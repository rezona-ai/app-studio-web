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

test('流式草稿带空壳 text/thinking part → 忽略空壳,工具并入前组', () => {
  const nodes = groupToolRuns([
    msg([tool('Read', { id: 'r1' })]), msg([tool('Read', { id: 'r2' })]), msg([tool('Read', { id: 'r3' })]),
    msg([{ type: 'text', text: '' }, { type: 'thinking', text: '  ' }, tool('Read', { id: 'r4', status: 'generating' })], { status: 'generating' }),
  ], NO_FOOTERS);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ kind: 'toolGroup', name: 'Read', id: 'r1' });
  expect((nodes[0] as Extract<typeof nodes[0], { kind: 'toolGroup' }>).parts.map((p) => p.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
});

test('草稿带非空 text/thinking → 仍是 message 节点,打断合并', () => {
  const nodes = groupToolRuns([
    msg([tool('Read', { id: 'r1' })]),
    msg([{ type: 'thinking', text: '想一下' }, tool('Read', { id: 'r2', status: 'generating' })], { status: 'generating' }),
  ], NO_FOOTERS);
  expect(nodes.map((n) => n.kind)).toEqual(['tool', 'message']);
});

test('空 parts 的 assistant 草稿消息 → message 节点(不被空 every 吸收/丢弃)', () => {
  const nodes = groupToolRuns([msg([], { id: 'draft', status: 'generating' })], NO_FOOTERS);
  expect(nodes).toEqual([{ kind: 'message', message: expect.objectContaining({ id: 'draft' }) }]);
});
