# Planner 模式（任务清单悬浮卡）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 agent 的任务清单（TaskCreate/TaskUpdate/TaskList/TaskGet 工具流）聚合为 Composer 上方固定悬浮的可折叠计划卡，实时更新任务状态。

**Architecture:** 协议层新增两个纯解析函数（result 驱动 ID/状态机、落定 input 补文案）；`applyKoubou` reducer 维护 `KoubouState.tasks` 切片（live 与冷启动 rebuild 双路径）；随会话快照持久化；UI 是订阅 store 的 `PlanCard` 组件 + 消息流内 Task 工具极简 pill。

**Tech Stack:** Next.js 16 / React 19 / zustand / Vitest（jsdom + Testing Library）/ react-i18next。

**Spec:** `docs/superpowers/specs/2026-07-07-planner-mode-design.md`

## Global Constraints

- 执行前用 superpowers:using-git-worktrees 建 `feat/planner-mode` worktree（基于 `dev`）；**每次写文件后校验落在 worktree 内**（`git -C <worktree> status`），不轻信绝对路径。
- 注释 / commit message 一律**中文**，commit 一句话总结；注释解释「为什么」。
- 颜色/圆角/阴影/字体一律走 `globals.css` 令牌（`--color-teal` / `--color-pop` / `--color-line` / `--color-muted` / `--color-ink` / `font-mono`），**禁止硬编码色值**；进度/高亮一律品牌青 `--color-teal`（不引入 Figma 的 `#14b8a6`）。
- 新增文案走 react-i18next，**六语齐补**（en/zh/fr/ru/ja/vi），en 为单一真相源。
- 验证只信命令退出码：`pnpm exec vitest run <file>`、`pnpm exec tsc --noEmit`、`pnpm lint`；worktree 里 IDE `<new-diagnostics>` 大量误报，忽略。
- 不可变更新：reducer/action 返回新对象；测试与源码同目录。
- 流式 `input_json_delta` 不解析；任务数据只在 `UserMessage`（tool_result 到达）时消费。

---

### Task 1: 协议层解析函数（`parseTaskResult` / `parseTaskInput`）

**Files:**
- Modify: `src/koubou/protocol.ts`（文件末尾、`buildWsUrl` 之前追加一节）
- Test: `src/koubou/protocol.test.ts`（追加 describe 块）

**Interfaces:**
- Produces（后续任务依赖，签名必须一致）:
  - `type PlanTaskStatus = 'pending' | 'in_progress' | 'completed'`
  - `interface PlanTask { id: string; subject: string; description?: string; activeForm?: string; status: PlanTaskStatus }`
  - `function isTaskTool(name: string): boolean`
  - `type TaskEffect =`（判别 union，见下）
  - `function parseTaskResult(toolName: string, raw: unknown): TaskEffect | null`
  - `interface TaskInputMeta { taskId?: string; subject?: string; description?: string; activeForm?: string }`
  - `function parseTaskInput(input: unknown): TaskInputMeta | null`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/protocol.test.ts` 末尾追加：

```ts
import { parseTaskResult, parseTaskInput, isTaskTool } from './protocol';

describe('parseTaskResult', () => {
  it('TaskCreate → create effect(取 task.id/subject)', () => {
    expect(parseTaskResult('TaskCreate', { task: { id: '1', subject: '建骨架' } }))
      .toEqual({ kind: 'create', id: '1', subject: '建骨架' });
  });
  it('TaskUpdate → update effect(statusChange.to + updatedFields)', () => {
    expect(parseTaskResult('TaskUpdate', {
      success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' },
    })).toEqual({ kind: 'update', taskId: '1', to: 'in_progress', updatedFields: ['status'] });
  });
  it('TaskUpdate 无 statusChange → to 为 null', () => {
    expect(parseTaskResult('TaskUpdate', { success: true, taskId: '2', updatedFields: ['subject'] }))
      .toEqual({ kind: 'update', taskId: '2', to: null, updatedFields: ['subject'] });
  });
  it('TaskList → snapshot(过滤畸形项)', () => {
    expect(parseTaskResult('TaskList', { tasks: [
      { id: '1', subject: 'a', status: 'completed' },
      { subject: '缺 id 丢弃' },
    ] })).toEqual({ kind: 'snapshot', tasks: [{ id: '1', subject: 'a', status: 'completed' }] });
  });
  it('TaskGet → get effect', () => {
    expect(parseTaskResult('TaskGet', { task: { id: '3', subject: 's', description: 'd', status: 'pending' } }))
      .toEqual({ kind: 'get', task: { id: '3', subject: 's', description: 'd', status: 'pending' } });
  });
  it.each([
    ['非任务工具', 'Bash', { task: { id: '1' } }],
    ['null', 'TaskCreate', null],
    ['缺 task.id', 'TaskCreate', { task: { subject: 'x' } }],
    ['TaskUpdate 缺 taskId', 'TaskUpdate', { success: true }],
    ['TaskList 非数组', 'TaskList', { tasks: 'nope' }],
  ])('畸形输入返回 null:%s', (_n, tool, raw) => {
    expect(parseTaskResult(tool, raw)).toBeNull();
  });
});

describe('parseTaskInput', () => {
  it('规范键直取', () => {
    expect(parseTaskInput({ taskId: '1', subject: 's', description: 'd', activeForm: '进行中文案' }))
      .toEqual({ taskId: '1', subject: 's', description: 'd', activeForm: '进行中文案' });
  });
  it('别名兜底:active_form/task_id/id(流式保留模型原始键)', () => {
    expect(parseTaskInput({ id: '2', active_form: '做某事' })).toEqual({ taskId: '2', activeForm: '做某事' });
    expect(parseTaskInput({ task_id: '3' })).toEqual({ taskId: '3' });
  });
  it('规范键优先于别名', () => {
    expect(parseTaskInput({ taskId: '1', task_id: '9' })).toEqual({ taskId: '1' });
  });
  it('非对象/空对象返回 null', () => {
    expect(parseTaskInput(undefined)).toBeNull();
    expect(parseTaskInput('str')).toBeNull();
    expect(parseTaskInput({})).toBeNull();
  });
});

describe('isTaskTool', () => {
  it('四个任务工具 true,其余 false', () => {
    for (const n of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) expect(isTaskTool(n)).toBe(true);
    expect(isTaskTool('Bash')).toBe(false);
    expect(isTaskTool('TaskStartedMessage')).toBe(false); // 后台任务事件,不是清单工具
  });
});
```

注意：该测试文件如已有 `import { describe, it, expect } from 'vitest'` 或 vitest globals 配置，沿用现状（项目 Vitest 开了 globals，通常无需 import）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/protocol.test.ts`
Expected: FAIL（`parseTaskResult` 未导出）

- [ ] **Step 3: 实现**

在 `src/koubou/protocol.ts` 的 `toolResultText` 之前（`// ---- 提交回执` 一节之后）插入：

```ts
// ---- 任务清单(TaskCreate/TaskUpdate/TaskList/TaskGet)----
// agent 用这组工具跟踪多步骤工作;没有整单快照型独立事件,前端按 run/session 累积
// tool_use_result 维护清单状态(见 koubou 文档「任务清单」节)。
export type PlanTaskStatus = 'pending' | 'in_progress' | 'completed';
export interface PlanTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;   // 进行中态的现在进行时文案,in_progress 时优先展示
  status: PlanTaskStatus;
}

const TASK_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];
export function isTaskTool(name: string): boolean {
  return TASK_TOOLS.includes(name);
}

// 归一后的清单变更(reducer 消费)。ID/状态机只信 tool_use_result:
// TaskUpdate 的 statusChange.to 比入参可靠(入参缺省字段时结果仍给完整变化);
// 但 result 不含文案新值(TaskCreate 只有 id/subject、TaskUpdate 只有字段名),
// 文案由 parseTaskInput 从落定 input 补齐。
export type TaskEffect =
  | { kind: 'create'; id: string; subject: string }
  | { kind: 'update'; taskId: string; to: string | null; updatedFields: string[] }
  | { kind: 'snapshot'; tasks: { id: string; subject: string; status: string }[] }
  | { kind: 'get'; task: { id: string; subject?: string; description?: string; status?: string } };

export function parseTaskResult(toolName: string, raw: unknown): TaskEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (toolName === 'TaskCreate' || toolName === 'TaskGet') {
    const t = o.task;
    if (!t || typeof t !== 'object') return null;
    const task = t as Record<string, unknown>;
    if (typeof task.id !== 'string' || !task.id) return null;
    if (toolName === 'TaskCreate') {
      return { kind: 'create', id: task.id, subject: typeof task.subject === 'string' ? task.subject : '' };
    }
    return {
      kind: 'get',
      task: {
        id: task.id,
        ...(typeof task.subject === 'string' ? { subject: task.subject } : {}),
        ...(typeof task.description === 'string' ? { description: task.description } : {}),
        ...(typeof task.status === 'string' ? { status: task.status } : {}),
      },
    };
  }
  if (toolName === 'TaskUpdate') {
    if (typeof o.taskId !== 'string' || !o.taskId) return null;
    const sc = o.statusChange;
    const to = sc && typeof sc === 'object' && typeof (sc as Record<string, unknown>).to === 'string'
      ? (sc as Record<string, unknown>).to as string : null;
    const updatedFields = Array.isArray(o.updatedFields)
      ? o.updatedFields.filter((f): f is string => typeof f === 'string') : [];
    return { kind: 'update', taskId: o.taskId, to, updatedFields };
  }
  if (toolName === 'TaskList') {
    if (!Array.isArray(o.tasks)) return null;
    const tasks = o.tasks
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as Record<string, unknown>).id === 'string')
      .map((t) => ({
        id: t.id as string,
        subject: typeof t.subject === 'string' ? t.subject : '',
        status: typeof t.status === 'string' ? t.status : 'pending',
      }));
    return { kind: 'snapshot', tasks };
  }
  return null;
}

// 从落定的 tool_use.input 提取文案字段。CLI 会修复模型写错的字段名,但流式下发的
// input 保留修复前原始键 → 做别名兜底(active_form→activeForm、id/task_id→taskId)。
export interface TaskInputMeta { taskId?: string; subject?: string; description?: string; activeForm?: string }

export function parseTaskInput(input: unknown): TaskInputMeta | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v) return v; }
    return undefined;
  };
  const meta: TaskInputMeta = {};
  const taskId = pick('taskId', 'task_id', 'id');
  const subject = pick('subject');
  const description = pick('description');
  const activeForm = pick('activeForm', 'active_form');
  if (taskId) meta.taskId = taskId;
  if (subject) meta.subject = subject;
  if (description) meta.description = description;
  if (activeForm) meta.activeForm = activeForm;
  return Object.keys(meta).length ? meta : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/koubou/protocol.test.ts`
Expected: PASS（全部用例，含原有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add src/koubou/protocol.ts src/koubou/protocol.test.ts
git commit -m "feat: 任务清单协议解析(parseTaskResult/parseTaskInput)"
```

---

### Task 2: reducer 维护 `tasks` 切片（live + 冷启动重建）

**Files:**
- Modify: `src/store/types.ts`（`KoubouState` / `createInitialKoubouState` / `PersistedSession`）
- Modify: `src/koubou/apply-koubou.ts`
- Test: `src/koubou/apply-koubou.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `PlanTask` / `isTaskTool` / `parseTaskResult` / `parseTaskInput`。
- Produces:
  - `KoubouState.tasks: PlanTask[]`（初值 `[]`）
  - `PersistedSession.tasks: PlanTask[]`
  - `rebuild(events)` 返回值扩为 `{ messages, turns, tasks, sawTasks }`（`sawTasks`=事件日志中出现过任务工具结果）

- [ ] **Step 1: 改类型（无独立测试,编译约束）**

`src/store/types.ts`：

1. 顶部 import 追加 `PlanTask`：

```ts
import type { MediaItem, QuestionDef, FileDiff, ServerEvent, SubmittedTask, PlanTask } from '@/koubou/protocol';
```

2. `KoubouState` 内 `turns: TurnMeta[];` 之后加一行：

```ts
  tasks: PlanTask[];         // agent 任务清单(planner 模式);由任务工具 tool_use_result 累积,TaskList 快照整单校正
```

3. `createInitialKoubouState` 返回对象 `turns: [],` 后加 `tasks: [],`。

4. `PersistedSession` 改为：

```ts
export interface PersistedSession { sessionId: string; lastSequence: number; messages: Message[]; turns: TurnMeta[]; tasks: PlanTask[] }
```

- [ ] **Step 2: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 末尾追加（沿用该文件既有的事件构造 helper；若其 helper 形状不同，按现有风格改写构造，**断言不变**）：

```ts
describe('任务清单(tasks 切片)', () => {
  // 助手消息带 TaskCreate tool_use → UserMessage 带对应 tool_result + tool_use_result
  const assistantWithTool = (uuid: string, toolId: string, name: string, input: unknown): ServerEvent => ({
    type: 'claude.message', project_id: 'p', session_id: 's', sequence: seq++,
    payload: { sdk_type: 'AssistantMessage', payload: { uuid, content: [{ type: 'tool_use', id: toolId, name, input }] } },
  } as unknown as ServerEvent);
  const userResult = (toolId: string, tur: unknown): ServerEvent => ({
    type: 'claude.message', project_id: 'p', session_id: 's', sequence: seq++,
    payload: { sdk_type: 'UserMessage', payload: {
      content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }],
      tool_use_result: tur,
    } },
  } as unknown as ServerEvent);
  let seq = 1;
  beforeEach(() => { seq = 1; });

  const init = () => createInitialKoubouState();

  it('TaskCreate 结果建项(pending),文案从落定 input 补齐', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: '建骨架', description: 'D', activeForm: '正在建骨架' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: '建骨架' } }));
    expect(s.tasks).toEqual([{ id: '1', subject: '建骨架', description: 'D', activeForm: '正在建骨架', status: 'pending' }]);
  });

  it('TaskUpdate 按 statusChange.to 推状态机;deleted 移除;未知 taskId 忽略不抛', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: 'a' } }));
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskUpdate', { taskId: '1', status: 'in_progress' }));
    s = applyKoubou(s, userResult('t2', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } }));
    expect(s.tasks[0].status).toBe('in_progress');
    // 未知 taskId → 原样
    s = applyKoubou(s, assistantWithTool('u3', 't3', 'TaskUpdate', { taskId: '99' }));
    s = applyKoubou(s, userResult('t3', { success: true, taskId: '99', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } }));
    expect(s.tasks).toHaveLength(1);
    // deleted → 移除
    s = applyKoubou(s, assistantWithTool('u4', 't4', 'TaskUpdate', { taskId: '1', status: 'deleted' }));
    s = applyKoubou(s, userResult('t4', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'in_progress', to: 'deleted' } }));
    expect(s.tasks).toHaveLength(0);
  });

  it('TaskUpdate 的 updatedFields 文案改写取 input 新值', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: '旧标题' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: '旧标题' } }));
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskUpdate', { task_id: '1', subject: '新标题', active_form: '改标题中' }));
    s = applyKoubou(s, userResult('t2', { success: true, taskId: '1', updatedFields: ['subject', 'activeForm'] }));
    expect(s.tasks[0].subject).toBe('新标题');
    expect(s.tasks[0].activeForm).toBe('改标题中');
  });

  it('TaskList 快照整单校正,保留已知项的 activeForm', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a', activeForm: '做 a' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: 'a' } }));
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskList', {}));
    s = applyKoubou(s, userResult('t2', { tasks: [
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ] }));
    expect(s.tasks).toEqual([
      { id: '1', subject: 'a', activeForm: '做 a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ]);
  });

  it('is_error 的任务工具结果不动清单', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a' }));
    s = applyKoubou(s, {
      type: 'claude.message', project_id: 'p', session_id: 's', sequence: seq++,
      payload: { sdk_type: 'UserMessage', payload: {
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }],
        tool_use_result: { task: { id: '1', subject: 'a' } },
      } },
    } as unknown as ServerEvent);
    expect(s.tasks).toHaveLength(0);
  });

  it('rebuild 从事件日志重建 tasks(冷启动路径)', () => {
    const events: ServerEvent[] = [
      assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a', activeForm: '做 a' }),
      userResult('t1', { task: { id: '1', subject: 'a' } }),
      assistantWithTool('u2', 't2', 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
      userResult('t2', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } }),
    ];
    const { tasks, sawTasks } = rebuild(events);
    expect(sawTasks).toBe(true);
    expect(tasks).toEqual([{ id: '1', subject: 'a', activeForm: '做 a', status: 'in_progress' }]);
  });

  it('无任务事件的日志 sawTasks=false;seedHistory 保留现有 tasks', () => {
    const { sawTasks } = rebuild([]);
    expect(sawTasks).toBe(false);
    const s: KoubouState = { ...createInitialKoubouState(), tasks: [{ id: '1', subject: 'a', status: 'pending' }] };
    const next = seedHistory(s, { events: [], has_more: false, latest_sequence: 0 });
    expect(next.tasks).toEqual(s.tasks); // 页内无任务事件 → 不清空既有清单
  });

  it('prependHistory 不用旧页覆盖 tasks(前插的都是更早事件)', () => {
    const s: KoubouState = { ...createInitialKoubouState(), tasks: [{ id: '9', subject: '最新', status: 'completed' }] };
    const page = { events: [
      assistantWithTool('u1', 't1', 'TaskCreate', { subject: '旧' }),
      userResult('t1', { task: { id: '1', subject: '旧' } }),
    ], has_more: false, latest_sequence: 2 };
    const next = prependHistory({ ...s, historyEvents: [], historyMsgCount: 0, historyTurnCount: 0 }, page);
    expect(next.tasks).toEqual(s.tasks);
  });
});
```

需要的 import（并入该文件顶部现有 import）：`rebuild`、`seedHistory`、`prependHistory`、`createInitialKoubouState`、`KoubouState` 类型。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: FAIL（`s.tasks` undefined / `sawTasks` 不存在）

- [ ] **Step 4: 实现 reducer**

`src/koubou/apply-koubou.ts` 修改：

1. import 扩充：

```ts
import type {
  ServerEvent, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
  RawStreamEvent, ClaudeMessagePayload, QuestionDef, FileDiff, ToolUseResultRaw, PlanTask, PlanTaskStatus, TaskEffect,
} from './protocol';
import { isFullMessage, parseMediaItems, parseSubmittedTask, toolResultText, parseFileDiff, isTaskTool, parseTaskResult, parseTaskInput, type TaskInputMeta } from './protocol';
```

（`TaskInputMeta` 是 interface，放 type import 或值 import 的 `type` 前缀均可，与文件现状一致即可。）

2. 在 `foldResults` 之后新增任务清单一节：

```ts
// ---- 任务清单(planner 模式)----
// ID/状态机只信 tool_use_result;文案(subject/description/activeForm)从对应 tool_use part
// 的落定 input 补齐(流式半截 JSON 不进这里:input 在完整 AssistantMessage 落定时才写入 part)。
const KNOWN_TASK_STATUS: readonly PlanTaskStatus[] = ['pending', 'in_progress', 'completed'];
function normTaskStatus(s: string | undefined, fallback: PlanTaskStatus): PlanTaskStatus {
  return (KNOWN_TASK_STATUS as readonly string[]).includes(s ?? '') ? (s as PlanTaskStatus) : fallback;
}

// 从消息里按 tool_use_id 反查 tool part(取工具名 + 落定入参);草稿/历史均适用,从尾部找(结果紧跟调用)
function findToolPart(messages: readonly Message[], toolUseId: string): Extract<Part, { type: 'tool' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const p of messages[i].parts) {
      if (p.type === 'tool' && p.id === toolUseId) return p;
    }
  }
  return undefined;
}

// 把一批 tool_result 中的任务工具结果应用到清单。tool_use_result 是消息级单值,
// 多结果时无法可靠归属 → 仅处理单结果场景(任务工具实际单发);失败结果(is_error)不动清单。
function applyTaskResults(tasks: PlanTask[], messages: readonly Message[], results: ToolResultBlock[], raw: unknown): PlanTask[] {
  if (results.length !== 1 || results[0].is_error) return tasks;
  const part = findToolPart(messages, results[0].tool_use_id);
  if (!part || !isTaskTool(part.name)) return tasks;
  const effect = parseTaskResult(part.name, raw);
  if (!effect) return tasks;
  return reduceTasks(tasks, effect, parseTaskInput(part.input) ?? {});
}

function reduceTasks(tasks: PlanTask[], effect: TaskEffect, meta: TaskInputMeta): PlanTask[] {
  switch (effect.kind) {
    case 'create': {
      const item: PlanTask = {
        id: effect.id,
        subject: effect.subject || meta.subject || '',
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.activeForm ? { activeForm: meta.activeForm } : {}),
        status: 'pending',
      };
      // 重放防御:同 id 已存在则原位合并,不追加重复项
      return tasks.some((t) => t.id === item.id)
        ? tasks.map((t) => (t.id === item.id ? { ...t, ...item } : t))
        : [...tasks, item];
    }
    case 'update': {
      if (effect.to === 'deleted') return tasks.filter((t) => t.id !== effect.taskId);
      return tasks.map((t) => {
        if (t.id !== effect.taskId) return t;
        const next: PlanTask = { ...t, status: normTaskStatus(effect.to ?? undefined, t.status) };
        // updatedFields 声明了哪些文案被改写;新值只在 input 里
        if (effect.updatedFields.includes('subject') && meta.subject) next.subject = meta.subject;
        if (effect.updatedFields.includes('description') && meta.description) next.description = meta.description;
        if (effect.updatedFields.includes('activeForm') && meta.activeForm) next.activeForm = meta.activeForm;
        return next;
      });
    }
    case 'snapshot': {
      // 整单校正:顺序按后端 tasks[];快照不含 activeForm/description,按 id 从已有项保留合并
      const prev = new Map(tasks.map((t) => [t.id, t]));
      return effect.tasks.map((t) => {
        const old = prev.get(t.id);
        return {
          id: t.id,
          subject: t.subject || old?.subject || '',
          ...(old?.description ? { description: old.description } : {}),
          ...(old?.activeForm ? { activeForm: old.activeForm } : {}),
          status: normTaskStatus(t.status, old?.status ?? 'pending'),
        };
      });
    }
    case 'get':
      return tasks.map((t) => {
        if (t.id !== effect.task.id) return t;
        return {
          ...t,
          ...(effect.task.subject ? { subject: effect.task.subject } : {}),
          ...(effect.task.description ? { description: effect.task.description } : {}),
          status: normTaskStatus(effect.task.status, t.status),
        };
      });
  }
}
```

（`Part` 类型已在文件 import 的 `@/store/types` 里。）

3. live 路径 —— `onClaudeMessage` 的 UserMessage 分支改为：

```ts
  // UserMessage:仅折叠 tool_result(用户文本已乐观渲染,不重复成泡);带文件 diff 时一并挂载
  const blocks = Array.isArray(content) ? content : [];
  const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  if (!results.length) return state;
  // 文件 diff 走文档约定的 snake_case 字段;与冷启动 rebuildHistory 路径保持一致
  return {
    ...state,
    messages: foldResults(state.messages, results, parseFileDiff(p.payload.tool_use_result) ?? undefined),
    tasks: applyTaskResults(state.tasks, state.messages, results, p.payload.tool_use_result),
  };
```

4. 冷启动路径 —— `rebuild`：函数开头 `const turns: TurnMeta[] = [];` 后加：

```ts
  let tasks: PlanTask[] = [];
  let sawTasks = false;
```

UserMessage 折叠处（`messages = foldResults(...)` 那行）改为：

```ts
    if (results.length && results.length === blocks.length) {
      // 任务清单与 diff 同一 tool_use_result 通道;先记清单再折叠(findToolPart 只依赖 tool_use part,先后均可)
      const nextTasks = applyTaskResults(tasks, messages, results, pl.tool_use_result);
      if (nextTasks !== tasks) { tasks = nextTasks; sawTasks = true; }
      else if (results.length === 1 && isTaskTool(findToolPart(messages, results[0].tool_use_id)?.name ?? '')) sawTasks = true;
      messages = foldResults(messages, results, parseFileDiff(pl.tool_use_result) ?? undefined);
    } else if (!isInterruptMarker(content)) {
```

返回值与签名改为：

```ts
export function rebuild(events: ServerEvent[]): { messages: Message[]; turns: TurnMeta[]; tasks: PlanTask[]; sawTasks: boolean } {
  ...
  return { messages, turns, tasks, sawTasks };
}
```

5. `historyFields` 带上 tasks（仅日志中出现过任务事件才覆盖，避免 REST 最新一页不含任务事件时清掉快照恢复的清单）：

```ts
function historyFields(events: ServerEvent[], hasMore?: boolean) {
  const { messages, turns, tasks, sawTasks } = rebuild(events);
  const oldest = typeof events[0]?.sequence === 'number' ? events[0].sequence : null;
  return {
    messages,
    turns,
    // 页内出现过任务工具结果才覆盖清单;否则调用方保留现值(局部日志推不出「清单为空」)
    ...(sawTasks ? { tasks } : {}),
    historyEvents: events,
    historyMsgCount: messages.length,
    historyTurnCount: turns.length,
    historyOldestSeq: oldest,
    historyHasMore: hasMore ?? (oldest != null && oldest > 1),
  };
}
```

6. `prependHistory`：旧页是更早事件，不得覆盖现有清单。spread `...fields` 之后显式保留：

```ts
  return {
    ...state,
    ...fields,
    tasks: state.tasks,   // 前插的都是更早事件,清单以现值(最新)为准
    messages: [...fields.messages, ...state.messages.slice(state.historyMsgCount)],
    turns: [...fields.turns, ...state.turns.slice(state.historyTurnCount)],
  };
```

- [ ] **Step 5: 跑测试确认通过（含全量回归）**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts src/koubou/protocol.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / 无类型错误。`tsc` 会暴露 `PersistedSession` 新增 `tasks` 后的既有构造缺口——如 `src/store/index.ts` 的 `switchProjectSession`（Task 3 处理）在此步报错，属预期，可先在本步一并补上 Task 3 Step 1 的两处最小改动使编译通过（`switchProjectSession` 加 `tasks: saved?.tasks ?? []`、`useKoubouConnection` 快照写入加 `tasks: st.tasks`），Task 3 只补测试。

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts src/store/index.ts src/client/useKoubouConnection.ts
git commit -m "feat: applyKoubou 维护任务清单 tasks 切片(live+冷启动重建)"
```

---

### Task 3: 会话快照持久化 / 恢复 + `planCollapsed` UIState

**Files:**
- Modify: `src/store/index.ts`（`switchProjectSession`、UIState、action）
- Modify: `src/client/useKoubouConnection.ts`（快照写入点，约 line 81）
- Test: `src/store/turns-persistence.test.ts`（追加用例;该文件已覆盖快照持久化语义，就近扩展）

**Interfaces:**
- Consumes: Task 2 的 `KoubouState.tasks` / `PersistedSession.tasks`。
- Produces:
  - `UIState.planCollapsed: boolean`（初值 `false`，**不持久化**）
  - `Actions.togglePlanCollapsed: () => void`

- [ ] **Step 1: 源码改动**

1. `src/store/index.ts` — `switchProjectSession` 的返回对象里 `turns: saved?.turns ?? [],` 后加：

```ts
            tasks: saved?.tasks ?? [],   // 旧快照无 tasks 字段 → 空清单
```

2. `src/client/useKoubouConnection.ts` — 快照写入对象加 `tasks: st.tasks`：

```ts
              koubouByProject: { ...st.koubouByProject, [String(pid)]: { sessionId: st.sessionId, lastSequence: st.lastSequence, messages: st.messages, turns: st.turns, tasks: st.tasks } },
```

3. `src/store/index.ts` — `UIState` 接口 `libraryListCache` 声明后加：

```ts
  // planner 计划卡折叠态;纯 UI 瞬态,不持久化(见 partialize)
  planCollapsed: boolean;
```

`Actions` 接口加：

```ts
  togglePlanCollapsed: () => void;
```

store 初值区（`libraryListCache: {},` 后）加 `planCollapsed: false,`；actions 区（`cacheLibraryList` 附近）加：

```ts
      togglePlanCollapsed: () => set((s) => ({ planCollapsed: !s.planCollapsed })),
```

**不改 `partialize`**（planCollapsed 不落盘）。

（若 Task 2 Step 5 已顺手完成 1/2 两处，本步只补 3。）

- [ ] **Step 2: 写测试**

在 `src/store/turns-persistence.test.ts` 追加（沿用该文件的 store 操作风格）：

```ts
it('tasks 随会话快照恢复;旧快照缺 tasks 回退空数组', () => {
  const tasks = [{ id: '1', subject: 'a', status: 'pending' as const }];
  useStore.setState({
    koubouByProject: {
      '1': { sessionId: 's1', lastSequence: 3, messages: [], turns: [], tasks },
      // 模拟 v1 旧快照:无 tasks 字段
      '2': { sessionId: 's2', lastSequence: 5, messages: [], turns: [] } as unknown as PersistedSession,
    },
  });
  useStore.getState().switchProjectSession(1);
  expect(useStore.getState().tasks).toEqual(tasks);
  useStore.getState().switchProjectSession(2);
  expect(useStore.getState().tasks).toEqual([]);
});

it('togglePlanCollapsed 翻转折叠态', () => {
  expect(useStore.getState().planCollapsed).toBe(false);
  useStore.getState().togglePlanCollapsed();
  expect(useStore.getState().planCollapsed).toBe(true);
  useStore.getState().togglePlanCollapsed();
  expect(useStore.getState().planCollapsed).toBe(false);
});
```

`PersistedSession` 类型 import 自 `@/store/types`。

- [ ] **Step 3: 跑测试**

Run: `pnpm exec vitest run src/store/turns-persistence.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts src/client/useKoubouConnection.ts src/store/turns-persistence.test.ts
git commit -m "feat: tasks 随会话快照持久化恢复 + planCollapsed 折叠态"
```

---

### Task 4: i18n 文案（六语）+ PlanCard 组件 + 挂载

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`
- Create: `src/components/chat/PlanCard.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`（Composer 外包 relative 容器）
- Test: `src/components/chat/PlanCard.test.tsx`

**Interfaces:**
- Consumes: `useStore` 的 `tasks` / `planCollapsed` / `togglePlanCollapsed`；`useExitTransition`（`src/client/useExitTransition.ts`）；`FigIcon`/`figAsset.checkCircle`；`CollapseArrow`（`./toolPill`）。
- Produces: `PlanCard`（default export，无 props）。
- i18n keys: `chat.plan.title` / `chat.plan.toggle`；Task 5 用 `chat.tool.updatedPlan`（本步一并补齐六语）。

- [ ] **Step 1: 补六语文案**

每个 locale 的 `chat` 节内加 `plan` 子节，`chat.tool` 内加 `updatedPlan`（对齐 en 的键序）：

| locale | `plan.title` | `plan.toggle` | `tool.updatedPlan` |
|---|---|---|---|
| en | `Task list` | `Toggle task list` | `Updated plan` |
| zh | `任务清单` | `展开/收起任务清单` | `更新计划` |
| fr | `Liste des tâches` | `Afficher/masquer la liste des tâches` | `Plan mis à jour` |
| ru | `Список задач` | `Показать/скрыть список задач` | `План обновлён` |
| ja | `タスクリスト` | `タスクリストの表示切替` | `プランを更新` |
| vi | `Danh sách nhiệm vụ` | `Hiện/ẩn danh sách nhiệm vụ` | `Đã cập nhật kế hoạch` |

en 示例（`chat.tool` 行与新增 `plan`）：

```ts
    tool: { running: 'Running', userEdited: 'Edited by user', input: 'Input', updatedPlan: 'Updated plan' },
    plan: { title: 'Task list', toggle: 'Toggle task list' },
```

- [ ] **Step 2: 写失败测试**

创建 `src/components/chat/PlanCard.test.tsx`：

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import PlanCard from './PlanCard';
import { useStore } from '@/store';
import type { PlanTask } from '@/koubou/protocol';

// i18n:测试环境挂 en 资源(沿用仓库其它组件测试的初始化方式;若 vitest.setup 已全局初始化则无需重复)

const setTasks = (tasks: PlanTask[]) => useStore.setState({ tasks, planCollapsed: false });

describe('PlanCard', () => {
  beforeEach(() => setTasks([]));

  it('空清单不渲染', () => {
    const { container } = render(<PlanCard />);
    expect(container.firstChild).toBeNull();
  });

  it('渲染标题与全部任务;in_progress 显示 activeForm,缺省回退 subject', () => {
    setTasks([
      { id: '1', subject: '搜 skill', status: 'completed' },
      { id: '2', subject: '写 json', activeForm: '正在写 json', status: 'in_progress' },
      { id: '3', subject: '无 activeForm', status: 'in_progress' },
      { id: '4', subject: '排队中', status: 'pending' },
    ]);
    render(<PlanCard />);
    expect(screen.getByText('Task list')).toBeInTheDocument();
    expect(screen.getByText('搜 skill')).toBeInTheDocument();
    expect(screen.getByText('正在写 json')).toBeInTheDocument();  // activeForm 优先
    expect(screen.queryByText('写 json')).toBeNull();
    expect(screen.getByText('无 activeForm')).toBeInTheDocument(); // 回退 subject
    expect(screen.getByText('排队中')).toBeInTheDocument();
  });

  it('折叠:列表隐藏,头部显示进度计数;再点展开', () => {
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ]);
    render(<PlanCard />);
    const toggle = screen.getByRole('button', { name: 'Toggle task list' });
    fireEvent.click(toggle);
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('1/2')).toBeNull(); // 展开态严格按设计稿,无计数
  });

  it('completed 行有删除线样式类', () => {
    setTasks([{ id: '1', subject: 'done', status: 'completed' }]);
    render(<PlanCard />);
    expect(screen.getByText('done').className).toContain('line-through');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/PlanCard.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 PlanCard**

创建 `src/components/chat/PlanCard.tsx`：

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useExitTransition } from '@/client/useExitTransition';
import { FigIcon, figAsset } from '@/components/ui/figma';
import { CollapseArrow } from './toolPill';
import type { PlanTaskStatus } from '@/koubou/protocol';

// 状态图标(设计稿 2841:62478):completed=teal 勾 14px;in_progress=teal 转圈 16px;
// pending=同形静态弧 muted(mock 未区分后两态,按语义补:仅当前项转动)
function PlanStatusIcon({ status }: { status: PlanTaskStatus }) {
  if (status === 'completed') {
    return (
      <span className="flex w-4 shrink-0 justify-center text-[var(--color-teal)]">
        <FigIcon src={figAsset.checkCircle} size={14} tone="primary" />
      </span>
    );
  }
  const active = status === 'in_progress';
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 shrink-0 rounded-full border-[1.5px] border-b-transparent ${
        active
          ? 'border-[var(--color-teal)] motion-safe:animate-spin'
          : 'border-[var(--color-line-2)]'
      }`}
    />
  );
}

// planner 计划卡:固定悬浮在 Composer 上方,聚合 agent 任务清单(设计稿深色 mock,令牌双主题适配)。
// 折叠态只留标题行 + mono 进度计数;展开态严格按 mock(标题 + 任务行,无计数)。
export default function PlanCard() {
  const { t } = useTranslation();
  const tasks = useStore((s) => s.tasks);
  const collapsed = useStore((s) => s.planCollapsed);
  const togglePlanCollapsed = useStore((s) => s.togglePlanCollapsed);
  // 清单清空(切项目/新会话)时先播退场再卸载
  const { mounted, closing } = useExitTransition(tasks.length > 0, 200);
  if (!mounted) return null;
  const done = tasks.filter((x) => x.status === 'completed').length;
  return (
    <div
      className={`absolute inset-x-3 bottom-full z-10 mb-2 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] px-2 py-3 shadow-[var(--shadow-popover)] backdrop-blur-[6px] ${closing ? 'anim-fade-out' : 'anim-collapse-in'}`}
    >
      <button
        type="button"
        onClick={togglePlanCollapsed}
        aria-expanded={!collapsed}
        aria-label={t('chat.plan.toggle')}
        className="flex w-full items-center gap-2 px-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-[1.5] text-[var(--color-ink)]">
          {t('chat.plan.title')}
        </span>
        {collapsed && (
          <span className="shrink-0 font-mono text-[12px] text-[var(--color-muted)]">{done}/{tasks.length}</span>
        )}
        <CollapseArrow open={!collapsed} />
      </button>
      {!collapsed && (
        <ul aria-live="polite" className="scrollbar-auto mt-4 flex max-h-[40vh] flex-col gap-4 overflow-y-auto px-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-4">
              <PlanStatusIcon status={task.status} />
              <span
                className={`min-w-0 truncate font-mono text-[12px] leading-4 ${
                  task.status === 'completed' ? 'text-[var(--color-muted)] line-through' : 'text-[var(--color-ink)]'
                }`}
              >
                {task.status === 'in_progress' ? task.activeForm || task.subject : task.subject}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 挂载进 ChatPanel**

`src/components/chat/ChatPanel.tsx`：

1. import：`import PlanCard from './PlanCard';`
2. 末尾渲染区，把 `<Composer client={client} />` 换成：

```tsx
      {/* Composer 外包 relative:PlanCard 以 absolute bottom-full 悬浮其上,不占文档流 */}
      <div className="relative">
        <PlanCard />
        <Composer client={client} />
      </div>
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/PlanCard.test.tsx src/components/chat/ChatPanel.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS（ChatPanel 既有测试不回归）

- [ ] **Step 7: Commit**

```bash
git add src/i18n/locales src/components/chat/PlanCard.tsx src/components/chat/PlanCard.test.tsx src/components/chat/ChatPanel.tsx
git commit -m "feat: planner 计划卡悬浮 Composer 上方(六语文案+折叠+进度)"
```

---

### Task 5: 消息流内 Task 工具极简 pill

**Files:**
- Modify: `src/components/chat/ToolCard.tsx`
- Modify: `src/components/chat/ToolGroupCard.tsx`
- Test: `src/components/chat/ToolCard.test.tsx`、`src/components/chat/ToolGroupCard.test.tsx`（各追加用例）

**Interfaces:**
- Consumes: Task 1 的 `isTaskTool`；Task 4 的 `chat.tool.updatedPlan` 文案。
- 行为：任务工具调用在消息流保留（时序完整），但渲染为**不可展开**的极简 pill「Updated plan」；连续多次仍走既有同名合并（`ToolGroupCard` ×N），组内不展开入参。

- [ ] **Step 1: 写失败测试**

`ToolCard.test.tsx` 追加：

```tsx
it('任务工具渲染极简 pill:本地化标签,无展开箭头', () => {
  render(<ToolCard part={{ type: 'tool', id: 't1', name: 'TaskCreate', input: { subject: 'x' }, status: 'ready' }} />);
  expect(screen.getByText('Updated plan')).toBeInTheDocument();
  expect(screen.queryByText('TaskCreate')).toBeNull();
  expect(document.querySelector('[data-collapse-arrow]')).toBeNull();
});
```

`ToolGroupCard.test.tsx` 追加：

```tsx
it('任务工具组:标签本地化 + 不可展开(无箭头,点击不出参数)', () => {
  const parts = [
    { type: 'tool', id: 't1', name: 'TaskUpdate', input: { taskId: '1' }, status: 'ready' },
    { type: 'tool', id: 't2', name: 'TaskUpdate', input: { taskId: '2' }, status: 'ready' },
  ] as const;
  render(<ToolGroupCard name="TaskUpdate" parts={parts as unknown as ToolPart[]} />);
  expect(screen.getByText('Updated plan')).toBeInTheDocument();
  expect(screen.getByText('×2')).toBeInTheDocument();
  expect(document.querySelector('[data-collapse-arrow]')).toBeNull();
});
```

（两个测试文件的既有 render/i18n 前置沿用现状；`ToolPart` 类型按文件内已有定义/import。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ToolCard.test.tsx src/components/chat/ToolGroupCard.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `ToolCard.tsx`：import 加 `import { isTaskTool } from '@/koubou/protocol';`。组件内 `const diff = part.diff;` 之前加：

```tsx
  // 任务工具:主呈现在 PlanCard,消息流只留时序痕迹 → 极简 pill,不暴露入参、不可展开
  if (isTaskTool(part.name)) {
    return (
      <div className={pillClass(false)}>
        <span className="flex items-center gap-2">
          <ToolStatusIcon status={part.status} />
          <span className="font-medium">{t('chat.tool.updatedPlan')}</span>
        </span>
      </div>
    );
  }
```

（该 early return 位于 `useState` 之后，不违反 hooks 规则——`useState`/`useTranslation` 均已在其前调用。）

2. `ToolGroupCard.tsx`：
   - import 加 `import { useTranslation } from 'react-i18next';` 与 `import { isTaskTool } from '@/koubou/protocol';`
   - 组件内加 `const { t } = useTranslation();` 与 `const taskGroup = isTaskTool(name);`
   - 标签行改为 `<span className="font-medium">{taskGroup ? t('chat.tool.updatedPlan') : name}</span>`
   - 折叠箭头改为 `{!taskGroup && <CollapseArrow open={open} />}`
   - 正文改为 `{open && !taskGroup && (`（任务组不展开入参）
   - 头部 button 的 `onClick` 改为 `onClick={() => { if (!taskGroup) setOpen((o) => !o); }}`，`aria-expanded` 改为 `taskGroup ? undefined : open`

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ToolCard.test.tsx src/components/chat/ToolGroupCard.test.tsx`
Expected: PASS（既有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ToolCard.tsx src/components/chat/ToolGroupCard.tsx src/components/chat/ToolCard.test.tsx src/components/chat/ToolGroupCard.test.tsx
git commit -m "feat: 消息流内任务工具折叠为极简 Updated plan pill"
```

---

### Task 6: 资产清理 + 全量验证 + 运行态截图核验

**Files:**
- Delete: `public/figma/f39b735e114f17765b8337a9e1589a86c3a959af.svg`、`public/figma/fd7514f29a2b16d0748804a6c234e4abd32917fe.png`（Figma MCP 导出的临时文件；check-circle 已有 `public/figma/icons/check-circle.svg` 在册，spinner 用 CSS 实现，两者均不需要）

- [ ] **Step 1: 删除未用资产**

```bash
rm public/figma/f39b735e114f17765b8337a9e1589a86c3a959af.svg public/figma/fd7514f29a2b16d0748804a6c234e4abd32917fe.png
```

注意这两个文件在**主仓**工作区（brainstorm 阶段导出），若 worktree 里不存在则到主仓删（勿误删 `public/figma/icons/` 在册图标）。

- [ ] **Step 2: 全量验证**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

Expected: 全部通过（CI 同四关）。

- [ ] **Step 3: 运行态核验（/verify 精神,按 memory 的本地技巧）**

用 Playwright 打开 dev/prod 本地页,经 `window.__store`（若无此注入则用 `useStore.setState` 等价途径 / page.route mock）注入 `tasks` 完整态,逐态截图核验:

1. 展开态(completed/in_progress/pending 混合,in_progress 显示 activeForm)
2. 折叠态(标题 + `2/4` 计数)
3. 空清单(卡片不渲染)
4. 深浅两主题各一张(令牌适配,mock 是深色稿)

对照设计稿列对照表(圆角 20px/标题 15px bold/行 12px mono/间距 16px/teal 勾),不符处修正后再截。注意 dev 端口可能被其它 worktree 占用,先 `lsof -i :3000` 确认(memory: runtime-verification-local-gotchas)。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 清理 Figma 导出临时资产"
```

---

## 收尾

全部任务完成后走 superpowers:finishing-a-development-branch：`feat/planner-mode` 按 Nick 约定 **`--no-ff` 合回 `dev`**（merge message 含分支名），合并后删分支清 worktree；合并前先验证 worktree 无未提交文件、`git log` 确认所有 commit 落在 feature 分支（memory: subagent 可能提交错分支）。Meegle 工作项 13295481 待 Nick 验收后再流转节点。

## Self-Review 记录

- Spec 覆盖：数据层（Task 1/2）、持久化（Task 3）、PlanCard UI 与设计稿映射（Task 4）、消息流 pill（Task 5）、资产清理与边界（Task 6）——`blockedBy/owner/metadata` 容忍不渲染由 parseTaskResult 天然丢弃实现，无需独立任务。
- 类型一致性：`PlanTask/PlanTaskStatus/TaskEffect/TaskInputMeta` 全部在 Task 1 定义,后续任务签名逐一核对。
- 无占位符：每步含完整代码/命令/预期输出。
