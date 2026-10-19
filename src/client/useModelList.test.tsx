import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useModelList } from './useModelList';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';

beforeEach(() => useStore.setState({ availableModels: [], selectedModel: null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('挂载拉取模型写入 store,默认选首项', async () => {
  vi.spyOn(koubouApi, 'listModels').mockResolvedValue(['claude-opus-4-8', 'claude-fable-5']);
  renderHook(() => useModelList());
  await waitFor(() => expect(useStore.getState().availableModels).toHaveLength(2));
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
});

test('拉取失败静默,列表保持空', async () => {
  vi.spyOn(koubouApi, 'listModels').mockRejectedValue(new Error('down'));
  renderHook(() => useModelList());
  await waitFor(() => expect(koubouApi.listModels).toHaveBeenCalled());
  expect(useStore.getState().availableModels).toEqual([]);
});
