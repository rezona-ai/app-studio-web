import { beforeEach, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIsDark } from './useIsDark';

beforeEach(() => { document.documentElement.removeAttribute('data-theme'); });

test('无 data-theme(缺省)→ 深色', () => {
  expect(renderHook(() => useIsDark()).result.current).toBe(true);
});

test('data-theme=dark → 深色', () => {
  document.documentElement.dataset.theme = 'dark';
  expect(renderHook(() => useIsDark()).result.current).toBe(true);
});

test('data-theme=light → 非深色', () => {
  document.documentElement.dataset.theme = 'light';
  expect(renderHook(() => useIsDark()).result.current).toBe(false);
});

test('运行期改 data-theme → 快照随之更新(MutationObserver)', async () => {
  const { result } = renderHook(() => useIsDark());
  expect(result.current).toBe(true); // 缺省深色
  act(() => { document.documentElement.dataset.theme = 'light'; });
  // MutationObserver 异步投递,等回调触发 store 通知后重渲染
  await vi.waitFor(() => expect(result.current).toBe(false));
});
