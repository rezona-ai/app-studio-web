# 订阅订单轮询提进 store（设计稿）

日期：2026-08-14 · 触发来源：PR #9 第三轮 Codex 评审 C6（`useSubscribeFlow.ts:126`）

## 目的

让「已下单、等待权益开通」这件事的存活周期与**弹窗生命周期解耦**。当前轮询挂在 `useSubscribeFlow` 的 `useEffect` 里，弹窗一卸载 `clearInterval` 就把它带走。

## 现状与问题

`useSubscribeFlow` 内部持有 `pending` 局部 state 并自建 `setInterval`，清理函数无条件 `clearInterval`。而所有关闭路径都不受 `phase` 约束：

- `CreditUpsellModal`：遮罩点击（:66）、Escape（:48）、关闭按钮（:78）
- `AllPlansModal`：同样三处（:50 / :36 / :60）
- **`onSeeAllPlans`（`CreditUpsellModal.tsx:179`）** —— 最尖锐的一条：`waiting` 期间点「See all plans」，Gate 改渲染 `AllPlansModal`，`PlanBody` 卸载，轮询随之消失。用户并没有放弃，收银台还开着。

只有 CTA 是 `disabled={phase !== 'idle'}`。

后果：支付照样成功（权益由 Waffo webhook 保证，用户不吃亏），但前端永远不知道——`loadUserInfo()` 不跑、`plansCache` 停在旧档位，重开弹窗仍按旧档渲染，并可能对已订阅用户再打一次首次订阅接口（即 C1 修的那个洞在这条路径上重新裂开）。

## 约束

1. **沿用既有轮询范式**：状态进 store，节奏由 `client/` hook 驱动（`useCanvasPolling` / `useBalanceRefresh` 已是这个形状），门控复用 `useVisibilityGatedInterval`——「门控语义只此一份」。副作用与纯逻辑分层不破。
2. **不持久化**：`subscribeOrder` 是瞬态，不进 `persist` 白名单。刷新页面本来就会丢 `plansCache`（它也是瞬态），下次开弹窗自然重拉当前档位，刷新场景天然自愈，不需要跨刷新续轮询。
3. **可见性门控是升级不是退化**：用户此刻多半在收银台标签页（本页 hidden）。`useVisibilityGatedInterval` 在 hidden 时不打后端、切回可见立即补一轮——比现在盲目每 3s 打一次更省，且回来那一刻就能判定。
4. **不能在成功那一刻清 `plansCache`**：`CreditModalGate.tsx:68` 见 `plans == null` 直接 `return null`，弹窗会当场消失、吃掉成功态停留。这条约束来自 C1，继续成立。
5. **替换而非堆叠**：C1 那套「hook 卸载时清缓存」的 `succeededRef` 机制由本方案的 store 分支取代，一并删掉，不留两套。
6. **`useTopupFlow` 本轮不动**：形状类似但它有 `cancelOrder` 与弹窗内 waiting UI，语义不同；本轮只做订阅，避免范围蔓延。

## 方案

### store（`ServerState`，瞬态）

- `subscribeOrder: { id, tier, startedAt } | null` —— 在飞的订阅单。
- `subscribeSucceeded: boolean` —— 「成功了但弹窗还开着」的待失效标记。

### ServerActions

- `watchSubscribeOrder({ id, tier })`：登记，记 `startedAt`。
- `pollSubscribeOrder()`：推进一轮。
  - 拉单失败 → **只判超时**（超时则收单回可重试态），否则跳过本轮 ← 顺带修 C7（见下）
  - `status === 'active' && tier === 目标档` → 收单 + success Toast + `loadUserInfo()` + 失效 `plansCache`
  - 落在 `DEAD_STATUSES`（closed/expired/canceled）→ 收单 + error Toast
  - 超过 `POLL_DEADLINE_MS` → 收单，**不判失败**（到账最终由 webhook 保证）
- `plansCache` 失效时机分两种：
  - 成功时**没有弹窗开着** → 直接清（没人在渲染它，安全）
  - 有弹窗开着 → 只标 `subscribeSucceeded`，由 `setCreditModalOpen(false)` 在关窗那一刻连同标记一起清

### client

- 新增 `useSubscribeWatch()`：`useVisibilityGatedInterval(subscribeOrder != null, 3s, pollSubscribeOrder)`，挂进 `Workspace.tsx`（与 `useCanvasPolling` / `useBalanceRefresh` 并列）。

### `useSubscribeFlow` 收缩

只留「下单」：建单成功 → `watchSubscribeOrder(...)`。删掉自身的轮询 effect、`pending` 局部 state、以及 C1 的 `succeededRef` 卸载清缓存。`phase` 改为派生：

| phase | 判据 |
|---|---|
| `creating` | 建单请求在飞（hook 本地） |
| `waiting` | `store.subscribeOrder != null` |
| `active` | `store.subscribeSucceeded`（它只在弹窗开着期间为真，关窗即清） |
| `idle` | 其余 |

自动关窗（成功停留 1.5s）仍留在 hook——只有弹窗还开着时才有意义。

## 顺带修：C7（`useSubscribeFlow.ts:110`）

现有失败分支 `catch { return; }` 直接返回，绕过了下面 else-if 链里的超时判断，持续 5xx / 超时会让弹窗永远停在 `waiting` 并每 3s 打一次，10 分钟兜底形同虚设。轮询搬进 store 后，失败路径显式补上超时判定。

## 成功标准

1. `waiting` 期间关闭弹窗或点「See all plans」，轮询继续；随后支付成功时 Toast、`loadUserInfo`、`plansCache` 失效照常发生。
2. 弹窗开着时成功，成功态停留不被打断（`plansCache` 不在那一刻变 null）。
3. 持续拉单失败满 10 分钟后收单回可重试态，不再无限轮询。
4. 刷新页面后不续轮询，但也不残留错误档位（`plansCache` 本就瞬态，重开即重拉）。
5. 后台标签页不打后端，切回可见立即补一轮。

## 不做

- 不持久化在飞订单、不做跨刷新续轮询（约束 2）。
- 不动 `useTopupFlow`（约束 6）。
- 不改任何弹窗的关闭可达性——关窗自由是这次方案要保住的东西，不是要堵的洞。
