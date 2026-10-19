import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import ReconnectBanner from './ReconnectBanner';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';

afterEach(cleanup);

// 造一个只含 reconnect 的假 client ref
function fakeClient() {
  const reconnect = vi.fn();
  return { ref: { current: { reconnect } as unknown as KoubouClient }, reconnect };
}

test('open → 不渲染', () => {
  useStore.setState({ connStatus: 'open' });
  const { container } = render(<ReconnectBanner client={fakeClient().ref} />);
  expect(container.firstChild).toBeNull();
});

// superseded 原先只有 4s toast 即成死胡同(唤醒重连刻意排除它,用户只能刷新);
// 改为常驻横幅 + 「在此标签页继续」按钮手动抢回属主(spec 2026-07-22 chat-conn-resilience)
test('superseded → 常驻提示 + 「在此标签页继续」按钮,点击调 reconnect 抢回', () => {
  useStore.setState({ connStatus: 'superseded' });
  const c = fakeClient();
  render(<ReconnectBanner client={c.ref} />);
  expect(screen.getByText('Opened in another tab — this tab is paused.')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Continue here' }).click();
  expect(c.reconnect).toHaveBeenCalledTimes(1);
});

test('初次 connecting(从未 open 过) → 不渲染,避免首屏误报', () => {
  useStore.setState({ connStatus: 'connecting' });
  const { container } = render(<ReconnectBanner client={fakeClient().ref} />);
  expect(container.firstChild).toBeNull();
});

test('从未 open 但首连已失败(error) → 显示重连中(不再被首屏抑制吞掉)', () => {
  useStore.setState({ connStatus: 'connecting' });
  const { rerender } = render(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.queryByRole('status')).toBeNull();
  // 首连失败:error → 退避期 connecting,横条应持续显示重连中
  act(() => { useStore.setState({ connStatus: 'error' }); });
  rerender(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.getByText('Reconnecting… messages will send once reconnected')).toBeInTheDocument();
  act(() => { useStore.setState({ connStatus: 'connecting' }); });
  rerender(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.getByText('Reconnecting… messages will send once reconnected')).toBeInTheDocument();
});

test('曾 open 后断开(closed) → 显示重连中,无重连按钮', () => {
  useStore.setState({ connStatus: 'open' });
  const { rerender } = render(<ReconnectBanner client={fakeClient().ref} />);
  act(() => { useStore.setState({ connStatus: 'closed' }); });
  rerender(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.getByText('Reconnecting… messages will send once reconnected')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
});

test('stalled → 显示已断开 + 重连按钮,点击调 reconnect', () => {
  useStore.setState({ connStatus: 'stalled' });
  const c = fakeClient();
  render(<ReconnectBanner client={c.ref} />);
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Reconnect' }).click();
  expect(c.reconnect).toHaveBeenCalledTimes(1);
});

test('fatal → 显示重连按钮', () => {
  useStore.setState({ connStatus: 'fatal' });
  render(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
});
