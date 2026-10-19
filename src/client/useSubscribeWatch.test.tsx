import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubscribeWatch } from './useSubscribeWatch';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const poll = vi.fn();
const order = { id: 's1', tier: 'creator' as const, startedAt: 0, messages: { active: 'a', closed: 'c' } };

// document.visibilityState 只读:用 defineProperty 覆盖
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
};

beforeEach(() => {
  vi.useFakeTimers();
  poll.mockReset();
  setVisibility('visible');
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    pollSubscribeOrder: poll,
  } as never);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useSubscribeWatch(在飞订阅单的轮询驱动)', () => {
  test('无在飞单:不建 interval,零请求', () => {
    renderHook(() => useSubscribeWatch());
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(poll).not.toHaveBeenCalled();
  });

  test('有在飞单:按 3s 节奏推进', () => {
    useStore.setState({ subscribeOrder: order } as never);
    renderHook(() => useSubscribeWatch());
    act(() => { vi.advanceTimersByTime(3000); });
    expect(poll).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  test('收单后停:interval 存活期内也不再打(tick 内二次读现值)', () => {
    useStore.setState({ subscribeOrder: order } as never);
    renderHook(() => useSubscribeWatch());
    act(() => { vi.advanceTimersByTime(3000); });
    expect(poll).toHaveBeenCalledTimes(1);
    act(() => { useStore.setState({ subscribeOrder: null } as never); });
    act(() => { vi.advanceTimersByTime(9000); });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  // 用户此刻多半在收银台标签页:hidden 不打后端,切回可见立即补一轮(不等下个间隔)
  test('后台标签页不打后端;转回可见立即补一轮', () => {
    useStore.setState({ subscribeOrder: order } as never);
    renderHook(() => useSubscribeWatch());
    setVisibility('hidden');
    act(() => { vi.advanceTimersByTime(9000); });
    expect(poll).not.toHaveBeenCalled();

    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  // 关键:弹窗卸载与本 hook 无关——它挂在 Workspace 上,支付期间关窗不影响轮询
  test('轮询不依赖弹窗:本 hook 只看 store 里的在飞单', () => {
    useStore.setState({ subscribeOrder: order, creditModalOpen: false } as never);
    renderHook(() => useSubscribeWatch());
    act(() => { vi.advanceTimersByTime(3000); });
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
