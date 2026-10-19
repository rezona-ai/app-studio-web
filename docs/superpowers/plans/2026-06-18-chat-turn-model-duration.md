# 对话轮次「模型 + 耗时」footer 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在每轮 agent run 最后一条 assistant 消息下方展示「实际所用模型 · 执行耗时」，进行中实时跳秒，覆盖历史与刷新。

**Architecture:** `applyKoubou` 纯函数从 `run.*`/`claude.message` 事件维护一份 `turns: TurnMeta[]`（起止时间取服务端 `created_at`、模型取该轮 AssistantMessage 的 `model`）；turns 随会话持久化进 `koubouByProject`，并在历史重建（`rebuild`）里从可重放事件日志复原。UI 经纯函数 selector 把每轮锚到其最后一条消息，`TurnFooter` 渲染并对进行中那轮用秒级 timer 跳秒。

**Tech Stack:** Next.js 16 / React 19 / zustand（persist）/ Vitest + jsdom + @testing-library/react / TypeScript。

## Global Constraints

- 代码注释 / 计划 / commit message 一律用**中文**；commit 一句话总结。
- 项目 UI 文案默认**英文**（footer 文案：`Running for` / `Ran for` / `Failed after` / `Stopped after`）。
- TDD：测试与源码**同目录**（`*.test.ts(x)`）；Vitest globals + jsdom，`@` → `src`。
- 纯函数 + 不可变更新；reducer（`applyKoubou`）保持纯，不引入副作用。
- 只消费**文档约定字段**：事件 envelope 的 `created_at`、`AssistantMessage.payload.model`、`run.started/finished` 的 `run_id`/`status`。不臆测后端别名字段。
- 时长展示：`<60s → "42s"`；`≥60s → "5m 10s"`（整分省略秒，如 `"2m"`）。时钟偏移用 `Math.max(0, …)` 钳制。
- 跑测试：`pnpm exec vitest run <file>`；类型检查 `pnpm exec tsc --noEmit`。

---

### Task 1: 时长格式化纯函数 `formatDuration`

**Files:**
- Create: `src/lib/koubou/duration.ts`
- Test: `src/lib/koubou/duration.test.ts`

**Interfaces:**
- Produces: `formatDuration(seconds: number): string`

- [ ] **Step 1: 写失败测试**

`src/lib/koubou/duration.test.ts`:

```ts
import { expect, test } from 'vitest';
import { formatDuration } from './duration';

test('<60s 显示纯秒', () => {
  expect(formatDuration(0)).toBe('0s');
  expect(formatDuration(42)).toBe('42s');
  expect(formatDuration(59)).toBe('59s');
});

test('>=60s 整分省略秒', () => {
  expect(formatDuration(60)).toBe('1m');
  expect(formatDuration(120)).toBe('2m');
});

test('>=60s 含余秒显示「Xm Ys」', () => {
  expect(formatDuration(61)).toBe('1m 1s');
  expect(formatDuration(310)).toBe('5m 10s');
});

test('负数 / 小数向下钳制取整', () => {
  expect(formatDuration(-5)).toBe('0s');
  expect(formatDuration(42.9)).toBe('42s');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/koubou/duration.test.ts`
Expected: FAIL — `formatDuration` 未定义 / 模块不存在。

- [ ] **Step 3: 写最小实现**

`src/lib/koubou/duration.ts`:

```ts
// 轮次耗时格式化(纯函数):<60s 显示秒;>=60s 显示「Xm」或「Xm Ys」(整分省略秒)
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/koubou/duration.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/koubou/duration.ts src/lib/koubou/duration.test.ts
git commit -m "feat: 新增轮次耗时格式化纯函数 formatDuration"
```

---

### Task 2: `TurnMeta` 类型 + reducer 轮次生命周期

**Files:**
- Modify: `src/store/types.ts`（新增 `TurnStatus`/`TurnMeta`；`KoubouState` 加 `turns`/`historyTurnCount`；初始态补字段）
- Modify: `src/koubou/apply-koubou.ts`（`run.started` 开轮、`finishRun` 闭轮、`reconcileAssistant` 与 `message_start` 回填）
- Test: `src/koubou/apply-koubou.test.ts`（新增 `describe('turns 轮次元数据')`）

**Interfaces:**
- Produces:
  - `type TurnStatus = 'running' | 'succeeded' | 'error' | 'interrupted'`
  - `interface TurnMeta { runId: string | null; model: string | null; startedAt: string | null; finishedAt: string | null; status: TurnStatus; lastMessageId: string | null }`
  - `KoubouState.turns: TurnMeta[]`、`KoubouState.historyTurnCount: number`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 末尾追加（沿用文件顶部已有的 `S` / `ev` / `cmsg` 辅助）：

```ts
describe('turns 轮次元数据', () => {
  test('run.started 建 running 轮,取 startedAt 与当前会话 model', () => {
    let s = applyKoubou(S(), cmsg('SystemMessage', { model: 'claude-opus-4-8' }));
    s = applyKoubou(s, ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:00.000Z', payload: { run_id: 'r1' } }));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({
      runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z',
      finishedAt: null, status: 'running', lastMessageId: null,
    });
  });

  test('AssistantMessage 回填 lastMessageId 与 per-turn model', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, cmsg('AssistantMessage', { uuid: 'a1', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: '好的' }] }));
    expect(s.turns[0].lastMessageId).toBe('a1');
    expect(s.turns[0].model).toBe('claude-sonnet-4-6');
  });

  test('run.finished succeeded → 闭轮 succeeded + finishedAt', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:00.000Z', payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 2, created_at: '2026-06-18T00:00:12.000Z', payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.turns[0]).toMatchObject({ status: 'succeeded', finishedAt: '2026-06-18T00:00:12.000Z' });
    expect(s.runStatus).toBe('idle');
  });

  test('run.finished failed → status error,runStatus error', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 2, payload: { status: 'failed' } }));
    expect(s.turns[0].status).toBe('error');
    expect(s.runStatus).toBe('error');
  });

  test('run.interrupted → status interrupted,runStatus idle', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', sequence: 2, payload: {} }));
    expect(s.turns[0].status).toBe('interrupted');
    expect(s.runStatus).toBe('idle');
  });

  test('sequence 重放不重复建轮', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    expect(s.turns).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts -t "turns 轮次元数据"`
Expected: FAIL — `s.turns` 为 `undefined` / 期望长度不符。

- [ ] **Step 3: 扩展类型（`src/store/types.ts`）**

在 `Message` 接口之后新增：

```ts
export type TurnStatus = 'running' | 'succeeded' | 'error' | 'interrupted';
// 一轮 agent run 的元数据:用于在最后一条消息下方展示「模型 · 耗时」。起止时间取服务端 created_at。
export interface TurnMeta {
  runId: string | null;
  model: string | null;          // 该轮实际所用模型 id
  startedAt: string | null;      // run.started.created_at (ISO)
  finishedAt: string | null;     // run.finished/interrupted.created_at;running 时 null
  status: TurnStatus;
  lastMessageId: string | null;  // 该轮最后一条 assistant 消息 id —— footer 锚点
}
```

`KoubouState` 接口增加两个字段（放在 `seenSequences` 之后、历史分页字段之前）：

```ts
  turns: TurnMeta[];
  historyTurnCount: number;   // turns 中由 historyEvents 重建的前缀长度(瞬态,与 historyMsgCount 对称)
```

`createInitialKoubouState()` 的返回对象补上（与 `historyMsgCount` 同处）：

```ts
    turns: [], historyTurnCount: 0,
```

- [ ] **Step 4: 改 reducer（`src/koubou/apply-koubou.ts`）**

(a) 顶部 import 增补类型：

```ts
import type { KoubouState, Message, Part, PendingInteraction, TurnMeta, TurnStatus } from '@/store/types';
```

(b) 新增一个更新「当前 running 轮」的纯 helper（放在 `finishRun` 之前）：

```ts
// 更新最后一条 running 轮(末尾起找);无 running 轮则原样返回。patch 中值为 undefined 的键不应传入(避免覆盖)
function patchActiveTurn(turns: TurnMeta[], patch: Partial<TurnMeta>): TurnMeta[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].status === 'running') {
      const next = turns.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    }
  }
  return turns;
}
```

(c) `run.started` case 改为建轮（替换原 `case 'run.started': return {...}` 整行）：

```ts
    case 'run.started': {
      const runId = (e.payload.run_id as string) ?? e.run_id ?? null;
      const turn: TurnMeta = { runId, model: state.model, startedAt: e.created_at ?? null, finishedAt: null, status: 'running', lastMessageId: null };
      return { ...state, runStatus: 'running', activeRunId: runId, turns: [...state.turns, turn] };
    }
```

(d) `run.interrupted` / `run.finished` 两 case 改为把事件与轮次状态传给 `finishRun`：

```ts
    case 'run.interrupted': return finishRun(state, e, 'interrupted');
    case 'run.finished': return finishRun(state, e, e.payload.status === 'succeeded' ? 'succeeded' : 'error');
```

(e) `finishRun` 改签名并闭轮（替换原函数体）：

```ts
// ---- run 结束:清 loading + 落定最后一条 assistant + 闭合当前轮 ----
function finishRun(state: KoubouState, e: ServerEvent, turnStatus: TurnStatus): KoubouState {
  const runStatus = turnStatus === 'error' ? 'error' as const : 'idle' as const;
  const messages = state.messages.map((m) =>
    m.role === 'assistant' && m.status === 'generating'
      ? { ...m, status: turnStatus === 'error' ? 'error' as const : 'ready' as const } : m);
  const turns = patchActiveTurn(state.turns, { finishedAt: e.created_at ?? null, status: turnStatus });
  return { ...state, messages, runStatus, activeRunId: null, turns };
}
```

(f) `onClaudeMessage` 把 model 透传给 `reconcileAssistant`（找到 `if (p.sdk_type === 'AssistantMessage') return reconcileAssistant(state, messageId, content);` 改为）：

```ts
  if (p.sdk_type === 'AssistantMessage') return reconcileAssistant(state, messageId, content, p.payload.model);
```

(g) `reconcileAssistant` 增参并回填轮次（替换函数签名与 `return`）：

```ts
function reconcileAssistant(state: KoubouState, messageId: string | undefined, content: ContentBlock[] | string, model?: string): KoubouState {
  let parts = blocksToParts(content);
  const messages = state.messages.slice();
  let idx = messageId ? messages.findIndex((m) => m.id === messageId) : -1;
  if (idx === -1) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].status === 'generating') { idx = i; break; }
    }
  }
  if (idx !== -1) parts = preserveThinking(messages[idx].parts, parts);
  const msg: Message = { id: messageId ?? newId('msg'), role: 'assistant', parts, status: 'ready' };
  if (idx === -1) messages.push(msg); else messages[idx] = msg;
  // 回填当前轮:锚点指向落定消息;model 仅在存在时覆盖(避免抹掉会话级初值)
  const patch: Partial<TurnMeta> = { lastMessageId: msg.id };
  if (model) patch.model = model;
  return { ...state, messages, turns: patchActiveTurn(state.turns, patch) };
}
```

(h) `applyStreamEvent` 的 `message_start` 同步锚点（替换该 case）：

```ts
    case 'message_start': {
      const id = (ev as { message: { id: string } }).message.id;
      if (state.messages.some((m) => m.id === id)) return state;
      return {
        ...state,
        messages: [...state.messages, { id, role: 'assistant', parts: [], status: 'generating' }],
        turns: patchActiveTurn(state.turns, { lastMessageId: id }),
      };
    }
```

> 说明：`ClaudeMessagePayload.payload.model` 已在协议类型中（`protocol.ts`），`p.payload.model` 类型为 `string | undefined`，可直接传入。

- [ ] **Step 5: 跑测试确认通过（含原有回归）**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS（新增 6 用例 + 原有用例不回归）。

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（`turns`/`historyTurnCount` 为必填字段，仅在本任务文件内消费，store 其余文件下个任务补齐——若此处报 `switchProjectSession` 缺字段属预期，将在 Task 4 修复；本步只确认 `apply-koubou.ts`/`types.ts` 自身无类型错）。

> 注:Task 2 引入必填字段 `turns`/`historyTurnCount` 后,`store/index.ts` 的 `switchProjectSession`(只构造了部分 KoubouState 字段)与 `createInitialKoubouState()` 协作仍成立——因为它 `...createInitialKoubouState()` 兜底全部字段。故 tsc 应通过。

- [ ] **Step 7: 提交**

```bash
git add src/store/types.ts src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: reducer 维护每轮 TurnMeta(模型/起止时间/状态/锚点)"
```

---

### Task 3: 历史重建产出 turns

**Files:**
- Modify: `src/koubou/apply-koubou.ts`（抽出 `rebuild()` 同时产 messages+turns；`historyFields`/`seedHistory`/`prependHistory` 带上 turns）
- Test: `src/koubou/apply-koubou.test.ts`（新增 `describe('历史重建 turns')`）

**Interfaces:**
- Consumes: Task 2 的 `TurnMeta` / `patchActiveTurn` 规则
- Produces: `rebuild(events: ServerEvent[]): { messages: Message[]; turns: TurnMeta[] }`；`historyFields` 返回值新增 `turns` 与 `historyTurnCount`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 追加：

```ts
describe('历史重建 turns', () => {
  test('从事件日志重建多轮 + 热切换模型 + 末尾未闭合 running 轮', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: { session_id: 's1', visible_state: { messages: [
        cmsg('SystemMessage', { model: 'claude-opus-4-8' }),
        ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:00.000Z', payload: { run_id: 'r1' } }),
        umsg('做个跳跃游戏', 'evt_u1'),
        cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'text', text: '好的' }] }),
        ev({ type: 'run.finished', sequence: 2, created_at: '2026-06-18T00:00:12.000Z', payload: { run_id: 'r1', status: 'succeeded' } }),
        ev({ type: 'run.started', sequence: 3, created_at: '2026-06-18T00:01:00.000Z', payload: { run_id: 'r2' } }),
        cmsg('AssistantMessage', { uuid: 'a2', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: '继续' }] }),
      ] } },
    }));
    expect(next.turns).toHaveLength(2);
    expect(next.turns[0]).toMatchObject({ runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z', finishedAt: '2026-06-18T00:00:12.000Z', status: 'succeeded', lastMessageId: 'a1' });
    expect(next.turns[1]).toMatchObject({ runId: 'r2', model: 'claude-sonnet-4-6', status: 'running', finishedAt: null, lastMessageId: 'a2' });
    expect(next.historyTurnCount).toBe(2);
  });

  test('seedHistory 写入 turns 与 historyTurnCount', () => {
    const s = seedHistory(S(), { events: [
      ev({ type: 'run.started', sequence: 5, created_at: 'A', payload: { run_id: 'r5' } }),
      cmsg('AssistantMessage', { uuid: 'm5', content: [{ type: 'text', text: 'x' }] }),
      ev({ type: 'run.finished', sequence: 6, created_at: 'B', payload: { status: 'succeeded' } }),
    ], has_more: true, latest_sequence: 6 });
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ runId: 'r5', status: 'succeeded', lastMessageId: 'm5' });
    expect(s.historyTurnCount).toBe(1);
  });

  test('prependHistory 按 historyTurnCount 保留 live 尾部 turns', () => {
    let s = seedHistory(S(), { events: [
      ev({ type: 'run.started', sequence: 10, created_at: 'A', payload: { run_id: 'r10' } }),
      cmsg('AssistantMessage', { uuid: 'm10', content: [{ type: 'text', text: 'x' }] }),
      ev({ type: 'run.finished', sequence: 11, created_at: 'B', payload: { status: 'succeeded' } }),
    ], has_more: true, latest_sequence: 11 });
    // live 再来一轮
    s = applyKoubou(s, ev({ type: 'run.started', sequence: 12, created_at: 'C', payload: { run_id: 'r12' } }));
    s = applyKoubou(s, cmsg('AssistantMessage', { uuid: 'm12', content: [{ type: 'text', text: 'y' }] }));
    expect(s.turns).toHaveLength(2);
    expect(s.historyTurnCount).toBe(1);
    // 前插更早一页
    s = prependHistory(s, { events: [
      ev({ type: 'run.started', sequence: 1, created_at: 'X', payload: { run_id: 'r1' } }),
      cmsg('AssistantMessage', { uuid: 'm1', content: [{ type: 'text', text: 'old' }] }),
      ev({ type: 'run.finished', sequence: 2, created_at: 'Y', payload: { status: 'succeeded' } }),
    ], has_more: false, latest_sequence: 11 });
    expect(s.turns.map((t) => t.runId)).toEqual(['r1', 'r10', 'r12']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts -t "历史重建 turns"`
Expected: FAIL — `next.turns` 为空 / `historyTurnCount` 未定义。

- [ ] **Step 3: 抽出 `rebuild` 并改历史相关函数（`src/koubou/apply-koubou.ts`）**

(a) 用下面的 `rebuild` 替换现有 `export function rebuildHistory(...)` 整段，并保留 `rebuildHistory` 薄封装：

```ts
// 单遍重建:从可重放事件日志(含 run.* / claude.message / user.message)同时产出 messages 与 turns。
// 切轮规则与 live(applyKoubou)一致:run.started 开轮、AssistantMessage 回填锚点/模型、run.finished/interrupted 闭轮。
export function rebuild(events: ServerEvent[]): { messages: Message[]; turns: TurnMeta[] } {
  let messages: Message[] = [];
  const turns: TurnMeta[] = [];
  let model: string | null = null;
  const patchOpen = (patch: Partial<TurnMeta>) => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].status === 'running') { turns[i] = { ...turns[i], ...patch }; return; }
    }
  };
  for (const ev of events) {
    if (ev.type === 'run.started') {
      turns.push({ runId: (ev.payload.run_id as string) ?? ev.run_id ?? null, model, startedAt: ev.created_at ?? null, finishedAt: null, status: 'running', lastMessageId: null });
      continue;
    }
    if (ev.type === 'run.finished') {
      patchOpen({ finishedAt: ev.created_at ?? null, status: ev.payload.status === 'succeeded' ? 'succeeded' : 'error' });
      continue;
    }
    if (ev.type === 'run.interrupted') {
      patchOpen({ finishedAt: ev.created_at ?? null, status: 'interrupted' });
      continue;
    }
    if (ev.type === 'user.message') {
      const msg = (ev.payload as { message?: { content?: ContentBlock[] | string } }).message;
      const parts = blocksToParts(msg?.content ?? []);
      if (parts.length) messages.push({ id: ev.event_id ?? newId('msg'), role: 'user', parts, status: 'ready' });
      continue;
    }
    if (ev.type !== 'claude.message') continue;
    const cm = ev.payload as unknown as ClaudeMessagePayload;
    if (cm.sdk_type === 'SystemMessage') { if (cm.payload.model) model = cm.payload.model; continue; }
    if (cm.sdk_type !== 'AssistantMessage' && cm.sdk_type !== 'UserMessage') continue;
    const pl = cm.payload as {
      content?: ContentBlock[] | string; uuid?: string; message_id?: string; id?: string;
      model?: string; tool_use_result?: ToolUseResultRaw;
    };
    const id = pl.uuid ?? pl.message_id ?? pl.id ?? newId('msg');
    const content = pl.content ?? [];
    if (cm.sdk_type === 'AssistantMessage') {
      messages.push({ id, role: 'assistant', parts: blocksToParts(content), status: 'ready' });
      const patch: Partial<TurnMeta> = { lastMessageId: id };
      if (pl.model) patch.model = pl.model;
      patchOpen(patch);
      continue;
    }
    const blocks = Array.isArray(content) ? content : [];
    const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
    if (results.length && results.length === blocks.length) {
      messages = foldResults(messages, results, parseFileDiff(pl.tool_use_result) ?? undefined);
    } else {
      messages.push({ id, role: 'user', parts: blocksToParts(content), status: 'ready' });
    }
  }
  return { messages, turns };
}

// 兼容封装:历史相关旧调用方/测试只取 messages
export function rebuildHistory(events: ServerEvent[]): Message[] {
  return rebuild(events).messages;
}
```

(b) `historyFields` 改为带上 turns（替换函数体）：

```ts
function historyFields(events: ServerEvent[], hasMore?: boolean) {
  const { messages, turns } = rebuild(events);
  const oldest = typeof events[0]?.sequence === 'number' ? events[0].sequence : null;
  return {
    messages,
    turns,
    historyEvents: events,
    historyMsgCount: messages.length,
    historyTurnCount: turns.length,
    historyOldestSeq: oldest,
    historyHasMore: hasMore ?? (oldest != null && oldest > 1),
  };
}
```

(c) `prependHistory` 增加 turns 拼接（替换 `return` 行）：

```ts
export function prependHistory(state: KoubouState, page: EventsPageLike): KoubouState {
  if (!page.events.length) return { ...state, historyHasMore: page.has_more };
  const fields = historyFields([...page.events, ...state.historyEvents], page.has_more);
  return {
    ...state,
    ...fields,
    messages: [...fields.messages, ...state.messages.slice(state.historyMsgCount)],
    turns: [...fields.turns, ...state.turns.slice(state.historyTurnCount)],
  };
}
```

> `seedHistory` 与 `onReady` 经 `...historyFields(...)` 自动获得 `turns` / `historyTurnCount`，无需另改。

- [ ] **Step 4: 跑测试确认通过（含回归）**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS（新增 3 用例 + 原 session.ready/history 用例不回归）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（`store/index.ts` 仍待 Task 4，但其 `switchProjectSession` 用 `...createInitialKoubouState()` 兜底，类型成立）。

- [ ] **Step 6: 提交**

```bash
git add src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: 历史重建从事件日志复原每轮 turns"
```

---

### Task 4: turns 持久化（PersistedSession + 快照 + 切项目）

**Files:**
- Modify: `src/store/types.ts`（`PersistedSession` 加 `turns`）
- Modify: `src/store/index.ts`（`switchProjectSession` 载入 turns）
- Modify: `src/client/useKoubouConnection.ts`（快照检查点写 turns）
- Test: `src/store/turns-persistence.test.ts`（新建）

**Interfaces:**
- Consumes: `KoubouState.turns`（Task 2）、`PersistedSession`
- Produces: `PersistedSession.turns: TurnMeta[]`

- [ ] **Step 1: 写失败测试**

`src/store/turns-persistence.test.ts`:

```ts
import { afterEach, expect, test } from 'vitest';
import { useStore } from './index';
import type { TurnMeta } from './types';

const turn: TurnMeta = { runId: 'r1', model: 'claude-opus-4-8', startedAt: 'A', finishedAt: 'B', status: 'succeeded', lastMessageId: 'm1' };

afterEach(() => { localStorage.clear(); });

test('switchProjectSession 从快照载入 turns', () => {
  useStore.setState({ koubouByProject: { '7': { sessionId: 's7', lastSequence: 9, messages: [], turns: [turn] } } });
  useStore.getState().switchProjectSession(7);
  expect(useStore.getState().turns).toEqual([turn]);
});

test('快照无 turns(老数据)→ 降级空数组', () => {
  // 模拟旧持久化结构(无 turns 字段)
  useStore.setState({ koubouByProject: { '8': { sessionId: 's8', lastSequence: 3, messages: [] } as unknown as never } });
  useStore.getState().switchProjectSession(8);
  expect(useStore.getState().turns).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/turns-persistence.test.ts`
Expected: FAIL — 第一例 `turns` 为 `[]`（switchProjectSession 尚未载入）；或类型/字段缺失。

- [ ] **Step 3: 扩 `PersistedSession`（`src/store/types.ts`）**

```ts
export interface PersistedSession { sessionId: string; lastSequence: number; messages: Message[]; turns: TurnMeta[] }
```

- [ ] **Step 4: `switchProjectSession` 载入 turns（`src/store/index.ts`）**

把 `switchProjectSession` 的返回对象补一行（在 `messages: saved?.messages ?? [],` 之后）：

```ts
            messages: saved?.messages ?? [],
            turns: saved?.turns ?? [],
```

- [ ] **Step 5: 快照检查点写 turns（`src/client/useKoubouConnection.ts`）**

把第 71 行的快照对象补 `turns`：

```ts
              koubouByProject: { ...st.koubouByProject, [String(pid)]: { sessionId: st.sessionId, lastSequence: st.lastSequence, messages: st.messages, turns: st.turns } },
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/turns-persistence.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 7: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: tsc 无错误；全部测试通过。

- [ ] **Step 8: 提交**

```bash
git add src/store/types.ts src/store/index.ts src/client/useKoubouConnection.ts src/store/turns-persistence.test.ts
git commit -m "feat: turns 随会话持久化(快照+切项目载入)"
```

---

### Task 5: 锚点选择器 `selectTurnAnchors`

**Files:**
- Modify: `src/store/selectors.ts`
- Test: `src/store/selectors.test.ts`（新建）

**Interfaces:**
- Consumes: `TurnMeta`（Task 2）
- Produces:
  - `interface TurnAnchors { byMessageId: Map<string, TurnMeta>; trailing: TurnMeta | null }`
  - `selectTurnAnchors(messages: Message[], turns: TurnMeta[]): TurnAnchors`

- [ ] **Step 1: 写失败测试**

`src/store/selectors.test.ts`:

```ts
import { expect, test } from 'vitest';
import { selectTurnAnchors } from './selectors';
import type { Message, TurnMeta } from './types';

const msg = (id: string, role: 'user' | 'assistant' = 'assistant'): Message => ({ id, role, parts: [{ type: 'text', text: 'x' }], status: 'ready' });
const turn = (p: Partial<TurnMeta>): TurnMeta => ({ runId: 'r', model: 'm', startedAt: 'A', finishedAt: 'B', status: 'succeeded', lastMessageId: null, ...p });

test('已结束轮锚到各自 lastMessageId', () => {
  const { byMessageId, trailing } = selectTurnAnchors([msg('a1'), msg('a2')], [turn({ lastMessageId: 'a1' }), turn({ lastMessageId: 'a2' })]);
  expect(byMessageId.get('a1')?.lastMessageId).toBe('a1');
  expect(byMessageId.get('a2')?.lastMessageId).toBe('a2');
  expect(trailing).toBeNull();
});

test('running 轮无有效锚点 → trailing', () => {
  const { trailing } = selectTurnAnchors([msg('a1')], [turn({ lastMessageId: 'a1' }), turn({ status: 'running', lastMessageId: null })]);
  expect(trailing?.status).toBe('running');
});

test('running 轮已有锚点 → 进 byMessageId 不进 trailing', () => {
  const { byMessageId, trailing } = selectTurnAnchors([msg('a1')], [turn({ status: 'running', lastMessageId: 'a1' })]);
  expect(byMessageId.has('a1')).toBe(true);
  expect(trailing).toBeNull();
});

test('已结束空轮(锚点不在 messages)→ 跳过', () => {
  const { byMessageId, trailing } = selectTurnAnchors([msg('a1')], [turn({ lastMessageId: 'gone' })]);
  expect(byMessageId.size).toBe(0);
  expect(trailing).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/selectors.test.ts`
Expected: FAIL — `selectTurnAnchors` 未导出。

- [ ] **Step 3: 实现（`src/store/selectors.ts`）**

顶部 import 增补 `TurnMeta`：

```ts
import type { Asset, Message, Part, RunStatus, TurnMeta, Version } from './types';
```

文件末尾追加：

```ts
export interface TurnAnchors { byMessageId: Map<string, TurnMeta>; trailing: TurnMeta | null }

// 把每轮 footer 锚到其最后一条消息;running 轮若无有效锚点(纯思考阶段,尚无 assistant 输出)归入 trailing 渲染到底部。
// 已结束且锚点不在 messages 的空轮直接跳过(不渲染 footer)。
export function selectTurnAnchors(messages: Message[], turns: TurnMeta[]): TurnAnchors {
  const ids = new Set(messages.map((m) => m.id));
  const byMessageId = new Map<string, TurnMeta>();
  let trailing: TurnMeta | null = null;
  for (const t of turns) {
    if (t.lastMessageId && ids.has(t.lastMessageId)) byMessageId.set(t.lastMessageId, t);
    else if (t.status === 'running') trailing = t;
  }
  return { byMessageId, trailing };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/selectors.test.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: 提交**

```bash
git add src/store/selectors.ts src/store/selectors.test.ts
git commit -m "feat: 新增 selectTurnAnchors 把每轮锚到末条消息"
```

---

### Task 6: `TurnFooter` 组件

**Files:**
- Create: `src/components/chat/TurnFooter.tsx`
- Test: `src/components/chat/TurnFooter.test.tsx`

**Interfaces:**
- Consumes: `TurnMeta`（Task 2）、`formatDuration`（Task 1）、`modelLabel`（`@/lib/koubou/models`）
- Produces: `default function TurnFooter({ turn }: { turn: TurnMeta })`

- [ ] **Step 1: 写失败测试**

`src/components/chat/TurnFooter.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import TurnFooter from './TurnFooter';
import type { TurnMeta } from '@/store/types';

const base: TurnMeta = { runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z', finishedAt: '2026-06-18T00:00:12.000Z', status: 'succeeded', lastMessageId: 'a1' };

test('succeeded → 模型名 + Ran for', () => {
  render(<TurnFooter turn={base} />);
  expect(screen.getByText(/Opus 4\.8/)).toBeInTheDocument();
  expect(screen.getByText(/Ran for 12s/)).toBeInTheDocument();
});

test('error → Failed after', () => {
  render(<TurnFooter turn={{ ...base, status: 'error' }} />);
  expect(screen.getByText(/Failed after 12s/)).toBeInTheDocument();
});

test('interrupted → Stopped after', () => {
  render(<TurnFooter turn={{ ...base, status: 'interrupted' }} />);
  expect(screen.getByText(/Stopped after 12s/)).toBeInTheDocument();
});

test('>=60s 显示分钟', () => {
  render(<TurnFooter turn={{ ...base, finishedAt: '2026-06-18T00:05:10.000Z' }} />);
  expect(screen.getByText(/Ran for 5m 10s/)).toBeInTheDocument();
});

test('running → 实时跳秒', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-18T00:00:00.000Z'));
  render(<TurnFooter turn={{ ...base, status: 'running', finishedAt: null }} />);
  expect(screen.getByText(/Running for 0s/)).toBeInTheDocument();
  act(() => { vi.setSystemTime(new Date('2026-06-18T00:00:03.000Z')); vi.advanceTimersByTime(3000); });
  expect(screen.getByText(/Running for 3s/)).toBeInTheDocument();
  vi.useRealTimers();
});

test('model 缺失 → 不渲染', () => {
  const { container } = render(<TurnFooter turn={{ ...base, model: null }} />);
  expect(container).toBeEmptyDOMElement();
});

test('startedAt 缺失但已结束 → 仅模型名', () => {
  render(<TurnFooter turn={{ ...base, startedAt: null }} />);
  expect(screen.getByText('Opus 4.8')).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/TurnFooter.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现（`src/components/chat/TurnFooter.tsx`）**

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { TurnMeta } from '@/store/types';
import { modelLabel } from '@/lib/koubou/models';
import { formatDuration } from '@/lib/koubou/duration';

// 非进行中状态的动词前缀
const VERB: Record<Exclude<TurnMeta['status'], 'running'>, string> = {
  succeeded: 'Ran for',
  error: 'Failed after',
  interrupted: 'Stopped after',
};

// 从 startedAt(ISO)到 endMs 的秒数;startedAt 缺失或非法返回 null。时钟偏移钳到 0。
function elapsedSeconds(startedAt: string | null, endMs: number): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((endMs - start) / 1000));
}

export default function TurnFooter({ turn }: { turn: TurnMeta }) {
  const running = turn.status === 'running';
  // 进行中:每秒重算"现在"以驱动跳秒;结束态不计时
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const model = turn.model ? modelLabel(turn.model) : null;
  // 无模型:不渲染 footer(降级约定)
  if (!model) return null;

  let timeText: string | null;
  if (running) {
    const secs = elapsedSeconds(turn.startedAt, nowMs);
    timeText = secs == null ? 'Running…' : `Running for ${formatDuration(secs)}`;
  } else {
    const endMs = turn.finishedAt ? Date.parse(turn.finishedAt) : NaN;
    const secs = Number.isNaN(endMs) ? null : elapsedSeconds(turn.startedAt, endMs);
    timeText = secs == null ? null : `${VERB[turn.status]} ${formatDuration(secs)}`;
  }

  return (
    <div className="mt-1 px-1 text-xs text-[var(--color-muted)]">
      {model}{timeText ? ` · ${timeText}` : ''}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/TurnFooter.test.tsx`
Expected: PASS（7 用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/TurnFooter.tsx src/components/chat/TurnFooter.test.tsx
git commit -m "feat: 新增 TurnFooter 展示每轮模型与耗时(进行中跳秒)"
```

---

### Task 7: `ChatPanel` 接线渲染 footer

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Test: `src/components/chat/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `selectTurnAnchors`（Task 5）、`TurnFooter`（Task 6）、`KoubouState.turns`（Task 2）

- [ ] **Step 1: 写失败测试**

在 `src/components/chat/ChatPanel.test.tsx` 顶部 import 补 `TurnMeta`：

```ts
import type { Message, TurnMeta } from '@/store/types';
```

把 `beforeEach` 的 setState 补 `turns: []`（避免用例间泄漏）：

```ts
  useStore.setState({ messages: [], turns: [], runStatus: 'idle', pendingInteractions: {} });
```

追加用例：

```ts
test('每轮最后一条消息下方渲染 TurnFooter', () => {
  const messages: Message[] = [
    { id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: '做个跳跃游戏' }] },
    { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '好的' }] },
  ];
  const turns: TurnMeta[] = [{ runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z', finishedAt: '2026-06-18T00:00:12.000Z', status: 'succeeded', lastMessageId: 'a1' }];
  useStore.setState({ messages, turns, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  expect(screen.getByText(/Ran for 12s/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ChatPanel.test.tsx -t "TurnFooter"`
Expected: FAIL — 找不到 `Ran for 12s` 文本。

- [ ] **Step 3: 接线（`src/components/chat/ChatPanel.tsx`）**

(a) import 增补（顶部）：

```ts
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
```
并新增：
```ts
import TurnFooter from './TurnFooter';
import { selectAwaitingResponse, selectTurnAnchors } from '@/store/selectors';
```
（删除原单独的 `import { selectAwaitingResponse } from '@/store/selectors';`，合并为上面一行。）

(b) 订阅 turns 并算锚点（在 `const messages = useStore(...)` 之后）：

```ts
  const turns = useStore((s) => s.turns);
  const { byMessageId, trailing } = selectTurnAnchors(messages, turns);
```

(c) 把消息渲染改为穿插 footer（替换 `messages.map((m) => <MessageItem key={m.id} message={m} />)`）：

```tsx
            messages.map((m) => (
              <Fragment key={m.id}>
                <MessageItem message={m} />
                {byMessageId.has(m.id) && <TurnFooter turn={byMessageId.get(m.id)!} />}
              </Fragment>
            ))
```

(d) 在底部骨架屏前渲染进行中那轮的 footer（在 `{awaiting && <MessageSkeleton />}` 之前一行加）：

```tsx
          {trailing && <TurnFooter turn={trailing} />}
          {awaiting && <MessageSkeleton />}
```

- [ ] **Step 4: 跑测试确认通过（含回归）**

Run: `pnpm exec vitest run src/components/chat/ChatPanel.test.tsx`
Expected: PASS（新增用例 + 原骨架屏/滚动用例不回归）。

- [ ] **Step 5: 全量校验**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm lint`
Expected: tsc 无错误；全部测试通过；lint 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/components/chat/ChatPanel.tsx src/components/chat/ChatPanel.test.tsx
git commit -m "feat: ChatPanel 在每轮末条消息与底部渲染 TurnFooter"
```

---

## 收尾

- [ ] 人工冒烟（`pnpm dev`）：发一条消息看进行中 `Running for Xs` 跳秒；run 结束变 `Ran for Xs`；刷新页面后历史轮 footer 仍在；切项目 footer 跟随会话；中断一轮看 `Stopped after Xs`。
- 实际 PR 在 `feat:` 与本 `docs:`/plan 成对的约定下提交（spec 已于 `4a32dfd` 提交）。

## 自查清单（Spec 覆盖）

- 数据模型（`TurnMeta`/`turns`/`historyTurnCount`/`PersistedSession.turns`）→ Task 2、4 ✅
- reducer 轮次生命周期（started/AssistantMessage/finished/interrupted/sequence 去重）→ Task 2 ✅
- 历史重建（`rebuild` 单遍、seed/prepend 拼接）→ Task 3 ✅
- 持久化（快照 + switchProjectSession）→ Task 4 ✅
- 锚点 selector（byMessageId/trailing/空轮跳过）→ Task 5 ✅
- `TurnFooter`（四状态文案、跳秒、降级、`formatDuration`）→ Task 1、6 ✅
- `ChatPanel` 接线（穿插 + trailing + 骨架并存）→ Task 7 ✅
- 边界（时间缺失只显模型、时钟偏移钳制、空轮跳过、interval cleanup）→ Task 5/6 ✅
