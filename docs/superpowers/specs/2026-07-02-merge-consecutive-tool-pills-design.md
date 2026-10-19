# 连续同类型工具调用合并为一个 pill 设计

在 pill 化的工具调用块基础上（见 [[2026-07-02-tool-call-pill-style-design]]），把**渲染序中连续、同名、可合并**的工具调用折叠成一个「group pill」（如 `Read ×5`），减少重复调用带来的视觉噪声。

## 数据模型前提

- 每个 assistant API 消息 = 一个 `Message`（含 `parts`）。**并行** tool_use 在同一消息里出现多个 tool part；**顺序**调用是**分开的多条 assistant 消息**（tool_result 已折进对应 tool part，不单独成气泡）。
- `ChatPanel` 逐条 `messages.map(<MessageItem> + 可选 TurnFooter)`，footer 按 message id 锚定（`byMessageId`）。

因此"连续同类型"最常见的形态是**跨多条相邻的纯工具消息**，合并逻辑放在 `ChatPanel` 层，`MessageItem` 不动。

## 范围（方案 A）

只对**连续的「纯工具 assistant 消息」**分组：

- **可分组消息**：`role === 'assistant'` 且 `parts.length > 0` 且**所有 part 都是 `tool`** 且**不带 turn footer**（`!footerIds.has(id)`）。
- 把一段连续可分组消息里的 tool parts 按顺序拍平，再切成组：**同 `name`、可合并、连续 ≥2 个** → 一个 group；其余（run=1 或不可合并）→ 单个工具，渲染成与现状一致的 `ToolCard`。
- **可合并** = `!part.diff && !(part.media?.length)`（diff 工具、产图工具的关键产出不该藏进计数，保留独立 pill）。
- 文本 / 思考 / 用户消息 / 带 footer 的消息都作为 `message` 节点照旧渲染，并**打断**连续段（narration 本就该显示，是期望行为）。

**明确局限（非目标）**：工具与叙述文本在**同一条消息**里时，这条消息的工具不合并（该消息非"纯工具"）。要覆盖这种情况需把全部 assistant parts 打平成流（方案 B），涉及 ChatPanel 重写流式/footer 锚定，回归风险高——本次不做。

## 组件与数据流

### 1. 纯函数 `src/lib/chat/group-tool-runs.ts`

```ts
import type { Message, Part } from '@/store/types';
type ToolPart = Extract<Part, { type: 'tool' }>;

export type RenderNode =
  | { kind: 'message'; message: Message }
  | { kind: 'tool'; part: ToolPart }                              // 单个(run=1 或不可合并)
  | { kind: 'toolGroup'; id: string; name: string; parts: ToolPart[] };  // 合并组(≥2)

export function isMergeable(p: ToolPart): boolean;               // !p.diff && !(p.media?.length)
export function groupToolRuns(
  messages: readonly Message[],
  footerIds: ReadonlySet<string>,
): RenderNode[];
```

算法：
- `isGroupable(m)` = `m.role==='assistant' && m.parts.length>0 && m.parts.every(p=>p.type==='tool') && !footerIds.has(m.id)`。
- 遍历 messages：非可分组 → push `{kind:'message'}`；可分组 → 收集**连续**可分组消息的全部 tool parts，交给 `splitToolRun`。
- `splitToolRun(parts)`：累积「同名且可合并」的连续 run；遇到不可合并 part → 先 flush 再单独 push `{kind:'tool'}`；遇到不同名 → flush 再起新 run。flush 时 run≥2 → `{kind:'toolGroup', id:run[0].id, name:run[0].name, parts:run}`，run===1 → `{kind:'tool', part:run[0]}`。

### 2. `src/components/chat/ToolGroupCard.tsx`

复用 [[2026-07-02-tool-call-pill-style-design]] 的 `pillClass`/`ToolStatusIcon`/`CollapseArrow`。

- 聚合状态 `aggregateStatus(parts)`：任一 `generating`/`pending` → `'generating'`；否则任一 `error` → `'error'`；否则 `'ready'`。
- 收起：`[ToolStatusIcon(agg)] {name} <×N muted> [CollapseArrow]`。
- 展开：`space-y-1`，每次调用一行 `GroupRow`：仅当 `status!=='ready'` 时前置 `ToolStatusIcon(status)`（进行中转圈/失败 warning，完成不加图标避免噪声），后接参数 `<pre>`（复用现有参数样式：`max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--color-fill)] px-2 py-1.5 text-[12px] text-[var(--color-muted)]`），`argText` 取 `JSON.stringify(part.input)` 截断 400，空则显 `—`。
- 展开/收起默认态：`open` 初值 = `agg` 为 `generating`/`error`；用渲染期 guard（`prevAgg` 跟随 `agg` 变化重置 `open`，同 `ToolCard` 写法，不用 effect）。手动可切换，`aria-expanded` 在按钮上。
- `×N` 只是符号+数字，无需 i18n；`name` 同工具名不翻译。

### 3. `ChatPanel` 集成

```tsx
const footerIds = useMemo(() => new Set(byMessageId.keys()), [byMessageId]);
const nodes = useMemo(() => groupToolRuns(messages, footerIds), [messages, footerIds]);
```
`nodes.map`：
- `message` → `<Fragment key={message.id}><MessageItem/>{byMessageId.has(id)&&<TurnFooter/>}</Fragment>`（同现状）。
- `tool` → `<div key={part.id} className="mb-2"><ToolCard part/></div>`。
- `toolGroup` → `<div key={id} className="mb-2"><ToolGroupCard name parts/></div>`。

`mb-2` 复刻原纯工具消息的间距；`trailing` footer / `awaiting` 骨架 / `historyLoading` 不变。

## 单元边界

- `group-tool-runs.ts`：纯分组逻辑，无副作用，易测。
- `ToolGroupCard.tsx`：只负责合并 pill 的展示与本地折叠态。
- `ChatPanel`：用渲染节点替换 `messages.map`；footer/骨架/空态逻辑保留。
- `MessageItem` / `ToolCard` / `toolPill.tsx`：**不改**（ToolGroupCard 复用其导出）。

## 测试

- `src/lib/chat/group-tool-runs.test.ts`：
  - 连续两条同名纯工具消息 → 一个 `toolGroup`（count=2，parts 顺序正确）。
  - run=1 → `tool` 节点，非 group。
  - 不同名相邻 → 各自成节点（Read 段 + Bash 段）。
  - 带 diff 的工具 → `tool` 节点且打断 run。
  - 带 media 的工具 → 同上不合并。
  - 文本/思考/用户消息夹在中间 → `message` 节点打断，两侧各自分组。
  - 带 footer 的纯工具消息（footerIds 命中）→ 不分组，出 `message` 节点。
  - 同一条消息内并行同名 `[Read,Read]` → 合并。
  - 含 `generating` 的工具 → 参与合并。
- `src/components/chat/ToolGroupCard.test.tsx`：
  - 渲染 `name ×N`；全 done → 头部 `data-tool-status="done"`；含 generating → `role=status`；含 error（无 generating）→ `data-tool-status="error"`。
  - 展开列出各行 argText；errored 行带 `data-tool-status="error"` 标记；done 行不带状态图标。
  - 默认态：agg 为 generating/error 时展开，全 ready 时收起；点击切换 `aria-expanded`。
- `src/components/chat/ChatPanel.test.tsx`：若现有断言受影响则更新；新增"连续同名工具消息渲染为一个 group（一个 `×N`，而非 N 个独立 ToolCard）"。

## 验收

- tsc / lint / 全量 test 绿。
- 运行态核对：造几条连续同名纯工具消息，确认合并成 `Name ×N`、展开列出各调用、聚合状态与折叠行为符合设计（可复用上次的 scratch 页方式，验证后删除）。
