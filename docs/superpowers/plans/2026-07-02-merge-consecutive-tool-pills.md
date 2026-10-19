# 连续同类型工具调用合并为一个 pill 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ChatPanel 渲染序中连续、同名、可合并的工具调用折叠成一个 group pill（如 `Read ×5`）。

**Architecture:** 新增纯函数 `group-tool-runs.ts` 把 `messages` 预处理成渲染节点（message / tool / toolGroup）；新增 `ToolGroupCard` 复用已有 pill 原子渲染合并组；`ChatPanel` 用节点序列替换 `messages.map`。`MessageItem`/`ToolCard`/`toolPill.tsx` 不改。

**Tech Stack:** Next 16 / React 19 / Tailwind v4 / react-i18next / Vitest + Testing Library（jsdom）。

## Global Constraints

- **范围（方案 A）**：只对**连续的「纯工具 assistant 消息」**分组——`role==='assistant' && parts.length>0 && parts.every(type==='tool') && !footerIds.has(id)`。文本/思考/用户/带 footer 的消息作为 `message` 节点照旧渲染并打断连续段。同消息内工具+文本混排的工具**不合并**（明确非目标）。
- **可合并** = 同 `name` + `!part.diff` + `!(part.media?.length)`。合并阈值 **≥2**（run=1 出 `tool` 节点）。
- **复用已有 pill 原子**：`pillClass` / `ToolStatusIcon` / `CollapseArrow`（来自 `src/components/chat/toolPill.tsx`）；不新建 pill 样式。
- **不用 effect setState**：折叠态用渲染期 guard（`prevAgg` 跟随聚合状态，同 `ToolCard` 写法）。
- **颜色走 CSS 变量**，不硬编码色值。
- **`MessageItem` / `ToolCard` / `toolPill.tsx` 不改**（ToolGroupCard 复用其导出）。
- 命令 / 注释 / commit message 一律中文。执行前在 `superpowers:using-git-worktrees` 建 `feat/merge-consecutive-tool-pills` worktree（注意 [[worktree-absolute-path-trap]] / [[subagent-may-commit-wrong-branch]]，改完 `git -C <worktree>` 校验落点）。

---

## 文件结构

- 新建 `src/lib/chat/group-tool-runs.ts` — 纯分组函数 + `RenderNode` 类型 + `isMergeable`。
- 新建 `src/lib/chat/group-tool-runs.test.ts`。
- 新建 `src/components/chat/ToolGroupCard.tsx` — 合并 pill 组件。
- 新建 `src/components/chat/ToolGroupCard.test.tsx`。
- 改 `src/components/chat/ChatPanel.tsx` — 用节点序列渲染。
- 改 `src/components/chat/ChatPanel.test.tsx` — 新增合并断言。

---

## Task 1: 分组纯函数 `group-tool-runs.ts`

**Files:**
- Create: `src/lib/chat/group-tool-runs.ts`
- Test: `src/lib/chat/group-tool-runs.test.ts`

**Interfaces:**
- Produces:
  - `type RenderNode = { kind:'message'; message: Message } | { kind:'tool'; part: ToolPart } | { kind:'toolGroup'; id: string; name: string; parts: ToolPart[] }`，其中 `ToolPart = Extract<Part, { type:'tool' }>`。
  - `isMergeable(p: ToolPart): boolean`
  - `groupToolRuns(messages: readonly Message[], footerIds: ReadonlySet<string>): RenderNode[]`

- [ ] **Step 1: 写失败测试 `group-tool-runs.test.ts`**

```tsx
import { expect, test } from 'vitest';
import { groupToolRuns, isMergeable } from './group-tool-runs';
import type { Message, Part } from '@/store/types';
import type { FileDiff } from '@/koubou/protocol';

type ToolPart = Extract<Part, { type: 'tool' }>;
let seq = 0;
const tool = (name: string, over: Partial<ToolPart> = {}): ToolPart =>
  ({ type: 'tool', id: over.id ?? `t${seq++}`, name, input: {}, status: 'ready', ...over });
const msg = (parts: Part[], over: Partial<Message> = {}): Message =>
  ({ id: over.id ?? `m${seq++}`, role: 'assistant', status: 'ready', parts, ...over });
const NO_FOOTERS: ReadonlySet<string> = new Set();

test('连续两条同名纯工具消息 → 一个 toolGroup(count=2, id=首个)', () => {
  const nodes = groupToolRuns([msg([tool('Read', { id: 'r1' })]), msg([tool('Read', { id: 'r2' })])], NO_FOOTERS);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ kind: 'toolGroup', name: 'Read', id: 'r1' });
  expect((nodes[0] as Extract<typeof nodes[0], { kind: 'toolGroup' }>).parts).toHaveLength(2);
});

test('run=1 → tool 节点,非 group', () => {
  const nodes = groupToolRuns([msg([tool('Read', { id: 'r1' })])], NO_FOOTERS);
  expect(nodes).toEqual([{ kind: 'tool', part: expect.objectContaining({ id: 'r1' }) }]);
});

test('相邻不同名 → group(Read) + tool(Bash)', () => {
  const nodes = groupToolRuns([msg([tool('Read', { id: 'r1' })]), msg([tool('Read', { id: 'r2' })]), msg([tool('Bash', { id: 'b1' })])], NO_FOOTERS);
  expect(nodes.map((n) => n.kind)).toEqual(['toolGroup', 'tool']);
});

test('带 diff 的工具不合并且打断 run', () => {
  const diff: FileDiff = { type: 'update', filePath: 'a.ts', additions: 1, deletions: 0, hunks: [] };
  const nodes = groupToolRuns([msg([tool('Edit', { id: 'e1', diff })]), msg([tool('Edit', { id: 'e2', diff })])], NO_FOOTERS);
  expect(nodes.map((n) => n.kind)).toEqual(['tool', 'tool']);
});

test('带 media 的工具不合并', () => {
  const media = [{ kind: 'image' as const, path: 'p.png', previewUrl: 'u' }];
  const nodes = groupToolRuns([msg([tool('gen', { id: 'g1', media })]), msg([tool('gen', { id: 'g2', media })])], NO_FOOTERS);
  expect(nodes.map((n) => n.kind)).toEqual(['tool', 'tool']);
});

test('文本消息打断,两侧各自分组', () => {
  const nodes = groupToolRuns([
    msg([tool('Read', { id: 'r1' })]), msg([tool('Read', { id: 'r2' })]),
    msg([{ type: 'text', text: '继续' }]),
    msg([tool('Read', { id: 'r3' })]), msg([tool('Read', { id: 'r4' })]),
  ], NO_FOOTERS);
  expect(nodes.map((n) => n.kind)).toEqual(['toolGroup', 'message', 'toolGroup']);
});

test('带 footer 的纯工具消息不分组(出 message 节点)', () => {
  const nodes = groupToolRuns([msg([tool('Read', { id: 'r1' })], { id: 'm1' }), msg([tool('Read', { id: 'r2' })], { id: 'm2' })], new Set(['m2']));
  expect(nodes.map((n) => n.kind)).toEqual(['tool', 'message']);
});

test('同一消息内并行同名 [Read,Read] → 合并', () => {
  const nodes = groupToolRuns([msg([tool('Read', { id: 'r1' }), tool('Read', { id: 'r2' })])], NO_FOOTERS);
  expect(nodes).toHaveLength(1);
  expect(nodes[0].kind).toBe('toolGroup');
});

test('含 generating 的工具参与合并', () => {
  const nodes = groupToolRuns([msg([tool('Read', { id: 'r1' })]), msg([tool('Read', { id: 'r2', status: 'generating' })], { status: 'generating' })], NO_FOOTERS);
  expect(nodes).toHaveLength(1);
  expect(nodes[0].kind).toBe('toolGroup');
});

test('用户消息作为 message 节点并打断', () => {
  const nodes = groupToolRuns([
    msg([tool('Read', { id: 'r1' })]),
    { id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] },
    msg([tool('Read', { id: 'r2' })]),
  ], NO_FOOTERS);
  expect(nodes.map((n) => n.kind)).toEqual(['tool', 'message', 'tool']);
});

test('isMergeable: 普通 true;diff/media false', () => {
  expect(isMergeable(tool('Read'))).toBe(true);
  expect(isMergeable(tool('Edit', { diff: { type: 'update', filePath: 'a', additions: 0, deletions: 0, hunks: [] } }))).toBe(false);
  expect(isMergeable(tool('gen', { media: [{ kind: 'image', path: 'p', previewUrl: 'u' }] }))).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/lib/chat/group-tool-runs.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `group-tool-runs.ts`**

```ts
import type { Message, Part } from '@/store/types';

type ToolPart = Extract<Part, { type: 'tool' }>;

// ChatPanel 渲染节点:普通消息(照旧走 MessageItem)/ 单个工具 / 合并组(≥2 同名可合并)
export type RenderNode =
  | { kind: 'message'; message: Message }
  | { kind: 'tool'; part: ToolPart }
  | { kind: 'toolGroup'; id: string; name: string; parts: ToolPart[] };

// 可合并:同名之外还要求无 diff、无 media —— diff/产图工具的关键产出不该藏进计数,保留独立 pill
export function isMergeable(p: ToolPart): boolean {
  return !p.diff && !(p.media && p.media.length > 0);
}

// 可分组消息:纯工具的 assistant 消息,且不带 turn footer(footer 是回合边界,不并进组)
function isGroupable(m: Message, footerIds: ReadonlySet<string>): boolean {
  return (
    m.role === 'assistant' &&
    m.parts.length > 0 &&
    m.parts.every((p) => p.type === 'tool') &&
    !footerIds.has(m.id)
  );
}

// 把一段连续可分组消息拍平出的 tool parts 切成组:同名+可合并+连续 ≥2 → toolGroup,否则单个 tool
function splitToolRun(parts: ToolPart[]): RenderNode[] {
  const out: RenderNode[] = [];
  let run: ToolPart[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: 'toolGroup', id: run[0].id, name: run[0].name, parts: run });
    else if (run.length === 1) out.push({ kind: 'tool', part: run[0] });
    run = [];
  };
  for (const p of parts) {
    if (!isMergeable(p)) { flush(); out.push({ kind: 'tool', part: p }); continue; }
    if (run.length > 0 && run[0].name !== p.name) flush();
    run.push(p);
  }
  flush();
  return out;
}

// 主入口:messages → 渲染节点序列。连续可分组消息内做同名合并,其余消息原样透出并打断连续段。
export function groupToolRuns(messages: readonly Message[], footerIds: ReadonlySet<string>): RenderNode[] {
  const nodes: RenderNode[] = [];
  let i = 0;
  while (i < messages.length) {
    if (!isGroupable(messages[i], footerIds)) {
      nodes.push({ kind: 'message', message: messages[i] });
      i++;
      continue;
    }
    const parts: ToolPart[] = [];
    while (i < messages.length && isGroupable(messages[i], footerIds)) {
      for (const p of messages[i].parts) parts.push(p as ToolPart);
      i++;
    }
    nodes.push(...splitToolRun(parts));
  }
  return nodes;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/lib/chat/group-tool-runs.test.ts`
Expected: PASS（11 用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/chat/group-tool-runs.ts src/lib/chat/group-tool-runs.test.ts
git commit -m "feat: 工具调用分组纯函数——连续同名可合并 parts 归为 RenderNode"
```

---

## Task 2: 合并 pill 组件 `ToolGroupCard.tsx`

**Files:**
- Create: `src/components/chat/ToolGroupCard.tsx`
- Test: `src/components/chat/ToolGroupCard.test.tsx`

**Interfaces:**
- Consumes: `pillClass`/`ToolStatusIcon`/`CollapseArrow`（`./toolPill`）；`Status`（`@/store/types`）。
- Produces: `default ToolGroupCard({ name, parts }: { name: string; parts: ToolPart[] })`，`ToolPart = Extract<Part, { type:'tool' }>`。

- [ ] **Step 1: 写失败测试 `ToolGroupCard.test.tsx`**

```tsx
import { expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolGroupCard from './ToolGroupCard';
import type { Part } from '@/store/types';

type ToolPart = Extract<Part, { type: 'tool' }>;
const tool = (over: Partial<ToolPart> = {}): ToolPart =>
  ({ type: 'tool', id: over.id ?? 't', name: 'Read', input: { file: 'a.ts' }, status: 'ready', ...over });

test('渲染 name ×N', () => {
  render(<ToolGroupCard name="Read" parts={[tool({ id: '1' }), tool({ id: '2' }), tool({ id: '3' })]} />);
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.getByText('×3')).toBeInTheDocument();
});

test('全部完成 → 头部 teal check(data-tool-status=done),默认收起(不显示参数)', () => {
  const { container } = render(<ToolGroupCard name="Read" parts={[tool({ id: '1' }), tool({ id: '2' })]} />);
  expect(container.querySelector('[data-tool-status="done"]')).toBeInTheDocument();
  expect(screen.queryByText(/"file":"a.ts"/)).not.toBeInTheDocument();
});

test('含进行中 → 有转圈(role=status)且默认展开显示参数', () => {
  render(<ToolGroupCard name="Read" parts={[tool({ id: '1' }), tool({ id: '2', status: 'generating' })]} />);
  expect(screen.getAllByRole('status', { name: 'Running' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/"file":"a.ts"/).length).toBeGreaterThan(0);
});

test('含失败(无进行中)→ 头部 data-tool-status=error 且默认展开', () => {
  const { container } = render(<ToolGroupCard name="Bash" parts={[tool({ id: '1' }), tool({ id: '2', status: 'error' })]} />);
  expect(container.querySelector('[data-tool-status="error"]')).toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
});

test('点击标题切换 aria-expanded 并展示各调用参数', () => {
  render(<ToolGroupCard name="Read" parts={[tool({ id: '1', input: { file: 'a.ts' } }), tool({ id: '2', input: { file: 'b.ts' } })]} />);
  const btn = screen.getByRole('button');
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/"file":"a.ts"/)).toBeInTheDocument();
  expect(screen.getByText(/"file":"b.ts"/)).toBeInTheDocument();
});

test('完成的行不加状态图标,失败的行加标记(头部+失败行共 2 个 error 标记,无 done)', () => {
  const { container } = render(<ToolGroupCard name="Bash" parts={[tool({ id: '1' }), tool({ id: '2', status: 'error' })]} />);
  expect(container.querySelectorAll('[data-tool-status="error"]')).toHaveLength(2);
  expect(container.querySelector('[data-tool-status="done"]')).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/chat/ToolGroupCard.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `ToolGroupCard.tsx`**

```tsx
'use client';
import { useState } from 'react';
import type { Part, Status } from '@/store/types';
import { pillClass, ToolStatusIcon, CollapseArrow } from './toolPill';

type ToolPart = Extract<Part, { type: 'tool' }>;

// 组聚合状态:任一进行中 → generating;否则任一失败 → error;否则 ready(全完成)
function aggregateStatus(parts: ToolPart[]): Status {
  if (parts.some((p) => p.status === 'generating' || p.status === 'pending')) return 'generating';
  if (parts.some((p) => p.status === 'error')) return 'error';
  return 'ready';
}

export default function ToolGroupCard({ name, parts }: { name: string; parts: ToolPart[] }) {
  const agg = aggregateStatus(parts);
  // 进行中/失败默认展开,全部完成自动收起;渲染期 guard 跟随 agg 变化,不用 effect(同 ToolCard)
  const [open, setOpen] = useState(agg === 'generating' || agg === 'error');
  const [prevAgg, setPrevAgg] = useState(agg);
  if (prevAgg !== agg) {
    setPrevAgg(agg);
    setOpen(agg === 'generating' || agg === 'error');
  }
  return (
    <div className={pillClass(open)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <ToolStatusIcon status={agg} />
        <span className="font-medium">{name}</span>
        <span className="text-[var(--color-muted)]">×{parts.length}</span>
        <CollapseArrow open={open} />
      </button>
      {open && (
        <div className="anim-collapse-in mt-1.5 space-y-1">
          {parts.map((p, i) => <GroupRow key={p.id || i} part={p} />)}
        </div>
      )}
    </div>
  );
}

// 单次调用一行:仅未完成(进行中/失败)才前置状态图标(完成不加,避免一排 teal 勾);后接参数
function GroupRow({ part }: { part: ToolPart }) {
  let argText = '';
  try { argText = part.input !== undefined ? JSON.stringify(part.input) : ''; } catch { argText = String(part.input); }
  return (
    <div className="flex items-start gap-2">
      {part.status !== 'ready' && <span className="mt-0.5 shrink-0"><ToolStatusIcon status={part.status} /></span>}
      <pre className="max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--color-fill)] px-2 py-1.5 text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400) || '—'}</pre>
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/components/chat/ToolGroupCard.test.tsx`
Expected: PASS（6 用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/ToolGroupCard.tsx src/components/chat/ToolGroupCard.test.tsx
git commit -m "feat: 合并 pill 组件 ToolGroupCard——聚合状态+计数+展开逐行参数"
```

---

## Task 3: ChatPanel 集成

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Test: `src/components/chat/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `groupToolRuns`（Task 1）、`ToolGroupCard`（Task 2）、`ToolCard`（现有）。

- [ ] **Step 1: 新增 ChatPanel 合并测试**

在 `src/components/chat/ChatPanel.test.tsx` 末尾追加：
```tsx
test('连续同名纯工具消息 → 合并为一个 group(×N),而非 N 个独立卡', () => {
  const messages: Message[] = [
    { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'r1', name: 'Read', input: { file: 'a.ts' }, status: 'ready' }] },
    { id: 'a2', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'r2', name: 'Read', input: { file: 'b.ts' }, status: 'ready' }] },
    { id: 'a3', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'r3', name: 'Read', input: { file: 'c.ts' }, status: 'ready' }] },
  ];
  useStore.setState({ messages, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  expect(screen.getByText('×3')).toBeInTheDocument();
  // 合并后头部只有一个 "Read" 标签(而非 3 个独立 ToolCard)
  expect(screen.getAllByText('Read')).toHaveLength(1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/chat/ChatPanel.test.tsx`
Expected: FAIL（旧实现渲染 3 个独立 ToolCard，无 `×3`，`Read` 出现 3 次）。

- [ ] **Step 3: 集成到 ChatPanel**

在 import 区补充（第 5 行 `import MessageItem from './MessageItem';` 之后）：
```tsx
import ToolCard from './ToolCard';
import ToolGroupCard from './ToolGroupCard';
import { groupToolRuns } from '@/lib/chat/group-tool-runs';
```
在 `const { byMessageId, trailing } = selectTurnAnchors(messages, turns);`（约第 29 行）之后新增：
```tsx
  // 带 footer 的消息是回合边界,不并进工具组;据此把 messages 预处理成渲染节点
  const footerIds = new Set(byMessageId.keys());
  const renderNodes = groupToolRuns(messages, footerIds);
```
把渲染块（`messages.map((m) => ( <Fragment ...> ... </Fragment> ))` 整段，约第 152–158 行）替换为：
```tsx
            renderNodes.map((node) => {
              if (node.kind === 'message') {
                const m = node.message;
                return (
                  <Fragment key={m.id}>
                    <MessageItem message={m} />
                    {byMessageId.has(m.id) && <TurnFooter turn={byMessageId.get(m.id)!} />}
                  </Fragment>
                );
              }
              // 单个/合并工具节点:补回原纯工具消息的 mb-2 间距
              if (node.kind === 'tool') {
                return <div key={node.part.id} className="mb-2"><ToolCard part={node.part} /></div>;
              }
              return <div key={node.id} className="mb-2"><ToolGroupCard name={node.name} parts={node.parts} /></div>;
            })
```
（`messages.length === 0` 空态分支、`trailing` footer、`awaiting` 骨架、`historyLoading` 均不变。）

- [ ] **Step 4: 运行确认通过（含全量 + tsc）**

Run: `pnpm exec vitest run src/components/chat/ChatPanel.test.tsx`
Expected: PASS（原有用例 + 新增合并用例）。
再跑 `pnpm exec vitest run` 与 `pnpm exec tsc --noEmit`，均须绿；报告结果。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/ChatPanel.tsx src/components/chat/ChatPanel.test.tsx
git commit -m "feat: ChatPanel 用渲染节点合并连续同类型工具调用为 group pill"
```

---

## Task 4: 全量校验 + 运行态核对

**Files:**（临时，验证后删除）
- Create/Delete: `src/app/dev-toolgroup/page.tsx`

- [ ] **Step 1: 全量检查**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: 三者全绿。（勿只信 IDE 诊断，见 [[worktree-ide-diagnostics-false-positive]]。）

- [ ] **Step 2: 建 scratch 预览页**

`src/app/dev-toolgroup/page.tsx`（注意路由目录名不能以 `_` 开头，否则 App Router 视为私有目录 404）：
```tsx
'use client';
import I18nProvider from '@/components/i18n/I18nProvider';
import ToolGroupCard from '@/components/chat/ToolGroupCard';
import type { Part } from '@/store/types';

type ToolPart = Extract<Part, { type: 'tool' }>;
const t = (over: Partial<ToolPart>): ToolPart =>
  ({ type: 'tool', id: over.id ?? 't', name: 'Read', input: { file: 'src/game/scene.ts' }, status: 'ready', ...over });

export default function DevToolGroup() {
  return (
    <I18nProvider>
      <div className="mx-auto flex max-w-[320px] flex-col gap-3 bg-[var(--color-surface-2)] p-6">
        <ToolGroupCard name="Read" parts={[t({ id: '1' }), t({ id: '2' }), t({ id: '3' }), t({ id: '4' }), t({ id: '5' })]} />
        <ToolGroupCard name="Bash" parts={[t({ id: '6', name: 'Bash', input: { command: 'ls' } }), t({ id: '7', name: 'Bash', input: { command: 'pwd' }, status: 'generating' })]} />
        <ToolGroupCard name="Bash" parts={[t({ id: '8', name: 'Bash', input: { command: 'ls' } }), t({ id: '9', name: 'Bash', input: { command: 'boom' }, status: 'error' })]} />
      </div>
    </I18nProvider>
  );
}
```

- [ ] **Step 3: 起 prod-mode 服务并截图**

Run（后台，端口须空闲——3000 常被别的 worktree 占，见 [[runtime-verification-local-gotchas]]）：`PORT=3100 pnpm dev`（后台）。
用 curl 轮询 `http://localhost:3100/dev-toolgroup` 就绪（`--retry-connrefused`）。用 Playwright 打开该页，浅色 + 深色（`document.documentElement.dataset.theme='dark'|'light'`）各截一张。

- [ ] **Step 4: 逐项核对（按 [[verify-design-alignment-before-claiming]]）**

确认：收起态一行 `Read ×5`（聚合 teal check）；含 generating 组默认展开、头部与该行有 amber 转圈；含 error 组默认展开、头部 warning、失败行有标记而完成行无图标；`×N` 与名称间距、展开参数行样式与设计语汇一致。列 `项 | 期望 | 实测 | ✓/✗`。

- [ ] **Step 5: 删 scratch 页 + 停服**

```bash
rm -rf src/app/dev-toolgroup
lsof -ti:3100 | xargs kill 2>/dev/null || true
```
停掉后台 server。scratch 页不进版本库,无需提交。

---

## Self-Review

**1. Spec coverage：**
- 跨相邻纯工具消息分组 + 打断规则 → Task 1 `groupToolRuns`/`isGroupable` ✓
- 可合并(同名/无 diff/无 media)+ 阈值 ≥2 → Task 1 `isMergeable`/`splitToolRun` ✓
- footer-bearing 不分组 → Task 1（`footerIds`）+ Task 3（`footerIds = byMessageId.keys()`）✓
- 合并 pill：聚合状态 + `×N` + 展开逐行参数 + 未完成行才带图标 + 折叠默认态 → Task 2 ✓
- ChatPanel 渲染节点 + 保留 footer/骨架/空态 + mb-2 间距 → Task 3 ✓
- MessageItem/ToolCard/toolPill 不改 → 三个任务均未列改动 ✓
- 运行态核对 → Task 4 ✓

**2. Placeholder scan：** 无 TBD/TODO；每个代码步给出完整代码与测试。

**3. Type consistency：** `RenderNode`（message/tool/toolGroup）、`isMergeable`、`groupToolRuns(messages, footerIds)`、`ToolGroupCard({name, parts})`、`aggregateStatus` 命名前后一致；`ToolPart = Extract<Part,{type:'tool'}>` 各处一致;`data-tool-status`(running/done/error) 与 `toolPill.tsx`(Task 1 前序特性)一致。
