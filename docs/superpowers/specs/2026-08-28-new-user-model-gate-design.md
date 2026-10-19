# 新用户模型门禁设计（Rez1 锁 + 订阅弹窗）

日期：2026-08-28 · 状态：已批（盘问定案）· 关联接口：pgc `GET /api/auth/me/new-user-status`（`rezonalab-game-server@e47d47a`，`docs/api/auth.md`）

## 目的

新用户在对话模型选择器里默认只允许用自研模型 **Rez1**；选其他模型不切换，直接弹订阅弹窗，把「想用更强模型」这条意愿导到升档转化上。

## 现状（改动前）

- 模型列表：`koubouApi` 的 `GET /models?backend=` → store `availableModels` / `selectedModel`（`setAvailableModels` 里走 `resolveSelectedModel`，默认取列表首项，后端把 `Rez1` 排首位）。
- 选择器：`src/components/chat/ModelSelector.tsx`，复用公共 `Select`；`onChange` 写 `setSelectedModel` + `client.setModel(id)` 热切换。
- 建连模型：`src/client/useKoubouConnection.ts` 读 `selectedModel`（跨 backend 时置空）。
- 升购弹窗：`CreditModalGate` 按 `plansCache.current_tier` 路由——`free` → `AllPlansModal`（三档并排），付费档 → `CreditUpsellModal`。`plansCache` 是**懒加载**（弹窗打开才拉，见 `useSubscriptionPlans`）。
- 权益矩阵里已有 `entitlements.premium_models`，但它**仅展示、后端无强制**（biz-api 注释写明；2026-08-31 查证纠正了本文最初「后端强校验的两项之一」的错误说法），且 `free` **不是可售档位、不出现在 `plans[]` 里**，前端读不到 free 的 entitlements —— 故前端口径只能落在 `current_tier === 'free'`。

## 判定口径（盘问定案）

**锁定 = `is_new_user === true` 且 `current_tier === 'free'` 且 `availableModels` 里确有 `Rez1`。**

- 叠加 `free`：已付费用户即便还没 build 过版本也不锁——对已订阅的人弹订阅窗没有意义。
- 要求列表里确有 `Rez1`：后端没下发自研模型时锁死等于把对话废掉（无可用模型），此时放行。
- 新用户判定取后端 `is_new_user`（口径「自建项目中没有任何一个 build 出过版本」，`modes` 用默认的 `prompt`+`mcp`，不传参）。

### 未知一律放行

三项输入任意一项未知（接口 401/403/422/503、网络失败、`plansCache` 还没到）都**不锁**。文档明说那三个 503（`NEW_USER_STORAGE_UNAVAILABLE` / `NEW_USER_SCAN_TRUNCATED` / `NEW_USER_PROVENANCE_UNKNOWN`）是「暂时不知道」，把它当新用户会误伤老用户；此处误伤的表现是「老用户突然只能用 Rez1」，比漏放几个新用户糟得多。

## 交互（盘问定案）

- 下拉里**所有模型照常列出，不加锁标**——外观零改动。
- 点击非 Rez1 的项：**不写 `selectedModel`、不发 `session.set_model`**，只 `setCreditModalOpen('modelLocked')`。free 档经 `CreditModalGate` 必然落到 `AllPlansModal`。
- 点 Rez1（当前项）照旧无操作。
- 埋点：新增 `UpsellSource = 'modelLocked'`，`triggerDimension` 映射到 `'game_model_locked'`（2026-08-31 对齐主站 `PaywallTrigger` 的同名字面值），曝光仍由 `CreditModalGate` 统一上报（不在选择器里另报一条）。

## 强制归位

锁生效时 `selectedModel` 强制回落 `Rez1`（持久化里可能留着上次选的 Claude，或同账号换环境）。评审发现只挂一个 effect 拦不住——`selectedModel` 有四个独立写入口，故归位做成**写入口的不变式**：

1. `setSelectedModel` 内部过 `gatedModel`：覆盖 UI 选择与 `applyStudioPrelude` 的 `?model=`；
2. `switchProjectSession` 取回的项目模型记忆过 `gatedModel`：否则切到一个记忆是 Claude 的旧项目就绕过了锁；
3. 建连：`useKoubouConnection` 取建连模型时过同一份纯函数；
4. **给在世会话补一条 `session.set_model`**：冷启动时门禁要两个往返才判定、建连只等 `currentProjectId`，常态是连接先建起来（带着 persist 里的旧模型）。只改 store 会出现「UI 已归位、会话仍跑 Claude」，而后端并不拦（`premium_models` 无强制），等于锁在这条路径上完全失效——用户照旧用着别家模型。`model.changed` 回填也可能把旧模型写回，故归位 effect 依赖含 `selectedModel`。

已知取舍：归位会把 `modelByProject` 里的旧选择一并覆盖成 `Rez1`，解锁后回不到用户原来选的模型。可接受——重新选一次即可。

## 刷新时机（盘问定案）

- 进工作台拉一次 `new-user-status`，结果落 store 瞬态字段（**不持久化**：它是服务端事实，缓存过夜只会拿旧结论锁人）。
- `is_new_user === true` 时才顺带拉 `plans`（复用 `useSubscriptionPlans`）——非新用户根本不需要 tier，省一次请求。
- **版本 build 成功后重拉一次**：那一刻用户不再是新用户，应当场解锁，不必刷新页面。
- 订阅成功不重拉新用户状态（tier 变化由现有订阅链路刷新 `plansCache`，锁随之解除）。

## 成功标准

1. 新用户 + free：下拉点 Claude/GPT 等 → 不切模型、弹 AllPlansModal；`selectedModel` 恒 `Rez1`，建连也用 `Rez1`。
2. 新用户 + 已订阅任意档：不锁，随便切。
3. 非新用户：不锁。
4. 接口 503 / 网络失败 / plans 未到：不锁。
5. 列表里没有 `Rez1`：不锁。
6. 锁定态下 build 出一个版本 → 重拉后当场解锁，无需刷新。

## 已知取舍（评审记录，非缺陷）

- 「build 成功」用 `versions.length` 增长代理：切项目 / 冷启动填充也算增长，会多打一次重量级扫存储请求。已被 `newUserStatus === true` 收窄（新用户的项目通常无版本），不值得为此接进 `run.finished` 那套判据。
- 归位覆盖项目模型记忆（见上）。

## 不做

- 不做后端侧的模型权限校验：`premium_models` 仅展示、后端不拦，对话模型走 koubou `GET /models` 也没有 tier 校验，故本门禁**纯体验层**（2026-08-31 查证）。
- 不给锁定模型加锁图标 / 灰态（定案：外观不变）。
- 不做「解锁后提示」之类的额外反馈。
