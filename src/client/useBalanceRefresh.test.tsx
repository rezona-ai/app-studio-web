import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBalanceRefresh } from './useBalanceRefresh';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

// 可控的页面可见性:jsdom 默认恒 visible(同 useCanvasPolling 测试范式)
let visibility: DocumentVisibilityState = 'visible';
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

const genTask = { itemId: 'vid-1', kind: 'video' as const, taskId: 't1', startedAt: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    refreshBalance: vi.fn(),   // 只验触发时机,不验拉取内部
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useBalanceRefresh(在途兜底轮询)', () => {
  test('agent run 进行中:按 15s 间隔刷余额(一次 run 内多次扣费也能跟进)', () => {
    useStore.setState({ runStatus: 'running' } as never);
    renderHook(() => useBalanceRefresh());
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(useStore.getState().refreshBalance).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(useStore.getState().refreshBalance).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(useStore.getState().refreshBalance).toHaveBeenCalledTimes(2);
  });

  test('有在途生成任务时同样轮询', () => {
    useStore.setState({ genTasks: [genTask] } as never);
    renderHook(() => useBalanceRefresh());
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(useStore.getState().refreshBalance).toHaveBeenCalledTimes(1);
  });

  test('空闲(run idle 且无生成任务)不起 interval —— 空闲时零余额请求', () => {
    useStore.setState({ runStatus: 'idle', genTasks: [] } as never);
    renderHook(() => useBalanceRefresh());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(useStore.getState().refreshBalance).not.toHaveBeenCalled();
  });

  test('页面隐藏时不打后端', () => {
    useStore.setState({ runStatus: 'running' } as never);
    renderHook(() => useBalanceRefresh());
    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(useStore.getState().refreshBalance).not.toHaveBeenCalled();
  });

  test('转回可见立即补一轮,不等下个间隔', () => {
    useStore.setState({ runStatus: 'running' } as never);
    renderHook(() => useBalanceRefresh());
    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => { setVisibility('visible'); });
    expect(useStore.getState().refreshBalance).toHaveBeenCalledTimes(1);
  });

  test('run 结束后停止轮询(interval 随 active 撤销)', () => {
    useStore.setState({ runStatus: 'running' } as never);
    const { rerender } = renderHook(() => useBalanceRefresh());
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(useStore.getState().refreshBalance).toHaveBeenCalledTimes(1);
    act(() => { useStore.setState({ runStatus: 'idle' } as never); });
    rerender();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(useStore.getState().refreshBalance).toHaveBeenCalledTimes(1);
  });
});
