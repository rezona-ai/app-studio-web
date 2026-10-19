import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import TurnFooter from './TurnFooter';
import type { TurnMeta } from '@/store/types';
import { useStore } from '@/store';

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
  // advanceTimersByTime 同时推进 fake 时钟与触发 interval,无需再 setSystemTime(否则两者叠加)
  act(() => { vi.advanceTimersByTime(3000); });
  expect(screen.getByText(/Running for 3s/)).toBeInTheDocument();
  vi.useRealTimers();
});

test('running 中断连(closed) → 停止跳秒,改显连接中断文案;恢复 open 后继续计时', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-18T00:00:00.000Z'));
  useStore.setState({ connStatus: 'open' });
  render(<TurnFooter turn={{ ...base, status: 'running', finishedAt: null }} />);
  act(() => { vi.advanceTimersByTime(2000); });
  expect(screen.getByText(/Running for 2s/)).toBeInTheDocument();
  // 断连:计时文案换成连接中断,秒表不再推进
  act(() => { useStore.setState({ connStatus: 'closed' }); });
  expect(screen.getByText(/Connection interrupted/)).toBeInTheDocument();
  // 重试期回到 connecting 也保持中断显示(闩住,避免退避循环里计时闪烁)
  act(() => { useStore.setState({ connStatus: 'connecting' }); });
  expect(screen.getByText(/Connection interrupted/)).toBeInTheDocument();
  // 恢复 open → 继续按真实时间计时
  act(() => { useStore.setState({ connStatus: 'open' }); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText(/Running for 3s/)).toBeInTheDocument();
  vi.useRealTimers();
  useStore.setState({ connStatus: 'connecting' });
});

test('首屏 connecting(从未失败) → 正常计时,不误报中断', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-18T00:00:04.000Z'));
  useStore.setState({ connStatus: 'connecting' });
  render(<TurnFooter turn={{ ...base, status: 'running', finishedAt: null }} />);
  expect(screen.getByText(/Running for 4s/)).toBeInTheDocument();
  vi.useRealTimers();
});

test('model 缺失 → 不渲染', () => {
  const { container } = render(<TurnFooter turn={{ ...base, model: null }} />);
  expect(container).toBeEmptyDOMElement();
});

test('running 且 model 缺失 → 仅计时(发送即开表,model 等 SystemMessage 回填)', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-18T00:00:05.000Z'));
  render(<TurnFooter turn={{ ...base, model: null, status: 'running', finishedAt: null }} />);
  expect(screen.getByText(/Running for 5s/)).toBeInTheDocument();
  vi.useRealTimers();
});

test('startedAt 缺失但已结束 → 仅模型名', () => {
  render(<TurnFooter turn={{ ...base, startedAt: null }} />);
  expect(screen.getByText('Opus 4.8')).toBeInTheDocument();
});

test('回放期 running → 以播放头(最近一帧 created_at)为计时终点,不用真实当前时间', async () => {
  const { useStore } = await import('@/store');
  useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's', total: 9, cursor: 2, speed: 1, playheadAt: '2026-06-18T00:00:07.000Z' } });
  render(<TurnFooter turn={{ ...base, status: 'running', finishedAt: null }} />);
  // startedAt 00:00:00 → 播放头 00:00:07 = 7s(真实时间远在其后,若误用会显示成数月)
  expect(screen.getByText(/Running for 7s/)).toBeInTheDocument();
  useStore.setState({ replay: null });
});

test('回放期 running 且播放头未就绪(首帧前)→ 回落纯 Running 文案,不计时', async () => {
  const { useStore } = await import('@/store');
  useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's', total: 9, cursor: 0, speed: 1 } });
  render(<TurnFooter turn={{ ...base, status: 'running', finishedAt: null }} />);
  expect(screen.getByText(/Running…/)).toBeInTheDocument();
  useStore.setState({ replay: null });
});
