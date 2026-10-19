# 实现计划：休眠恢复连接卡死修复（connecting 超时化）

对应设计稿：`docs/superpowers/specs/2026-07-21-ws-wake-connecting-timeout.md`

## 任务拆分（每任务独立可测、完成即提交）

### 任务 1：握手看门狗（client.ts）

- 文件：`src/koubou/client.ts`、`src/koubou/client.test.ts`
- TDD：
  1. 失败测试 A：socket 建出后永不 open，推进 15s → 旧 socket 被 close、状态收到 `closed`，再推进退避 → 创建第二个 socket（`created.length === 2`）；
  2. 失败测试 B：socket 在 15s 内正常 open → 握手看门狗不误杀（推进至 15s 后 socket 仍 OPEN、无重连）；且 open 后 45s 无帧心跳看门狗仍生效（既有行为不回归，若已有用例覆盖则确认不红即可）。
- 实现：`HANDSHAKE_TIMEOUT_MS = 15_000`；`ws = make(url)` 后启动握手定时器（复用 `watchdog` 变量）；超时处理解绑 handlers → close → `onStatus('closed')` → `scheduleReconnect()`；`onopen` 里 `kickWatchdog()` 自然切换为 45s 心跳档。
- 验证：`pnpm exec vitest run src/koubou/client.test.ts`

### 任务 2：mintTicket 与 koubou HTTP fetch 超时

- 文件：`src/client/useKoubouConnection.ts`、`src/lib/koubou/client.ts` 及各自测试
- TDD：
  1. 失败测试 C（`useKoubouConnection.test.tsx`）：断言 ws-ticket 的 fetch init 带 `signal`（AbortSignal 实例）；
  2. 失败测试 D（`src/lib/koubou/client.test.ts`，如无则新建）：断言 `koubouApi.listSessions` 发出的 fetch init 带 `signal`。
- 实现：`mintTicket` fetch 加 `signal: AbortSignal.timeout(10_000)`；`koubou()` helper 加 `init.signal = AbortSignal.timeout(15_000)`。
- 验证：`pnpm exec vitest run src/client/useKoubouConnection.test.tsx src/lib/koubou/client.test.ts`

### 任务 3：全量验证

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
- 全绿后回合 dev（`--no-ff`），删分支、清理 worktree。

## 风险

- jsdom 是否有 `AbortSignal.timeout`：Node 22 原生支持，jsdom 环境用的是 Node 全局，预期可用；若缺失则测试先暴露，再决定 polyfill 或改用 AbortController+setTimeout。
- 握手看门狗与 `connect()` 中「重连前解绑旧 socket」路径的定时器竞态：统一经 `clearWatchdog()` 清理，任务 1 测试覆盖重连路径。
