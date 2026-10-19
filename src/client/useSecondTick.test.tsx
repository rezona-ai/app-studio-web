import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSecondTick } from './useSecondTick';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

describe('useSecondTick', () => {
  test('enabled=false 时不注册定时器', () => {
    renderHook(() => useSecondTick(false));
    expect(vi.getTimerCount()).toBe(0);
  });

  test('enabled=true 每秒推进返回值', () => {
    const { result } = renderHook(() => useSecondTick(true));
    const t0 = result.current;
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current - t0).toBe(2_000);
  });

  // 约束 5:不做每卡一个计时器 —— N 个订阅者共用一个 interval
  test('多个订阅者只有一个定时器', () => {
    renderHook(() => useSecondTick(true));
    renderHook(() => useSecondTick(true));
    renderHook(() => useSecondTick(true));
    expect(vi.getTimerCount()).toBe(1);
  });

  test('最后一个订阅者卸载后定时器被清掉', () => {
    const a = renderHook(() => useSecondTick(true));
    const b = renderHook(() => useSecondTick(true));
    a.unmount();
    expect(vi.getTimerCount()).toBe(1);
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('enabled 由 true 转 false 等同退订', () => {
    const { rerender } = renderHook(({ on }) => useSecondTick(on), { initialProps: { on: true } });
    expect(vi.getTimerCount()).toBe(1);
    rerender({ on: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
