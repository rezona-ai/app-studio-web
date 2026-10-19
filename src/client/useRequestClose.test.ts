import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRequestClose } from './useRequestClose';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useRequestClose', () => {
  test('requestClose:先 closing,延时后调用 onClose 并复位', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useRequestClose(onClose, 200));
    expect(result.current.closing).toBe(false);

    act(() => result.current.requestClose());
    expect(result.current.closing).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.closing).toBe(false);
  });

  test('退场途中重复 requestClose 不重复计时/重复关闭', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useRequestClose(onClose, 200));
    act(() => { result.current.requestClose(); result.current.requestClose(); });
    act(() => vi.advanceTimersByTime(200));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('prefers-reduced-motion:退场延时视为 0,立即关闭', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    const onClose = vi.fn();
    const { result } = renderHook(() => useRequestClose(onClose, 200));
    act(() => result.current.requestClose());
    act(() => vi.advanceTimersByTime(0));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
