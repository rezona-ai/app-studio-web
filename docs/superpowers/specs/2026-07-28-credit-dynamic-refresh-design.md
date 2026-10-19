# 积分动态更新 + 版本消耗展示（设计稿）

2026-07-28

## 目的

1. **账户条余额随消耗动态更新**：用户在画布生成资产、与 agent 对话时，右上角 credit 数字不再需要刷新页面才变化。
2. **版本时间线展示该版本消耗的积分**：每个 Version 行紧跟版本名显示该版本区间内产生的积分消耗。

## 现状（核验于 2026-07-28）

- 余额 `ServerState.credit`（`BalanceData { balance, held, spendable }`）**只在挂载时拉一次**：`useUserInfo` → `loadUserInfo`（并发 `/auth/me` + `/credits/balance`，失败静默）。
- 另有两处刷新，均属充值链路：`useTopupFlow` 打开弹窗时、支付成功轮询到 `paid_at` 后。
- **消耗侧完全不刷新**——这是 `2026-07-05-credit-insufficient-modal-design.md` 显式划的非目标（「不做充值完成后的余额自动刷新/轮询」）。本设计稿推翻该非目标。
- 后端相关契约（Apifox 项目 8405123 核对）：
  - `GET /api/credits/balance` → `BalanceData`，唯一余额查询口，`spendable = balance - held`。
  - `GET /api/credits/ledger` → 用户级流水（游标分页），query 仅 `limit/cursor`，**不能按项目/版本过滤**；`ref_type/ref_id/metadata` 取值文档未枚举。
  - **生成接口响应不带扣费后余额、也不带本次消耗数**（核了 Generate Image 的 `CanvasItemListData`）。
  - Koubou WS 只有 `credit.insufficient`，**无余额变更推送事件**。
  - `VersionData` 无任何消耗字段；`/api/usage` 聚合粒度只到 `(user_id, project_id)` 且**只含 pgc 资产生成用量、不含 koubou 对话 LLM 用量**；admin `asset-spend` 证实 spend 归属维度是 `generation_usage`（user/project/type/model/日），**无 version 维度**。

结论：余额动态更新只能由前端在消耗时机主动 re-fetch；版本消耗积分**必须后端加口径**。

## 约束

- 前端不得臆测后端字段（项目反模式）。版本消耗字段按下文契约提案实现映射，**字段缺失时不渲染**，后端上线即自动显示。
- 余额是非关键信息：刷新失败一律静默（不走 `guard`、不弹 Toast、不触发登录跳转），沿用 `loadUserInfo` 既有语义。
- 刷新触发要**源头分流**，不在 6 个生成 action 里各撒一行；只挂在既有的单一漏斗上。
- 空闲时零额外请求；后台标签页不打后端（沿用 `useCanvasPolling` 的可见性门控）。
- 不引入新 UI 令牌 / 新组件种类；版本行高保持 60px（设计稿圆心间距）。

## 成功标准

1. 画布生成图片/音频返回后、视频/3D/绑骨/重纹理**发起后**与**完成后**、agent `run.finished` 后，账户条数字都会更新，无需刷新页面。
2. agent 长 run 期间（一次 run 内多次扣费）数字会持续跟进，不会憋到最后一跳。
3. 空闲（无 run、无在途生成任务）时不产生任何余额请求；后台标签页不请求。
4. 版本时间线在后端返回消耗字段时，每行版本名后显示 `⚡<紧凑数字>`，悬停给精确值；字段缺失时该处不占位。
5. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 方案

### A. 余额动态刷新（本轮落地）

**1) 新增 action `refreshBalance`**（`src/store/actions.ts`）

只拉 `/credits/balance`（不带 `/auth/me`，比 `loadUserInfo` 便宜一半），成功写 `credit`，失败静默。并发合流：在飞时复用同一 promise，避免多任务同时完成打出一串同样的请求。

`loadUserInfo` 保留原样（挂载与充值链路仍用它，它内部也拉余额）。

**2) 三个源头漏斗（不是六处散点）**

| 漏斗 | 位置 | 覆盖的消耗 |
|---|---|---|
| `runGen` 的 `call` 成功后 | `actions.ts` 生成骨架 | 图片/音频（同步已扣）+ 视频/3D/绑骨/重纹理（**发起即 held**，`spendable` 下降） |
| `pollGenTasks` 任务进终态后 | `actions.ts` 轮询推进 | 异步任务**结算**（held 释放、`balance` 下降）与失败退款 |
| `run.finished` 分支 | `useKoubouConnection.ts:151` 既有钩子 | agent 对话 LLM 消耗（与既有 `loadCanvas`/`loadVersions` 搭车） |

`runGen` 是全部六种生成的唯一骨架（image/audio/video/model3d/rig3d/retexture 都经它），故「发起侧」一处即全覆盖。

**3) 在途兜底轮询**

新 hook `useBalanceRefresh`（`src/client/`）：仅当 **`runStatus === 'running'` 或 `genTasks.length > 0`** 时，每 **15s** 拉一次余额；可见性门控（隐藏标签页不打，转回可见立即补一轮）。空闲时 interval 根本不建立。

复用现成模式：把 `useCanvasPolling` 内的 `useVisibilityGatedInterval` 抽到 `src/client/useVisibilityGatedInterval.ts` 共享，两个 hook 同源，不新造门控逻辑。

覆盖点：agent 一次 run 内的多次扣费、以及前端不可感知的消耗（后端侧任务、其他标签页操作）。

**4) 不做**：乐观扣减（无价目数据，无法本地预扣）；全局定时轮询；余额预检拦截（沿用「以后端错误为准」）。

### B. 版本消耗积分（前端预埋 + 后端待接）

**后端契约提案（待后端确认，字段名未定前实现按此映射）**

`VersionData` 增一个字段：

```
credits_spent: int | null   # 该版本区间内归属本项目的 credit 消耗合计
                            # 口径：上一个稳定版本创建时刻 → 本版本创建时刻
                            # 含：pgc 资产生成用量(generation_usage.estimated_credits)
                            #   + koubou 对话 LLM 用量
                            # 未计费 / 无数据 → null（前端不渲染，区别于 0）
```

选 `List Versions` 内联而非另开端点：时间线已在 `loadVersions` / `pollVersions` 两处刷新，内联字段零额外请求、天然随版本刷新同步；另开端点要再接一套轮询。

**前端预埋**

- `src/lib/pgc/types.ts`：`VersionData` 增 `credits_spent?: number | null`。
- `src/lib/pgc/map.ts` `versionToVersion`：映射为 `Version.creditsSpent?: number`（`typeof === 'number'` 才带上，`null`/缺失即 `undefined`）。
- `src/store/types.ts`：`Version` 增可选 `creditsSpent?: number`。

**UI 落点**（`src/components/preview/VersionTimeline.tsx`）

行结构由 `[圆点] 版本名 ⋯⋯ 时间戳(右)` 变为：

```
●─  V3  ⚡120            14:32
│
○─  V2  ⚡86             13:05
│
○─  V1  ⚡1.2K           11:40
```

- 紧跟版本名右侧（属该版本的属性，与右端时间戳分离，避免两个数字在窄宽度打堆）。
- 视觉：`FigIcon src={figAsset.credit} size={12}` + 数字，恒品牌青 `--color-teal`（与账户条 credit 同语汇，`tone="primary"` 随 currentColor）；`shrink-0`，让位者仍是版本名（`truncate`）。
- 数字格式沿用 `formatCredit`（K/M/B 紧凑，`en` 记法），`title` 给 `formatCreditExact` 精确值 —— 与账户条完全一致，不新造格式。
- `creditsSpent === undefined` 时整块不渲染（不占位、无「—」占位符）。
- i18n：新增 `preview.versionSpend`（如 `{{n}} credits spent on this version`）作 `title`/`aria-label`，补齐 11 套语言。

## 影响面

| 文件 | 改动 |
|---|---|
| `src/store/actions.ts` | 新增 `refreshBalance`；`runGen` 与 `pollGenTasks` 终态处接入 |
| `src/store/index.ts` | 导出 `refreshBalance` 到 `ServerActions` |
| `src/client/useVisibilityGatedInterval.ts` | 新文件：从 `useCanvasPolling` 抽出共享门控 |
| `src/client/useCanvasPolling.ts` | 改用共享门控（行为不变） |
| `src/client/useBalanceRefresh.ts` | 新文件：在途低频兜底轮询 |
| `src/components/workspace/Workspace.tsx` | 挂 `useBalanceRefresh` |
| `src/client/useKoubouConnection.ts` | `run.finished` 分支搭车刷余额 |
| `src/lib/pgc/types.ts` · `map.ts` · `src/store/types.ts` | 版本消耗字段预埋 |
| `src/components/preview/VersionTimeline.tsx` | 版本行显示消耗 |
| `src/i18n/locales/*.ts`（11 个） | `preview.versionSpend` |

## 测试计划

| 对象 | 用例 |
|---|---|
| `refreshBalance` | 成功写 `credit`；失败静默不写 `toast`；在飞期间重复调用只发一次请求 |
| `runGen` 接入 | 生成成功后调用 `refreshBalance`；生成失败（非 ABORTED）不调 |
| `pollGenTasks` | 任务进终态后调用 `refreshBalance` |
| `useBalanceRefresh` | `runStatus=running` 时按间隔 tick；`idle` 且无 genTasks 时不建 interval；`visibilityState=hidden` 时跳过 tick |
| `versionToVersion` | `credits_spent` 数字 → `creditsSpent`；`null`/缺失 → `undefined` |
| `VersionTimeline` | 有 `creditsSpent` 渲染紧凑数字 + 精确 `title`；无则该元素不存在 |

## 非目标

- 不做「本次将消耗 N 积分」的价目预告（后端无价目接口，另开需求）。
- 不做积分流水 / 消耗明细页面。
- 不改 `InsufficientCreditsModal` / `TopupModal` 既有逻辑。
- 不做余额预检拦截生成。
