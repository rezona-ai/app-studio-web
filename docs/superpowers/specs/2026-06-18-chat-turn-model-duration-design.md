# 对话轮次「模型 + 耗时」footer 设计

> 在每一轮问答（agent run）最后一条 assistant 消息下方，展示该轮**实际所用模型**与**执行耗时**：进行中实时跳秒（`Running for 18s`），结束后定格（`Ran for 12s` / `5m 10s`）。范围覆盖**每一轮，含历史与刷新**——靠服务端 `created_at` 之差算时长，从可重放事件日志重建，本地缓存随会话持久化。

## 背景与目标

参考 Gemini 对话产品：每轮回复底部挂一行「模型 · 耗时」，滚回历史轮也在，进行中那轮实时跳秒。

现状数据缺口：

- `Message`（`id/role/parts/status`）**不带**模型与耗时。
- 会话级 `KoubouState.model` 来自 `SystemMessage`，且模型可在对话中热切换（`ModelSelector` → `session.set_model`），故**每轮模型可能不同**，不能只用会话级单值。
- 一轮天然由 `run.started → run.finished` 这对事件界定；事件 envelope 带 `created_at`（服务端时钟），`run.started/finished/interrupted` 均为**可重放**（带 `sequence`）事件（见 `docs/.../2026-06-09-koubou-websocket-conversation-design.md` §第 75/165 行）。

目标：在不破坏「纯 reducer + 单一 store」架构前提下，给每轮补齐 `{ model, 起止时间, 状态, 锚点消息 }`，并在 UI 渲染 footer。

## 取舍

- **时间源 = 服务端 `created_at` 之差**（契约背书，live / 历史 / 翻页统一）。进行中那轮 UI 用 `now - startedAt` 跳秒，对客户端/服务端轻微时钟偏移做 `max(0,…)` 钳制——秒级展示无感。不依赖当前被忽略的 `ResultMessage.duration_ms`（可靠性未知，且无法支撑实时跳秒）。
- **per-turn 元数据进 reducer 并持久化**，而非从 messages 反推：`Message` 不带 `run_id`/`model`，反推无法可靠切历史轮、也拿不到模型。
- 历史重建与翻页拼接**完全对称复用** messages 既有机制（`historyMsgCount` ↔ 新增 `historyTurnCount`），沿用「前缀距 live 至少一页、跨界轮可忽略」的既有取舍。

## 数据模型

新增类型（`src/store/types.ts`）：

```ts
export type TurnStatus = 'running' | 'succeeded' | 'error' | 'interrupted';
export interface TurnMeta {
  runId: string | null;          // run_id；缺失兜底 null
  model: string | null;          // 该轮实际所用模型 id
  startedAt: string | null;      // run.started.created_at (ISO)；缺失 null
  finishedAt: string | null;     // run.finished/interrupted.created_at；running 时 null
  status: TurnStatus;
  lastMessageId: string | null;  // 该轮最后一条 assistant 消息 id —— footer 锚点
}
```

`KoubouState` 变更：

- 新增 `turns: TurnMeta[]`（持久化切片，随会话走）。
- 新增 `historyTurnCount: number`（**瞬态**，不持久化，与 `historyMsgCount` 对称，标记 turns 中由历史事件重建的前缀长度）。
- `createInitialKoubouState()` 补 `turns: []`、`historyTurnCount: 0`。

`PersistedSession` 变更：加 `turns: TurnMeta[]`，与 `messages` 一同持久化进 `koubouByProject`。`switchProjectSession` 换出/换入时一并搬运；store 的 persist 检查点写快照时连同 turns（保持 `lastSequence ↔ messages ↔ turns` 一致）。

## reducer 轮次生命周期（`src/koubou/apply-koubou.ts`，纯函数、不可变更新）

「当前 running 轮」定义：`turns` 中最后一条 `status === 'running'`（无则视情况）。

| 事件 | 对 `turns` 的操作 |
|---|---|
| `run.started` | push `{ runId: payload.run_id ?? e.run_id ?? null, model: state.model, startedAt: e.created_at ?? null, finishedAt: null, status: 'running', lastMessageId: null }` |
| `claude.message` `AssistantMessage` | 当前 running 轮：`lastMessageId = 落定消息 id`，`model = payload.model ?? 原值`（见下「锚点维护」） |
| `claude.message` `StreamEvent: message_start` | 当前 running 轮：`lastMessageId = 草稿消息 id`（始终指向尾部，正文落定后由 reconcile 覆盖为权威 id） |
| `claude.message` `SystemMessage` | 既有逻辑：`state.model = payload.model`（后续 run 的初始模型来源） |
| `run.finished` | 当前 running 轮：`finishedAt = e.created_at ?? null`，`status = payload.status === 'succeeded' ? 'succeeded' : 'error'` |
| `run.interrupted` | 当前 running 轮：`finishedAt = e.created_at ?? null`，`status = 'interrupted'` |

**锚点维护**：`reconcileAssistant` 落定一条 assistant 消息时，把当前 running 轮的 `lastMessageId` 指到该消息最终 id（`message_start` 草稿 id 可能被权威 `uuid/message_id` 替换，以 reconcile 后为准），并 `model = payload.model ?? turn.model`。`message_start` 阶段先行指向草稿 id，保证「尚未落定但已开始流式」时锚点也有效。

**幂等**：`sequence` 去重沿用现有 `seenSequences`——重连重放不会重复建轮 / 重复改写。

**边界**：
- `run.finished/interrupted` 找不到 running 轮（如历史从半截开始）→ no-op，不抛错。
- `session.ready.active_run` 不单独建轮：其对应 run 的 `run.started` 在重放事件日志中，由 `rebuildHistory` 建轮。

## 历史重建（关键路径，`src/koubou/apply-koubou.ts`）

`visible_state.messages` / REST events 是**含 `run.*` 的可重放事件日志**。把现仅产出 messages 的重建逻辑扩成**单遍同时产出 `{ messages, turns }`**：

- 遍历事件时按 §「reducer 轮次生命周期」同规则切轮：`run.started` 开轮、`AssistantMessage` 回填 `lastMessageId`/`model`、`SystemMessage` 更新游标模型、`run.finished/interrupted` 闭轮。
- 事件流末尾若仍有未闭合轮（live 进行中重放），保留为 `running`。

落地方式：内部统一 `rebuild(events): { messages, turns }`；保留 `rebuildHistory(events): Message[]` 薄封装（返回 `.messages`）以兼容现有直接调用方/测试。`historyFields()` 返回值新增 `turns` 与 `historyTurnCount = turns.length`。

翻页拼接（与 messages 对称）：

- `seedHistory`：`turns = fields.turns`，`historyTurnCount = fields.turns.length`。
- `prependHistory`：`turns: [...fields.turns, ...state.turns.slice(state.historyTurnCount)]`，并更新 `historyTurnCount`。
- `onReady` 无本地缓存重建分支：连同 turns 一起写入。

## UI 渲染

### 锚点选择器（`src/store/selectors.ts`，纯函数）

```ts
selectTurnAnchors(messages: Message[], turns: TurnMeta[]):
  { byMessageId: Map<string, TurnMeta>; trailing: TurnMeta | null }
```

- `byMessageId`：以 `turn.lastMessageId`（存在且命中 messages）为键 → TurnMeta。
- `trailing`：running 且 `lastMessageId` 为空或未命中 messages 的那轮（纯思考阶段、尚无 assistant 输出）——渲染在列表底部。
- 无 `lastMessageId` 且已结束的空轮 → 不进结果（跳过）。

### `TurnFooter`（`src/components/chat/TurnFooter.tsx`）

props：`{ turn: TurnMeta }`。渲染一行 muted 小字：`{modelLabel(turn.model)} · {timeText}`。

- 文案（沿用英文 UI）：
  - `running` → `Running for {fmt}`（**实时跳秒**）
  - `succeeded` → `Ran for {fmt}`
  - `error` → `Failed after {fmt}`
  - `interrupted` → `Stopped after {fmt}`
- 模型名复用 `modelLabel()`（`src/lib/koubou/models.ts`，输出如 "Opus 4.8"）。
- 实时跳秒：`status==='running'` 时 `setInterval(1000)` 触发重算，卸载或转非 running 时 `clearInterval`。
- 降级：`startedAt`/`finishedAt` 缺失 → 只显示模型名、不显示时长；`model` 也缺失 → 不渲染该 footer。

### 时长格式化（纯函数，新文件 `src/lib/koubou/duration.ts`）

```ts
formatDuration(seconds: number): string
// <60      → `${s}s`               例:42 → "42s"
// >=60     → `${m}m` (+ ` ${r}s` 当 r>0)   例:310 → "5m 10s",120 → "2m"
```

- `succeeded/error/interrupted`：`fmt = formatDuration(floor((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000))`。
- `running`：`elapsed = max(0, floor((Date.now() - Date.parse(startedAt)) / 1000))`，`fmt = formatDuration(elapsed)`；`startedAt` 缺失则文案降级为 `Running…`。

### `ChatPanel` 接线（`src/components/chat/ChatPanel.tsx`）

- 订阅 `turns`，经 `selectTurnAnchors` 得 `{ byMessageId, trailing }`。
- 把 `messages.map(m => <MessageItem/>)` 改为：渲染每条消息后，若 `byMessageId.has(m.id)` 紧跟一条 `<TurnFooter turn=.../>`。
- `trailing` 存在 → 在消息列表底部、`MessageSkeleton` 处渲染其 footer（对应发完消息立即出现 `Running for 0s` 并跳秒）。
- `MessageSkeleton` 既有「等待中」骨架保留不动，与 running footer 并存（骨架=working 信号，footer=计时）。

## 边界与降级（汇总）

- `startedAt`/`finishedAt` 缺失 → 仅模型名，无时长。
- `model` 缺失 → 不渲染 footer。
- 无 assistant 输出的空轮 → 无锚点，跳过。
- 客户端/服务端时钟偏移 → `max(0,…)` 钳制。
- StrictMode / 热刷新重复挂载 → 跳秒 interval 必在 effect cleanup 清除，不泄漏。

## 测试（同目录 TDD）

- `apply-koubou.test.ts`：
  - `run.started` 建 running 轮（startedAt/model 取值）；`AssistantMessage` 回填 `lastMessageId`/per-turn `model`；`run.finished(succeeded/failed)` 与 `run.interrupted` 闭轮状态与 `finishedAt`。
  - `sequence` 重放不重复建轮。
  - `rebuildHistory`/`rebuild`：从含 `run.*` 的事件日志重建 turns（多轮、热切换模型、末尾未闭合 running 轮）。
  - `seedHistory`/`prependHistory`：`historyTurnCount` 边界拼接 live 尾部。
- `selectors` 新测：`selectTurnAnchors` 的 `byMessageId` 命中、`trailing` 判定、空轮跳过。
- `duration` 新测：`formatDuration` 各档（<60 / 整分 / 分+秒）。
- `TurnFooter` 新测：四种状态文案、时长格式、`running` 跳秒（vitest fake timers）、降级分支。

## 非目标（YAGNI）

- 不展示 token 用量 / 费用 / num_turns（`ResultMessage` 其余字段）。
- 不做 checkpoint / restore（参考图里的 Checkpoint 行不在本次范围）。
- 不改后端协议；只消费既有 `created_at` 与消息 `model`。
