import { beforeEach, expect, test } from 'vitest';
import { useStore } from '@/store';
import { createInitialKoubouState } from './types';
import type { AgentRetry, Message } from './types';

const msg = (id: string): Message => ({ id, role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] });

// 自动重试的落库入口(设计稿 2026-08-25)。判定在 reducer,发送在 client hook,
// 这一层只负责把两者要读写的状态收进 store —— 组件与 hook 都不绕过 action 直接写。

const ERR = { text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' };

const RETRY: AgentRetry = {
  attempt: 2, mode: 'resend', phase: 'waiting', nextAt: null,
  text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom',
};

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), toast: null });
});

test('markPendingSend 记下可重发 payload', () => {
  useStore.getState().markPendingSend({ content: 'hi' });
  expect(useStore.getState().lastSend).toEqual({ content: 'hi' });
});

test('用户手动发送即放弃上一条的重试(新一轮重新计数)', () => {
  useStore.setState({ agentRetry: RETRY });
  useStore.getState().markPendingSend({ content: 'hi' });
  expect(useStore.getState().agentRetry).toBeNull();
});

// 插话内容照样记下供重发(后端把 user.steer 当新消息跑);但不能复用 markPendingSend ——
// 那会置乐观计时 + 45s 超时兜底,而 steer 不开新轮
test('插话记下内容供重发,且不置乐观计时', () => {
  useStore.getState().markSteerSent('把卡面改暗一点');
  expect(useStore.getState().lastSend).toEqual({ content: '把卡面改暗一点' });
  expect(useStore.getState().pendingSendAt).toBeNull();
});

test('scheduleAgentRetry 写到点时刻,startAgentRetry 转在跑', () => {
  useStore.setState({ agentRetry: RETRY });
  useStore.getState().scheduleAgentRetry(1_700_000_000_000);
  expect(useStore.getState().agentRetry).toMatchObject({ phase: 'waiting', nextAt: 1_700_000_000_000 });
  useStore.getState().startAgentRetry();
  expect(useStore.getState().agentRetry).toMatchObject({ phase: 'running', nextAt: null });
});

test('无重试态时排期/启动是 no-op(不凭空造一条)', () => {
  useStore.getState().scheduleAgentRetry(1);
  useStore.getState().startAgentRetry();
  expect(useStore.getState().agentRetry).toBeNull();
});

test('cancelAgentRetry 落正式错误气泡(带最后一次原文)并清态', () => {
  useStore.setState({ agentRetry: RETRY });
  useStore.getState().cancelAgentRetry();
  const s = useStore.getState();
  expect(s.agentRetry).toBeNull();
  expect(s.agentError).toMatchObject({ code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' });
});

// 兜底走同一套判定:SEND_TIMEOUT 不在白名单 → 收口为正式错误,不推进下一次
test('failAgentRetry 走同一套判定:白名单外的失败收口为正式错误', () => {
  useStore.setState({ agentRetry: { ...RETRY, phase: 'running' }, lastSend: { content: 'hi' } });
  useStore.getState().failAgentRetry({ code: 'SEND_TIMEOUT', fallback: 'no response' });
  expect(useStore.getState().agentRetry).toBeNull();
  expect(useStore.getState().agentError).toMatchObject({ code: 'SEND_TIMEOUT' });
});

test('后端说可重试的失败仍推进下一次', () => {
  useStore.setState({ agentRetry: { ...RETRY, phase: 'running' }, lastSend: { content: 'hi' } });
  useStore.getState().failAgentRetry({ code: 'upstream_unavailable', fallback: 'busy', retryable: true });
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 3, phase: 'waiting' });
});

test('失败推进到上限即落正式错误', () => {
  useStore.setState({ agentRetry: { ...RETRY, attempt: 10, phase: 'running' }, lastSend: { content: 'hi' } });
  useStore.getState().failAgentRetry({ code: 'upstream_unavailable', fallback: 'busy', retryable: true });
  expect(useStore.getState().agentRetry).toBeNull();
  expect(useStore.getState().agentError).toMatchObject({ code: 'upstream_unavailable' });
});

test('retryAgentNow 从头计数重开重试', () => {
  useStore.setState({ lastSend: { content: 'hi' }, agentError: ERR });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1, mode: 'resend', phase: 'waiting' });
});

// 点了重试就等于「这条错误翻篇了」:进度气泡就地占它那一格,固定槽必须同时清空,
// 否则界面上红气泡与转圈进度并排,像是又失败了一次
test('retryAgentNow 清空固定槽,原因随重试态带走', () => {
  useStore.setState({ lastSend: { content: 'hi' }, agentError: { text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' } });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentError).toBeNull();
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1, phase: 'waiting', detail: 'ValueError: boom' });
});

// 清空不是丢掉:重试失败或用户喊停时,错误照样回到固定槽 —— 否则失败会变成静默
test('清空的错误在停止重试后重新落回固定槽', () => {
  useStore.setState({ lastSend: { content: 'hi' }, agentError: { text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' } });
  useStore.getState().retryAgentNow();
  useStore.getState().cancelAgentRetry();
  expect(useStore.getState().agentError).toMatchObject({ code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' });
});

test('无可重发 payload 时手动重试是 no-op', () => {
  useStore.setState({ agentError: ERR });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentRetry).toBeNull();
});

// 取消只是放弃**自动**重试,不该把手动重试的路也断掉:cancelAgentRetry 曾借道 failAgentTurn
// 并传 lastSend:null 来走弃疗分支,而那个返回值会被 set 写回 —— 于是点完「停止重试」,
// 错误气泡上的手动重试按钮(判据含 lastSend 可重发)就永久消失了
test('取消自动重试后仍保留可重发 payload(手动重试还能用)', () => {
  useStore.setState({ agentRetry: RETRY, lastSend: { content: 'hi' } });
  useStore.getState().cancelAgentRetry();
  expect(useStore.getState().lastSend).toEqual({ content: 'hi' });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1, phase: 'waiting' });
});

// 手动重试的 mode 判定必须钉在**失败的那一轮**上。失败可能根本没起 run(error 事件先于
// run.started 到达),此时 turns 末条是上一轮成功的 turn —— 拿它的 lastMessageId 判,
// 用户点「重试」会发出 continue 而不是重发那句话(评审自查发现)
const turn = (over: Partial<import('./types').TurnMeta> = {}) =>
  ({ runId: 'r', model: null, startedAt: null, finishedAt: null, status: 'succeeded' as const, lastMessageId: 'm', ...over });

test('上一轮成功 + 本次 run 未起来 → 手动重试重发原话,不发 continue', () => {
  useStore.setState({ lastSend: { content: 'hi' }, turns: [turn()], agentError: ERR });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentRetry?.mode).toBe('resend');
});

test('失败那一轮确实有产出 → 手动重试走 continue', () => {
  useStore.setState({ lastSend: { content: 'hi' }, turns: [turn({ status: 'error', lastMessageId: 'm1' })], agentError: ERR });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentRetry?.mode).toBe('continue');
});

test('失败那一轮没吐字 → 手动重试重发原话', () => {
  useStore.setState({ lastSend: { content: 'hi' }, turns: [turn({ status: 'error', lastMessageId: null })], agentError: ERR });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentRetry?.mode).toBe('resend');
});

// 固定槽错误态(设计稿 2026-08-27):与 agentRetry 同一套生命周期 —— 用户一有新动作就让位
test('点停止重试 → 原因落进固定槽而不是对话流', () => {
  useStore.setState({ agentRetry: RETRY, lastSend: { content: 'hi' } });
  useStore.getState().cancelAgentRetry();
  expect(useStore.getState().agentError).toMatchObject({ text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' });
});

test('用户发新消息即清掉固定槽', () => {
  useStore.setState({ agentError: { text: 'boom' } });
  useStore.getState().markPendingSend({ content: 'hi' });
  expect(useStore.getState().agentError).toBeNull();
});

test('插话同样清掉固定槽', () => {
  useStore.setState({ agentError: { text: 'boom' } });
  useStore.getState().markSteerSent('接着做');
  expect(useStore.getState().agentError).toBeNull();
});

test('点手动重试即让位给进度气泡(两者互斥)', () => {
  useStore.setState({ agentError: ERR, lastSend: { content: 'hi' } });
  useStore.getState().retryAgentNow();
  expect(useStore.getState().agentError).toBeNull();
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1 });
});

// 两个瞬态字段都不该跨项目残留。切项目走 createInitialKoubouState 整体重置,故无需专门代码 ——
// 但要有测试钉着:哪天有人改成逐字段搬,漏掉它就会把上个项目的报错带到新项目
test('切项目清掉固定槽与自愈态', () => {
  useStore.setState({ agentError: { text: 'boom' }, agentRetry: RETRY });
  useStore.getState().switchProjectSession(null);
  expect(useStore.getState().agentError).toBeNull();
  expect(useStore.getState().agentRetry).toBeNull();
});
