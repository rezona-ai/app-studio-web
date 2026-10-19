# 订阅订单轮询提进 store（实现计划）

设计稿：`docs/superpowers/specs/2026-08-14-subscribe-order-watch.md`
分支：`feat/subscribe-order-watch`

按「并存加新 → 原子切换 → 删旧」推进：T1–T3 只加 store 侧能力（旧轮询照跑，行为不变），T4 一次性切换 hook 并删旧轮询，T5 接线到应用层。每个任务可独立测试、独立评审。

## T1 · store 状态与登记 action

- `ServerState` 加瞬态 `subscribeOrder: SubscribeOrder | null` 与 `subscribeSucceeded: boolean`，`createInitialServerState()` 补默认值；**不进 `persist` 白名单**。
- `ServerActions` 加 `watchSubscribeOrder({ id, tier })`：写入并记 `startedAt`。
- 测试（`src/store/subscribe-watch.test.ts` 新建）：登记后状态就位；切项目 / 初始态不残留。

## T2 · `pollSubscribeOrder` 状态机

一次拉单推进一轮，四个分支：

| 分支 | 动作 |
|---|---|
| `active` 且 tier 已切到目标档 | 收单 → success Toast → `loadUserInfo()` → 失效 `plansCache`（分两种，见 T3） |
| `closed`/`expired`/`canceled` | 收单 → error Toast |
| 超过 10 分钟 | 收单，不判失败 |
| 拉单抛错 | **先判超时**，未超时才跳过本轮 ← C7 |

判成功的判据沿用现有语义：`status === 'active' && order.tier === 目标档`（升档改的是同一条订阅行，授权期间恒 active，只看 status 会提前误报）。

- 测试：四个分支各一条；外加「持续失败满 10 分钟收单」这条 C7 的复现（改前必须红）。

## T3 · `plansCache` 失效的两种时机

- `pollSubscribeOrder` 成功分支：`creditModalOpen === false && !topupModalOpen && !allPlansOpen` → 直接清 `plansCache`；否则只置 `subscribeSucceeded = true`。
- `setCreditModalOpen(false)`：若 `subscribeSucceeded` → 一并清 `plansCache` 并复位标记。
- 测试：无弹窗时成功即清；有弹窗时不清且标记置位；关窗那一刻清且标记复位。

## T4 · 切换 `useSubscribeFlow`（原子）

- 建单成功改调 `watchSubscribeOrder`，**删掉**自身的轮询 `useEffect`、`pending` 局部 state、`succeededRef` 与其卸载清缓存 effect（C1 的实现由 T3 取代，不留两套）。
- `phase` 改派生：本地 `creating` + `subscribeOrder != null → waiting` + `subscribeSucceeded → active`。
- 自动关窗保留。
- 测试：现有 `useSubscribeFlow.test.tsx` 整体改写到新形状；新增 **C6 复现**——`waiting` 期间 `unmount()` 后 `store.subscribeOrder` 仍在（改前红）。

## T5 · 应用层驱动

- 新增 `src/client/useSubscribeWatch.ts`：`useVisibilityGatedInterval(subscribeOrder != null, 3000, tick)`，tick 内二次读现值防 interval 存活期内已收单（照 `useCanvasPolling` 的写法）。
- 挂进 `Workspace.tsx`（与 `useCanvasPolling` / `useBalanceRefresh` 并列）。
- 测试：`useSubscribeWatch.test.tsx`——有单才建 interval、收单即停、hidden 不打后端、转可见立即补一轮。

## 验证

每个任务跑对应单测；全部完成后在分支上跑完整门 `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`，再 `--no-ff` 合回 dev 并在合并结果上重跑一遍。

## 风险

- **phase 派生后 `subscribeSucceeded` 的归属**：它是全局标记，同一时刻只可能有一个订阅流在飞（CTA 非 idle 即禁用），故不需要按弹窗实例区分。若将来允许并发下单，这里要改成按 order id 归属。
- **`onSeeAllPlans` 跨弹窗跳转**：切换后 `PlanBody` 卸载但 store 保有在飞单，新弹窗里 phase 仍是 `waiting`，CTA 照常禁用——顺带把「跳过去还能再下一单」也堵上了。
