import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import AgentRetryBubble from './AgentRetryBubble';
import { useStore } from '@/store';
import { createInitialKoubouState } from '@/store/types';
import type { AgentRetry } from '@/store/types';

// 重试进度气泡(设计稿 2026-08-25 决策 5):就地占错误气泡那一格,全程只一条 —— 每次失败各留
// 一条会把对话刷成 10 条红。它**不进 messages**,故不落盘、倒计时每秒 tick 也只重渲它自己。

// nextAt 给 0(=已到点)而不是 null:组件的「等待期」判据是 phase==='waiting' && nextAt != null,
// 夹具不带 nextAt 的话所有用它的用例测的其实都是非等待分支
const RETRY: AgentRetry = {
  attempt: 3, mode: 'resend', phase: 'waiting', nextAt: 0,
  text: 'Overloaded', code: 'AGENT_RUN_ERROR', detail: 'AnthropicOverloadedError: Overloaded',
};

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ ...createInitialKoubouState(), toast: null });
});
afterEach(() => vi.useRealTimers());

test('无重试态 → 不渲染', () => {
  const { container } = render(<AgentRetryBubble />);
  expect(container).toBeEmptyDOMElement();
});

test('等待期显示进度 n/10', () => {
  useStore.setState({ agentRetry: RETRY });
  render(<AgentRetryBubble />);
  expect(screen.getByRole('status')).toHaveTextContent('3/10');
});

// 进度气泡是「正在自愈」的进行态,不是报错:上游原文属于**放弃自愈后**那条正式错误气泡。
// 自愈期就摊开一坨异常栈,等于让用户为一件系统自己在处理的事排障(原文并没丢,取消/耗尽即落成气泡)
test('不渲染上游原文折叠块', () => {
  useStore.setState({ agentRetry: RETRY });
  render(<AgentRetryBubble />);
  expect(screen.queryByText('AnthropicOverloadedError: Overloaded')).not.toBeInTheDocument();
  expect(screen.getByRole('status').querySelector('details')).toBeNull();
});

// 重试一被后端受理(run 起来了)就退场:不必等回合终态,那之间隔着整轮生成
test('responded → 不渲染(状态还在,只为计数)', () => {
  useStore.setState({ agentRetry: { ...RETRY, phase: 'responded', nextAt: null } });
  const { container } = render(<AgentRetryBubble />);
  expect(container).toBeEmptyDOMElement();
});

test('等待期显示倒计时秒数', () => {
  useStore.setState({ agentRetry: { ...RETRY, nextAt: Date.now() + 4_000 } });
  render(<AgentRetryBubble />);
  expect(screen.getByRole('status')).toHaveTextContent('4s');
});

test('在跑时不显示倒计时(已发出,等的是 agent 不是退避)', () => {
  useStore.setState({ agentRetry: { ...RETRY, phase: 'running', nextAt: null } });
  render(<AgentRetryBubble />);
  expect(screen.getByRole('status')).toHaveTextContent('3/10');
  expect(screen.getByRole('status').textContent).not.toMatch(/\d+s/);
});

test('点取消 → 放弃自愈并落正式错误气泡', () => {
  useStore.setState({ agentRetry: RETRY, lastSend: { content: 'hi' } });
  render(<AgentRetryBubble />);
  act(() => { screen.getByRole('button', { name: 'Stop retrying' }).click(); });
  expect(useStore.getState().agentRetry).toBeNull();
  expect(useStore.getState().agentError).toMatchObject({ detail: RETRY.detail });
});
