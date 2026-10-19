import { describe, expect, test } from 'vitest';
import { selectActiveVersion, selectAwaitingResponse, selectTurnAnchors } from './selectors';
import type { Message, TurnMeta, Version } from './types';

describe('selectors', () => {
  test('selectActiveVersion 取 current/active', () => {
    const v: Version = { id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: true, status: 'ready', assetKeys: [], game: { title: 't', palette: 'p' } };
    expect(selectActiveVersion([v], 'v1')).toBe(v);
    expect(selectActiveVersion([v], null)).toBe(v); // 回退到 current
  });
});

const msg = (over: Partial<Message>): Message => ({ id: 'm', role: 'assistant', status: 'ready', parts: [], ...over });

describe('selectAwaitingResponse(空窗期判定)', () => {
  test('运行中且尾部是用户消息 → true(助手还没开口)', () => {
    const messages = [msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: '做个跳跃游戏' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(true);
  });
  test('运行中且尾部是空的助手草稿 → true', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'generating', parts: [] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(true);
  });
  test('运行中但助手已有非空文本 → false(文本本身就是反馈)', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'generating', parts: [{ type: 'text', text: '好的' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(false);
  });
  test('运行中但助手仅有空文本块(刚 content_block_start) → true', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'generating', parts: [{ type: 'text', text: '' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(true);
  });
  test('运行中且助手出现思考块 → false(已有可见进展)', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'generating', parts: [{ type: 'thinking', text: '' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(false);
  });
  test('运行中且助手正在调用工具(工具卡 generating)→ true(工具调用中也显示加载动画)', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'generating', parts: [{ type: 'tool', id: 't', name: 'Bash', input: {}, status: 'generating' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(true);
  });
  test('工具调用已落定但 run 仍在运行(等待工具结果/下一段输出)→ true', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 't', name: 'Bash', input: {}, status: 'ready', result: 'ok' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(true);
  });
  test('重连到未完成会话(尾部助手文本已落定 + run 仍 running)→ true', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '前文已生成' }] })];
    expect(selectAwaitingResponse(messages, 'running')).toBe(true);
  });
  test('助手文本已完成且 run 空闲 → false(响应结束)', () => {
    const messages = [msg({ id: 'a', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '已生成' }] })];
    expect(selectAwaitingResponse(messages, 'idle')).toBe(false);
  });
  test('非运行态(idle/error)一律 false', () => {
    const messages = [msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] })];
    expect(selectAwaitingResponse(messages, 'idle')).toBe(false);
    expect(selectAwaitingResponse(messages, 'error')).toBe(false);
  });
  test('无消息 → false', () => {
    expect(selectAwaitingResponse([], 'running')).toBe(false);
  });
});

describe('selectTurnAnchors(每轮 footer 锚点)', () => {
  const m = (id: string): Message => ({ id, role: 'assistant', parts: [{ type: 'text', text: 'x' }], status: 'ready' });
  const t = (over: Partial<TurnMeta>): TurnMeta => ({ runId: 'r', model: 'm', startedAt: 'A', finishedAt: 'B', status: 'succeeded', lastMessageId: null, ...over });

  test('已结束轮锚到各自 lastMessageId', () => {
    const { byMessageId, trailing } = selectTurnAnchors([m('a1'), m('a2')], [t({ lastMessageId: 'a1' }), t({ lastMessageId: 'a2' })]);
    expect(byMessageId.get('a1')?.lastMessageId).toBe('a1');
    expect(byMessageId.get('a2')?.lastMessageId).toBe('a2');
    expect(trailing).toBeNull();
  });
  test('running 轮无有效锚点 → trailing', () => {
    const { trailing } = selectTurnAnchors([m('a1')], [t({ lastMessageId: 'a1' }), t({ status: 'running', lastMessageId: null })]);
    expect(trailing?.status).toBe('running');
  });
  test('running 轮已有锚点 → 仍归 trailing，保证计时器跟随列表最新内容', () => {
    const { byMessageId, trailing } = selectTurnAnchors([m('a1')], [t({ status: 'running', lastMessageId: 'a1' })]);
    expect(byMessageId.has('a1')).toBe(false);
    expect(trailing?.lastMessageId).toBe('a1');
  });
  test('已结束空轮(锚点不在 messages)→ 跳过', () => {
    const { byMessageId, trailing } = selectTurnAnchors([m('a1')], [t({ lastMessageId: 'gone' })]);
    expect(byMessageId.size).toBe(0);
    expect(trailing).toBeNull();
  });
  test('已结束轮聚合边界内全部助手正文,忽略工具并保留 Markdown', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', status: 'ready', parts: [{ type: 'text', text: '开始' }] },
      { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '## 完成' }] },
      { id: 'a2', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'tool-1', name: 'Bash', input: {}, status: 'ready' }] },
      { id: 'a3', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '- 第一项\n- 第二项' }] },
    ];

    const { copyTextByMessageId } = selectTurnAnchors(messages, [t({ lastMessageId: 'a3' })]);

    expect(copyTextByMessageId.get('a3')).toBe('## 完成\n\n- 第一项\n- 第二项');
  });
  test('多轮正文按回合边界隔离,不把上一轮内容串入下一轮', () => {
    const messages: Message[] = [
      { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '第一轮' }] },
      { id: 'u2', role: 'user', status: 'ready', parts: [{ type: 'text', text: '继续' }] },
      { id: 'a2', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '第二轮' }] },
    ];

    const { copyTextByMessageId } = selectTurnAnchors(messages, [
      t({ runId: 'r1', lastMessageId: 'a1' }),
      t({ runId: 'r2', lastMessageId: 'a2' }),
    ]);

    expect(copyTextByMessageId.get('a1')).toBe('第一轮');
    expect(copyTextByMessageId.get('a2')).toBe('第二轮');
  });
  test('运行中回合尚无稳定结束边界,不生成回复复制文本', () => {
    const { copyTextByMessageId } = selectTurnAnchors(
      [m('a1')],
      [t({ status: 'running', finishedAt: null, lastMessageId: 'a1' })],
    );

    expect(copyTextByMessageId.size).toBe(0);
  });
});
