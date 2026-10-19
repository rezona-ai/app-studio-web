import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTypewriter, TYPEWRITER } from './useTypewriter';

const shownOf = (v: { head: string; tail: { text: string }[] }) =>
  v.head + v.tail.map((c) => c.text).join('');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useTypewriter', () => {
  test('流式中逐字推进,最终揭示全文', () => {
    const { result } = renderHook(() => useTypewriter('hello', true));
    expect(shownOf(result.current)).toBe('');
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 10));
    expect(shownOf(result.current)).toBe('hello');
  });

  test('backlog 大时单 tick 揭示更多字(自适应追赶)', () => {
    const long = 'x'.repeat(80);
    const { result } = renderHook(() => useTypewriter(long, true));
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS));
    const step = Math.min(
      TYPEWRITER.MAX_STEP,
      Math.max(TYPEWRITER.MIN_STEP, Math.ceil(80 / TYPEWRITER.CATCHUP)),
    );
    expect(shownOf(result.current).length).toBe(step); // = 10,远大于 MIN_STEP
  });

  test('active 转 false 后把剩余打完,尾段毕业后清空', () => {
    const { result, rerender } = renderHook(
      ({ t, a }: { t: string; a: boolean }) => useTypewriter(t, a),
      { initialProps: { t: 'abcdef', a: true } },
    );
    // backlog=6 → step=ceil(6/8)=1,2 ticks 仅揭示 2 字,剩余 4 字留给 active=false 后打完
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 2));
    rerender({ t: 'abcdef', a: false });
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 20));
    expect(shownOf(result.current)).toBe('abcdef');
    act(() => vi.advanceTimersByTime(TYPEWRITER.FADE_MS * 2));
    expect(result.current.tail).toEqual([]);
    expect(result.current.head).toBe('abcdef');
  });

  test('首次挂载即非流式 → 立即全量,无逐字', () => {
    const { result } = renderHook(() => useTypewriter('done text', false));
    expect(result.current.head).toBe('done text');
    expect(result.current.tail).toEqual([]);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.head).toBe('done text');
  });

  test('prefers-reduced-motion → 全量无渐显,增量也即时全量', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, media: '', onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    }));
    const { result, rerender } = renderHook(
      ({ t }: { t: string }) => useTypewriter(t, true),
      { initialProps: { t: 'ab' } },
    );
    expect(result.current).toEqual({ head: 'ab', tail: [] });
    rerender({ t: 'abcd' });
    expect(result.current).toEqual({ head: 'abcd', tail: [] });
  });
});
