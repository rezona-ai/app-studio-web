import { beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import AgentErrorBubble from './AgentErrorBubble';
import { useStore } from '@/store';
import { createInitialKoubouState } from '@/store/types';

// 固定槽报错气泡(设计稿 2026-08-27)。与重试进度气泡同一格、同一套瞬态模型:
// 同一时刻至多一条,对话流里不再堆历史失败。

const ERR = { text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' };

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), toast: null });
});

test('无错误 → 不渲染', () => {
  const { container } = render(<AgentErrorBubble />);
  expect(container).toBeEmptyDOMElement();
});

test('渲染主行译文与可展开的上游原文', () => {
  useStore.setState({ agentError: ERR });
  render(<AgentErrorBubble />);
  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong during the run');
  // 原文默认收起(受控),点 Details 才渲染
  expect(screen.queryByText('ValueError: boom')).not.toBeInTheDocument();
  // 箭头随文字色(currentColor),不能落到 ICON_TONE 默认的恒灰 secondary —— 红字配灰箭头是两个色
  const toggle = screen.getByRole('button', { name: 'Details', expanded: false });
  expect((toggle.querySelector('span[aria-hidden]') as HTMLElement).style.backgroundColor).toBe('currentcolor');
  act(() => { toggle.click(); });
  expect(screen.getByText('ValueError: boom')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Details', expanded: true })).toBeInTheDocument();
});

// 判据不再是「它是 messages 最后一条」—— 那条判据在报错之后又来了任何一条消息时就把按钮弄没了
test('有可重发 payload 且回合已停 → 给手动重试', () => {
  useStore.setState({ agentError: ERR, lastSend: { content: 'hi' } });
  render(<AgentErrorBubble />);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('刷新后没有可重发 payload → 不给按钮(点了也发不出去)', () => {
  useStore.setState({ agentError: ERR, lastSend: null });
  render(<AgentErrorBubble />);
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

test('回合正在跑 → 不给按钮(会撞后端 run already active)', () => {
  useStore.setState({ agentError: ERR, lastSend: { content: 'hi' }, runStatus: 'running' });
  render(<AgentErrorBubble />);
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

test('自愈进行中 → 不给按钮,也不该同时出现两条气泡', () => {
  useStore.setState({
    agentError: ERR, lastSend: { content: 'hi' },
    agentRetry: { attempt: 1, mode: 'resend', phase: 'waiting', nextAt: null, text: 'boom' },
  });
  const { container } = render(<AgentErrorBubble />);
  expect(container).toBeEmptyDOMElement();
});

// 模型侧不可重试失败(设计稿 2026-09-03,方案二):气泡里多一段提示 + Switch model 按钮,
// 点击不自己开菜单,只向 store 发请求,由 Composer 里的 ModelSelector 展开
test('retryable:false → 多一段换模型提示与 Switch model 按钮;点击请求展开模型下拉', () => {
  useStore.setState({
    agentError: { ...ERR, code: 'upstream_error', retryable: false }, lastSend: { content: 'hi' },
    availableModels: ['a', 'b'], selectedModel: 'a', newUserStatus: false, modelMenuRequest: 0,
  });
  render(<AgentErrorBubble />);
  expect(screen.getByRole('alert')).toHaveTextContent('The request could not be completed');
  // 排版分层(Nick 2026-09-03 定案):提示行是 12px 正文色(红 = 错误,正文色 = 建议),不与主行同色同字号
  const hint = screen.getByText(/Switching to another model may help/);
  expect(hint.className).toContain('text-[var(--color-ink)]');
  // 底部一条动作栏:Details 在左,Try again(ghost)与 Switch model(带底色的首选)在右并排
  const bar = screen.getByRole('group', { name: 'Error actions' });
  const buttons = within(bar).getAllByRole('button').map((b) => b.textContent);
  expect(buttons).toEqual(['Details', 'Try again', 'Switch model']);
  // 首选动作实底 + 白字,与 ghost 红字的 Try again 拉开对比
  expect(screen.getByRole('button', { name: 'Switch model' }).className).toContain('bg-[var(--color-danger)]');
  expect(screen.getByRole('button', { name: 'Switch model' }).className).toContain('text-[var(--color-on-primary-strong)]');
  act(() => { screen.getByRole('button', { name: 'Switch model' }).click(); });
  expect(useStore.getState().modelMenuRequest).toBe(1);
});

test('无任何动作也无原文 → 不渲染空动作栏', () => {
  useStore.setState({ agentError: { text: 'agent crashed' }, lastSend: null });
  render(<AgentErrorBubble />);
  expect(screen.queryByRole('group', { name: 'Error actions' })).not.toBeInTheDocument();
});

test('普通报错 / 无可换模型 → 不出现换模型提示', () => {
  useStore.setState({ agentError: ERR, availableModels: ['a', 'b'], selectedModel: 'a', newUserStatus: false });
  render(<AgentErrorBubble />);
  expect(screen.queryByRole('button', { name: 'Switch model' })).not.toBeInTheDocument();
  cleanup();
  useStore.setState({ agentError: { ...ERR, retryable: false }, availableModels: ['a'] });
  render(<AgentErrorBubble />);
  expect(screen.queryByRole('button', { name: 'Switch model' })).not.toBeInTheDocument();
});

test('点手动重试 → 交棒给进度气泡', () => {
  useStore.setState({ agentError: ERR, lastSend: { content: 'hi' } });
  render(<AgentErrorBubble />);
  act(() => { screen.getByRole('button', { name: 'Try again' }).click(); });
  expect(useStore.getState().agentError).toBeNull();
  expect(useStore.getState().agentRetry).toMatchObject({ attempt: 1 });
});

test('无 detail → 不渲染详情折叠(不留空壳)', () => {
  useStore.setState({ agentError: { text: 'agent crashed' } });
  render(<AgentErrorBubble />);
  expect(screen.getByRole('alert')).toHaveTextContent('agent crashed');
  expect(screen.queryByText('Details')).not.toBeInTheDocument();
});

test('详情可一键复制上游原文', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useStore.setState({ agentError: ERR });
  render(<AgentErrorBubble />);
  act(() => { screen.getByRole('button', { name: 'Details' }).click(); });
  act(() => { screen.getByRole('button', { name: 'Copy details' }).click(); });
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('ValueError: boom'));
});

// 评审 I-2:phase='responded' 时 agentRetry 还留着(只剩计数用途)但进度气泡已退场 ——
// 让位判据若写成 agentRetry != null,这段横跨整个被重试 run 的窗口里固定槽是空的
test('自愈已被受理(responded) → 报错照常显示,不跟着进度气泡一起消失', () => {
  useStore.setState({
    agentError: ERR,
    agentRetry: { attempt: 2, mode: 'resend', phase: 'responded', nextAt: null, text: 'x' },
  });
  render(<AgentErrorBubble />);
  expect(screen.getByRole('alert')).toBeInTheDocument();
});
