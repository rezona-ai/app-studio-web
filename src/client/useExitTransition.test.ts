import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExitTransition } from './useExitTransition';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useExitTransition', () => {
  test('open=true 立即挂载且非 closing', () => {
    const { result } = renderHook(() => useExitTransition(true, 200));
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  test('open 转 false:先 closing 仍挂载,延时后卸载', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitTransition(open, 200),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  test('退场途中重新 open:取消卸载,恢复挂载', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitTransition(open, 200),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(100));
    rerender({ open: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  test('prefers-reduced-motion:退场延时视为 0,立即卸载', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitTransition(open, 200),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.mounted).toBe(false);
  });
});
