import { afterEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useUserInfo } from './useUserInfo';
import { useStore } from '@/store';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('挂载触发一次 loadUserInfo', async () => {
  const spy = vi.spyOn(useStore.getState(), 'loadUserInfo').mockResolvedValue();
  renderHook(() => useUserInfo());
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
});

test('loadUserInfo 拒绝时不抛(渲染不崩)', () => {
  vi.spyOn(useStore.getState(), 'loadUserInfo').mockRejectedValue(new Error('down'));
  expect(() => renderHook(() => useUserInfo())).not.toThrow();
});
