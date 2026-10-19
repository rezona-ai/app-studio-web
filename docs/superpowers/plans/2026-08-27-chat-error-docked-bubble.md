# 实现计划：对话报错改为输入框上方的固定气泡

> 设计稿：`docs/superpowers/specs/2026-08-27-chat-error-docked-bubble.md`

机制替换按「并存加新 → 原子切换 → 删旧」推进。每个任务可独立测试、独立评审。

## T1 · 加 `agentError` 字段与写入/清除规则（尚无 UI）

- `store/types.ts`：`AgentError` 接口 + `KoubouState.agentError`，初值 `null`。
- `apply-koubou.ts`：`pushErrorBubble` 改为**同时**写 `agentError`（此阶段仍 append message，两套并存）；`run.started` / 成功 / 打断三处清 `agentError`。
- `store/index.ts`：`markPendingSend` / `markSteerSent` / `retryAgentNow` 三处清 `agentError`。
- 测试（先红）：
  - error 事件 / `build.failed` / `cancelAgentRetry` → `agentError` 置位且字段齐全
  - 六个清除时机逐条
  - **不落盘**：`sessionSnapshot(state)` 的结果里没有 `agentError`
  - **切项目归零**：`switchProjectSession` 后 `agentError` 为 null

验收：`pnpm test` 全绿；此时 UI 无变化（错误仍画在流里）。

## T2 · 原子切换：底部槽渲染 + 摘掉流内渲染

- 新增 `components/chat/AgentErrorBubble.tsx`：订阅 `agentError`，复用 `danger-bubble.ts` 共用类 + `ErrorDetail`；手动重试按钮判据 `lastSend != null && agentRetry == null && runStatus !== 'running'`。
- `ChatPanel.tsx`：`AgentRetryBubble` 从消息列表尾部挪到底部 `relative` 容器内、`ReconnectBanner` 之上；`AgentErrorBubble` 挨着它。
- `MessageItem.tsx`：删除 `case 'error'` 分支（返回 `null`），连同 `canRetry` 订阅与 `retryAgentNow` 调用一并移除。
- `store/index.ts`：`retryAgentNow` 签名收成无参，原因取自 `agentError`。
- 测试（先红）：
  - `AgentErrorBubble`：渲染主行译文 / 展开原文 / 重试按钮判据四种组合 / `agentError` 为空不渲染
  - `MessageItem`：error part 不再渲染任何东西
  - `ChatPanel`：两条气泡在 Composer 之前、消息列表之外（用 DOM 顺序断言）
  - 互斥：`agentRetry` 与 `agentError` 同时非空时只画重试气泡（防御性，正常不会发生）

验收：`pnpm test` 全绿；真机看四种态（错误 / 自愈中 / 自愈被受理 / 成功后消失）。

## T3 · 删旧：`pushErrorBubble` 不再写 messages + 老快照清洗

- `apply-koubou.ts`：`pushErrorBubble` 去掉 append message 那一半，只写 `agentError`（函数改名 `setAgentError` 更贴切）。
- `session-snapshot.ts`：`restoreSnapshot` 过滤掉「所有 part 都是 error」的消息（一次性清洗）。
- 全仓 grep `type: 'error'`，确认没有别的地方依赖流内错误消息（`MessageActions` 的复制文案、`renderNodes` 的分组、`TurnFooter` 的挂载判据）。
- 测试（先红）：
  - error 事件后 `messages` 长度不变
  - 老快照（含 error 消息）经 `restoreSnapshot` 后那条被滤掉，其余消息与顺序不变
  - 上一轮那条不变式测试改写：终态帧过后「要么自愈还在，要么 `agentError` 非空」（原判据是「有可见错误气泡」，落点变了判据要跟着变）

验收：`pnpm test` + `pnpm test:tz` + `tsc` + `lint` + `build`；真机验老会话（有存量 error 消息的项目）刷新后无空壳。

## T4 · 收口

- spec 回填实现落点与真机结论。
- 干净上下文子代理评审（只给 spec 与 commit 范围 diff），Critical / Important 修完再合。
