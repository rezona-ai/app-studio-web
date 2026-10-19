import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// 保留真实导出(PgcError 供 instanceof),仅替换 api 方法为 mock(沿用 actions.test.ts 写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      createProject: vi.fn(), listProjects: vi.fn(), listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
    },
  };
});

import { useStore } from './index';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const proj = (id: number) => ({
  id, public_id: `p${id}`, name: 'P', cover_url: null, cover_source: null,
  current_version_id: null, status: 'draft', created_at: '', updated_at: '',
});

beforeEach(() => {
  // 须连 composer/selectedModel 一并重置(不在 koubou/server initial 内)
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    composer: { draft: '', attachments: [], baseLines: 2 }, selectedModel: null, availableModels: [],
    modelByProject: {},
    autoSendArmed: false,
  });
  vi.clearAllMocks();
  api.updateCanvasReference.mockResolvedValue({});
  api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
  api.listVersions.mockResolvedValue({ items: [], total: 0 });
  api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  window.history.replaceState(null, '', '/?model=m&prompt=p&assets=x');
});
afterEach(() => vi.restoreAllMocks());

test('applyStudioPrelude:新建项目 + 预填模型/输入框/资产 + 剥离 URL', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({
    model: 'claude-x',
    prompt: 'make a game',
    assets: [
      { url: 'https://cdn/hero.png?v=1', kind: 'image', name: 'Hero' },
      { url: 'https://cdn/clip.mp4', kind: 'video' },
    ],
  });
  const s = useStore.getState();
  expect(api.createProject).toHaveBeenCalledWith('Untitled game'); // 强制新建(默认名)
  expect(s.currentProjectId).toBe(9);
  expect(s.selectedModel).toBe('claude-x');
  expect(s.composer.draft).toBe('make a game');
  expect(s.composer.attachments).toHaveLength(2);
  expect(s.composer.attachments[0]).toMatchObject({ kind: 'image', status: 'ready', url: 'https://cdn/hero.png?v=1', name: 'Hero' });
  expect(s.composer.attachments[0].itemId).toBeUndefined(); // 无 itemId → 移除不会误删 PGC
  expect(s.composer.attachments[1]).toMatchObject({ kind: 'video', status: 'ready', name: 'clip.mp4' }); // 文件名兜底
  // URL 收敛:prelude 参数被剥离,仅留 ?project=<public_id>
  expect(window.location.search).toBe('?project=p9');
  expect(s.booting).toBe(false); // prelude 分支不经 loadProjects 的 finally,须自行撤加载层
});

test('applyStudioPrelude:新建后补全用户全量项目列表(bug #13088343)', async () => {
  // 复现修复:从 Studio 带参进入会 force-create 新项目,列表须仍含用户其余项目,而非只剩新建项
  api.createProject.mockResolvedValue(proj(9));
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(7), proj(2)], total: 3, page: 1, page_size: 100 });
  await useStore.getState().applyStudioPrelude({ prompt: 'make a game', assets: [] });
  const s = useStore.getState();
  expect(api.listProjects).toHaveBeenCalled();             // 新建后补拉全量
  expect(s.currentProjectId).toBe(9);                       // current 仍是新建项,不被列表刷新改写
  expect(s.projects.map((p) => p.id)).toEqual([9, 7, 2]);   // 列表补齐为全量,非只剩新建的 [9]
  expect(s.composer.draft).toBe('make a game');             // 预填不被破坏
});

test('applyStudioPrelude:model 缺省 → 不改 selectedModel', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({ prompt: 'hi', assets: [] });
  expect(useStore.getState().selectedModel).toBeNull();
  expect(useStore.getState().composer.draft).toBe('hi');
});

test('applyStudioPrelude:模型在 createProject 前写入(建连竞态)', async () => {
  // 复现 bug:currentProjectId 一落地 useKoubouConnection 即建连并读 selectedModel,
  // 若模型在 createProject 之后才写入,建连 URL 会带上旧模型 → 主站选 A 实际用 B
  let modelAtCreate: string | null = 'sentinel';
  api.createProject.mockImplementation(() => {
    modelAtCreate = useStore.getState().selectedModel;
    return Promise.resolve(proj(9));
  });
  await useStore.getState().applyStudioPrelude({ model: 'claude-x', prompt: 'hi', assets: [] });
  expect(modelAtCreate).toBe('claude-x');
});

test('applyStudioPrelude:model 在 pid 落地后补落 modelByProject(按项目记忆)', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({ model: 'claude-x', prompt: 'hi', assets: [] });
  expect(useStore.getState().modelByProject['9']).toBe('claude-x');
});

test('applyStudioPrelude:有 prompt → armed 自动发送', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({ prompt: 'make a game', assets: [] });
  expect(useStore.getState().autoSendArmed).toBe(true);
});

test('applyStudioPrelude:仅 assets(无 prompt) → armed 自动发送', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({ assets: [{ url: 'https://x/a.png', kind: 'image' }] });
  expect(useStore.getState().autoSendArmed).toBe(true);
});

test('applyStudioPrelude:仅 model(无可发送内容) → 不 armed,仍切模型', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({ model: 'claude-x', assets: [] });
  expect(useStore.getState().autoSendArmed).toBe(false);
  expect(useStore.getState().selectedModel).toBe('claude-x');
});

test('applyStudioPrelude:createProject 失败 → 不 armed', async () => {
  api.createProject.mockRejectedValue(new PgcError('INTERNAL', 'boom', 500));
  await useStore.getState().applyStudioPrelude({ prompt: 'hi', assets: [] });
  expect(useStore.getState().autoSendArmed).toBe(false);
});

test('applyStudioPrelude:createProject 失败 → 不预填,置 toast,撤加载层', async () => {
  api.createProject.mockRejectedValue(new PgcError('INTERNAL', 'boom', 500));
  await useStore.getState().applyStudioPrelude({
    model: 'claude-x', prompt: 'hi', assets: [{ url: 'https://x/a.png', kind: 'image' }],
  });
  const s = useStore.getState();
  expect(s.currentProjectId).toBeNull();
  expect(s.composer.draft).toBe('');
  expect(s.composer.attachments).toEqual([]);
  expect(s.selectedModel).toBe('claude-x'); // 模型是入口意图,建项目失败也保留(建连时须用主站所选)
  expect(s.toast?.code).toBe('INTERNAL');
  expect(s.booting).toBe(false);
});
