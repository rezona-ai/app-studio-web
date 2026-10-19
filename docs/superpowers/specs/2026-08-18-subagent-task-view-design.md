# 子代理任务视图（复用任务清单卡，Segmented 切换）

日期：2026-08-18
状态：待批准（下述 5 条决策由 Nick 逐条确认）
上游契约：koubou `docs/websocket-events.md` 的「子 agent 归属与渲染」「任务清单（TaskCreate / TaskUpdate / TaskList / TaskGet）」「可重放事件与 Sequence」三节（后端 `_attribute_background_task_message` 已在 main）
前置：`2026-06-19-workspace-motion-design`（动效语汇）、任务清单现状实现（`protocol.ts:185-280` + `PlanCard.tsx`）

## 目的

后端一个 run 里可能同时跑父回合和若干子 agent（`Agent` 工具，可后台），它们的消息**混在同一条事件流里**，唯一分流判据是 `payload.parent_tool_use_id`。前端现状是：

1. **不分流**——`apply-koubou.ts:652` 的 `onClaudeMessage` 从不读 `parent_tool_use_id`，子 agent 的 thinking / 文本 / 工具调用被当成父回合渲染，**子 agent 的话冒充父 agent 说的话**（既存 bug）。
2. **不建卡**——`isFullMessage` 只认四种完整消息，全部 `Task*Message` 生命周期事件（`TaskStartedMessage` / `TaskUpdatedMessage` / `TaskNotificationMessage` / `TaskProgressMessage`）在入口直接丢弃。于是用户看不到「派了几个子代理、跑到哪了、结论是什么」，而子代理的真正产出只在 `TaskNotificationMessage.summary` 里（父回合那条 `tool_result` 是 `Async agent launched successfully...` 之类内部元数据）。

本回合补齐两侧：**入口按 `parent_tool_use_id` 分流**，并把子代理任务渲染成一段列表，**复用现有任务清单卡（`PlanCard`）的卡壳与行样式，用 Segmented 在「任务清单 / 子代理」间切换**。

## 约束

- **任务清单与子代理是两回事，不合并**：`TaskCreate/TaskUpdate/...` 是 agent 自己的待办清单（现有 `state.tasks`），`Task*Message` 是后台任务生命周期。上游文档明确要求别混，两者各自一段、各自的数据源，只共用卡壳。
- **纯函数 + 唯一落库入口**：状态机全部落在新纯函数模块 `src/lib/subagent-tasks.ts`（同步、无副作用、不 import store），`applyKoubou` 只接线；UI 只订阅。
- **不新增 UI 种类**：复用 `Segmented`、`FigIcon`（`checkCircle` / `warningSign`）、`PlanCard` 的卡壳 / 行高 / 折叠态 / `useExitTransition`、既有令牌（含 `--color-danger`），不写一次性 keyframes、不加新按钮组件。
- **只 Claude backend**：codex 会话走 `codex.message`（无对应生命周期事件），子代理段在 codex 下恒不出现。
- **瞬态不落盘**：子代理卡片按 run 存活，不进 `PersistedSession`、不进 persist 白名单。
- 11 个语言包（zh / zh-TW / en / ja / ko / de / es / fr / pt / ru / vi）必须同批补齐，因此文案条数要克制。

## 决策（Nick 已逐条确认）

### 决策 1：同一张卡 + 头部 Segmented 切换

`PlanCard` 头部放 `Segmented`「任务清单 / 子代理」，两段共用卡壳、行高、状态图标语汇与折叠态。

- 两段都有内容时才出现 Segmented；只有一段有内容时**不出现开关**，标题直接是那一段的标题（观感与今天一致）。
- 选中段进 store（`planView: 'tasks' | 'subagents'`，瞬态），**不自动抢切**：子代理开卡不会把用户从任务清单页面弹走；`run.started` 重置回 `'tasks'`。
- Segmented 的子代理段标签带计数（**总数**，非进行中数）。
- 折叠态沿用现状：标题行 + mono 计数 + 当前进行中的一行（子代理段取首个非终态卡）。

### 决策 2：状态行 + 可展开汇报

每行 = 状态图标 + `description` + 行尾类型标（仅 `local_bash` 显示「后台命令」，`local_agent` 不加标，`unknown` 按 bash 同形态但不预期子消息）。

- 进行中的行下方补一条 muted 活体行「正在 {lastToolName}」（来自 `TaskProgressMessage`，**仅 live**；重连后这一行丢失属可接受降级）。
- 行可点开：展示 `TaskNotificationMessage.summary`（走既有 `Markdown` 组件渲染），`error` 时展示错误文本。**终态卡可能没有 summary**，此时展开区显示一行 muted「无汇报」而不是空白。
- `output_file` 只在有值时以 mono 小字展示路径（不做打开动作——前端拿不到该文件）。

### 决策 3：可见性沿用现状——run 结束即淡出

子代理段与任务清单同一可见性：`(tasks.length > 0 || subagentCards.length > 0) && runStatus === 'running'`，`run.finished` / `run.interrupted` 后整张卡淡出。

**已知取舍（Nick 已确认接受）**：终态常与 run 结束在同一瞬间到达，因此 `summary` 实际主要在 run 进行中可读（后台子 agent 先于父回合结束时能读到）；run 结束后不留任何回顾入口。合成终态（见决策 5）同理只在收尾那一刻短暂可见。

### 决策 4：子 agent 自己的消息剥出主消息流

`parent_tool_use_id` 非空的 `AssistantMessage` / `UserMessage` / `StreamEvent` **不再进主消息流**，只用于驱动卡片（当前仅取工具名做活体行兜底；文本 / thinking 丢弃）。这同时修掉「子 agent 的话冒充父 agent」的既存 bug。

后台 `Agent` 调用在父回合里的 `tool_result` 是内部元数据（文本自称不要引用），保持现有 `ToolCard` 折叠即可，不额外展示。

### 决策 5：状态机按文档完整实现

逐条对应上游契约，不做删减版（删减版的已知后果是永久转圈卡，2026-08-07 线上事故即此）：

1. **终态词表归一**：`TaskUpdatedMessage.patch.status` ∈ `pending|running|paused|completed|failed|killed`，`TaskNotificationMessage.status` ∈ `completed|failed|stopped`；`killed ≡ stopped`。终态集合 = `{completed, failed, stopped}`（归一后），非终态 = `{pending, running, paused}`。
2. **开卡只认 `TaskStartedMessage`**，`task_type` 决定形态：`local_agent` → 子代理、`local_bash` → 后台命令、缺失 / 未知 → `unknown`（不预期子消息，只显示状态与 summary）。类型未知**不影响归属与终态收敛**。
3. **`TaskUpdatedMessage` 是补丁，不必带 `status`**：只有 `end_time` / `result` / `error` 的补丁合法且**不是终态**，合并其它字段、保留原状态；`end_time` 不能推出终态。卡片未建时按 `task_id` 暂存，等 start 合并。
4. **收卡条件是「任一端点带来终态」**，`TaskUpdatedMessage` 与 `TaskNotificationMessage` 谁先带终态谁关卡；notification **非必达**（被 `TaskStop` 杀掉时只有 `TaskUpdatedMessage(status=killed)`）。两端点都带终态时幂等：先到者定状态，后到者只补 `summary` / `output_file`。
5. **终态单独出现绝不开卡**：按 `task_id` 记 tombstone（连同事件的 `parent_tool_use_id` 一起记），等 start 到达才建卡并**直接建成终态**；tombstone 只在与该 start 的 `tool_use_id` 一致时才可消费（`task_id` 不假设跨 run 唯一）。
6. **跨 run 隔离靠 `parent_tool_use_id`，不靠 `task_id`**，按事件有无归属分两条：
   - **有归属**：只接受 id ∈ 本 run 已知 `tool_use` id 集合的事件，其余丢弃。该集合**两个来源缺一不可**：① 父回合 `AssistantMessage` 里 `tool_use` block 的 id；② **每一条带非空 `tool_use_id` 的 `TaskStartedMessage`**（服务端已把陌生 start 整条抑制，故到达客户端的带 id start 可信）。缺 ② 会在重连（父回合那条消息在历史页外）时丢掉合法 start，卡片建不起来、后续 notification / progress 连带被丢。
   - **无归属**：无法校验但**不能丢**（可能携带唯一终态）。按 `task_id` 暂存为待定，只有当本 run 出现一个同 `task_id` 且已通过 ① 校验的 start 时才并入；到 `run.finished` 仍未消费则丢弃。**例外**：无归属的 `TaskStartedMessage` 自带足够信息，渲染成一张**不归组的卡**（按 `task_id` 索引），同 `task_id` 的无归属补丁并入它，但它的 id **绝不能**进已知集合。
7. **`run.finished` 上自行收尾**（`run.interrupted` 上**不收**——它之后仍会有真实终态到达）：把该 run 下所有非终态卡片收成**本地合成态** `ended_without_terminal`，措辞跟 `run.finished.status` 走：`interrupted` → 「已中断」、`failed` → 「随本轮失败」、`succeeded` → 「结局未知」。**不得**伪造成 `stopped` / `killed`。收尾幂等，并清掉该 run 下未被消费的 tombstone 与待定项。
8. **收尾过的 run 不因迟到事件重开**（孤儿收割可能在 `run.finished` 后仍追加同 run 事件）：迟到 start 不建卡也不建 tombstone；迟到的无归属终态不建待定项；迟到事件只能并入已存在的卡片；卡片处于合成态而迟到了**真实 wire 终态**时用真实终态替换（并补 `summary` / `output_file`）；迟到的**非终态**补丁绝不把卡片改回 `running`。
9. **`TaskProgressMessage` 只实时下发**：无对应卡片直接丢弃，只更新 `lastToolName`，不参与状态。
10. **`background_tasks_changed`（`SystemMessage`）是参考性成员列表**：不开卡、不改任何状态；见到没有 start 的 `task_id` 忽略，`task_id` 从下次快照消失**不等于**结束。
11. **`SystemMessage` 的 `thinking_tokens` / `status` 无连接键**，只能当全局进度，不挂到任何卡片。

## 数据模型

```ts
// src/koubou/protocol.ts（协议层，纯类型 + 纯解析）
export type SubagentKind = 'agent' | 'bash' | 'unknown';            // local_agent / local_bash / 其它
export type WireTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
export type SubagentStatus = WireTaskStatus | 'ended_without_terminal';  // 末项为本地合成态
export type SealReason = 'interrupted' | 'failed' | 'unknown';           // 合成态措辞来源

// 归一后的生命周期事件（reducer 消费；无法归一时 parse 返回 null）
export type TaskLifecycle =
  | { kind: 'started'; taskId: string; toolUseId: string | null; parentToolUseId: string | null;
      taskType: SubagentKind; description: string; subagentType?: string }
  | { kind: 'updated'; taskId: string; parentToolUseId: string | null;
      status: WireTaskStatus | null; result?: string; error?: string; endTime?: string }
  | { kind: 'notification'; taskId: string; parentToolUseId: string | null;
      status: WireTaskStatus | null; summary?: string; outputFile?: string }
  | { kind: 'progress'; taskId: string; parentToolUseId: string | null; lastToolName?: string };
```

```ts
// src/store/types.ts（KoubouState 新增一块，瞬态）
export interface SubagentCard {
  taskId: string;
  toolUseId: string | null;   // null = 不归组的无归属卡
  runId: string | null;       // 开卡所属 run：收尾与跨轮清理的判据
  kind: SubagentKind;
  description: string;
  subagentType?: string;
  status: SubagentStatus;
  sealReason?: SealReason;    // 仅合成态
  summary?: string;
  outputFile?: string;
  error?: string;
  lastToolName?: string;      // 仅 live，重连后丢失
}

export interface SubagentState {
  cards: SubagentCard[];                              // 开卡顺序
  knownToolUseIds: string[];                          // 本 run 已知 tool_use id（父回合 block + 可信 start）
  taskToolUse: Record<string, string>;                // task_id → tool_use_id（start 学到）
  deferred: Record<string, DeferredPatches>;          // 卡未建时的暂存补丁（见下）
  sealedRunIds: string[];                             // 已收尾的 run（迟到事件据此不重开）
}
```

**实现偏差（已落地）**：原计划的 `tombstones`（有归属终态先到）与 `pending`（无归属待定）**合并成一个 `deferred`**。两者消费时机完全相同（等本 `task_id` 的 start 到达），分成两个容器会让「无归属条目被后来的带归属事件升级」「run 收尾时清理本 run 条目」这两段逻辑各写一遍。条目形状：

```ts
export interface DeferredPatches {
  toolUseId: string | null;    // 有归属 → 记下供一致性校验（即契约里的 tombstone）；null → 无归属
  runId: string | null;        // 供 run 收尾时清理未被消费的条目
  events: Exclude<TaskLifecycle, { kind: 'started' }>[];
}
```

## 纯函数层（新增 `src/lib/subagent-tasks.ts`）

- `normalizeStatus(raw: string | null | undefined): WireTaskStatus | null`（`killed → stopped`，未知 → null）
- `isTerminalStatus(s: SubagentStatus): boolean`
- `learnToolUseIds(st, ids: string[]): SubagentState`（父回合 `tool_use` block 灌入已知集合）
- `reduceLifecycle(st, ev: TaskLifecycle, ctx: { runId: string | null }): SubagentState`（决策 5 的 2–6、8–9 全部在这里）
- `sealRun(st, runId: string | null, runStatus: 'succeeded' | 'error' | 'interrupted'): SubagentState`（决策 5 的 7）
- `resetSubagents(): SubagentState`（`run.started` / 切项目 / 切会话）

解析（`protocol.ts`）：`parseTaskLifecycle(sdkType: string, payload): TaskLifecycle | null`，键名按 SDK 原样 snake_case（`task_id` / `tool_use_id` / `parent_tool_use_id` / `task_type` / `last_tool_name` / `output_file`），**不臆造 camelCase 兜底**（反模式）。

## reducer 接线（`apply-koubou.ts`）

- `onClaudeMessage` 入口先取 `p.payload.parent_tool_use_id`：
  - `sdk_type` ∈ 四种生命周期类型 → `parseTaskLifecycle` → `reduceLifecycle`，**不进消息流**（其中 `TaskStartedMessage` / `TaskUpdatedMessage` / `TaskNotificationMessage` 带 sequence 会落库重放，走既有 sequence 去重）。
  - 其余 `sdk_type` 且 `parent_tool_use_id` 非空 → 子 agent 消息：**剥出主流**（决策 4），仅 `AssistantMessage` 的 `tool_use` block 用于更新对应卡的 `lastToolName`。
  - `parent_tool_use_id` 为 null → 现有父回合路径不变；`AssistantMessage` 的 `tool_use` block id 灌入 `knownToolUseIds`（决策 5-6-①）。
- `run.started`：`subagents = createSubagentState()`（与 `tasks: []` 同一处）。**`planView` 不由 reducer 重置**——实现偏差：reducer 属 `KoubouState`，改 UI 态越界。改为 UI 侧派生：`view = hasCards && (!hasTasks || planView === 'subagents') ? 'subagents' : 'tasks'`，一段空掉自动回落另一段，新一轮清空卡片后天然回到任务清单。
- `run.finished`：先 `sealRun`，再走现有 `finishRun`；`run.interrupted` **不** seal。
- `rebuild`（历史重放）同步产出 `subagents`：重连到仍在跑的 run 时卡片可重建（端点已落库）；已结束的 run 不显示卡，重建结果被 seal 收成合成态即可。
- 切项目 / 切会话：与会话态在**同一次 `set`** 内清空（维持既有不变式）。

## UI 规格（`PlanCard.tsx` + 新增 `SubagentList.tsx`）

- 卡壳、圆角 `rounded-[20px]`、`--color-pop` + `--shadow-popover` + `backdrop-blur-[6px]`、`anim-collapse-in` / `anim-fade-out`、`forwardRef` 测高补底部内边距：全部沿用，不改。
- 头部：`Segmented`（`value: planView`，两段；仅两段都有内容时渲染）+ 折叠箭头 `CollapseArrow`。折叠态右侧 mono 计数：任务清单段 `done/total`，子代理段 `终态数/总数`。
- 子代理行状态图标（复用 `PlanStatusIcon` 语汇，同 16px 槽位）：
  - `pending` → muted 静态弧；`running` / `paused` → 品牌橙转圈（`paused` 不转，静态橙弧）
  - `completed` → `checkCircle`（品牌橙，14px）
  - `failed` → `warningSign`，`--color-danger`
  - `stopped` / `ended_without_terminal` → muted 静态弧 + 行尾状态词
- 行文本 12px mono（与任务清单行同规格），`truncate`；类型标 11px `--color-muted`；活体行「正在 {tool}」11px muted，缩进对齐文本列。
- 展开区：`Markdown` 渲染 `summary`（限高 + `scrollbar-auto`），无 summary 显示 muted「无汇报」；`outputFile` mono 小字；`error` 用 `--color-danger`。
- 列表限高沿用 `max-h-[112px]` 语义（子代理段因带展开区放宽到 `max-h-[200px]`），`scrollbar-auto`，`aria-live="polite"`。
- 无障碍：Segmented 传 `ariaLabel`；每行展开按钮带 `aria-expanded` 与 `aria-label`。

## i18n 文案（11 语言同批，共 11 条，实际落地 `chat.subagents.*`）

`title`（子代理）、`kindBash`（后台命令）、`doing`（正在 {{tool}}）、`noSummary`（无汇报）、`statusStopped`（已停止）、`statusFailed`（失败）、`sealInterrupted`（已中断）、`sealFailed`（随本轮失败）、`sealUnknown`（结局未知）、`toggleRow`（展开/收起汇报）、`switch`（Segmented 的 aria-label）。

**偏差**：原列的 `tabTasks` / `count` 没有新增——Segmented 的清单段标签直接复用既有 `chat.plan.title`，计数拼在子代理段标签里。`toggleRow` / `switch` 是实现时补的无障碍标签。`i18n.test.ts` 要求 11 语言键集完全一致，故文案与组件必须同一次提交。

## 成功标准

1. 子 agent 的文本 / thinking / 工具调用**不再出现在主消息流**（回归测试钉住）。
2. run 进行中派子代理 → 卡片出现、进行中转圈、活体行跟随工具、终态收卡并可展开读 summary。
3. 被 `TaskStop` 杀掉（只有 `TaskUpdatedMessage(status=killed)`）→ 卡片收成「已停止」，不转圈。
4. run 被切断、任务从未发终态 → `run.finished` 上收成合成态，措辞随 run 状态；卡片不转圈。
5. 终态先于 start 到达 → 卡片建成终态；同 `task_id` 但不同 `tool_use_id` 的 start **不消费**该 tombstone。
6. 跨 run 残留的有归属事件被丢弃；无归属事件在 `run.finished` 前无同 `task_id` 合法 start 时被丢弃。
7. 重连（父回合消息在历史页外，只有 start 落在页内）→ 卡片仍能重建。
8. 无子代理时卡片外观与今天完全一致（无 Segmented）。
9. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` / `pnpm build` 全绿。

## 测试清单（同目录 `*.test.ts(x)`，TDD）

- `src/lib/subagent-tasks.test.ts`：词表归一（含 `killed≡stopped`）、开卡形态三种、非终态补丁不收卡、双端点幂等、tombstone（含 `tool_use_id` 不一致不消费）、有归属跨 run 丢弃、无归属待定并入 / 到期丢弃、无归属 start 建不归组卡且不进已知集合、`sealRun` 三种措辞 + 幂等、收尾后迟到事件（不重开 / 真实终态替换合成态 / 非终态不回退）、progress 无卡丢弃。
- `src/koubou/protocol.test.ts`：`parseTaskLifecycle` 四类 + 缺字段容错 + 未知 `task_type` → `unknown`。
- `src/koubou/apply-koubou.test.ts`：分流（子 agent 消息不进 `messages`）、`tool_use` id 学习、`run.started` 重置、`run.finished` seal 而 `run.interrupted` 不 seal、`background_tasks_changed` 不改状态、`rebuild` 重建卡片。
- `src/components/chat/PlanCard.test.tsx` / `SubagentList.test.tsx`：Segmented 仅两段都有内容时出现、切换、计数、类型标、活体行、展开 summary / 无汇报、各状态图标、可见性（run 结束淡出）。

## 明确不做

- 子代理完整消息流回放（决策 2 的选项 C）：需要一整套分组消息渲染，本回合不做。
- run 结束后的历史回顾入口 / 手动关闭（决策 3 已定沿用现状淡出）。
- 把合成态写成 `stopped` / `killed`（伪造 wire 终态）。
- 按 `task_id` 做跨 run 配对（契约不保证唯一）。
- 落盘子代理卡片（不进 persist 白名单 / `PersistedSession`）。
- codex backend 的等价能力。

## 评审处置（2026-08-18，干净上下文子代理基于 `1e02c3a0..HEAD` 独立评审）

**Critical**

- **C1 已修**：live 路径把 `state.activeRunId` 当生命周期事件的 run 归属，而 `finishRun`（`apply-koubou.ts:662`）在 `run.finished` **和** `run.interrupted` 上都把它清成 null。后果实测成立：① `run.interrupted → TaskStartedMessage → run.finished` 这条真实帧序里，卡片 `runId` 为 null，`sealRun` 匹配不到 → **永久转圈**（正是决策 5-7 引用的 2026-08-07 事故形态）；② 收尾后迟到的 start 照样建卡、迟到的无归属终态照样建待定项。修法：`claude.message` 分支把 envelope 的 `run_id` 透进 `onClaudeMessage`（`runIdOf(e) ?? state.activeRunId`），与 `rebuild` 用同一判据；`sealRun` 的归属判据放宽为 `cardRunId === runId || cardRunId == null || runId == null`（顺带覆盖契约允许的 `run.finished{run_id: null}` 极端帧，即 m3）。补了两条 apply 层用例 + 两条 lib 用例。

**Important**

- **I1 不成立（实测否证，未改代码）**：评审担心「四个 `sdk_type` 是**后台**任务生命周期，所以前台 `Agent` 子代理没有卡片兜底、剥流后过程全不可见」。2026-08-18 在 dev 补测一轮**前台**调用（`run_in_background: false`，seq 234）：它同样下发了 `TaskStartedMessage`(235, `task_type=local_agent`)、`TaskUpdatedMessage`(239)、`TaskNotificationMessage`(240, 带 summary)。故前台子代理有卡片兜底，**不给剥流加 `run_in_background` 门控**。该事实已由 `apply-koubou.subagent-frames.test.ts` 的前台用例钉住。
- **I2 记为已知取舍（技术性异议，未改代码）**：评审建议把「有归属但 id 尚不在已知集合」的端点事件也 deferred，以免重连窗口丢掉先到的终态。契约字面就是「其余丢弃」，而该场景的实际触发面极窄：历史页按 `sequence` 升序，start 的 sequence 恒小于自己的终态，同页内不可能出现「终态在前、start 在后」；只有「start 落在页外而终态落在页内」才会命中，而那种窗口下 start 永远不在本页，deferred 条目也无从消费。改动会把跨 run 残留事件引进暂存区（虽有 `tool_use_id` 一致性校验兜底），收益不抵复杂度。**取舍**：此窗口下该任务的 summary 丢失，卡片建成 `running`，最终由 `run.finished` 收成合成态。

**Minor**

- **m1 已修**：折叠态的子代理行硬写 `status="in_progress"`，`pending`/`paused` 的卡在折叠态会转圈、与展开态（paused 静态橙弧）自相矛盾。改为复用 `SubagentStatusIcon` 按真实状态出图标，补两条用例。
- **m3 已修**：随 C1 一起（见上）。
- **m4 已修**：墓碑一致性校验失败时条目**保留**（供后来 `tool_use_id` 一致的 start 消费）这一语义此前无断言，改成删除测试也不会红。已补 `deferred` 仍持有该 `task_id` 的断言。
- **m5 已修**：把「三种形态原样透传」这条同义反复用例（把已归一的 `taskType` 传进去再断言原样出来）换成契约明确点出、此前无覆盖的「类型未知不影响归属与终态收敛」。
- **m2 技术性异议（未改）**：评审建议把可信判据从 `parent_tool_use_id` 改成 `tool_use_id`（贴合契约字面）。但契约同时要求「**无归属**的 start 不可信、其 id 绝不进已知集合」，而「带 `tool_use_id` 却没盖上章」正是那条规则定义的形状——按 `tool_use_id` 判反而会把它当可信并入集合，与该规则冲突。服务端盖章用的就是同一字段，两者当前等价；保留 `parent_tool_use_id` 判据更贴合「无归属即不可信」这条更明确的规则。
- **m6 已随 C1 消失**：无归属待定项的 `runId` 为 null 的窗口来自 `activeRunId` 为 null，现在取事件自带 `run_id`；且 `sealRun` 的清理已覆盖 `runId == null` 的条目。
- **m7 不改**：`prependHistory` 里 `historyFields` 白算一遍子代理状态随后丢弃，语义正确（旧页的 start 会把已收掉的卡重建成 running，必须以现值为准，已有用例钉住），`tasks` 早有同样形状，属既有风格。

## 已知风险与残留

- **无归属 `TaskUpdatedMessage` + `task_id` 碰撞**：上游文档已声明服务端与客户端都无法再收窄（那个事件里没有可校验的 run 归属键），需 run lease / owner-epoch fencing（koubou issue #13）或 SDK 在 `task_updated` 上补 `parent_tool_use_id`。本前端按契约实现，不再加自造兜底。
- **旧镜像环境**：只有 2026-08 之后的 koubou 镜像才落库这三个端点。对着旧镜像，子代理卡是 live-only，重连后不重建（不凭空造卡）。

## dev 实机核对（2026-08-18，已完成）

在 dev（`devlab.rezona.ai`）真发一条「后台派两个只读子代理」的需求，取回该会话的全量事件日志（184 条，project 1608 / session `session_4f4fc056…`），逐条比对契约并把日志喂给 `rebuild` 跑一遍：

- **端点确实落库**：`TaskStartedMessage`(seq 35, 39)、`TaskUpdatedMessage`(86, 173)、`TaskNotificationMessage`(174, 87) 六帧**全部带 sequence**，出现在 HTTP history 里。→ 重连重建这条路成立，dev 镜像已具备该能力。
- **`parent_tool_use_id` 确实盖了章**：三类端点都带（值 = 那次 `Agent` 调用的 `tool_use_id`，如 `call-…-0` / `-1`），本轮未出现无归属事件。
- **字段形状与文档一致**：start 的 `task_id` / `description` / `tool_use_id` / `task_type`(`local_agent`) 在**顶层**，`subagent_type` / `prompt` 在 `data` 里；notification 带 `summary` / `output_file` / `status`；updated 的 `patch` 是 `{status, end_time}`，`end_time` 是**毫秒数字**（我们本就不入卡，无影响）。
- **rebuild 结果正确**：两张 `kind=agent` 卡按 `description` 建起、收成 `completed`、带上各自 `summary` 与 `output_file`，归属与 `runId` 正确；`deferred` 无残留，`sealedRunIds` 记下该 run。
- **分流生效（对照）**：这一轮里有 **21 条**带 `parent_tool_use_id` 的完整消息（15 `AssistantMessage` + 6 `UserMessage`），**修前它们会全部渲染进主消息流**——在跑 dev 分支代码的本地 server 上肉眼即可看到子代理的汇报文本（「一句话回报：工作区内不存在 index.html」等）夹在父回合里。修后主流只剩 12 条父回合消息，子代理文本泄漏 **0** 条。
- `lastToolName` 重连后丢失（`TaskProgressMessage` 不落库），属上游刻意取舍。
