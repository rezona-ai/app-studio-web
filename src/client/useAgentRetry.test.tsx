import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentRetry } from './useAgentRetry';
import { useStore } from '@/store';
import { AUTO_RETRY_CONTINUE, AUTO_RETRY_MARKER, autoRetryPrompt } from '@/lib/agent-retry';
import { createInitialKoubouState } from '@/store/types';
import type { AgentRetry } from '@/store/types';
import type { KoubouClient } from '@/koubou/client';

// 应用层自动重试的执行侧(设计稿 2026-08-25)。判定在 reducer,这里只管「等到点、连接可用就发」。
// client 实例是 useKoubouConnection 的 ref,store 够不着 —— 故执行必须落在 hook 层。

function makeClient() {
  const sendUserMessage = vi.fn();
  const ref = { current: { sendUserMessage } as unknown as KoubouClient };
  return { ref, sendUserMessage };
}

const waiting = (patch: Partial<AgentRetry> = {}): AgentRetry => ({
  attempt: 1, mode: 'resend', phase: 'waiting', nextAt: null, text: 'boom', ...patch,
});

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ ...createInitialKoubouState(), connStatus: 'open', toast: null });
});
afterEach(() => vi.useRealTimers());

test('等满退避才发,早一毫秒不发', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(999); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: autoRetryPrompt('hi') });
  expect(useStore.getState().agentRetry).toMatchObject({ phase: 'running' });
});

test('退避随 attempt 增长(第 3 次等 4s)', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting({ attempt: 3 }) });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(3_999); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
});

test('continue 模式发带哨兵前缀的 continue,且不推用户气泡', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting({ mode: 'continue' }) });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(1000); });
  // 哨兵前缀让历史重建能把这条机器指令滤掉(见 apply-koubou 的 isNonBubbleUserMessage);
  // 指令正文仍是干净的 continue,agent 侧语义不变
  expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: AUTO_RETRY_CONTINUE });
  expect(AUTO_RETRY_CONTINUE).toMatch(/continue$/);
  expect(useStore.getState().messages).toHaveLength(0);
});

// resend 是同一问题的另一半:重发的用户原话同样真实落进事件日志、同样不推本地气泡,
// 不带哨兵的话刷新后用户那句话会在历史里出现两次(最多 10 次)
test('resend 模式重发的原话也带哨兵前缀', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: '做个跳跃游戏' }, agentRetry: waiting({ mode: 'resend' }) });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(1000); });
  expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: autoRetryPrompt('做个跳跃游戏') });
});

// 带附件的发送 payload 是 ContentBlock[] 而非字符串 —— 哨兵不能只会拼字符串,
// 否则这条路要么编译不过,要么把数组 stringify 成 [object Object] 发出去
test('resend 的 payload 是 content block 数组时,哨兵作为首个 text block 前插', () => {
  const { ref, sendUserMessage } = makeClient();
  const blocks = [{ type: 'image', source: { url: 'x' } }, { type: 'text', text: '照这张改' }];
  useStore.setState({ lastSend: { content: blocks }, agentRetry: waiting({ mode: 'resend' }) });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(1000); });
  expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: [{ type: 'text', text: AUTO_RETRY_MARKER }, ...blocks] });
});

test('断连期到点不发,连上后立即补发', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ connStatus: 'closed', lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(5_000); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  act(() => { useStore.setState({ connStatus: 'open' }); });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
});

test('连接致命 → 终止自愈并落正式错误', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  act(() => { useStore.setState({ connStatus: 'fatal' }); });
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  expect(useStore.getState().agentRetry).toBeNull();
  // cancelAgentRetry 要把最后一次的原因带过去 —— 只断言「非 null」会让「落了一条空报错」也通过
  expect(useStore.getState().agentError).toMatchObject({ text: 'boom' });
});

// 白名单口径下 SEND_TIMEOUT 不自动重试:兜底只负责收口,不再自己发第二条 ——
// koubou 当前无 event_id 去重,后端排队慢时「兜底再发一条」会双执行
test('发出后 run 永不开跑 → 45s 兜底收口为正式错误,不再自动发第二条', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(1000); });
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1, phase: 'running' });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(45_000); });
  expect(useStore.getState().agentRetry).toBeNull();
  expect(useStore.getState().agentError).toMatchObject({ code: 'SEND_TIMEOUT' });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);   // 没有第二条
});

test('run 已开跑 → 兜底不误触发', () => {
  const { ref } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(1000); });
  act(() => { useStore.setState({ runStatus: 'running' }); });
  act(() => { vi.advanceTimersByTime(45_000); });
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1, phase: 'running' });
});

test('卸载清定时器,不再发', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  const { unmount } = renderHook(() => useAgentRetry(ref));
  unmount();
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(sendUserMessage).not.toHaveBeenCalled();
});

// 后端当前**没有** event_id 去重 —— 同一条消息发两次 = 双执行 = 双扣费。
// 这两条守着最容易出双发的两个时序(评审自查补)
test('连接状态反复抖动 → 到点仍只发一次', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  // effect 随 connStatus 反复重跑,每次都会清旧定时器再设新的
  for (const st of ['closed', 'open', 'connecting', 'open'] as const) {
    act(() => { useStore.setState({ connStatus: st }); });
  }
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
});

test('等待期用户手动发送 → 旧的重试定时器不再发出', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  // markPendingSend 清 agentRetry(手动发送即放弃上一条的自愈)
  act(() => { useStore.getState().markPendingSend({ content: '另一句话' }); });
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(sendUserMessage).not.toHaveBeenCalled();
});

// 评审 I-1:`onError` 不关轮 —— error 事件到达时 runStatus 仍是 'running',真正关轮要等后面
// 那条 run.finished,间隔无上界(后端发完 error 还会继续 drain 流,finally 里还有四段 await)。
// 首档退避只有 1s,贸然发出会撞后端的 `run already active` 门(actor.py:783),自愈第一次就死,
// 而且用户看到的报错还指错方向。故 run 未关闭时挂起,关闭后立即补发。
test('旧 run 尚未关闭 → 到点不发,run 关闭后立即补发', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, runStatus: 'running', agentRetry: waiting() });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  act(() => { useStore.setState({ runStatus: 'idle' }); });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
});

// responded = 后端已受理这次自愈,气泡已退场,状态只剩「计数」这一个用途:
// 本 hook 就此彻底撒手 —— 既不排期、不发送,也不把它当成还在自愈中而去做致命态收口
test('responded 后不再排期、不再发送(状态只留着计数)', () => {
  const { ref, sendUserMessage } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting({ phase: 'responded' }), runStatus: 'running' });
  renderHook(() => useAgentRetry(ref));
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  expect(useStore.getState().agentRetry).toMatchObject({ phase: 'responded', nextAt: null });
});

test('responded 期连接转致命 → 不落陈年错误气泡(那一轮 agent 正在答)', () => {
  const { ref } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting({ phase: 'responded' }), runStatus: 'running' });
  renderHook(() => useAgentRetry(ref));
  act(() => { useStore.setState({ connStatus: 'fatal' }); });
  expect(useStore.getState().messages).toHaveLength(0);
});

// responded 的出口不变式:自愈发出的那轮起来了,随后断线重连,后端已无 active run ——
// 终态帧永远不到,而 session.ready 只把 runStatus 拨回 idle、不碰 agentRetry。
// 不清的话 agentRetry 永久非 null,而手动重试按钮的判据含 agentRetry == null:
// 进度气泡不渲染、手动入口也一并消失,屏幕上一个出口都没有
test('responded 且回合已不在跑 → 清空重试态,把手动入口还回去', () => {
  const { ref } = makeClient();
  useStore.setState({ lastSend: { content: 'hi' }, agentRetry: waiting({ phase: 'responded' }), runStatus: 'running' });
  const { rerender } = renderHook(() => useAgentRetry(ref));
  expect(useStore.getState().agentRetry).not.toBeNull();
  act(() => { useStore.setState({ runStatus: 'idle' }); });
  rerender();
  expect(useStore.getState().agentRetry).toBeNull();
  expect(useStore.getState().messages).toHaveLength(0);   // 不落陈年错误气泡
});
