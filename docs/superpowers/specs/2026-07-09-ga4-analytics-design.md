# GA4 埋点集成设计（game 站 · §4）

> 2026-07-09 · 依据《Taluna 埋点二期开发说明（studio / api / film / game 四端）》
> 原文档：飞书 wiki `F67tw07K9i97w4kHtAclfc1fgzh`（doc_id `HPAXdCPLcoancrxIFN3lVnG8gGf`）
> 本仓库 `game-create-platform` = **game 站（taluna-game）**，对应原文 §4「从零接入」。

## 1. 背景与范围

- game 站此前**无任何 gtag / GA4 / dataLayer 接入**，本期从零集成。
- **范围 = 原文 §4 全部事件**（§4.0 地基 + §4.1 编辑器核心 + §4.2 画布生成与素材 + §4.3 分享导出与变现），外加 §0 通用约定。
- 原文 §1（studio）/§2（api）/§3（film）**不在本仓库范围**，仅作跨站语义参照。
- GA4 property 四端共用：**PROD `G-P8ZW92PW19` / TEST `G-H4SNKB0DCX`**。

### 已确认决策（Nick 拍板）

1. **环境区分**：新增构建期变量 `NEXT_PUBLIC_APP_ENV`（`prod` | 其余）。
2. **id 口径**：事件里的 `project_id` 与 `game_id` **均取 `project.public_id`**（对外 Sqids 标识，与分享/游玩直链一致，跨站可 join）。
3. **分期**：§4 一次做完。

## 2. 架构分层

贴合仓库既有原则：**纯逻辑下沉 `lib/`（无副作用可测）· 副作用隔离 `client/` hooks · 唯一 zustand store 是真相源 · 调用点极薄**。

```
src/lib/analytics/
├── config.ts      # resolveGa4(): 读 NEXT_PUBLIC_APP_ENV → { measurementId, env, enabled, debug }
│                  #   'prod' → { G-P8ZW92PW19, env:'prod', debug:false }
│                  #   其余(test/dev/未设) → { G-H4SNKB0DCX, env:'test', debug:true }
│                  #   两个 measurement id 是公开常量(本就随 bundle 下发),硬编码入表,不再新增 id 变量
├── events.ts      # 事件目录:GA4EventName 联合 + 每事件专有参数类型(集中真相源,强制 snake_case)
├── context.ts     # getCommonParams(): 从 useStore.getState() 派生 6 公共参数 + from_page + env
│                  #   parseFromPage(search): 纯函数,读 ?from_page,回退 'direct'(可测)
├── failReason.ts  # mapFailReason(code): 后端 failure.code / 错误码 → fail_reason 枚举(纯函数,可测)
└── gtag.ts        # track() / trackAndWait() / setUserId() / pushGtag():
                   #   SSR(无 window)与 gtag 未就绪时一律 no-op 守卫;不抛错
src/client/
└── useAnalytics.ts  # 挂载于 Workspace:① 读并锁定 from_page ② 发一次 page_view(editor,StrictMode ref 去重)
                     #   ③ 订阅 store.userInfo → setUserId(登录设原生 User-ID / 登出置 null)
```

**调用契约**：业务触发点只调 `track('event_name', { 专有参数 })`；6 个公共参数（`product`='gamestudio' / `env` / `page_name`='editor' / `from_page` / `is_login` / `user_id`）由 `track()` 内部经 `getCommonParams()` 自动补齐，业务处**不重复传**（原文 §0-1）。`events.ts` 的类型让专有参数在编译期就锁定名字与取值，满足 §5.1 自测口径、防拼写漂移。

### gtag 加载

`src/app/layout.tsx`（server component）用 `next/script` 的 `<Script>`（`afterInteractive`）注入标准 GA4 片段：

1. loader：`https://www.googletagmanager.com/gtag/js?id=<measurementId>`；
2. inline init：`window.dataLayer=[]; gtag('js', new Date()); gtag('config', id, { send_page_view:false })`。

- `send_page_view:false`：关掉 gtag 自动 page_view，改由 `useAnalytics` 发**带公共参数**的自定义 page_view。
- 非 prod 环境 init 追加 `debug_mode:true`，供 GA4 DebugView 自测（§5.1）。
- measurement id 在 server 层由 `resolveGa4()` 解析后注入 inline 脚本。
- gtag 从 `googletagmanager.com` 加载（外域，非本服务 `/api`），**不经 basePath**；需确认部署无 CSP 拦截该域（本仓库现无 CSP 头，验收时复核）。

> 备注：`new Date()` 在应用运行期客户端代码中可用（仅 Workflow 脚本禁用），不受限制。

## 3. 地基（§4.0）

| 公共参数 | 取值来源 |
|---|---|
| `product` | 常量 `'gamestudio'` |
| `env` | `resolveGa4().env`（`prod`/`test`） |
| `page_name` | 常量 `'editor'`（本站单场景，§4.0） |
| `from_page` | 挂载时读 URL `?from_page`，回退 `'direct'`，锁定整个会话（§0-2） |
| `is_login` | `userInfo != null ? 1 : 0`（"已拿到用户信息"近似，§4.0） |
| `user_id` | `userInfo.id`（登录后带；游客不传）；同时 `gtag('set',{user_id})` 设原生 User-ID，登出置 null |

- **`page_view`**：SPA，`useAnalytics` 在 Workspace 挂载时发一次（新建 / 打开 / remix 进入都算一次到访，§4.0）。StrictMode 双挂载 / HMR 用 `ran` ref 去重（沿用 `useProjectBootstrap` 范式）。
- **`from_page`**：`useProjectBootstrap` 的 prelude/remix 流程会在成功后**剥离 URL**（`replaceState`）。`useAnalytics` 必须在挂载 effect 同步起点先读 `window.location.search` 捕获 `from_page`，早于 URL 被剥。用纯函数 `parseFromPage(search)` 解析（可测）。
- **user_id 异步**：`userInfo` 由 `useUserInfo` 挂载后异步拉取；登录后首个事件可能缺 `user_id`（§4.0 明确可接受）。`useAnalytics` 订阅 `userInfo` 变化，就绪即 `setUserId`。

## 4. 事件全量表（§4 · 共 14 项）

> 落点为现有代码位置（行号以实现时复核为准，可能已漂移）。`model` 等标注"以实装为准"的枚举按**原始 id 上报**，落点后同步数据团队核对定稿（§5.2）。

### §4.0 / §4.1 编辑器核心

| 事件 | 落点 | 专有参数 | 说明 |
|---|---|---|---|
| `page_view` | `useAnalytics`（Workspace 挂载） | —（仅公共参数） | 仅 `editor` 场景，一次到访一次 |
| `chat_message_submit` | `Composer.send()` 空内容拦截之后、下发 WS 命令之前 | `model`; `project_id` | steer / 空闲首发 / landing 自动发送三分支合并一处插桩 |
| `model_switch` | `ModelSelector.tsx` `onChange` | `model_from`; `model_to` | 旧值 = 当前 selected，新值 = 选中 id |
| `game_generate_success` | `useKoubouConnection.onEvent` `run.finished(succeeded)` 分支，`loadVersions` 后 | `version_id`; `version`; `game_id`; `generate_duration`; `project_id` | **仅当产出新版本**才报（对比刷新前后版本 id 集合，新增即报；仅答疑/改画布无新版本不报，§4.1） |
| `game_generate_fail` | 同上，**新增**失败/中断分支 | `fail_reason`; `game_id`; `project_id` | 见 §5.1 |

### §4.2 画布生成与素材

| 事件 | 落点 | 专有参数 | 说明 |
|---|---|---|---|
| `asset_generate_submit` | `GenerateForm.submit()` `canSubmit` 之后、`requestClose()` 之前 | `modality`; `model`; `project_id` | 仅生成类菜单项；与整局 `game_generate_*` 是两回事 |
| `asset_generate_success` | 同步(图/音): `settleGenPlaceholders`；异步(视/3d): `pollGenTasks` 资产 ready 处 | `modality`; `model`; `asset_id`; `generate_duration`; `project_id` | `asset_id` = 替换占位卡的真实资产 item_id |
| `asset_generate_fail` | `failGenTask`（集中兜底，一处） | `modality`; `model`; `fail_reason`; `project_id` | 同步失败经 `runGen` catch→guard；异步失败经 poll。§0-3 幂等一处 |
| `asset_upload` | `adoptAgentItem`：媒体上传成功处 / `createTextAsset` 文本成功处 | `kind`(`image`/`video`/`audio`/`text`); `project_id` | 上传≠生成，独立事件；**排除对话窗 chat 附件**（`uploadChatAttachment`，不落画布） |

### §4.3 分享导出与变现

| 事件 | 落点 | 专有参数 | 说明 |
|---|---|---|---|
| `game_share_click` | `FileMenu.tsx` Share game / Share to Rezona 两 onClick | `target`(`link`/`rezona`); `project_id` | `link`=Share game，`rezona`=Share to Rezona |
| `game_link_copy` | `SharePopover.copy()` `writeText` resolve 之后 | `game_id`; `project_id` | 仅复制成功后（失败走 Toast 不报） |
| `game_export_submit` | `RezonaPublishModal.submit()` 确认提交时刻 | `target`='rezona'; `project_id`; `version_id` | |
| `out_of_credits_show` | `CreditModal` 挂载 effect（组件仅打开时挂载，一处覆盖所有触发源） | `trigger` | 本弹窗无差额/档位信息，不带 `credit_gap`（§4.3） |
| `out_of_credits_recharge_click` | `CreditModal.recharge()` `window.open` 之前（用 `trackAndWait`） | `trigger` | 见 §5.2 |

## 5. 需要的功能性改动

### 5.1 `game_generate_fail` 分支（唯一功能缺口）

`useKoubouConnection.onEvent` 目前**只处理** `run.finished(succeeded)`（触发 `loadCanvas`+`loadVersions`），**没有失败/中断的 side-effect 分支**——失败当前仅在 reducer 里产错误气泡。需新增对以下三种终态的埋点分支：

- `run.finished` 且 `status !== 'succeeded'`
- `run.interrupted`
- `build.failed`

`fail_reason` 走 `mapFailReason()`：`build_error` / `timeout` / `insufficient_credit` / `server_error` / `content_blocked`。**中断（interrupted）暂归 `build_error`**（原文该枚举标注"最终枚举与数据侧对齐"，落点后核对）。此分支纯为埋点，不改动既有 UI / reducer 行为。

### 5.2 CreditModal 充值跳转补 §0-2 参数

`CreditModal.recharge()` 现 `window.open(origin + '/studio/settings?section=recharge')` **未带跳转参数**。按 §0-2 / §4.3，跳向 studio 充值页的 URL 须补：

- `source_product=gamestudio`
- `source_trigger=insufficient`
- `from_page=editor`（= 当前 page_name）

并在 `window.open` 之前用 `trackAndWait('out_of_credits_recharge_click', ...)`（§0-5，虽然 `window.open` 开新标签不卸载当前页，仍按约定保证送达）。

## 6. 幂等 & generate_duration（§0-3）

- **不上报任何任务 id**：不自造 uuid，不传 job_id/run_id/request_id；success 只带产物实体 id（`version_id` / `asset_id`）。
- **幂等去重**（同一次生成只报一次 success 或 fail）：
  - `game_generate_*`：模块级 `Set<run_id>` 记"已报"；成功或失败任一先到即锁。
  - `asset_generate_*`：按占位卡 item_id 记"已报"；`failGenTask` 与 success 落点共用同一去重集。
- **`generate_duration`（前端自算 ms）**：
  - game：`TurnMeta.startedAt`(run.started.created_at) → `finishedAt`(run.finished.created_at)，复用 `src/lib/koubou/duration.ts`。
  - asset 异步（视/3d）：`GenTask.startedAt` → ready 时刻。
  - asset 同步（图/音）：`generateImage/Audio` 调用前后就地计时。

## 7. 测试策略（TDD，纯逻辑同目录 `*.test.ts`）

- `parseFromPage`：有/无 `from_page`、空串 → `direct`。
- `resolveGa4`：`prod` → PROD id+`prod`+debug=false；其余/未设 → TEST id+`test`+debug=true。
- `mapFailReason`：各后端 code / credit code / 缺省 → 目标枚举。
- `getCommonParams`：mock `useStore.getState()`（登录/游客/无项目），断言 6 参数与 id 口径（public_id）。
- `gtag` 守卫：SSR（无 window）与 gtag 未就绪 → `track` 静默 no-op，不抛错。
- `game_generate` 判定：succeeded+新版本 → success 一次；succeeded 无新版本 → 不报；失败/中断 → fail 一次；同一 run 重复终态 → 只报一次（幂等）。
- 触发点调用为薄封装（1~2 行 `track(...)`），不单独强测；关键幂等/判定逻辑抽成纯函数后测。

## 8. 新增 / 改动文件清单

**新增**
- `src/lib/analytics/config.ts` · `events.ts` · `context.ts` · `failReason.ts` · `gtag.ts`（+ 各自 `*.test.ts`）
- `src/client/useAnalytics.ts`

**改动**
- `src/app/layout.tsx`：注入 gtag `<Script>`
- `src/components/workspace/Workspace.tsx`：挂载 `useAnalytics()`
- `src/components/chat/Composer.tsx` · `ModelSelector.tsx`：`chat_message_submit` / `model_switch`
- `src/client/useKoubouConnection.ts`：`game_generate_success/fail`（含新增失败分支）
- `src/store/actions.ts`：`asset_generate_*` / `asset_upload`（settle/poll/failGenTask/adopt/createText）
- `src/components/canvas/GenerateForm.tsx`：`asset_generate_submit`
- `src/components/preview/FileMenu.tsx` · `SharePopover.tsx` · `RezonaPublishModal.tsx`：分享导出三事件
- `src/components/ui/CreditModal.tsx`：`out_of_credits_show/recharge_click` + 跳转补参
- `deploy/dockerfile` · `.github/workflows/deploy.yml`（production 设 `NEXT_PUBLIC_APP_ENV=prod`）· `.env.example`

## 9. 验收（§5）

1. 开发自测走 TEST property（`G-H4SNKB0DCX`）+ GA4 DebugView，逐事件核对事件名、6 公共参数、专有参数取值（本地默认解析为 test + `debug_mode`）。
2. 枚举型参数（`model` / `fail_reason` / `trigger` / `target` 等标注"以实装为准"的）落点后把实际取值清单同步数据团队核对定稿。
3. 自定义维度注册、Ads / 关键事件配置由数据侧负责，前端无需操作。

## 10. 待数据侧核对项（不阻塞开发，落点后确认）

- `project_id` / `game_id` 口径：本设计取 `public_id`；若数据侧要求 `project_id` 用稳定数值主键，只需改 `context.ts` 一处。
- `game_generate_fail` 的 `fail_reason` 枚举（尤其"中断"归类）。
- `chat_message_submit` 是否需要区分 steer / 首发（本设计仅带 `model`+`project_id`，未加 is_steer）。
