# 子代理任务视图 实现计划

**Goal:** 按 `parent_tool_use_id` 把子 agent 流量从父回合剥离，用一套纯函数状态机维护后台任务卡片，并在现有任务清单卡（`PlanCard`）头部加 `Segmented`，在「任务清单 / 子代理」两段间切换。

**Architecture:** 三层新增、零新依赖。① 协议层 `src/koubou/protocol.ts` 只加类型与 `parseTaskLifecycle`（snake_case 原样，无 camelCase 臆测）；② 纯函数层新增 `src/lib/subagent-tasks.ts`，承载全部状态机（开卡 / 补丁 / 收卡 / tombstone / 归属校验 / 无归属待定区 / run 收尾 / 迟到事件），同步纯函数、不 import store；③ `applyKoubou` 只接线，`SubagentState` 作为 `KoubouState` 的一块瞬态字段，UI 只订阅。UI 侧 `PlanCard` 由「单一清单」升为「双段容器」，子代理段独立成 `SubagentList`。

**Tech Stack:** TypeScript · zustand（`src/store`）· react-i18next（11 语言）· Vitest + jsdom（测试与源码同目录）

**Spec:** `docs/superpowers/specs/2026-08-18-subagent-task-view-design.md`

## Global Constraints

- `src/lib/subagent-tasks.ts` 必须是**同步纯函数**：不 import store / IO / 计时器，返回新对象、不可变更新。
- **只信文档约定字段**，snake_case 原样解析；不加 camelCase 别名兜底（反模式）。
- **`killed ≡ stopped`**；终态集合 `{completed, failed, stopped}`；合成态 `ended_without_terminal` **只在本地产生**，绝不写成 wire 终态。
- **`run.finished` 收尾，`run.interrupted` 不收尾**。
- 子代理状态**瞬态**：不进 `PersistedSession`、不进 persist 白名单。
- 新增 UI 只复用既有令牌 / `Segmented` / `FigIcon` / `Markdown` / 动效类；无硬编码色值、无一次性 keyframes。
- 注释与提交信息用中文；`eslint-disable` 必带 `-- 理由`。
- 每个任务结束时跑该任务的测试文件全绿再提交；任务 10 跑完整验证链。

---

### Task 1: 协议层类型与 `parseTaskLifecycle`

**Files:**
- Modify: `src/koubou/protocol.ts`
- Test: `src/koubou/protocol.test.ts`
- Read for context: koubou `docs/websocket-events.md`「子 agent 归属与渲染」

**Interfaces:**
- Produces: `SubagentKind` / `WireTaskStatus` / `SubagentStatus` / `SealReason` / `TaskLifecycle` / `isTaskLifecycleType(sdkType)` / `parseTaskLifecycle(sdkType, payload)`
- Consumed by: 任务 2（reducer 状态机）、任务 5（接线）

- [ ] **Step 1: 写失败测试** —— `parseTaskLifecycle`：
  - `TaskStartedMessage`：取 `task_id` / `tool_use_id` / `parent_tool_use_id` / `description`，`task_type: 'local_agent' → 'agent'`、`'local_bash' → 'bash'`、缺失或未知 → `'unknown'`；`payload.data.subagent_type` 取到 `subagentType`。
  - `TaskUpdatedMessage`：`patch.status` 归一（`killed → stopped`），仅带 `end_time` / `result` / `error` 时 `status: null`；**无 `tool_use_id` 字段**，`parentToolUseId` 只从 `parent_tool_use_id` 取。
  - `TaskNotificationMessage`：`status` / `summary` / `output_file`（空串视为无）。
  - `TaskProgressMessage`：`last_tool_name`。
  - 缺 `task_id`、非对象 payload、未知 `sdk_type` → `null`。
- [ ] **Step 2: 实现** —— 类型 + `isTaskLifecycleType` + `parseTaskLifecycle`（守卫齐全，未知取值不抛）。
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/koubou/protocol.test.ts`
- [ ] **Step 4: 提交** —— `feat(koubou): 协议层补后台任务生命周期事件的类型与归一解析`

---

### Task 2: 状态机主干（开卡 / 补丁 / 收卡 / 幂等）

**Files:**
- Create: `src/lib/subagent-tasks.ts`
- Test: `src/lib/subagent-tasks.test.ts`

**Interfaces:**
- Produces: `createSubagentState()` / `normalizeStatus` / `isTerminalStatus` / `reduceLifecycle(st, ev, ctx)` 的主干路径
- Consumed by: 任务 3（隔离与收尾）、任务 5（接线）

- [ ] **Step 1: 写失败测试**
  - `normalizeStatus`：六个 wire 值 + `killed → stopped` + 未知 → `null`。
  - `isTerminalStatus`：`{completed, failed, stopped, ended_without_terminal}` 为真，`{pending, running, paused}` 为假。
  - start 开卡：三种 `kind`，初始 `status` 为 `running`（start 不带状态时的默认），记 `runId` / `toolUseId`，`taskToolUse` 学到映射。
  - updated 补丁**不带 status**（只有 `end_time` / `result`）→ 合并字段、**保留原状态、不收卡**。
  - updated 带终态 → 收卡；notification 随后到达 → **只补 `summary` / `output_file`，不改已定状态**（幂等）。
  - notification 先带终态、updated 后到 → 同上反向幂等。
  - 同一 `task_id` 重复 start（重放去重之外的兜底）→ 不产生两张卡。
- [ ] **Step 2: 实现主干** —— 卡片按 `taskId` 索引写、按开卡顺序存于 `cards` 数组。
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/lib/subagent-tasks.test.ts`
- [ ] **Step 4: 提交** —— `feat(lib): 子代理任务状态机主干(开卡/补丁/收卡/双端点幂等)`

---

### Task 3: 跨 run 隔离、tombstone、无归属待定区

**Files:**
- Modify: `src/lib/subagent-tasks.ts`
- Test: `src/lib/subagent-tasks.test.ts`

**Interfaces:**
- Produces: `learnToolUseIds(st, ids)`；`reduceLifecycle` 的归属校验分支

- [ ] **Step 1: 写失败测试**
  - **有归属**：`parent_tool_use_id` ∈ 已知集合 → 接受；不在 → **丢弃**（卡片数不变、不进待定区）。
  - 已知集合两个来源：① `learnToolUseIds` 灌入的父回合 `tool_use` id；② **带非空 `tool_use_id` 的 start 自我加入**（模拟重连：父回合消息在页外，只有 start 到达 → 卡片仍建起来，后续同 id 的 notification 被接受）。
  - **tombstone**：终态先到（有归属）→ 不开卡、记 tombstone；随后同 `task_id` 且**同 `tool_use_id`** 的 start → 直接建成终态；同 `task_id` 但**不同 `tool_use_id`** 的 start → **不消费** tombstone，建成 `running`。
  - **无归属**：updated（无 `parent_tool_use_id`）先到 → 进 `pending[task_id]`；随后合法 start 到达 → 并入且状态生效。
  - **无归属 start**：建一张 `toolUseId: null` 的不归组卡，其 `tool_use_id` **不进** `knownToolUseIds`；同 `task_id` 的无归属补丁并入这张卡。
  - **progress**：有卡 → 只更新 `lastToolName`；无卡 → 丢弃，不建卡、不进待定区。
- [ ] **Step 2: 实现** —— 归属判定抽成内部 `attribution(ev, st)`：`'known' | 'foreign' | 'unattributed'`，三条路径分别处理。
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/lib/subagent-tasks.test.ts`
- [ ] **Step 4: 提交** —— `feat(lib): 子代理卡片按 parent_tool_use_id 隔离,补 tombstone 与无归属待定区`

---

### Task 4: `run.finished` 收尾与迟到事件规则

**Files:**
- Modify: `src/lib/subagent-tasks.ts`
- Test: `src/lib/subagent-tasks.test.ts`

**Interfaces:**
- Produces: `sealRun(st, runId, runStatus)`；`reduceLifecycle` 对 `sealedRunIds` 的判断

- [ ] **Step 1: 写失败测试**
  - `sealRun`：该 run 下非终态卡 → `ended_without_terminal` + `sealReason`（`succeeded → 'unknown'`、`error → 'failed'`、`interrupted → 'interrupted'`）；已是终态的卡不动；清掉该 run 的未消费 tombstone 与待定项；**幂等**（连续两次 seal 结果相同）。
  - 收尾后迟到：start **不建卡不建 tombstone**；无归属终态**不建待定项**；同卡的迟到**真实 wire 终态替换合成态**并补 `summary`；迟到**非终态**补丁**不把卡改回 `running`**。
  - 别的 run 的卡不受本次 seal 影响。
- [ ] **Step 2: 实现** —— `sealedRunIds` 记录 + `reduceLifecycle` 前置判断。
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/lib/subagent-tasks.test.ts`
- [ ] **Step 4: 提交** —— `feat(lib): run.finished 收尾子代理卡片,收尾后迟到事件不重开`

---

### Task 5: store 类型与 UI 态（并存加新，不改行为）

**Files:**
- Modify: `src/store/types.ts`（`SubagentState` 进 `KoubouState` + 初值）、`src/store/index.ts`（`planView` + `setPlanView`）
- Test: `src/store/index.test.ts`（或就近既有 store 测试文件）

**Interfaces:**
- Produces: `KoubouState.subagents`、`UIState.planView`、`setPlanView(view)`
- 说明：本任务只加字段不接事件，`PlanCard` 行为不变（并存加新）。

- [ ] **Step 1: 写失败测试** —— 初值：`subagents` 为空态、`planView === 'tasks'`；`setPlanView('subagents')` 生效；`planView` **不在** persist 白名单（`subagents` 同理不进 `PersistedSession`）。
- [ ] **Step 2: 实现**
- [ ] **Step 3: 验证** —— 该测试文件 + `pnpm exec tsc --noEmit`
- [ ] **Step 4: 提交** —— `chore(store): 并存加入子代理卡片切片与视图切换态(瞬态)`

---

### Task 6: reducer 接线（原子切换点：子 agent 消息剥出主流）

**Files:**
- Modify: `src/koubou/apply-koubou.ts`
- Test: `src/koubou/apply-koubou.test.ts`

**Interfaces:**
- Consumes: 任务 1 的解析、任务 2–4 的状态机、任务 5 的 store 字段

- [ ] **Step 1: 写失败测试**
  - **分流**：`parent_tool_use_id` 非空的 `AssistantMessage` / `UserMessage` / `StreamEvent` **不进 `messages`**（这是本回合唯一的行为切换，回归测试钉死）；父回合消息路径逐条不变（既有测试保持全绿）。
  - 父回合 `AssistantMessage` 的 `tool_use` block id 灌入 `knownToolUseIds`。
  - 四类生命周期事件 → 落到 `subagents`，**不进 `messages`**。
  - `run.started` → `subagents` 重置 + `planView` 回 `'tasks'`（与 `tasks: []` 同一次 `set`）。
  - `run.finished` → 先 seal；`run.finished{status:'interrupted'}` 与 `run.interrupted` → **不 seal**。
  - `SystemMessage(background_tasks_changed)` → 不开卡、不改任何卡状态。
  - 子 agent `AssistantMessage` 的 `tool_use` → 更新对应卡 `lastToolName`。
- [ ] **Step 2: 实现** —— `onClaudeMessage` 入口三分支；`run.*` 分支接 `sealRun` / `resetSubagents`。
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
- [ ] **Step 4: 提交** —— `feat(koubou): 按 parent_tool_use_id 分流,子 agent 消息不再冒充父回合`

---

### Task 7: 历史重建产出子代理卡片

**Files:**
- Modify: `src/koubou/apply-koubou.ts`（`rebuild` / `historyFields` / `seedHistory` / `prependHistory`）
- Test: `src/koubou/apply-koubou.test.ts`

**Interfaces:**
- Produces: `rebuild(...)` 返回值增加 `subagents`

- [ ] **Step 1: 写失败测试**
  - 事件日志含 start + notification → 重建出终态卡。
  - **重连窗口**：页内只有 start（父回合那条 `AssistantMessage` 在页外）→ 卡片仍建起来（依赖任务 3 的来源 ②）。
  - `prependHistory`（更早页前插）**不覆盖**当前 `subagents`（与 `tasks` 同口径，恒以现值为准）。
  - 已结束 run 的重建结果被 `run.finished` seal 成合成态（不转圈）。
- [ ] **Step 2: 实现**
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
- [ ] **Step 4: 提交** —— `feat(koubou): 历史重放重建子代理卡片(重连口径)`

---

### Task 8: `SubagentList` 组件

**Files:**
- Create: `src/components/chat/SubagentList.tsx`
- Test: `src/components/chat/SubagentList.test.tsx`
- Read for context: `src/components/chat/PlanCard.tsx`（行样式 / 状态图标）、`src/components/chat/Markdown.tsx`

**Interfaces:**
- Consumes: `SubagentCard[]`（props，纯展示组件，便于测试）
- Produces: 供任务 9 的 `PlanCard` 嵌入

- [ ] **Step 1: 写失败测试** —— 六种状态图标；`bash` 行显示「后台命令」标、`agent` 行不显示；`running` 行显示活体行「正在 Grep」，无 `lastToolName` 时不显示该行；点行展开渲染 `summary`（Markdown），无 summary 显示「无汇报」；`failed` 的 `error` 用 danger 色；`outputFile` 有值才渲染；`aria-expanded` 正确。
- [ ] **Step 2: 实现** —— 复用既有令牌与 12px mono 行规格，展开区 `scrollbar-auto` 限高。
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/components/chat/SubagentList.test.tsx`
- [ ] **Step 4: 提交** —— `feat(chat): 子代理任务列表(状态行 + 可展开汇报)`

---

### Task 9: `PlanCard` 升为双段容器 + i18n

**Files:**
- Modify: `src/components/chat/PlanCard.tsx`、`src/i18n/locales/{zh,zh-TW,en,ja,ko,de,es,fr,pt,ru,vi}.ts`
- Test: `src/components/chat/PlanCard.test.tsx`

**Interfaces:**
- Consumes: `SubagentList`、`store.subagents.cards`、`store.planView` / `setPlanView`

- [ ] **Step 1: 写失败测试**
  - 只有 `tasks` → 无 Segmented，标题为任务清单（**与今天完全一致**）。
  - 只有子代理卡 → 无 Segmented，标题为「子代理」，渲染 `SubagentList`。
  - 两者都有 → 出现 Segmented（两段 + 子代理段带总数），点击切换渲染内容；子代理开卡**不自动抢切**（`planView` 保持 `'tasks'`）。
  - 折叠态：任务清单段 `done/total`、子代理段 `终态数/总数`；子代理段折叠时显示首个非终态卡一行。
  - 可见性：`runStatus !== 'running'` → 退场（`useExitTransition`）；两段都空 → 不渲染。
  - i18n：`pnpm exec vitest run src/i18n`（既有键完备性测试）保持全绿，11 语言同批补齐 11 条文案。
- [ ] **Step 2: 实现**
- [ ] **Step 3: 验证** —— `pnpm exec vitest run src/components/chat/PlanCard.test.tsx src/i18n`
- [ ] **Step 4: 提交** —— `feat(chat): 任务清单卡升为双段容器,Segmented 切换子代理视图`

---

### Task 10: 全链验证 + dev 实机核对

**Files:** 无（仅验证；如实测发现契约偏差，回到对应任务修）

- [ ] **Step 1: 完整验证链** —— `pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`，逐条留完整输出与退出码。
- [ ] **Step 2: dev 实机核对** —— 连 dev（`devlab.rezona.ai`）发一条会派子代理的需求，在浏览器控制台观察 WS 帧：确认 `TaskStartedMessage` / `TaskUpdatedMessage` / `TaskNotificationMessage` 确实带 `sequence`（已落库）、`parent_tool_use_id` 是否盖章、`task_type` 取值；确认卡片出现→收卡、主流不再混入子 agent 消息。
- [ ] **Step 3: 记录** —— 实测结论（尤其镜像是否已落库端点）补进 spec 的「已知风险与残留」。
- [ ] **Step 4: 评审与合并** —— 派干净上下文子代理基于 commit 范围独立评审（只给 spec 与 diff）；Critical / Important 修完后 `--no-ff` 合入 dev，在合并结果上重跑完整验证链，再跑 `/walkthrough`。
