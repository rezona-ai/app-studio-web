# 休眠恢复后连接卡死修复：消灭 `connecting` 无限期悬挂

日期：2026-07-21

## 背景与问题

电脑休眠恢复后，页面偶发「卡住不动」：既不重连也不报错。排查确认唤醒自愈体系存在两个死角：

1. **卡死在 `connecting`**：休眠切断 TCP 后，若时机落在建连过程中——`mintTicket` 的 fetch（无超时）在途，或 `new WebSocket` 握手未完成——恢复后该 fetch / 握手可能永远不 resolve 也不 reject。此时：
   - `shouldReconnectOnWake` 只对 `stalled/error/closed` 重连，`connecting` 被排除 → `onWake` 不动作；
   - 心跳看门狗只在 `onopen` 后启动 → `connecting` 阶段无任何超时保护；
   - 无 error/close 回调 → 无 toast，`ReconnectBanner` 也不出现（只认 `stalled/fatal`）。
2. **client 还没建出来**：`useKoubouConnection` 引导期的 `resolveSession` / `listEvents` fetch 同样无超时。若悬死，`clientRef.current` 恒为 `null`，`onWake` 里的 `clientRef.current?.reconnect()` 是 no-op，连接永远建不起来。

对照：连接已 `open` 时的半开连接由 45s 心跳看门狗兜底（休眠期间定时器冻结、唤醒后立即触发），能自愈——「卡住超过一分钟不恢复」即指向上述死角。

## 目的与成功标准

- **目的**：让 `connecting` 与引导期不再是无限期状态；任何悬挂在唤醒后有界时间内自动恢复。
- **成功标准**：
  - 握手悬死（socket 建出但永不 `onopen`）在超时后自动走退避重连；
  - `mintTicket` / 引导期 fetch 悬死在超时后 reject，落入既有 error / 回退分支；
  - 全部经单测覆盖（fake timers + FakeWS，同既有测试范式）；
  - `pnpm lint` / `tsc --noEmit` / `pnpm test` 全绿。

## 方案

### 候选

- **A. 全面加超时（选定）**：握手看门狗 + fetch `AbortSignal.timeout`。根治「无限期状态」，唤醒后由冻结的定时器立即触发恢复，无需改 `shouldReconnectOnWake`。
- **B. `onWake` 覆盖 `connecting`**：唤醒时若 `connecting` 已持续超阈值则强制 `reconnect()`。需要额外记录进入 `connecting` 的时间戳，且只治唤醒场景、不治普通网络悬挂；作为 A 的加速兜底属锦上添花，按 YAGNI 裁剪不做。
- **C. 只给 `onWake` 无条件重连**：`connecting`/`open` 一律重连——正常初连、切 tab 都会触发无谓重建连接，抖动大，否决。

### 选定方案细节（A）

1. **握手看门狗**（`src/koubou/client.ts`）：
   - 新增 `HANDSHAKE_TIMEOUT_MS = 15_000`。`ws = make(url)` 后立即起一个握手定时器；`onopen` 时清除并切换为既有 45s 心跳看门狗。
   - 超时处理**不依赖 `onclose` 回调**（僵尸 socket 可能不回调）：解绑全部 handlers → `close()` → `onStatus('closed')` → `scheduleReconnect()`，确定性推进。
   - 复用现有 `watchdog` 定时器变量（两阶段互斥：握手期 15s / open 后 45s），不新增并行定时器。
2. **`mintTicket` fetch 超时**（`src/client/useKoubouConnection.ts`）：`signal: AbortSignal.timeout(10_000)`。超时 reject 落入既有 `ticketFails` 计数 → error 退避重连 → 连续 5 次失败转 `stalled`（ReconnectBanner 手动重连）。
3. **koubou HTTP 统一超时**（`src/lib/koubou/client.ts`）：`koubou()` helper 里 `init.signal = AbortSignal.timeout(15_000)`。覆盖 `resolveSession`（`listSessions`）与种子化（`listEvents`）——两处失败均已有回退分支（新建会话 / WS 回灌历史），不劣于现状。该 helper 下全部接口均为轻量控制面调用（含 clone 模板元数据操作），统一 15s 合理。

### 休眠恢复时序（修复后）

休眠期间所有定时器冻结；唤醒后过期定时器立即触发：

- 卡在 `mintTicket` → `AbortSignal.timeout` 触发 → reject → error + 退避重连；
- 卡在 WS 握手 → 握手看门狗触发 → closed + 退避重连；
- 卡在引导期 fetch → 超时 reject → 回退分支 → 正常建 client；
- 已 open 半开 → 既有 45s 心跳看门狗（不变）。

即唤醒后最迟一个超时周期 + 退避（秒级）内恢复，全程有 `connecting/closed` 状态流转，不再静默卡死。

## 不做的事（YAGNI）

- 不改 `shouldReconnectOnWake`（方案 B/C）；
- 不给 PGC REST 加超时（与本 bug 无关，PGC 有独立错误兜底）；
- 不做「在途命令重放」（见 client.ts 既有注释，随后端 event_id 去重落地）。
