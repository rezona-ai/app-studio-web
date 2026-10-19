# 工具消息文件修改 diff UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在改文件的工具(Edit/Write 等)卡片里,把 ws 新增的 `tool_use_result.structuredPatch` 渲染成紧凑彩色 diff。

**Architecture:** `protocol.ts` 新增 diff 类型与纯函数 `parseFileDiff`,把原始 `structuredPatch` 归一成 `FileDiff`;reducer `apply-koubou.ts` 在折叠 `tool_result` 时按 filePath/单结果把 `FileDiff` 挂到对应 `tool` part;新组件 `DiffView` 逐行着色,`ToolCard` 有 diff 时用它取代参数 JSON 与结果文本。

**Tech Stack:** TypeScript、React 19、Zustand、Vitest + @testing-library/react、Tailwind v4(CSS 变量色板)。

---

## 文件结构

- 修改 `src/koubou/protocol.ts` — 新增 `StructuredPatchHunk`/`ToolUseResultRaw`/`DiffLine`/`DiffHunk`/`FileDiff` 类型、`ClaudeMessagePayload.payload.tool_use_result`、纯函数 `parseFileDiff`。
- 修改 `src/store/types.ts` — `Part` 的 `tool` 分支加 `diff?: FileDiff`。
- 修改 `src/koubou/apply-koubou.ts` — `foldResults` 多接收 `diff` 参数并按规则挂载;`onClaudeMessage`(UserMessage)与 `rebuildHistory` 解析并传入 `diff`。
- 创建 `src/components/chat/DiffView.tsx` — 紧凑彩色 diff 渲染。
- 修改 `src/components/chat/ToolCard.tsx` — 头部统计 + 用 `DiffView` 取代正文。
- 测试:`src/koubou/apply-koubou.test.ts`(扩充)、`src/components/chat/DiffView.test.tsx`(新建)、`src/components/chat/ToolCard.test.tsx`(扩充)。

---

## Task 1: protocol 类型 + parseFileDiff

**Files:**
- Modify: `src/koubou/protocol.ts`
- Test: `src/koubou/apply-koubou.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 顶部已有 import 后追加 `parseFileDiff` 引入,并在文件末尾追加一个 describe。先改 import 行:

```ts
import { describe, expect, test } from 'vitest';
import { applyKoubou } from './apply-koubou';
import { createInitialKoubouState } from '@/store/types';
import type { Part } from '@/store/types';
import { parseFileDiff } from './protocol';
import type { ServerEvent } from './protocol';
```

在文件末尾追加:

```ts
describe('parseFileDiff', () => {
  test('update:structuredPatch 归一为 DiffLine,丢弃 \\ 无换行标记行,统计仅计 +/-', () => {
    const d = parseFileDiff({
      type: 'update', filePath: 'src/a.ts',
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' const x=1;', '-foo();', '+bar();', '+baz();', '\\ No newline at end of file'] }],
    });
    expect(d).toMatchObject({ type: 'update', filePath: 'src/a.ts', additions: 2, deletions: 1 });
    expect(d!.hunks[0].lines).toEqual([
      { kind: 'context', text: 'const x=1;' },
      { kind: 'del', text: 'foo();' },
      { kind: 'add', text: 'bar();' },
      { kind: 'add', text: 'baz();' },
    ]);
  });

  test('create:无 patch 有 content → 整文件按全新增,deletions=0', () => {
    const d = parseFileDiff({ type: 'create', filePath: 'src/new.ts', content: 'line1\nline2\nline3' });
    expect(d).toMatchObject({ type: 'create', additions: 3, deletions: 0 });
    expect(d!.hunks[0].lines.map((l) => l.kind)).toEqual(['add', 'add', 'add']);
    expect(d!.hunks[0].lines.map((l) => l.text)).toEqual(['line1', 'line2', 'line3']);
  });

  test('content 末尾换行不产生空尾行', () => {
    const d = parseFileDiff({ type: 'create', filePath: 'a.ts', content: 'a\nb\n' });
    expect(d!.additions).toBe(2);
  });

  test('userModified 透传', () => {
    const d = parseFileDiff({ type: 'update', filePath: 'a.ts', userModified: true, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] });
    expect(d!.userModified).toBe(true);
  });

  test('缺 filePath / 空 patch 且无 content / undefined → null', () => {
    expect(parseFileDiff({ structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a'] }] })).toBeNull();
    expect(parseFileDiff({ filePath: 'a.ts', structuredPatch: [] })).toBeNull();
    expect(parseFileDiff({ filePath: 'a.ts' })).toBeNull();
    expect(parseFileDiff(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/koubou/apply-koubou.test.ts -t "parseFileDiff"`
Expected: FAIL —「parseFileDiff is not a function」/ 类型导出不存在。

- [ ] **Step 3: 实现类型与 parseFileDiff**

在 `src/koubou/protocol.ts` 的 ContentBlock 定义之后(第 21 行附近)插入原始类型:

```ts
// ---- 文件修改 diff(UserMessage.payload.tool_use_result) ----
export interface StructuredPatchHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
export interface ToolUseResultRaw {
  type?: 'create' | 'update';
  filePath?: string;
  content?: string;
  oldString?: string;
  newString?: string;
  structuredPatch?: StructuredPatchHunk[];
  userModified?: boolean;
  [k: string]: unknown;
}

// 归一后的 diff(UI 直接消费)
export type DiffLineKind = 'context' | 'add' | 'del';
export interface DiffLine { kind: DiffLineKind; text: string }
export interface DiffHunk { lines: DiffLine[] }
export interface FileDiff {
  type: 'create' | 'update';
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  userModified?: boolean;
}
```

在 `ClaudeMessagePayload.payload` 内补一个可选字段(在 `event?: RawStreamEvent;` 行之后):

```ts
    tool_use_result?: ToolUseResultRaw;   // 文件修改 diff(snake key,内部字段 camel);也兼容 toolUseResult
```

在 `toolResultText` 函数(约第 98 行)之后追加纯函数:

```ts
// 把原始 tool_use_result 归一成 FileDiff;无法构成 diff 时返回 null
export function parseFileDiff(raw: ToolUseResultRaw | null | undefined): FileDiff | null {
  if (!raw || typeof raw !== 'object') return null;
  const filePath = raw.filePath;
  if (typeof filePath !== 'string' || !filePath) return null;
  const type: FileDiff['type'] = raw.type === 'create' ? 'create' : 'update';
  let hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  if (Array.isArray(raw.structuredPatch)) {
    for (const h of raw.structuredPatch) {
      const lines: DiffLine[] = [];
      for (const ln of h.lines ?? []) {
        const c = ln[0];
        if (c === '\\') continue; // 无换行标记行,不渲染
        if (c === '+') { lines.push({ kind: 'add', text: ln.slice(1) }); additions++; }
        else if (c === '-') { lines.push({ kind: 'del', text: ln.slice(1) }); deletions++; }
        else lines.push({ kind: 'context', text: ln.slice(1) });
      }
      if (lines.length) hunks.push({ lines });
    }
  }
  // create 常无 structuredPatch,只给 content → 整文件按全新增
  if (!hunks.length && type === 'create' && typeof raw.content === 'string') {
    const arr = raw.content.split('\n');
    if (arr.length && arr[arr.length - 1] === '') arr.pop(); // 末尾换行不算一行
    if (arr.length) {
      hunks = [{ lines: arr.map((t) => ({ kind: 'add' as const, text: t })) }];
      additions = arr.length;
    }
  }
  if (!hunks.length) return null;
  return { type, filePath, hunks, additions, deletions, userModified: raw.userModified === true || undefined };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/koubou/apply-koubou.test.ts -t "parseFileDiff"`
Expected: PASS(5 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/koubou/protocol.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: protocol 新增 FileDiff 类型与 parseFileDiff 归一函数"
```

---

## Task 2: reducer 把 diff 挂到 tool part

**Files:**
- Modify: `src/store/types.ts:30`(Part 的 tool 分支)
- Modify: `src/koubou/apply-koubou.ts`
- Test: `src/koubou/apply-koubou.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 的 `describe('claude.message 流式 + 完整消息', …)` 内末尾追加三个用例:

```ts
  test('UserMessage.tool_use_result 解析为 diff 并按 filePath 挂到对应 tool part', () => {
    let s = applyKoubou(createInitialKoubouState(), ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'tool_use', id: 'te', name: 'Edit', input: { file_path: 'src/a.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'UserMessage', payload: {
      content: [{ type: 'tool_result', tool_use_id: 'te', content: 'The file has been updated.' }],
      tool_use_result: { type: 'update', filePath: 'src/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' const x=1;', '-foo();', '+bar();', '+baz();'] }] },
    } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool') as Extract<Part, { type: 'tool' }>;
    expect(tool.diff).toMatchObject({ type: 'update', filePath: 'src/a.ts', additions: 2, deletions: 1 });
    expect(tool.diff!.hunks[0].lines[1]).toEqual({ kind: 'del', text: 'foo();' });
  });

  test('create 无 patch 有 content → tool part 拿到全新增 diff', () => {
    let s = applyKoubou(createInitialKoubouState(), ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'tool_use', id: 'tw', name: 'Write', input: { file_path: 'src/new.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'UserMessage', payload: {
      content: [{ type: 'tool_result', tool_use_id: 'tw', content: 'File created.' }],
      tool_use_result: { type: 'create', filePath: 'src/new.ts', content: 'line1\nline2\nline3' },
    } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool') as Extract<Part, { type: 'tool' }>;
    expect(tool.diff).toMatchObject({ type: 'create', additions: 3, deletions: 0 });
  });

  test('同一条消息多 tool_result + 单 diff → 仅挂到 filePath 命中的 part', () => {
    let s = createInitialKoubouState();
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'a1', message_id: 'mP', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'a2', message_id: 'mP', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/b.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 3, payload: { sdk_type: 'UserMessage', payload: {
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'updated' },
        { type: 'tool_result', tool_use_id: 't2', content: 'file body' },
      ],
      tool_use_result: { type: 'update', filePath: 'src/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] },
    } } }));
    const tools = s.messages.flatMap((m) => m.parts).filter((p) => p.type === 'tool') as Extract<Part, { type: 'tool' }>[];
    expect(tools.find((t) => t.id === 't1')!.diff).toBeTruthy();
    expect(tools.find((t) => t.id === 't2')!.diff).toBeUndefined();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/koubou/apply-koubou.test.ts -t "tool_use_result"`
Expected: FAIL —`tool.diff` 为 undefined / 类型 `diff` 不存在于 Part。

- [ ] **Step 3: 加 Part.diff 字段**

`src/store/types.ts` 第 3 行 import 补 `FileDiff`:

```ts
import type { MediaGenerated, QuestionDef, FileDiff } from '@/koubou/protocol';
```

第 30 行 tool 分支末尾加 `diff?: FileDiff`:

```ts
  | { type: 'tool'; id: string; name: string; input: unknown; status: Status; result?: string; isError?: boolean; media?: MediaGenerated; diff?: FileDiff };
```

- [ ] **Step 4: reducer 解析并挂载 diff**

`src/koubou/apply-koubou.ts` 顶部 import:把第 2 行的类型 import 补上 `FileDiff` 与 `ToolUseResultRaw`,第 5 行的值 import 补上 `parseFileDiff`:

```ts
import type {
  ServerEvent, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
  RawStreamEvent, ClaudeMessagePayload, QuestionDef, FileDiff, ToolUseResultRaw,
} from './protocol';
import { isFullMessage, parseMediaGenerated, toolResultText, parseFileDiff } from './protocol';
```

把 `onClaudeMessage` 的 UserMessage 分支(约第 136–139 行)改为:

```ts
  // UserMessage:仅折叠 tool_result(用户文本已乐观渲染,不重复成泡);带文件 diff 时一并挂载
  const blocks = Array.isArray(content) ? content : [];
  const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  if (!results.length) return state;
  const rawDiff = (p.payload.tool_use_result ?? (p.payload as Record<string, unknown>).toolUseResult) as ToolUseResultRaw | undefined;
  return { ...state, messages: foldResults(state.messages, results, parseFileDiff(rawDiff) ?? undefined) };
```

把 `foldResults`(约第 103–115 行)整段替换为带 `diff` 参数的版本,并在其下新增 `inputFilePath` helper:

```ts
// 把 tool_result 回填到对应 tool_use part(跨消息按 tool_use_id 匹配,纯函数返回新数组)
// diff 存在时:本批仅一个结果直接挂;多结果则按 filePath 匹配,避免并行工具挂错
function foldResults(messages: readonly Message[], results: ToolResultBlock[], diff?: FileDiff): Message[] {
  if (!results.length) return messages.slice();
  const single = results.length === 1;
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (p.type !== 'tool') return p;
      const r = results.find((x) => x.tool_use_id === p.id);
      if (!r) return p;
      const text = toolResultText(r.content);
      const attach = diff && (single || inputFilePath(p.input) === diff.filePath);
      return { ...p, status: 'ready' as const, result: text, isError: r.is_error, media: parseMediaGenerated(text) ?? undefined, diff: attach ? diff : p.diff };
    }),
  }));
}

// 从工具入参里取文件路径(兼容 file_path / filePath / path)
function inputFilePath(input: unknown): string | undefined {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const v = o.file_path ?? o.filePath ?? o.path;
    if (typeof v === 'string') return v;
  }
  return undefined;
}
```

让冷启动历史也尽力带上 diff:`HistoryView` 接口(约第 60 行)扩展为:

```ts
interface HistoryView { uuid: string; role: string; content?: { role?: string; content?: ContentBlock[] | string; tool_use_result?: ToolUseResultRaw }; tool_use_result?: ToolUseResultRaw }
```

`rebuildHistory` 里 user 全 tool_result 的折叠分支(约第 80–81 行)改为:

```ts
      if (results.length && results.length === blocks.length) {
        const rawDiff = (v.content?.tool_use_result ?? v.tool_use_result) as ToolUseResultRaw | undefined;
        messages = foldResults(messages, results, parseFileDiff(rawDiff) ?? undefined);
      } else {
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS(原有用例 + 新增 3 个全绿)。

- [ ] **Step 6: 提交**

```bash
git add src/store/types.ts src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: reducer 把文件修改 diff 按 filePath 挂到对应 tool part"
```

---

## Task 3: DiffView 组件

**Files:**
- Create: `src/components/chat/DiffView.tsx`
- Test: `src/components/chat/DiffView.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/chat/DiffView.test.tsx`:

```tsx
import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiffView from './DiffView';
import type { FileDiff } from '@/koubou/protocol';

const oneHunk: FileDiff = {
  type: 'update', filePath: 'src/a.ts', additions: 2, deletions: 1,
  hunks: [{ lines: [
    { kind: 'context', text: 'const x = 1;' },
    { kind: 'del', text: 'foo();' },
    { kind: 'add', text: 'bar();' },
    { kind: 'add', text: 'baz();' },
  ] }],
};

test('逐行渲染文本', () => {
  render(<DiffView diff={oneHunk} />);
  expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  expect(screen.getByText('foo();')).toBeInTheDocument();
  expect(screen.getByText('bar();')).toBeInTheDocument();
  expect(screen.getByText('baz();')).toBeInTheDocument();
});

test('增删行按类型着色(emerald=新增,red=删除)', () => {
  const { container } = render(<DiffView diff={oneHunk} />);
  expect(container.querySelectorAll('[class*="bg-emerald"]')).toHaveLength(2);
  expect(container.querySelectorAll('[class*="bg-red"]')).toHaveLength(1);
});

test('多 hunk 之间有分隔线', () => {
  const twoHunks: FileDiff = { ...oneHunk, hunks: [{ lines: [{ kind: 'context', text: 'a' }] }, { lines: [{ kind: 'context', text: 'b' }] }] };
  const { container } = render(<DiffView diff={twoHunks} />);
  expect(screen.getByText('a')).toBeInTheDocument();
  expect(screen.getByText('b')).toBeInTheDocument();
  expect(container.querySelectorAll('[class*="border-t"]')).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/chat/DiffView.test.tsx`
Expected: FAIL —「Failed to resolve import './DiffView'」。

- [ ] **Step 3: 实现 DiffView**

创建 `src/components/chat/DiffView.tsx`:

```tsx
'use client';
import type { FileDiff, DiffLineKind } from '@/koubou/protocol';

const SYM: Record<DiffLineKind, string> = { add: '+', del: '-', context: ' ' };
const ROW: Record<DiffLineKind, string> = {
  add: 'bg-emerald-500/10 text-emerald-700',
  del: 'bg-red-500/10 text-red-700',
  context: 'text-[var(--color-muted)]',
};

// 紧凑彩色 diff:等宽逐行着色,横向可滚动;多 hunk 间淡分隔线
export default function DiffView({ diff }: { diff: FileDiff }) {
  return (
    <div className="mt-1 max-h-64 overflow-auto rounded-[8px] border border-[var(--color-line)] font-mono text-[12px] leading-5">
      {diff.hunks.map((h, hi) => (
        <div key={hi} className={hi > 0 ? 'border-t border-[var(--color-line)]' : ''}>
          {h.lines.map((ln, li) => (
            <div key={li} className={`flex whitespace-pre px-2 ${ROW[ln.kind]}`}>
              <span className="select-none pr-2 opacity-60">{SYM[ln.kind]}</span>
              <span>{ln.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/chat/DiffView.test.tsx`
Expected: PASS(3 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/DiffView.tsx src/components/chat/DiffView.test.tsx
git commit -m "feat: 新增 DiffView 紧凑彩色 diff 组件"
```

---

## Task 4: ToolCard 集成 diff

**Files:**
- Modify: `src/components/chat/ToolCard.tsx`
- Test: `src/components/chat/ToolCard.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `src/components/chat/ToolCard.test.tsx` 顶部 import 后追加 `FileDiff` 引入与一个 diff 夹具,并追加 4 个用例。先在 import 区加:

```ts
import type { FileDiff } from '@/koubou/protocol';

const sampleDiff: FileDiff = {
  type: 'update', filePath: 'src/game/player.ts', additions: 2, deletions: 1,
  hunks: [{ lines: [
    { kind: 'del', text: 'foo();' },
    { kind: 'add', text: 'bar();' },
    { kind: 'add', text: 'baz();' },
  ] }],
};
```

文件末尾追加:

```ts
test('有 diff(完成态)→ 头部显示文件名与 +N -M 统计,折叠态也可见', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'src/game/player.ts' }, diff: sampleDiff })} />);
  expect(screen.getByText('player.ts')).toBeInTheDocument();
  expect(screen.getByText('+2')).toBeInTheDocument();
  expect(screen.getByText('-1')).toBeInTheDocument();
});

test('展开 diff → 渲染 diff 行,且不显示原始结果文本', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'a.ts' }, result: 'The file has been updated.', diff: sampleDiff })} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  expect(screen.getByText('bar();')).toBeInTheDocument();
  expect(screen.queryByText('The file has been updated.')).not.toBeInTheDocument();
});

test('有 diff 时不渲染参数 JSON(即便展开)', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'a.ts', old_string: 'foo' }, diff: sampleDiff })} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  expect(screen.queryByText(/old_string/)).not.toBeInTheDocument();
  expect(screen.getByText('bar();')).toBeInTheDocument();
});

test('userModified → 显示「用户已改」角标', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'a.ts' }, diff: { ...sampleDiff, userModified: true } })} />);
  expect(screen.getByText('用户已改')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/chat/ToolCard.test.tsx`
Expected: FAIL —新增 4 个用例失败(找不到 `player.ts`/`+2`/`bar();` 等)。

- [ ] **Step 3: 改 ToolCard**

把 `src/components/chat/ToolCard.tsx` 整文件替换为:

```tsx
'use client';
import { useState } from 'react';
import type { Part } from '@/store/types';
import DiffView from './DiffView';

export default function ToolCard({ part }: { part: Extract<Part, { type: 'tool' }> }) {
  const running = part.status === 'generating';
  // 运行中默认展开(可见流式输出),输出完成后自动折叠;用户仍可手动切换
  const [open, setOpen] = useState(running);
  // 跟随运行态切换:仅在 运行中⇄完成 的状态切换时自动调整展开态,不覆盖用户手动操作
  const [prevRunning, setPrevRunning] = useState(running);
  if (prevRunning !== running) {
    setPrevRunning(running);
    setOpen(running);
  }

  const diff = part.diff;
  const fileName = diff ? (diff.filePath.split('/').pop() || diff.filePath) : '';

  let argText = '';
  try { argText = part.input !== undefined ? JSON.stringify(part.input) : ''; } catch { argText = String(part.input); }

  // 可折叠正文:有 diff 时 diff 即正文(隐藏参数与结果文本);否则参数 + 文本结果(媒体不参与折叠,始终可见)
  const hasBody = Boolean(diff) || Boolean(argText) || Boolean(!part.media && part.result);

  return (
    <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {hasBody && <span className="text-[11px] text-[var(--color-muted)]">{open ? '▾' : '▸'}</span>}
        <span className="font-medium">{part.name}</span>
        {diff && (
          <>
            <span className="truncate text-[var(--color-muted)]" title={diff.filePath}>{fileName}</span>
            <span className="shrink-0 text-[11px] text-emerald-600">+{diff.additions}</span>
            <span className="shrink-0 text-[11px] text-red-600">-{diff.deletions}</span>
            {diff.userModified && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-600">用户已改</span>
            )}
          </>
        )}
        {running ? (
          <span
            role="status"
            aria-label="运行中"
            className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-[var(--color-line-2)] border-t-[var(--color-muted)]"
          />
        ) : (
          <span className="text-[11px] text-[var(--color-muted)]">{part.status}</span>
        )}
      </button>
      {open && diff && <DiffView diff={diff} />}
      {open && !diff && argText && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400)}</pre>
      )}
      {part.media?.preview_url && (
        part.media.kind === 'video'
          ? <video src={part.media.preview_url} controls className="mt-2 max-h-48 rounded-[8px]" />
          : <img src={part.media.preview_url} alt={part.media.path} className="mt-2 max-h-48 rounded-[8px]" />
      )}
      {open && !diff && !part.media && part.result && (
        <pre className={`mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] ${part.isError ? 'text-red-600' : 'text-[var(--color-muted)]'}`}>{part.result.slice(0, 600)}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/chat/ToolCard.test.tsx`
Expected: PASS(原有 7 个 + 新增 4 个全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/ToolCard.tsx src/components/chat/ToolCard.test.tsx
git commit -m "feat: ToolCard 有 diff 时展示文件名统计并用 DiffView 取代正文"
```

---

## Task 5: 全量验证

**Files:** 无新增

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS(无失败、无未捕获错误)。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 无 error(已有 warning 不算回归)。

- [ ] **Step 4: 收尾提交(若前述命令产生自动修复)**

```bash
git add -A
git commit -m "chore: 文件修改 diff UI 通过全量测试/类型/lint" || echo "无额外改动"
```

---

## Self-Review(作者已核对)

- **Spec 覆盖**:数据来源/字段 → Task 1 类型 + parseFileDiff;reducer 挂载(filePath/单结果匹配、create、history best-effort)→ Task 2;DiffView 三类行着色 + 多 hunk 分隔 → Task 3;ToolCard 头部统计 + 取代正文 + userModified 角标 → Task 4。非目标(行号/语法高亮/originalFile)均未实现。
- **占位符**:无 TBD/TODO;每个代码步骤含完整代码。
- **类型一致**:`FileDiff`/`DiffLine`/`DiffHunk`/`ToolUseResultRaw`/`StructuredPatchHunk`/`parseFileDiff`/`inputFilePath` 在各 Task 间命名一致;`Part.diff` 字段名与测试断言一致;`foldResults(messages, results, diff?)` 签名在 onClaudeMessage 与 rebuildHistory 两处调用一致。
