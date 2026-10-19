import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// 保留真实导出(PgcError 供 instanceof),仅替换 api 方法为 mock(沿用 studio-prelude.test.ts 写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      createRemix: vi.fn(), listProjects: vi.fn(),
      listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
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
// createRemix 返回 RemixProjectData;本计划只用 data.project,其余字段填占位
const remixData = (id: number) => ({
  project: proj(id), source_code: 'SRC', source_version_id: 'sv', target_version_id: 'tv',
  play_url: '', working_preview_url: '',
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
  window.history.replaceState(null, '', '/?remix=DakkYXUy');
});
afterEach(() => vi.restoreAllMocks());

test('applyStudioRemix:fork 源项目 + 入列选中 + 剥离 remix 参 + 补全用户全量列表', async () => {
  api.createRemix.mockResolvedValue(remixData(9));
  // fork 成功后须补全用户其余项目,否则列表只剩新 fork 项目(bug #13088343 同源)
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(5), proj(3)], total: 3, page: 1, page_size: 100 });
  await useStore.getState().applyStudioRemix('DakkYXUy');
  const s = useStore.getState();
  expect(api.createRemix).toHaveBeenCalledWith({ source_code: 'DakkYXUy' }); // 只传 source_code
  expect(s.currentProjectId).toBe(9);                 // current 仍是新 fork,不被列表刷新改写
  expect(s.projects[0].id).toBe(9);                   // fork 入列头
  expect(s.projects.map((p) => p.id)).toEqual([9, 5, 3]); // 列表补齐为用户全量,非只剩 fork
  expect(window.location.search).toBe('?project=p9'); // remix 参被剥,仅留 ?project=<fork public_id>
  expect(s.booting).toBe(false);                      // remix 分支不经 loadProjects 的 finally,自行撤加载层
  expect(api.listProjects).toHaveBeenCalled();        // 成功路径也补全量列表
});

test('applyStudioRemix:fork 成功但补全量列表抛网络错 → 不抛、撤加载层、保留 fork 项', async () => {
  // refreshProjectList 是纯增强,非 PgcError(如网络 TypeError)也必须被吞,
  // 否则会跳过 set({ booting:false }) 卡住加载层(codex review Important)
  api.createRemix.mockResolvedValue(remixData(9));
  api.listProjects.mockRejectedValue(new TypeError('fetch failed'));
  await expect(useStore.getState().applyStudioRemix('DakkYXUy')).resolves.toBeUndefined(); // 不抛
  const s = useStore.getState();
  expect(s.currentProjectId).toBe(9);   // fork 项仍选中
  expect(s.projects[0].id).toBe(9);     // 列表至少保留 fork 项(冷启动并入)
  expect(s.booting).toBe(false);        // 加载层已撤,不卡住
});

test('applyStudioRemix:fork 失败(REMIX_NOT_AVAILABLE)→ Toast + 兜底 loadProjects', async () => {
  api.createRemix.mockRejectedValue(new PgcError('REMIX_NOT_AVAILABLE', 'not available', 400));
  api.listProjects.mockResolvedValue({ items: [proj(1)], total: 1, page: 1, page_size: 100 });
  await useStore.getState().applyStudioRemix('x');
  const s = useStore.getState();
  expect(s.toast?.code).toBe('REMIX_NOT_AVAILABLE'); // guard 透传后端 code
  expect(api.listProjects).toHaveBeenCalled();           // 兜底拉用户项目
  expect(s.currentProjectId).toBe(1);                    // 落在自己的项目,非空工作台
  expect(s.booting).toBe(false);
  expect(window.location.search).not.toContain('remix');  // ?remix= 已剥,刷新不重复 fork
});

test('applyStudioRemix:老用户(currentProjectId 已回灌)fork 失败 → 仍兜底 loadProjects,不滞留旧项目', async () => {
  // 模拟 persist 回灌:进入前 currentProjectId 已是旧项目;fork 失败不能据此误判为成功
  useStore.setState({ currentProjectId: 99 });
  api.createRemix.mockRejectedValue(new PgcError('REMIX_NOT_AVAILABLE', 'not available', 400));
  api.listProjects.mockResolvedValue({ items: [proj(1)], total: 1, page: 1, page_size: 100 });
  await useStore.getState().applyStudioRemix('x');
  const s = useStore.getState();
  expect(api.listProjects).toHaveBeenCalled();           // 走了兜底
  expect(s.currentProjectId).toBe(1);                     // 落在用户自己的项目,非滞留旧 99
  expect(s.toast?.code).toBe('REMIX_NOT_AVAILABLE');
  expect(window.location.search).not.toContain('remix');  // ?remix= 已剥,刷新不重复 fork
  expect(s.booting).toBe(false);
});

test('applyStudioRemix:fork 失败 401 → 置 authRequired,不写 toast', async () => {
  api.createRemix.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  api.listProjects.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401)); // 兜底同样 401
  await useStore.getState().applyStudioRemix('x');
  const s = useStore.getState();
  expect(s.authRequired).toBe(true);
  expect(s.toast).toBeNull(); // 401 只置 authRequired,不弹红色报错
});
