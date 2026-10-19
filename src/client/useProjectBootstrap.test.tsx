import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listProjects: vi.fn(), createProject: vi.fn(), createRemix: vi.fn(),
      listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
    },
  };
});

import { useProjectBootstrap } from './useProjectBootstrap';
import { useStore } from '@/store';
import { pgcApi } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const proj = (id: number) => ({
  id, public_id: `p${id}`, name: 'P', cover_url: null, cover_source: null,
  current_version_id: null, status: 'draft', created_at: '', updated_at: '',
});

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    composer: { draft: '', attachments: [], baseLines: 2 }, selectedModel: null, availableModels: [],
  });
  vi.clearAllMocks();
  api.updateCanvasReference.mockResolvedValue({});
  api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
  api.listVersions.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => vi.restoreAllMocks());

test('URL 带 prelude → 新建项目并预填,并补全用户全量列表', async () => {
  api.createProject.mockResolvedValue(proj(9));
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(5)], total: 2, page: 1, page_size: 100 });
  const assets = encodeURIComponent(JSON.stringify([{ url: 'https://cdn/a.png', kind: 'image' }]));
  window.history.replaceState(null, '', `/?model=claude-x&prompt=hi&assets=${assets}`);
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('Untitled game'));
  await waitFor(() => expect(api.listProjects).toHaveBeenCalled()); // 修复:进入后补全量列表,侧栏不再只剩新建项
  expect(useStore.getState().selectedModel).toBe('claude-x');
  expect(useStore.getState().composer.draft).toBe('hi');
  expect(useStore.getState().composer.attachments).toHaveLength(1);
});

test('URL 无 prelude → 走 loadProjects', async () => {
  api.listProjects.mockResolvedValue({ items: [proj(1)], total: 1, page: 1, page_size: 100 });
  window.history.replaceState(null, '', '/');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
  expect(api.createProject).not.toHaveBeenCalled();
});

test('URL 带 handoff 且 sessionStorage 有载荷 → 新建预填,key 被一次性消费', async () => {
  api.createProject.mockResolvedValue(proj(9));
  api.listProjects.mockResolvedValue({ items: [proj(9)], total: 1, page: 1, page_size: 100 });
  const id = '273d3861-c383-40a3-8a39-9c35041d4143';
  window.sessionStorage.setItem(`tln.game.handoff.${id}`, JSON.stringify({
    v: 1, model: 'claude-opus-4-8', prompt: '很长的提示词',
    assets: [{ url: 'https://cdn/file.pdf', kind: 'document', name: 'file.pdf' }],
    createdAt: 1720870000000,
  }));
  window.history.replaceState(null, '', `/?handoff=${id}`);
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('Untitled game'));
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
  await waitFor(() => expect(useStore.getState().composer.draft).toBe('很长的提示词'));
  expect(useStore.getState().composer.attachments).toHaveLength(1);
  expect(window.sessionStorage.getItem(`tln.game.handoff.${id}`)).toBeNull(); // 读后即删,防刷新重复新建
});

test('URL 带 handoff 但 key 缺失(如已被消费)→ 回落 loadProjects,不新建', async () => {
  api.listProjects.mockResolvedValue({ items: [proj(1)], total: 1, page: 1, page_size: 100 });
  window.history.replaceState(null, '', '/?handoff=gone-id');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
  expect(api.createProject).not.toHaveBeenCalled();
});

test('URL 带 remix → 进入即 fork,不预填,fork 后补全用户全量列表', async () => {
  api.createRemix.mockResolvedValue({
    project: proj(9), source_code: 's', source_version_id: 'sv', target_version_id: 'tv',
    play_url: '', working_preview_url: '',
  });
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(4)], total: 2, page: 1, page_size: 100 });
  window.history.replaceState(null, '', '/?remix=DakkYXUy');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.createRemix).toHaveBeenCalledWith({ source_code: 'DakkYXUy' }));
  await waitFor(() => expect(api.listProjects).toHaveBeenCalled()); // fork 成功后补全量列表(非走 loadProjects 兜底)
  expect(api.createProject).not.toHaveBeenCalled(); // 也不走 prelude 新建
});

test('URL 带 share → 进入即三步 fork(applyWorkbenchShare),不走 remix/loadProjects', async () => {
  const applyWorkbenchShare = vi.fn();
  useStore.setState({ applyWorkbenchShare } as never);
  window.history.replaceState(null, '', '/?share=ShAre123');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(applyWorkbenchShare).toHaveBeenCalledWith('ShAre123'));
  expect(api.createRemix).not.toHaveBeenCalled();
  expect(api.listProjects).not.toHaveBeenCalled();
});

test('URL 同时带 share 与 remix → share 优先,不 fork remix', async () => {
  const applyWorkbenchShare = vi.fn();
  useStore.setState({ applyWorkbenchShare } as never);
  window.history.replaceState(null, '', '/?share=ShAre123&remix=DakkYXUy');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(applyWorkbenchShare).toHaveBeenCalledWith('ShAre123'));
  expect(api.createRemix).not.toHaveBeenCalled();
});

test('URL 带 replay_template → 进入即回放,不走 loadProjects/remix', async () => {
  const enterReplay = vi.fn();
  useStore.setState({ enterReplay } as never);
  window.history.replaceState(null, '', '/?replay_template=tpl_9');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(enterReplay).toHaveBeenCalledWith('tpl_9'));
  expect(api.listProjects).not.toHaveBeenCalled();
  expect(api.createRemix).not.toHaveBeenCalled();
});
