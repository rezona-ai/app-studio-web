import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useStore } from '@/store';
import { createInitialKoubouState } from './types';

// 乐观发送计时的超时兜底:run.started 永不到达时不能让骨架+计时永挂(spec 2026-07-22 chat-conn-resilience)

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ ...createInitialKoubouState(), toast: null });
});
afterEach(() => vi.useRealTimers());

test('置位 45s 后 run 仍未开跑 → 清计时 + SEND_TIMEOUT 提示', () => {
  useStore.getState().markPendingSend({ content: 'hi' });
  expect(useStore.getState().pendingSendAt).not.toBeNull();
  vi.advanceTimersByTime(45_000);
  expect(useStore.getState().pendingSendAt).toBeNull();
  expect(useStore.getState().toast).toMatchObject({ code: 'SEND_TIMEOUT' });
});

test('run.started 及时到达(pendingSendAt 已被清)→ 超时不误触发', () => {
  useStore.getState().markPendingSend({ content: 'hi' });
  useStore.getState().ingestKoubou({ type: 'run.started', project_id: '1', session_id: 's', sequence: 1, payload: { run_id: 'r1' } } as never);
  expect(useStore.getState().pendingSendAt).toBeNull();
  vi.advanceTimersByTime(60_000);
  expect(useStore.getState().toast).toBeNull();
});

test('超时前再次发送(新时间戳)→ 旧定时器不误清新计时', () => {
  useStore.getState().markPendingSend({ content: 'hi' });
  vi.advanceTimersByTime(30_000);
  useStore.getState().markPendingSend({ content: 'hi' });   // 第二次发送,刷新时间戳
  const stamp = useStore.getState().pendingSendAt;
  vi.advanceTimersByTime(20_000);          // 旧定时器到点(50s>45s),新的还没到(20s)
  expect(useStore.getState().pendingSendAt).toBe(stamp);
  expect(useStore.getState().toast).toBeNull();
});
