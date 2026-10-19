import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// 保留真实导出(尤其 PgcError 供 instanceof),仅替换 api 方法为 mock
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listProjects: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), autoNameProject: vi.fn(), deleteProject: vi.fn(),
      listCanvasItems: vi.fn(), deleteCanvasItem: vi.fn(),
      pollVideo: vi.fn(), pollModel3d: vi.fn(), updateCanvasReference: vi.fn(), batchUpdateCanvasItems: vi.fn(),
      listVersions: vi.fn(), previewVersion: vi.fn(),
      writeCanvasItemFromUrl: vi.fn(),
      createTextItem: vi.fn(),
      getCurrentUser: vi.fn(), getBalance: vi.fn(),
      rezona: { binding: vi.fn(), bind: vi.fn(), pollBind: vi.fn(), unbind: vi.fn(), publish: vi.fn() },
      startReplay: vi.fn(), finalizeReplay: vi.fn(), updateReplayState: vi.fn(),
    },
    uploadCanvasItem: vi.fn(),
    downloadVersion: vi.fn(),
    importProjectArchive: vi.fn(),
  };
});

// 该文件此前未 mock koubou client;enterReplay 编排需要 cloneFromTemplate/listSessions,故补一个最小 mock
// (KoubouError 用本地假类保留 instanceof 可用,不依赖真实实现)
vi.mock('@/lib/koubou/client', () => ({
  koubouApi: { cloneFromTemplate: vi.fn(), listSessions: vi.fn(), listEvents: vi.fn() },
  KoubouError: class extends Error {
    constructor(public code: number, m: string, public status: number) { super(m); }
  },
}));

import { useStore } from './index';
import { pgcApi, PgcError, uploadCanvasItem, importProjectArchive } from '@/lib/pgc/client';
import { koubouApi, KoubouError } from '@/lib/koubou/client';
import { createInitialKoubouState, createInitialServerState, type Message, type Asset } from './types';
import type { ServerEvent } from '@/koubou/protocol';
import { GAP_Y, CARD_SIZE } from '@/lib/card-layout';
import { makeAsset } from '@/lib/assets';
import { assetReference } from '@/lib/pgc/map';
import { remixToggleState } from '@/lib/remix-policy';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const uploadMock = uploadCanvasItem as unknown as ReturnType<typeof vi.fn>;

// reference 回写有两条通路:坐标 / 创建落位 / agent 收养卡走**批量端点**
// (spec 2026-08-05-canvas-batch-position),对话附件等仍走单条 PATCH。断言时两条都要看。
// 按 invocationCallOrder 归并成真实调用序 —— 直接拼两个数组会让「批量」永远显得更晚,
// 同一张卡先后走了两条通路时 `.at(-1)` 就会静默返回错的那次
const refWrites = (itemId: string): unknown[] => {
  const rows: { order: number; ref: unknown }[] = [];
  api.updateCanvasReference.mock.calls.forEach((c, i) => {
    if (c[1] === itemId) rows.push({ order: api.updateCanvasReference.mock.invocationCallOrder[i], ref: c[2] });
  });
  api.batchUpdateCanvasItems.mock.calls.forEach((c, i) => {
    for (const it of c[1] as { item_id: string; reference?: unknown }[]) {
      if (it.item_id === itemId) rows.push({ order: api.batchUpdateCanvasItems.mock.invocationCallOrder[i], ref: it.reference });
    }
  });
  return rows.sort((a, b) => a.order - b.order).map((r) => r.ref);
};
const refWriteFor = (itemId: string) => refWrites(itemId).at(-1) as Record<string, unknown> | undefined;
// 两条通路上被回写过的 item id(可能含重复;调用方只按集合比对,不依赖顺序)
const refWrittenIds = (): string[] => [
  ...api.updateCanvasReference.mock.calls.map((c) => c[1] as string),
  ...api.batchUpdateCanvasItems.mock.calls.flatMap((c) => (c[1] as { item_id: string }[]).map((i) => i.item_id)),
];

// 测试用 ProjectData 工厂:内部标识数值 id;public_id 取 `p<id>`(供 URL 展示层解析)
const proj = (id: number, name = 'P') => ({
  id, public_id: `p${id}`, name, cover_url: null, cover_source: null,
  current_version_id: null, status: 'draft', created_at: '', updated_at: '',
});

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  vi.clearAllMocks();
  // placeAndLink 对新资产 fire-and-forget 回写坐标;clearAllMocks 会清返回值,故默认返回 Promise 兜底
  api.updateCanvasReference.mockResolvedValue({});
  api.batchUpdateCanvasItems.mockResolvedValue({ updated: 0, failed: [] });
  window.history.replaceState(null, '', '/');
});
afterEach(() => vi.restoreAllMocks());

describe('importFromLiveEvent(实时 WS 资产帧)', () => {
  const userToolResult = (content: string): ServerEvent => ({
    type: 'claude.message', project_id: '42', session_id: 's1',
    payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', content }] } },
  } as unknown as ServerEvent);

  test('实时 media 帧 → 调 writeCanvasItemFromUrl(name=basename)', async () => {
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 'ci1', kind: 'image', name: 'hero.png', canvas_x: 0, canvas_y: 0 });
    useStore.setState({ currentProjectId: 42 });
    useStore.getState().importFromLiveEvent(userToolResult(JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/hero.png', preview_url: 'https://x/hero.png' }] })));
    await vi.waitFor(() => expect(api.writeCanvasItemFromUrl).toHaveBeenCalled());
    expect(api.writeCanvasItemFromUrl.mock.calls[0][1]).toMatchObject({ name: 'hero.png', type: 'image' });
  });

  test('实时 video task 帧 → 调 pollVideo(pid, taskId)', async () => {
    api.pollVideo.mockResolvedValue({});
    useStore.setState({ currentProjectId: 42 });
    useStore.getState().importFromLiveEvent(userToolResult(JSON.stringify({ type: 'media.task_submitted', task_id: 'gt1', kind: 'video' })));
    await vi.waitFor(() => expect(api.pollVideo).toHaveBeenCalledWith(42, 'gt1'));
  });

  test('非资产帧(session.ready)不触发导入/登记', async () => {
    useStore.setState({ currentProjectId: 42 });
    useStore.getState().importFromLiveEvent({ type: 'session.ready', project_id: '42', session_id: 's1', payload: {} } as ServerEvent);
    await Promise.resolve();
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
    expect(api.pollVideo).not.toHaveBeenCalled();
  });
});

describe('loadUserInfo(预览区账户条)', () => {
  test('并发成功写入 userInfo 与 credit', async () => {
    api.getCurrentUser.mockResolvedValue({ id: 7, username: 'nick', display_name: 'Nick' });
    api.getBalance.mockResolvedValue({ balance: 120, held: 20, spendable: 100 });
    await useStore.getState().loadUserInfo();
    expect(useStore.getState().userInfo?.display_name).toBe('Nick');
    expect(useStore.getState().credit?.balance).toBe(120);
  });

  test('一方失败仍写另一方,且不触发 authRequired / toast(非关键信息静默)', async () => {
    api.getCurrentUser.mockResolvedValue({ id: 7, username: 'nick' });
    api.getBalance.mockRejectedValue(new PgcError('SERVER', 'x', 500));
    await useStore.getState().loadUserInfo();
    expect(useStore.getState().userInfo?.id).toBe(7);
    expect(useStore.getState().credit).toBeNull();
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().toast).toBeNull();
  });

  test('401 也静默,不置 authRequired(账户条不抢登录跳转判定)', async () => {
    api.getCurrentUser.mockRejectedValue(new PgcError('UNAUTHENTICATED', '未登录', 401));
    api.getBalance.mockRejectedValue(new PgcError('UNAUTHENTICATED', '未登录', 401));
    await useStore.getState().loadUserInfo();
    expect(useStore.getState().authRequired).toBe(false);
  });
});

describe('refreshBalance(消耗后动态刷新余额)', () => {
  test('成功写入 credit,只打 balance 不打 /auth/me', async () => {
    api.getBalance.mockResolvedValue({ balance: 80, held: 0, spendable: 80 });
    await useStore.getState().refreshBalance();
    expect(useStore.getState().credit?.balance).toBe(80);
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  test('失败静默:不抛、不写 toast、不置 authRequired', async () => {
    useStore.setState({ credit: { balance: 5, held: 0, spendable: 5 } });
    api.getBalance.mockRejectedValue(new PgcError('UNAUTHENTICATED', '未登录', 401));
    await expect(useStore.getState().refreshBalance()).resolves.toBeUndefined();
    expect(useStore.getState().credit?.balance).toBe(5);   // 保留旧值,不抹成 null
    expect(useStore.getState().toast).toBeNull();
    expect(useStore.getState().authRequired).toBe(false);
  });

  test('在飞合流:并发多次只发一个请求(多任务同时完成不打一串同样的请求)', async () => {
    let release: (v: unknown) => void = () => {};
    api.getBalance.mockReturnValue(new Promise((r) => { release = r; }));
    const a = useStore.getState().refreshBalance();
    const b = useStore.getState().refreshBalance();
    release({ balance: 42, held: 0, spendable: 42 });
    await Promise.all([a, b]);
    expect(api.getBalance).toHaveBeenCalledTimes(1);
    expect(useStore.getState().credit?.balance).toBe(42);
  });

  test('前一轮结束后可再次发起(在飞标记已释放)', async () => {
    api.getBalance.mockResolvedValue({ balance: 1, held: 0, spendable: 1 });
    await useStore.getState().refreshBalance();
    api.getBalance.mockResolvedValue({ balance: 2, held: 0, spendable: 2 });
    await useStore.getState().refreshBalance();
    expect(api.getBalance).toHaveBeenCalledTimes(2);
    expect(useStore.getState().credit?.balance).toBe(2);
  });
});

describe('项目 actions', () => {
  test('loadProjects 写入 projects;无当前项目时自动选第一个并拉画布/版本', async () => {
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A')], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().projects).toHaveLength(1);
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(api.listCanvasItems).toHaveBeenCalledWith(7);
  });

  test('loadProjects 拉到空列表 → 自动以默认名建项目并落地 currentProjectId', async () => {
    api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    api.createProject.mockResolvedValue(proj(99, 'Untitled game'));
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.createProject).toHaveBeenCalledWith('Untitled game');
    expect(useStore.getState().currentProjectId).toBe(99);
    expect(useStore.getState().projects).toEqual([expect.objectContaining({ id: 99 })]);
  });

  test('并发两次 loadProjects(空列表)→ 只建一个项目(重入护卫)', async () => {
    api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    api.createProject.mockResolvedValue(proj(99, 'Untitled game'));
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await Promise.all([useStore.getState().loadProjects(), useStore.getState().loadProjects()]);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(useStore.getState().projects).toHaveLength(1);
  });

  test('loadProjects 拉到非空列表 → 不触发自动建项目', async () => {
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A')], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(useStore.getState().currentProjectId).toBe(7);
  });

  test('selectProject 切换时同步清空上一项目会话态(messages/sessionId/lastSequence),避免旧会话残留致跨项目误导入', async () => {
    // 项目 1 的会话残留:一条带 ready media 的消息 + 会话标识
    const sessionMsgs: Message[] = [{ id: 'm1', role: 'assistant', status: 'ready', parts: [
      { type: 'tool', id: 't1', name: 'gen', input: {}, status: 'ready', media: [{ kind: 'image', path: 'assets/hero.png', previewUrl: 'https://x/preview/hero.png' }] },
    ] }];
    useStore.setState({ currentProjectId: 1, projects: [proj(1), proj(2)], sessionId: 'sess-1', lastSequence: 5, messages: sessionMsgs });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(2);
    // 切到项目 2 后,上一项目会话必须已清空(随后由 switchProjectSession 载入项目 2 的真实快照),否则实时导入会把项目 1 的 media 误导入项目 2
    expect(useStore.getState().messages).toEqual([]);
    expect(useStore.getState().sessionId).toBeNull();
    expect(useStore.getState().lastSequence).toBe(0);
  });

  test('createProject 后切到新项目', async () => {
    api.createProject.mockResolvedValue(proj(9, 'New'));
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().createProject('New');
    expect(useStore.getState().currentProjectId).toBe(9);
    expect(useStore.getState().projects.find((p) => p.id === 9)).toBeTruthy();
  });

  test('deleteProject 移除并切到剩余项目', async () => {
    useStore.setState({ projects: [proj(1, 'A'), proj(2, 'B')], currentProjectId: 1 });
    api.deleteProject.mockResolvedValue({ id: 1 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().deleteProject(1);
    expect(useStore.getState().projects.map((p) => p.id)).toEqual([2]);
    expect(useStore.getState().currentProjectId).toBe(2);
  });

  test('deleteProject 一并清掉该项目的 agentTasksByProject 分桶', async () => {
    api.listProjects.mockResolvedValue({ items: [proj(7), proj(8)], total: 2, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    api.deleteProject.mockResolvedValue({ id: 8 });
    useStore.setState({ projects: [proj(7), proj(8)], currentProjectId: 7, agentTasksByProject: { '7': ['gt7'], '8': ['gt8'] } });
    await useStore.getState().deleteProject(8);
    expect(useStore.getState().agentTasksByProject).toEqual({ '7': ['gt7'] });
  });

  test('action 抛非 401 PgcError 时写 toast 不抛出', async () => {
    api.listProjects.mockRejectedValue(new PgcError('INTERNAL', '服务器错误', 500));
    await useStore.getState().loadProjects();
    expect(useStore.getState().toast?.code).toBe('INTERNAL');
  });

  test('loadProjects 遇 401 只置 authRequired,不写 toast(未登录不报错)', async () => {
    api.listProjects.mockRejectedValue(new PgcError('UNAUTHORIZED', '未授权', 401));
    await useStore.getState().loadProjects();
    expect(useStore.getState().authRequired).toBe(true);
    expect(useStore.getState().toast).toBeNull();
  });

  test('loadProjects 遇 403(已登录无权限)不置 authRequired', async () => {
    api.listProjects.mockRejectedValue(new PgcError('FORBIDDEN', '无权限', 403));
    await useStore.getState().loadProjects();
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().toast?.code).toBe('FORBIDDEN');
  });

  test('积分不足 PgcError → 开模态(来源 insufficient)且不写 toast', async () => {
    api.listProjects.mockRejectedValue(new PgcError('CREDIT_INSUFFICIENT', 'no credits', 402));
    await useStore.getState().loadProjects();
    expect(useStore.getState().creditModalOpen).toBe('insufficient');
    expect(useStore.getState().toast).toBeNull();
  });

  test('setCreditModalOpen(false) 关闭模态', () => {
    useStore.setState({ creditModalOpen: 'insufficient' });
    useStore.getState().setCreditModalOpen(false);
    expect(useStore.getState().creditModalOpen).toBe(false);
  });

  test('live credit.insufficient 帧 → 开模态;重放同 sequence 不二次触发', () => {
    const e = { type: 'credit.insufficient', session_id: 's1', sequence: 9, payload: {}, run_id: null } as ServerEvent;
    useStore.getState().ingestKoubou(e);
    expect(useStore.getState().creditModalOpen).toBe('insufficient');
    useStore.getState().setCreditModalOpen(false);
    useStore.getState().ingestKoubou(e);   // 重连重放同一帧
    expect(useStore.getState().creditModalOpen).toBe(false);
  });

  test('loadProjects:URL ?project(public_id)优先于持久化的 currentProjectId,解析为数值 id', async () => {
    window.history.replaceState(null, '', '/?project=p8');
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A'), proj(8, 'B')], total: 2, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    useStore.setState({ currentProjectId: 7 });   // 持久化恢复的「最近使用」
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(8);
    expect(window.location.search).toBe('?project=p8');
  });

  test('loadProjects:旧数值链 ?project=<id> 解析为数值 id 并把 URL 纠正为 public_id', async () => {
    window.history.replaceState(null, '', '/?project=8');
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A'), proj(8, 'B')], total: 2, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(8);
    expect(window.location.search).toBe('?project=p8');
  });

  test('loadProjects:URL 项目不在列表中则回退持久化值,并纠正 URL 为 public_id', async () => {
    window.history.replaceState(null, '', '/?project=zzz');
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A')], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    useStore.setState({ currentProjectId: 7 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(window.location.search).toBe('?project=p7');
  });

  test('loadProjects:无 URL 参数时沿用现状(持久化值),并把选定项目 public_id 写入 URL', async () => {
    window.history.replaceState(null, '', '/');
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A')], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(window.location.search).toBe('?project=p7');
  });

  test('loadProjects:await 期间用户切走项目时,不把过期 pick 写回 URL', async () => {
    window.history.replaceState(null, '', '/');
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A')], total: 1, page: 1, page_size: 100 });
    // 拉画布期间模拟用户通过 UI 切到另一项目:pick(7) 已过期,不得写回 URL
    api.listCanvasItems.mockImplementation(async () => {
      useStore.setState({ currentProjectId: 99 });
      return { items: [], total: 0 };
    });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    useStore.setState({ currentProjectId: 7 });
    await useStore.getState().loadProjects();
    expect(window.location.search).not.toBe('?project=p7');
  });

  test('loadProjects:项目列表为空时自动建默认项目,并把 URL 中的非法 ?project 纠正为新项目 public_id', async () => {
    window.history.replaceState(null, '', '/?project=8');
    api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    api.createProject.mockResolvedValue(proj(42, 'Untitled game'));
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(api.createProject).toHaveBeenCalledWith('Untitled game');
    expect(useStore.getState().currentProjectId).toBe(42);
    expect(window.location.search).toBe('?project=p42');
  });

  test('deleteProject 删掉最后一个项目 → 自动建默认项目维持 ≥1 不变式', async () => {
    useStore.setState({ projects: [proj(5, 'Only')], currentProjectId: 5 });
    api.deleteProject.mockResolvedValue({ id: 5 });
    api.createProject.mockResolvedValue(proj(100, 'Untitled game'));
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().deleteProject(5);
    expect(api.createProject).toHaveBeenCalledWith('Untitled game');
    expect(useStore.getState().currentProjectId).toBe(100);
    expect(useStore.getState().projects).toEqual([expect.objectContaining({ id: 100 })]);
  });

  test('selectProject 切换后把项目 public_id 写入本页签 URL', async () => {
    window.history.replaceState(null, '', '/?project=p1');
    useStore.setState({ currentProjectId: 1, projects: [proj(1), proj(2)] });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(2);
    expect(window.location.search).toBe('?project=p2');
  });

  test('deleteProject 删空全部项目后自动建默认项目,URL ?project 纠正为新项目 public_id', async () => {
    window.history.replaceState(null, '', '/?project=p1');
    useStore.setState({ currentProjectId: 1, projects: [proj(1, 'A')] });
    api.deleteProject.mockResolvedValue({});
    api.createProject.mockResolvedValue(proj(77, 'Untitled game'));
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().deleteProject(1);
    expect(useStore.getState().currentProjectId).toBe(77);
    expect(window.location.search).toBe('?project=p77');
  });
});

describe('loadCanvas(资产数据层)', () => {
  test('loadCanvas 把服务端项映射进 assets', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'img-1', type: 'image', status: 'ready', url: null }], total: 1 });
    await useStore.getState().loadCanvas();
    expect(useStore.getState().assets.map((a) => a.id)).toEqual(['img-1']);
  });

  // 整表替换 vs fire-and-forget 回写的竞态:reference PATCH 还没落库(或失败被吞)时
  // run.finished 触发的后台刷新会把「前端所有」的字段冲成服务端空值 ——
  // 血缘变没(连线消失)、坐标退化成兜底网格(卡跳位)。故服务端**缺失时**保留本地值。
  describe('loadCanvas 本地合并(前端所有的字段:坐标 / 血缘)', () => {
    const local = {
      id: 'm3d-1', key: 'm3d-1', label: 'ship', kind: '3d' as const, source: 'derived' as const,
      status: 'ready' as const, position: { x: 640, y: 320 }, parentId: 'img-src', refIds: ['img-2nd'],
    };

    test('服务端 reference 无血缘 → 保留本地 parentId/refIds/source', async () => {
      useStore.setState({ currentProjectId: 42, assets: [local] });
      api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'm3d-1', type: 'model3d', status: 'ready', url: null, reference: null }], total: 1 });
      await useStore.getState().loadCanvas();
      expect(useStore.getState().assets.find((a) => a.id === 'm3d-1')).toMatchObject({
        parentId: 'img-src', refIds: ['img-2nd'], source: 'derived',
      });
    });

    test('服务端无坐标 → 保留本地坐标(不退化成兜底网格)', async () => {
      useStore.setState({ currentProjectId: 42, assets: [local] });
      api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'm3d-1', type: 'model3d', status: 'ready', url: null, reference: null }], total: 1 });
      await useStore.getState().loadCanvas();
      expect(useStore.getState().assets.find((a) => a.id === 'm3d-1')!.position).toEqual({ x: 640, y: 320 });
    });

    test('服务端有血缘/坐标 → 以服务端为准(本地旧值不挡新值)', async () => {
      useStore.setState({ currentProjectId: 42, assets: [local] });
      api.listCanvasItems.mockResolvedValue({ items: [{
        id: 1, item_id: 'm3d-1', type: 'model3d', status: 'ready', url: null,
        reference: { parent_id: 'img-other', position: { x: 10, y: 20 } },
      }], total: 1 });
      await useStore.getState().loadCanvas();
      expect(useStore.getState().assets.find((a) => a.id === 'm3d-1')).toMatchObject({ parentId: 'img-other' });
      expect(useStore.getState().assets.find((a) => a.id === 'm3d-1')!.position).toEqual({ x: 10, y: 20 });
    });

    test('内存里没有的新卡 → 走原路径不变(服务端无坐标时按兜底网格铺开)', async () => {
      useStore.setState({ currentProjectId: 42, assets: [] });
      api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'img-new', type: 'image', status: 'ready', url: null, reference: null }], total: 1 });
      await useStore.getState().loadCanvas();
      const created = useStore.getState().assets.find((a) => a.id === 'img-new')!;
      expect(created.position).toEqual({ x: 0, y: 0 });   // fallbackGridPosition 首格
      expect(created.parentId).toBeUndefined();
    });
  });

  // 在飞占位卡不在服务端(它没有 item),整表替换会抹掉它 —— 而 GenTask 还指着那个 id,
  // 超时/失败时 markAssetsFailed 就打在空处:用户看到「卡凭空消失 + 一个 4 秒 Toast」
  // (spec 2026-08-06-gen-task-deadline-and-placeholder,真机实测撞出来的)
  describe('loadCanvas 保住在飞占位卡', () => {
    const placeholder = (id = 'pending_x') => ({
      id, key: id, label: '...', kind: '3d' as const, source: 'generated' as const,
      status: 'generating' as const, position: { x: 111, y: 222 },
    });
    const task = (itemId = 'pending_x') => ({ itemId, kind: 'model3d' as const, taskId: 'gt-slow', startedAt: Date.now(), fails: 0 });

    test('GenTask 还指着它 → 整表替换后占位卡仍在(坐标不变)', async () => {
      useStore.setState({ currentProjectId: 42, assets: [placeholder()], genTasks: [task()] });
      api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'img-real', type: 'image', status: 'ready', url: null, reference: null }], total: 1 });
      await useStore.getState().loadCanvas();
      const kept = useStore.getState().assets.find((a) => a.id === 'pending_x');
      expect(kept).toBeTruthy();
      expect(kept!.position).toEqual({ x: 111, y: 222 });
      expect(kept!.status).toBe('generating');
    });

    test('服务端真实卡与被保留的占位卡并存,不重复', async () => {
      useStore.setState({ currentProjectId: 42, assets: [placeholder()], genTasks: [task()] });
      api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'img-real', type: 'image', status: 'ready', url: null, reference: null }], total: 1 });
      await useStore.getState().loadCanvas();
      expect(useStore.getState().assets.map((a) => a.id).sort()).toEqual(['img-real', 'pending_x']);
    });

    // failGenTask 标失败的同时摘掉 GenTask,保留判据随即不成立 —— 若只看「任务还在」,
    // 下一次后台刷画布(run.finished / 手动刷新)会把刚转成失败的那张卡又抹掉,
    // 「就地转失败」就只在瞬时成立(评审 Important 1)
    test('已转失败态的占位卡(任务已摘)→ 再刷一次画布仍在,不被抹掉', async () => {
      useStore.setState({
        currentProjectId: 42,
        assets: [{ ...placeholder('pending_failed'), status: 'error' as const, failure: { code: 'GEN_FAILED', category: 'provider', message: 'x', retryable: true } }],
        genTasks: [],
      });
      api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
      await useStore.getState().loadCanvas();
      const kept = useStore.getState().assets.find((a) => a.id === 'pending_failed');
      expect(kept?.status).toBe('error');
      expect(kept?.failure?.code).toBe('GEN_FAILED');   // 重试入口所依赖的原因也留着
    });

    test('无 GenTask 引用的孤立占位卡(同步生成在飞)→ 仍按现状抹掉,不越界', async () => {
      useStore.setState({ currentProjectId: 42, assets: [placeholder('pending_sync')], genTasks: [] });
      api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
      await useStore.getState().loadCanvas();
      expect(useStore.getState().assets).toEqual([]);
    });
  });

  test('loadCanvas 在 await 期间项目已切换时不写入旧项目资产', async () => {
    useStore.setState({ currentProjectId: 42 });
    let resolveCanvas!: (v: unknown) => void;
    api.listCanvasItems.mockReturnValue(new Promise((r) => { resolveCanvas = r; }));
    const p = useStore.getState().loadCanvas();
    // await 期间切到另一项目
    useStore.setState({ currentProjectId: 99, assets: [] });
    resolveCanvas({ items: [{ id: 1, item_id: 'img-old', type: 'image', status: 'ready', url: null }], total: 1 });
    await p;
    expect(useStore.getState().assets.find((a) => a.id === 'img-old')).toBeUndefined();
  });
});

describe('版本 actions', () => {
  // 缺陷 14391311 / spec 2026-08-31:补上 2026-08-12 spec §4.5 那条待办要求的真实链路测试 ——
  // 从 listVersions 返回构建中的版本,到轮询推进至 ready,到下游两个判据同时解锁。
  test('构建中的版本经轮询推进至 ready:时间戳补齐,Rezona CTA 与 Remix 开关一并解锁', async () => {
    useStore.setState({ currentProjectId: 42, versions: [], activeVersionId: null });

    // 阶段一:后端返回构建中的行(created_at 缺失)
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'building', is_current: true },
    ], total: 1 });
    await useStore.getState().loadVersions();

    const building = useStore.getState().versions[0];
    expect(building.status).toBe('building');
    expect(building.createdAt).toBe('');          // 时间线据此不渲染时间戳
    expect(useStore.getState().activeVersionId).toBe('v1');
    // Rezona 发布 CTA 的判据(RezonaPublishModal 的 versionReady)
    expect(building.status === 'ready').toBe(false);
    // Remix 开关的判据:同一个 status 的另一个下游,必须同时被挡
    expect(remixToggleState({
      policy: { enabled: false, source_version_id: null } as never,
      pending: null, activeVersionId: 'v1', activeStatus: building.status, loading: false,
    })).toMatchObject({ disabled: true, reason: 'notBuilt' });

    // 阶段二:同一个 version_id 构建完成,轮询再拉一次
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true, created_at: '2026-08-31T10:00:00Z' },
    ], total: 1 });
    await useStore.getState().pollVersions();

    const ready = useStore.getState().versions[0];
    expect(ready.status).toBe('ready');
    expect(ready.createdAt).toBe('2026-08-31T10:00:00Z');
    // id 未变,active 不应发生漂移
    expect(useStore.getState().activeVersionId).toBe('v1');
    expect(ready.status === 'ready').toBe(true);
    expect(remixToggleState({
      policy: { enabled: false, source_version_id: null } as never,
      pending: null, activeVersionId: 'v1', activeStatus: ready.status, loading: false,
    })).toMatchObject({ disabled: false, reason: null });
  });

  test('loadVersions 映射进 versions,标记 current', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [{ version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true }], total: 1 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().versions[0].id).toBe('v1');
    expect(useStore.getState().activeVersionId).toBe('v1');
  });

  test('loadVersions 在 await 期间项目已切换时不写入旧项目版本', async () => {
    useStore.setState({ currentProjectId: 42 });
    let resolveVer!: (v: unknown) => void;
    api.listVersions.mockReturnValue(new Promise((r) => { resolveVer = r; }));
    const p = useStore.getState().loadVersions();
    useStore.setState({ currentProjectId: 99, versions: [], activeVersionId: null });
    resolveVer({ items: [{ version_id: 'v-old', seq: 1, title: 'V1', status: 'ready', is_current: true }], total: 1 });
    await p;
    expect(useStore.getState().versions).toHaveLength(0);
    expect(useStore.getState().activeVersionId).toBeNull();
  });

  test('刷新出现新版本时自动切到最新并同步 current 标记', async () => {
    useStore.setState({
      currentProjectId: 42,
      activeVersionId: 'v1',
      versions: [
        { id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: true, status: 'ready', assetKeys: [], game: { title: 'V1', palette: 'neon' } },
      ],
    });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: false },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: true },
    ], total: 2 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().activeVersionId).toBe('v2');
    expect(useStore.getState().versions.find((v) => v.id === 'v2')?.current).toBe(true);
    expect(useStore.getState().versions.find((v) => v.id === 'v1')?.current).toBe(false);
  });

  test('刷新无新版本时保持用户手动选中的旧版本', async () => {
    useStore.setState({
      currentProjectId: 42,
      activeVersionId: 'v1',
      versions: [
        { id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: false, status: 'ready', assetKeys: [], game: { title: 'V1', palette: 'neon' } },
        { id: 'v2', index: 2, label: 'V2', summary: '', createdAt: '', current: true, status: 'ready', assetKeys: [], game: { title: 'V2', palette: 'neon' } },
      ],
    });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: false },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: true },
    ], total: 2 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().activeVersionId).toBe('v1');
  });

  test('冷启动首载(旧列表为空)默认选择最新版本', async () => {
    useStore.setState({ currentProjectId: 42, versions: [], activeVersionId: null });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: false },
    ], total: 2 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().activeVersionId).toBe('v2');
    expect(useStore.getState().versions.find((v) => v.id === 'v2')?.current).toBe(true);
  });

  test('冷启动按版本 index 选择最新项,不依赖接口数组顺序', async () => {
    useStore.setState({ currentProjectId: 42, versions: [], activeVersionId: null });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v3', seq: 3, title: 'V3', status: 'ready', is_current: false },
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: false },
    ], total: 3 });
    await useStore.getState().loadVersions();

    expect(useStore.getState().activeVersionId).toBe('v3');
    expect(useStore.getState().versions.filter((v) => v.current).map((v) => v.id)).toEqual(['v3']);
  });
});

describe('画布轮询 pollGenTasks', () => {
  test('轮询 ready 后保留本地坐标', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'ready', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4', reference: { position: { x: 30, y: 40 } } } });
    await useStore.getState().pollGenTasks();
    const a = useStore.getState().assets.find((x) => x.id === 'vid-1')!;
    expect(a.status).toBe('ready');
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  test('占位项带本地 parentId 时,轮询 ready 后保留连线', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'derived', status: 'generating', position: { x: 0, y: 0 }, parentId: 'src-1' }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'ready', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4', reference: { position: { x: 30, y: 40 } } } });
    await useStore.getState().pollGenTasks();
    const a = useStore.getState().assets.find((x) => x.id === 'vid-1')!;
    expect(a.parentId).toBe('src-1');
    expect(a.source).toBe('derived');
  });

  // 溯源与坐标/血缘同理归前端所有(从工具入参提取,回写是 fire-and-forget)。
  // canvasItemToAsset **恒写** provenance 这个键(值可能是 undefined),故 `...asset` 会把本地那份
  // 冲成 undefined —— 属性面板的提示词/模型/再生成按钮在转 ready 那一刻整段消失(终审 rv-canvas-provenance)
  test('占位项带本地 provenance 时,轮询 ready 后仍在(服务端没回显也不得冲掉)', async () => {
    const provenance = { kind: 'video' as const, req: { prompt: '一只猫' }, at: '2026-08-11T00:00:00Z' };
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 }, provenance }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'ready', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4', reference: { position: { x: 30, y: 40 } } } });
    api.getBalance.mockResolvedValue(null);   // 终态成功会顺手刷账户条
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((x) => x.id === 'vid-1')?.provenance).toEqual(provenance);
  });

  test('轮询替换不覆盖已有 refIds', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 }, refIds: ['r1'] }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    // poll 返回的 item 无 ref_item_ids(reference 无该字段)
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'ready', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4', reference: { position: { x: 30, y: 40 } } } });
    await useStore.getState().pollGenTasks();
    const a = useStore.getState().assets.find((x) => x.id === 'vid-1')!;
    expect(a.refIds).toEqual(['r1']);
  });

  test('pollGenTasks 在 await 期间项目已切换时不写回旧项目任务结果', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    let resolvePoll!: (v: unknown) => void;
    api.pollVideo.mockReturnValue(new Promise((r) => { resolvePoll = r; }));
    const p = useStore.getState().pollGenTasks();
    useStore.setState({ currentProjectId: 99 });
    resolvePoll({ task_id: 't1', status: 'ready', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4' } });
    await p;
    // 切走后旧项目任务的 ready 结果不应写回(否则会污染当前项目画布)
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('generating');
  });

  test('轮询返回 failed:Toast 提醒,卡转失败态且服务端 item 保留', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'failed', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'failed', url: null } });
    api.deleteCanvasItem.mockResolvedValue({});
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();   // 保留服务端 failed item,失败卡才能活过刷新
  });

  test('轮询返回 failed 且带 failure:Toast 展示上游 failure 的 message 与 code(取代通用文案)', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({
      task_id: 't1', status: 'failed', item: null,
      failure: { code: 'PROVIDER_CONTENT_POLICY_VIOLATION', category: 'content_policy', message: '生成内容可能触发内容安全或版权相似风险。请改用原创素材或调整提示词后重试。', retryable: true, provider_code: 'OutputVideoSensitiveContentDetected.PolicyViolation' },
    });
    api.deleteCanvasItem.mockResolvedValue({});
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast).toMatchObject({
      code: 'PROVIDER_CONTENT_POLICY_VIOLATION',
      message: '生成内容可能触发内容安全或版权相似风险。请改用原创素材或调整提示词后重试。',
    });
  });

  test('model3d 轮询返回 failed 且带 failure:同样透传 failure.message', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'm-1', key: 'm-1', label: 'x', kind: '3d', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'm-1', kind: 'model3d', taskId: 't9', startedAt: Date.now() }],
    });
    api.pollModel3d.mockResolvedValue({
      task_id: 't9', status: 'failed', item: null,
      failure: { code: 'PROVIDER_CONTENT_POLICY_VIOLATION', category: 'content_policy', message: '提示词不合规', retryable: true },
    });
    api.deleteCanvasItem.mockResolvedValue({});
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().toast).toMatchObject({ code: 'PROVIDER_CONTENT_POLICY_VIOLATION', message: '提示词不合规' });
  });

  test('任务级 status=failed 且 item 为 null:卡转失败态 + Toast(不等超时)', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'failed', item: null });
    api.deleteCanvasItem.mockResolvedValue({});
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();   // 保留服务端 failed item,失败卡才能活过刷新
  });

  test('任务级 status=failed 但 item 仍标 generating:同样卡转失败态 + Toast', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'failed', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'generating', url: null } });
    api.deleteCanvasItem.mockResolvedValue({});
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();   // 保留服务端 failed item,失败卡才能活过刷新
  });

  test('poll 后仍 generating 且超过 DEADLINE 时卡转失败态 + Toast 并移除任务', async () => {
    const old = Date.now() - 36 * 60 * 1000;   // 36 分钟前,超过 35min 上限(= 后端契约 30min + 5min 余量)
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: old }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'in_progress', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'generating', url: null } });
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();   // 任务可能仍在跑,服务端 item 保留
  });

  test('连续 poll 失败达 MAX_FAILS 时卡转失败态 + Toast 并移除;未达上限仅累加 fails', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now(), fails: 4 }],
    });
    api.pollVideo.mockRejectedValue(new Error('boom'));
    await useStore.getState().pollGenTasks();   // fails 4 -> 5 = MAX_FAILS
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  test('poll 失败未达上限时保留任务并累加 fails', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now(), fails: 0 }],
    });
    api.pollVideo.mockRejectedValue(new Error('boom'));
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('generating');
    expect(useStore.getState().genTasks[0].fails).toBe(1);
  });

  test('poll 返回 item 为 null 且超过 DEADLINE 时也兜底转失败态 + Toast 移除', async () => {
    const old = Date.now() - 36 * 60 * 1000;
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: old }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'in_progress', item: null });
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  // 后端保证任何任务 ≤30 分钟必达终态(pgc docs/api/agent.md 的 AGENT__TASK_TIMEOUT_SECONDS),
  // 前端等 35 分钟。旧阈值 10 分钟会在答案到来前撤走 —— 慢的 3D(Tripo 排队时十几分钟)落进盲区
  // (spec 2026-08-06-gen-task-deadline-and-placeholder)
  test('已等 11 分钟(旧阈值之后、新阈值之前)→ 任务仍在,卡仍转圈', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() - 11 * 60 * 1000 }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'in_progress', item: null });
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('generating');
    expect(useStore.getState().genTasks).toHaveLength(1);
    expect(useStore.getState().toast).toBeNull();
  });

  // 整条链:占位卡先经一次后台 loadCanvas(run.finished 必刷)存活下来,超时才有卡可标。
  // 改动前这条必红 —— 卡在 loadCanvas 就被抹了,markAssetsFailed 打在空处、画布上什么都不剩
  test('在飞占位卡经后台 loadCanvas 后仍在 → 超时就地转失败卡(而非凭空消失)', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'pending_slow', key: 'pending_slow', label: '...', kind: '3d', source: 'generated', status: 'generating', position: { x: 30, y: 40 } }],
      genTasks: [{ itemId: 'pending_slow', kind: 'model3d', taskId: 'gt-slow', startedAt: Date.now() - 36 * 60 * 1000 }],
    });
    // run.finished 后台刷画布:服务端此刻还没有这张卡的 item
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadCanvas();
    expect(useStore.getState().assets.map((a) => a.id)).toEqual(['pending_slow']);   // 没被抹掉

    api.pollModel3d.mockResolvedValue({ task_id: 'gt-slow', status: 'in_progress', item: null });
    await useStore.getState().pollGenTasks();

    const card = useStore.getState().assets.find((a) => a.id === 'pending_slow');
    expect(card?.status).toBe('error');                    // 就地转失败,不是消失
    expect(card?.position).toEqual({ x: 30, y: 40 });      // 原位不动
    expect(useStore.getState().toast?.code).toBe('GEN_FAILED');
    expect(useStore.getState().genTasks).toHaveLength(0);

    // 再刷一次画布:任务已摘,失败卡不能因此被抹掉(否则「消失」只是被推迟了一步)
    await useStore.getState().loadCanvas();
    expect(useStore.getState().assets.find((a) => a.id === 'pending_slow')?.status).toBe('error');
  });

  test('poll 返回 item 为 null 但未超时,任务保留待下轮', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'in_progress', item: null });
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('generating');
    expect(useStore.getState().genTasks).toHaveLength(1);
  });
});

describe('genTasks 刷新重连 restoreGenTasks', () => {
  // 跨设备 / 清过 localStorage 时 genTasksByProject 是空的,任务只能从 item id 反推(DISCOVERABLE)。
  // 异步音频卡漏登记的话,它会落进下面那段「孤儿 generating 资产」被就地标失败 ——
  // 而服务端其实早已出货,只等一次 GET 去物化。
  test('DISCOVERABLE:无持久化任务时,异步音频卡能按 aud-gtask- 反推出轮询任务', () => {
    useStore.setState({
      currentProjectId: 42, genTasksByProject: {}, genTasks: [],
      assets: [{ id: 'aud-gtask-abc123', key: 'aud-gtask-abc123', label: 'x', kind: 'audio', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
    } as never);
    useStore.getState().restoreGenTasks(42);
    expect(useStore.getState().genTasks).toMatchObject([{ itemId: 'aud-gtask-abc123', kind: 'audio', taskId: 'gtask-abc123' }]);
  });

  // 另一半:同步音频卡同样是 `aud-` 开头(服务端 `aud-{hex12}`),但它**没有任务**。
  // 守卫写松成只判前缀的话,这里会凭空造出一个 taskId='9f2c1b' 的任务去轮询,
  // 404 攒到 MAX_FAILS 再把一张本来好端端的卡标成失败。
  test('DISCOVERABLE:同步音频卡(aud- 但非 gtask-)不得被反推成轮询任务', () => {
    useStore.setState({
      currentProjectId: 42, genTasksByProject: {}, genTasks: [],
      assets: [{ id: 'aud-9f2c1b', key: 'aud-9f2c1b', label: 'x', kind: 'audio', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
    } as never);
    useStore.getState().restoreGenTasks(42);
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  test('loadProjects 直载分支:持久化任务对应 item 仍 generating 时恢复 genTasks', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [],
      genTasksByProject: { '7': [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }] },
    });
    api.listProjects.mockResolvedValue({ items: [proj(7, 'A')], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'vid-1', type: 'video', status: 'generating', url: null }], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().genTasks).toHaveLength(1);
    expect(useStore.getState().genTasks[0].taskId).toBe('t1');
  });

  // ★ spec 成功标准 1 的端到端:走完整 selectProject(真的经过 loadCanvas 整表替换)后,
  // 占位卡在不在、任务保没保住。上面那条只调 restoreGenTasks 单函数、assets 还是预置的。
  //
  // ⚠️ 它**不**守「接回必须发生在整表替换之后」这条顺序 —— 实测把 selectProject 里那两行对调,
  // 本条仍绿(另有 15 条既有用例会红,顺序并非无人看守)。原因是回合 A 的 alivePlaceholders 是第二道
  // 防线:对调后 restoreGenTasks 先 commit 了任务,loadCanvas 就认得这张卡并保留它。
  // 也就是说顺序在这里不承重 —— 承重的是「整表替换之后卡还在」这个结果,正是本条断言的东西。
  test('刷新后走完整载入:整表替换抹掉占位卡后仍被接回,任务保住', async () => {
    const ph = { id: 'pending_full', key: 'pending_full', label: '在飞', kind: 'video', source: 'generated',
      status: 'generating', position: { x: 300, y: 400 } } as unknown as Asset;
    useStore.setState({
      currentProjectId: null, assets: [], genTasks: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [{ itemId: 'pending_full', kind: 'video', taskId: 'tf', startedAt: Date.now(), fails: 0 }] },
      inflightCardsByProject: { '7': [ph] },
    });
    // 服务端只有一张真实卡:整表替换后 assets 里绝无 pending_full
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'img-real', type: 'image', status: 'ready', url: '/p/a.png' }], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });

    await useStore.getState().selectProject(7);

    const st = useStore.getState();
    expect(st.assets.map((a) => a.id).sort()).toEqual(['img-real', 'pending_full']);
    expect(st.assets.find((a) => a.id === 'pending_full')?.position).toEqual({ x: 300, y: 400 });
    expect(st.genTasks.map((t) => t.itemId)).toEqual(['pending_full']);
  });

  test('持久化任务对应 item 已 ready 或已删则不恢复,并从映射剪除', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [
        { itemId: 'vid-done', kind: 'video', taskId: 't1', startedAt: Date.now() },
        { itemId: 'vid-gone', kind: 'video', taskId: 't2', startedAt: Date.now() },
      ] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'vid-done', type: 'video', status: 'ready', url: '/p/v.mp4' }], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);
    expect(useStore.getState().genTasks).toHaveLength(0);
    expect(useStore.getState().genTasksByProject['7']).toEqual([]);
  });

  // 在飞占位卡跨刷新存活(spec 2026-08-07-inflight-placeholder-persist)。
  // genTasksByProject 本身是持久的,丢的是**卡** —— 刷新后 assets 为空,restoreGenTasks 的剪枝
  // 按「卡在不在且 generating」判定,于是把那条任务当残留剪掉:付了钱的在飞生成从此无人推进、
  // 画布上什么都没有(4.9K credit 事故的完整复现路径)。
  // 用 registerAgentGenTask 驱动:只有它在首拉 item 为 null 时会保留 pending_ 身份并登记任务
  // (用户自发起那条 startAsyncGen 在 !task.item 时直接判失败,不会产生 pending_ 任务)
  describe('在飞占位卡快照', () => {
    beforeEach(() => {
      useStore.setState({ currentProjectId: 7, assets: [], genTasks: [], agentTasksByProject: {}, inflightCardsByProject: {} });
    });

    test('agent 异步任务首拉无 item → 占位卡进快照', async () => {
      api.pollVideo.mockResolvedValue({ task_id: 'gs1', status: 'running', item: null });
      await useStore.getState().registerAgentGenTask('gs1', 'video');
      const st = useStore.getState();
      const phId = st.genTasks[0]?.itemId;
      expect(phId).toMatch(/^pending_/);                                  // 前提:任务确实指向占位卡
      expect(st.inflightCardsByProject['7']?.map((c) => c.id)).toEqual([phId]);
    });

    // ★ 写入侧护栏:快照存的必须是**整份 Asset**。只存 {id,kind,position} 那种裁剪版的话,
    // 恢复出的卡会丢掉溯源与血缘 —— 等于换一种方式丢东西。
    // 接回那侧是纯数组 filter(种什么断言到什么),所以这条断言只有种在**写入侧**才吃劲:
    // 先用 submitMsg 让 registerAgentGenTask 真的算出 provenance 与 parentId,再看快照里在不在
    // (终审 M6:此前那条只比 position,裁剪版照样绿,等于没守)
    test('快照存整份 Asset:溯源与血缘一并落盘,不是裁剪版', async () => {
      const SRC = 'https://pgc.example/preview/7/hero.png';
      const src = { id: 'img-src', key: 'img-src', label: 'hero', kind: 'image', source: 'generated',
        status: 'ready', position: { x: 0, y: 0 }, preview: { src: SRC } } as unknown as Asset;
      useStore.setState({
        currentProjectId: 7, assets: [src], genTasks: [], agentTasksByProject: {}, inflightCardsByProject: {},
        messages: [{
          id: 'm-gs-p', role: 'assistant' as const, status: 'ready' as const,
          parts: [{ type: 'tool' as const, id: 'toolu-gs-p', name: 'mcp__media__submit_video_generation',
            input: { prompt: '一只宝箱', source_url: SRC }, status: 'ready' as const,
            result: JSON.stringify({ type: 'media.task_submitted', kind: 'video', task_id: 'gs-p' }) }],
        }] as never,
      });
      api.pollVideo.mockResolvedValue({ task_id: 'gs-p', status: 'running', item: null });
      await useStore.getState().registerAgentGenTask('gs-p', 'video');

      const snap = useStore.getState().inflightCardsByProject['7'];
      expect(snap).toHaveLength(1);
      expect(snap[0].provenance?.req).toMatchObject({ prompt: '一只宝箱' });   // 溯源进了快照
      expect(snap[0].parentId).toBe('img-src');                                 // 血缘也进了
    });

    test('任务终结 → 快照随之清空(清理是自动的,没有第二个写点)', async () => {
      api.pollVideo.mockResolvedValue({ task_id: 'gs2', status: 'running', item: null });
      await useStore.getState().registerAgentGenTask('gs2', 'video');
      expect(useStore.getState().inflightCardsByProject['7']).toHaveLength(1);
      // 轮询拿到终态 → adopt + 摘任务
      api.pollVideo.mockResolvedValue({ task_id: 'gs2', status: 'succeeded', item: { item_id: 'vid-ok', type: 'video', status: 'ready', url: 'https://x/a.mp4' } });
      await useStore.getState().pollGenTasks();
      expect(useStore.getState().genTasks).toEqual([]);
      expect(useStore.getState().inflightCardsByProject['7']).toEqual([]);
    });

    // ★ 本轮核心:刷新后 assets 只有服务端卡,占位卡不在其中 —— 若不先按快照接回来,
    // 下面的剪枝会把那条任务当残留剪掉,在飞生成从此无人推进
    test('刷新场景:按快照接回占位卡,任务被保住(改前:卡没了、任务被剪掉)', () => {
      const ph = { id: 'pending_r1', key: 'pending_r1', label: '在飞', kind: 'video', source: 'generated',
        status: 'generating', position: { x: 120, y: 240 },
        provenance: { kind: 'video', at: 'x', req: { prompt: 'p' } }, parentId: 'img-src', refIds: ['img-r'] } as unknown as Asset;
      useStore.setState({
        currentProjectId: 7,
        assets: [{ id: 'img-src', key: 'img-src', label: 's', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 } } as Asset],
        genTasks: [],
        genTasksByProject: { '7': [{ itemId: 'pending_r1', kind: 'video', taskId: 'tr1', startedAt: Date.now(), fails: 0 }] },
        inflightCardsByProject: { '7': [ph] },
      });

      useStore.getState().restoreGenTasks(7);

      const st = useStore.getState();
      const back = st.assets.find((a) => a.id === 'pending_r1');
      expect(back).toBeTruthy();                                  // 卡被接回来
      expect(back?.status).toBe('generating');
      expect(st.genTasks.map((t) => t.itemId)).toEqual(['pending_r1']);   // 任务保住,轮询接着推进
      // 溯源与血缘一起活过刷新,不是一张裸卡
      expect(back?.provenance).toBeTruthy();
      expect(back?.parentId).toBe('img-src');
      expect(back?.refIds).toEqual(['img-r']);
    });

    test('快照里有、但持久化任务里已没有 → 不接回(幽灵防线)', () => {
      const ph = { id: 'pending_ghost', key: 'pending_ghost', label: 'x', kind: 'video', source: 'generated',
        status: 'generating', position: { x: 0, y: 0 } } as Asset;
      useStore.setState({
        currentProjectId: 7, assets: [], genTasks: [],
        genTasksByProject: { '7': [] },
        inflightCardsByProject: { '7': [ph] },
      });
      useStore.getState().restoreGenTasks(7);
      expect(useStore.getState().assets).toEqual([]);
    });

    test('assets 里已有同 id → 不重复插(幂等)', () => {
      const ph = { id: 'pending_dup', key: 'pending_dup', label: 'x', kind: 'video', source: 'generated',
        status: 'generating', position: { x: 5, y: 6 } } as Asset;
      useStore.setState({
        currentProjectId: 7, assets: [ph], genTasks: [],
        genTasksByProject: { '7': [{ itemId: 'pending_dup', kind: 'video', taskId: 'td', startedAt: Date.now(), fails: 0 }] },
        inflightCardsByProject: { '7': [ph] },
      });
      useStore.getState().restoreGenTasks(7);
      expect(useStore.getState().assets.filter((a) => a.id === 'pending_dup')).toHaveLength(1);
    });

    // 必须从「快照里本来有它」出发:否则只杀得掉「无差别快照所有 pending_ 卡」,
    // 杀不掉「referenced **或** error 都快照」——后者才是推翻 2026-08-03 决策的那种改法(评审 M5)
    test('占位卡转失败态后 → 退出快照(「失败卡刷新即消失」的决策不被推翻)', async () => {
      api.pollVideo.mockResolvedValue({ task_id: 'gs-f', status: 'running', item: null });
      await useStore.getState().registerAgentGenTask('gs-f', 'video');
      const phId = useStore.getState().genTasks[0].itemId;
      expect(useStore.getState().inflightCardsByProject['7']).toHaveLength(1);   // 前提:它确实进过快照

      api.pollVideo.mockResolvedValue({ task_id: 'gs-f', status: 'failed', item: null });
      await useStore.getState().pollGenTasks();

      expect(useStore.getState().assets.find((a) => a.id === phId)?.status).toBe('error');
      expect(useStore.getState().inflightCardsByProject['7']).toEqual([]);
    });

    // 「按项目持久化的映射在 deleteProject 处成套剪除」是既有约定,漏一个就是 localStorage 泄漏(评审 I3)
    test('deleteProject 成套剪除:该项目的在飞卡快照一并清掉', async () => {
      api.deleteProject.mockResolvedValue({});
      api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
      useStore.setState({
        currentProjectId: 7, projects: [{ id: 7, name: 'A' }] as never,
        genTasksByProject: { '7': [{ itemId: 'pending_d', kind: 'video', taskId: 'td', startedAt: 1, fails: 0 }] },
        inflightCardsByProject: { '7': [{ id: 'pending_d', key: 'pending_d', label: 'x', kind: 'video',
          source: 'generated', status: 'generating', position: { x: 0, y: 0 } } as unknown as Asset] },
      });
      await useStore.getState().deleteProject(7);
      expect(useStore.getState().inflightCardsByProject['7']).toBeUndefined();
      expect(useStore.getState().genTasksByProject['7']).toBeUndefined();   // 对照:既有那份本来就剪
    });

    test('切项目隔离:A 项目的在飞卡不出现在 B 项目', () => {
      const ph = { id: 'pending_pA', key: 'pending_pA', label: 'x', kind: 'video', source: 'generated',
        status: 'generating', position: { x: 0, y: 0 } } as Asset;
      // 项目 8 也有一条指向**同一 itemId** 的任务,而卡只在项目 7 的快照里 ——
      // 这样「按 pid 取快照」写成 Object.values(...).flat() 之类的误键才会被杀掉(评审 M4)
      useStore.setState({
        currentProjectId: 8, assets: [], genTasks: [],
        genTasksByProject: {
          '7': [{ itemId: 'pending_pA', kind: 'video', taskId: 'tA', startedAt: Date.now(), fails: 0 }],
          '8': [{ itemId: 'pending_pA', kind: 'video', taskId: 'tA', startedAt: Date.now(), fails: 0 }],
        },
        inflightCardsByProject: { '7': [ph] },
      });
      useStore.getState().restoreGenTasks(8);
      expect(useStore.getState().assets).toEqual([]);
    });

    test('真实 item 的卡不进快照(刷新后由 loadCanvas 带回,不该前端存一份)', async () => {
      api.pollVideo.mockResolvedValue({ task_id: 'gs3', status: 'running', item: { item_id: 'vid-real', type: 'video', status: 'generating', url: null } });
      await useStore.getState().registerAgentGenTask('gs3', 'video');
      const st = useStore.getState();
      expect(st.genTasks[0].itemId).toBe('vid-real');
      expect(st.inflightCardsByProject['7']).toEqual([]);
    });
  });

  // 真接不回来的孤儿(id 里没有可反推的 task_id,如同步生成的 img- 卡卡在 generating):
  // 不能留永远转圈的加载卡,但**不删服务端 item** —— 判据错一次就是不可恢复的数据丢失
  // (后端无 restore 端点),标失败同样达到目的且留着重试入口
  // (spec 2026-08-06-orphan-gen-task-no-delete)
  test('接不回来的孤儿:就地标失败,不删服务端 item、不弹 Toast', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'img-stuck', type: 'image', status: 'generating', url: null },
      { id: 2, item_id: 'img-ok', type: 'image', status: 'ready', url: '/p/a.png' },
    ], total: 2 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    const stuck = useStore.getState().assets.find((a) => a.id === 'img-stuck');
    expect(stuck).toBeTruthy();                     // 卡留在画布上,不被移除
    expect(stuck!.status).toBe('error');            // 就地转失败(带重试入口)
    // 不弹 Toast:卡不再被删,Toast 会在每次打开项目时重弹;信息由卡面自己承担(见设计稿改判说明)
    expect(useStore.getState().toast).toBeNull();
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();   // ★ 本轮核心:一次都不发 DELETE
  });

  // 孤儿的真实情况不是「生成失败」,而是「我们接不回这个任务的状态」——
  // 两者的正确应对完全不同,故挂前端自造的专属 code,由卡面按 code 换文案与按钮
  // (spec 2026-08-07-retry-path-guards 决策 2)
  test('孤儿标失败时挂 GEN_STATE_LOST,而不是无原因的 null', async () => {
    useStore.setState({ currentProjectId: 7, assets: [], versions: [], activeVersionId: null, genTasksByProject: { '7': [] } });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'img-stuck', type: 'image', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().assets.find((a) => a.id === 'img-stuck')?.failure?.code).toBe('GEN_STATE_LOST');
  });

  // 孤儿是**服务端真实卡**,它的 status 来自服务端(仍 generating —— 本轮刻意不删那份),
  // 而 loadCanvas 那条「留住失败态」的保留规则只覆盖占位卡 → 后台刷一次画布就翻回 generating,
  // 且没有任何任务指着它 = 永远转圈,标失败等于白标(评审 I1)
  test('孤儿标失败后,后台刷画布不得把它翻回 generating', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    const serverItems = { items: [{ id: 1, item_id: 'img-stuck', type: 'image', status: 'generating', url: null }], total: 1 };
    api.listCanvasItems.mockResolvedValue(serverItems);
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);
    expect(useStore.getState().assets.find((a) => a.id === 'img-stuck')?.status).toBe('error');

    // run.finished / checkpoint.created 后的后台刷画布(不经 restoreGenTasks):服务端那份仍 generating
    await useStore.getState().loadCanvas();

    expect(useStore.getState().assets.find((a) => a.id === 'img-stuck')?.status).toBe('error');
    expect(useStore.getState().genTasks).toEqual([]);   // 也没有任务被凭空造出来
  });

  // item_id 后缀即 task_id(契约:vid-<task_id> / m3d-<task_id>,与 rig-/tex- 同构)——
  // 换台设备、无痕窗口、清了 localStorage 都能从画布把在飞任务接回来,而不是把它删掉
  test('无持久化任务时,vid- 在飞卡被发现并接着轮询', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'vid-abc123', type: 'video', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().genTasks).toEqual([
      expect.objectContaining({ itemId: 'vid-abc123', kind: 'video', taskId: 'abc123' }),
    ]);
    // 被发现即不再是孤儿:卡仍 generating、没标失败、没弹 Toast
    expect(useStore.getState().assets.find((a) => a.id === 'vid-abc123')?.status).toBe('generating');
    expect(useStore.getState().toast).toBeNull();
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
    // 落盘:换设备接回来的价值依赖它落进持久化表后能续(commitGenTasks 的职责)
    expect(useStore.getState().genTasksByProject['7']).toEqual([
      expect.objectContaining({ itemId: 'vid-abc123', kind: 'video', taskId: 'abc123' }),
    ]);
  });

  test('无持久化任务时,m3d- 在飞卡被发现为 model3d 任务', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'm3d-abc123', type: 'model3d', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().genTasks).toEqual([
      expect.objectContaining({ itemId: 'm3d-abc123', kind: 'model3d', taskId: 'abc123' }),
    ]);
  });

  // 四个前缀互斥,不会互相认错;真正钉住 match 的是下面那条 vid-weird(类型不符即拒认)
  test('tex- 的既有发现行为不回退(kind=retexture)', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'tex-abc123', type: 'model3d', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().genTasks).toEqual([
      expect.objectContaining({ itemId: 'tex-abc123', kind: 'retexture', taskId: 'abc123' }),
    ]);
  });

  // rig- 这条依赖 threeDType==='rig3d',而 threeDType 只在 map.ts 对 type==='rig3d' 赋值 ——
  // 哪天 pgc 把绑骨产物的 type 改成 model3d,这条会静默失效(在飞绑骨被判失败)而无人发现(终审 M1)
  test('rig- 的既有发现行为不回退(kind=rig3d)', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'rig-abc123', type: 'rig3d', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().genTasks).toEqual([
      expect.objectContaining({ itemId: 'rig-abc123', kind: 'rig3d', taskId: 'abc123' }),
    ]);
  });

  // pending_ 占位卡属同会话在途请求(本就无任务),不在孤儿之列 —— 这道守卫此前没有断言看着(终审 M2)
  test('pending_ 占位卡不被当孤儿:不标失败、不删', async () => {
    useStore.setState({
      currentProjectId: 7,
      assets: [{ id: 'pending_inflight', key: 'pending_inflight', label: '...', kind: 'image',
        source: 'generated', status: 'generating', position: { x: 5, y: 6 } }],
      versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    // 切项目会清空 assets(既定语义),故这里直接对 restoreGenTasks 施加同款状态再验守卫
    useStore.setState({
      assets: [{ id: 'pending_inflight', key: 'pending_inflight', label: '...', kind: 'image',
        source: 'generated', status: 'generating', position: { x: 5, y: 6 } }],
      genTasks: [],
    });
    useStore.getState().restoreGenTasks(7);

    const ph = useStore.getState().assets.find((a) => a.id === 'pending_inflight');
    expect(ph?.status).toBe('generating');            // 未被标失败
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
  });

  test('vid- 前缀但类型不是 video → 不认(不臆造任务)', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'vid-weird', type: 'image', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().genTasks).toEqual([]);
    // 认不出 → 走孤儿分支:标失败但不删
    expect(useStore.getState().assets.find((a) => a.id === 'vid-weird')?.status).toBe('error');
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
  });

  test('已有持久化任务的 itemId 不被重复登记', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [{ itemId: 'vid-abc123', kind: 'video', taskId: '原任务', startedAt: Date.now() }] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [
      { id: 1, item_id: 'vid-abc123', type: 'video', status: 'generating', url: null },
    ], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);

    expect(useStore.getState().genTasks).toHaveLength(1);
    expect(useStore.getState().genTasks[0].taskId).toBe('原任务');   // 持久化那份优先,不被发现规则覆盖
  });

  test('item 仍 generating 且任务可恢复:不视为孤儿,卡片保留继续轮询', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'vid-1', type: 'video', status: 'generating', url: null }], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);
    expect(useStore.getState().assets.map((a) => a.id)).toEqual(['vid-1']);
    expect(useStore.getState().genTasks).toHaveLength(1);
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
  });
});

describe('importGeneratedAsset 自动导入', () => {
  // await 后必校验上下文:import 端点要服务端去拉字节(秒级往返),期间切项目的话
  // 这张属于旧项目的卡会落进新项目画布 —— 边被 selectCanvasEdges 过滤掉、卡本体留着,
  // 刷新才消失。spec 成功标准 9 与 plan 都点过这条,但用例从未落地(终审 rv-agent-lineage)
  test('await 期间切项目:不写入新项目画布', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {} });
    // 在 resolve 的**同时**把项目切走,模拟用户在等待期间点了另一个项目
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      useStore.setState({ currentProjectId: 99 });
      return { id: 1, item_id: 'imp-1', type: 'image', status: 'ready', url: '/p/h.png', reference: {}, canvas_x: 0, canvas_y: 0 };
    });
    await useStore.getState().importGeneratedAsset({ filename: 'hero.png', path: 'assets/hero.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/hero.png' });
    expect(useStore.getState().assets).toHaveLength(0);
    // 但去重键**照记**:表按 pid 键(与「当前是哪个项目」无关),而这张卡服务端已经建好了。
    // 漏记的话切回项目 42 时 importFromLiveEvent 重扫历史,去重表为空 → 二次 POST → 画布上两张同素材的卡
    expect(useStore.getState().importedByProject['42']).toContain('assets/hero.png');
  });

  test('视口中心兜底坐标传给 from-url,成功后并入 assets 与 importedByProject', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {} });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 1, item_id: 'imp-1', type: 'image', status: 'ready', url: '/p/h.png', reference: { source_filename: 'hero.png' }, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'hero.png', path: 'assets/hero.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/hero.png' });
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalledWith(42, expect.objectContaining({
      source_url: 'https://pgc.example/preview/42/hero.png', type: 'image', name: 'hero.png', reference: { source_filename: 'hero.png' },
      canvas_x: 0, canvas_y: 0,
    }));
    expect(useStore.getState().assets.find((a) => a.id === 'imp-1')).toBeTruthy();
    // 去重表记录完整 path(而非 basename):同名不同路径互不误杀
    expect(useStore.getState().importedByProject['42']).toContain('assets/hero.png');
  });

  test('同名不同路径不误杀:去重表已有 a/hero.png,导入 b/hero.png 仍落卡', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: { '42': ['assets/a/hero.png'] } });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 9, item_id: 'imp-9', type: 'image', status: 'ready', url: null, reference: null });
    await useStore.getState().importGeneratedAsset({ filename: 'hero.png', path: 'assets/b/hero.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/hero.png' });
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalled();
    expect(useStore.getState().importedByProject['42']).toContain('assets/b/hero.png');
  });

  test('兼容旧 basename 去重条目:list 里是 hero.png 时按 basename 命中跳过(存量项目不重导)', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: { '42': ['hero.png'] } });
    await useStore.getState().importGeneratedAsset({ filename: 'hero.png', path: 'assets/hero.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/hero.png' });
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
  });

  // —— 血缘归因:按 taskId 回溯该次生成的源卡(设计稿 2026-08-04-agent-asset-lineage)——
  // 源卡:画布上已有的 hero 图,agent 以它的 preview.src 作 source_url 做图生图
  const SRC = 'https://pgc.example/preview/42/hero.png';
  const srcAsset = {
    id: 'img-src', key: 'img-src', label: 'hero', kind: 'image' as const, source: 'generated' as const,
    status: 'ready' as const, position: { x: 100, y: 200 }, preview: { src: SRC },
  };
  // agent 提交生成的 tool part:input 带源 url,result 是回执(taskId 配对键)
  const submitMsg = (taskId: string, input: unknown) => ({
    id: `m-${taskId}`, role: 'assistant' as const, status: 'ready' as const,
    parts: [{
      type: 'tool' as const, id: `toolu-${taskId}`, name: 'mcp__media__submit_image_generation',
      input, status: 'ready' as const,
      result: JSON.stringify({ type: 'media.task_submitted', kind: 'image', task_id: taskId }),
    }],
  });

  test('归因到源卡 → reference 带 parent_id、落位在源卡右侧、asset 记 parentId', async () => {
    useStore.setState({
      currentProjectId: 42, assets: [srcAsset], importedByProject: {},
      messages: [submitMsg('gtask-1', { source_url: SRC })],
    });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 2, item_id: 'imp-2', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'new.png', path: 'assets/new.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/new.png', taskId: 'gtask-1' });

    const body = api.writeCanvasItemFromUrl.mock.calls[0][1];
    expect(body.reference).toMatchObject({ parent_id: 'img-src', source_filename: 'new.png' });
    // 父卡右侧树形落位:x 严格大于父卡(childPosition 的方向契约),不硬编码具体像素
    expect(body.canvas_x).toBeGreaterThan(srcAsset.position.x);
    expect(useStore.getState().assets.find((a) => a.id === 'imp-2')).toMatchObject({ parentId: 'img-src', source: 'derived' });
  });

  test('多源:首个进 parent_id(决定落位),其余进 ref_item_ids', async () => {
    const second = { ...srcAsset, id: 'img-2nd', key: 'img-2nd', preview: { src: 'https://pgc.example/preview/42/tree.png' } };
    useStore.setState({
      currentProjectId: 42, assets: [srcAsset, second], importedByProject: {},
      messages: [submitMsg('gtask-2', { source_urls: [second.preview.src, SRC] })],
    });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 3, item_id: 'imp-3', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png', taskId: 'gtask-2' });

    expect(api.writeCanvasItemFromUrl.mock.calls[0][1].reference).toMatchObject({ parent_id: 'img-2nd', ref_item_ids: ['img-src'] });
    expect(useStore.getState().assets.find((a) => a.id === 'imp-3')).toMatchObject({ parentId: 'img-2nd', refIds: ['img-src'] });
  });

  test('纯文生图(无源字段)→ 不连线,落位与现状一致(视口中心兜底 0,0)', async () => {
    useStore.setState({
      currentProjectId: 42, assets: [srcAsset], importedByProject: {},
      messages: [submitMsg('gtask-3', { prompt: '森林背景' })],
    });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 4, item_id: 'imp-4', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png', taskId: 'gtask-3' });

    const body = api.writeCanvasItemFromUrl.mock.calls[0][1];
    // 断言的是「没有血缘键」而非「reference 只有这一个键」——同一次回写还带溯源(provenance)
    expect(body.reference).toMatchObject({ source_filename: 'n.png' });
    expect(body.reference).not.toHaveProperty('parent_id');
    expect(body.reference).not.toHaveProperty('ref_item_ids');
    expect(useStore.getState().assets.find((a) => a.id === 'imp-4')?.parentId).toBeUndefined();
  });

  test('源 url match 不到画布卡(外部 url / 卡已删)→ 不连线,导入照常成功', async () => {
    useStore.setState({
      currentProjectId: 42, assets: [srcAsset], importedByProject: {},
      messages: [submitMsg('gtask-4', { source_url: 'https://external.example/x.png' })],
    });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 5, item_id: 'imp-5', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png', taskId: 'gtask-4' });

    const ref5 = api.writeCanvasItemFromUrl.mock.calls[0][1].reference;
    expect(ref5).toMatchObject({ source_filename: 'n.png' });
    expect(ref5).not.toHaveProperty('parent_id');
    expect(useStore.getState().assets.find((a) => a.id === 'imp-5')).toBeTruthy();
  });

  test('无 taskId(历史/回放路径)→ 走原路径不归因', async () => {
    useStore.setState({
      currentProjectId: 42, assets: [srcAsset], importedByProject: {},
      messages: [submitMsg('gtask-5', { source_url: SRC })],
    });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 6, item_id: 'imp-6', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png' });

    expect(api.writeCanvasItemFromUrl.mock.calls[0][1].reference).toEqual({ source_filename: 'n.png' });
  });

  // —— 创作溯源:同一次回溯(submitInputForTask)顺路把工具入参钉进资产(设计稿 2026-08-06-agent-asset-provenance)——
  test('溯源落库:reference.provenance 是工具入参原样,带 agent 判别器', async () => {
    const input = { prompt: '像素森林背景', model: 'gemini-flash-image', size: '1536x1024', name: 'forest' };
    useStore.setState({
      currentProjectId: 42, assets: [], importedByProject: {},
      messages: [submitMsg('gtask-p1', input)],
    });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 9, item_id: 'imp-9', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png', taskId: 'gtask-p1' });

    const prov = api.writeCanvasItemFromUrl.mock.calls[0][1].reference.provenance;
    // 原样:koubou 专属键(name)与别名(model)都不在写侧加工,归一留给读侧
    expect(prov).toEqual({ kind: 'image', req: input, at: expect.any(String), agent: true });
    // 内存里那份也带上,否则刷新前面板读不到
    expect(useStore.getState().assets.find((a) => a.id === 'imp-9')?.provenance).toEqual(prov);
  });

  test('无 taskId → 请求体不含 provenance 键(不发 undefined)', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {}, messages: [] });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 10, item_id: 'imp-10', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png' });

    expect(api.writeCanvasItemFromUrl.mock.calls[0][1].reference).not.toHaveProperty('provenance');
  });

  test('taskId 有但消息里没有那条提交(历史分页没加载到)→ 不写溯源,导入照常成功', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {}, messages: [] });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 11, item_id: 'imp-11', type: 'image', status: 'ready', url: '/p/n.png', reference: null, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'n.png', path: 'assets/n.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/n.png', taskId: 'gtask-不存在' });

    expect(api.writeCanvasItemFromUrl.mock.calls[0][1].reference).not.toHaveProperty('provenance');
    expect(useStore.getState().assets.find((a) => a.id === 'imp-11')).toBeTruthy();
  });

  test('去重表有上限:超过 500 条裁掉最旧,保留最新导入', async () => {
    const old = Array.from({ length: 500 }, (_, i) => `old-${i}.png`);
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: { '42': old } });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 2, item_id: 'imp-2', type: 'image', status: 'ready', url: '/p/n.png', reference: { source_filename: 'new.png' }, canvas_x: 0, canvas_y: 0 });
    await useStore.getState().importGeneratedAsset({ filename: 'new.png', path: 'assets/new.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/new.png' });
    const list = useStore.getState().importedByProject['42'];
    expect(list).toHaveLength(500);
    expect(list[list.length - 1]).toBe('assets/new.png');
    expect(list).not.toContain('old-0.png'); // 最旧一条被裁掉
  });

  test('已导入路径跳过,不再调 from-url', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: { '42': ['assets/hero.png'] } });
    await useStore.getState().importGeneratedAsset({ filename: 'hero.png', path: 'assets/hero.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/hero.png' });
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
  });

  test('无 preview_url 时跳过,不调 from-url 也不记去重', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {} });
    await useStore.getState().importGeneratedAsset({ filename: 'no-url.png', path: 'assets/no-url.png', kind: 'image', previewUrl: null });
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
    expect(useStore.getState().importedByProject['42'] ?? []).not.toContain('no-url.png');
  });

  test('from-url 抛 PgcError 写 toast,不记入 importedByProject', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {} });
    api.writeCanvasItemFromUrl.mockRejectedValue(new PgcError('FETCH_FAILED', '拉取失败', 502));
    await useStore.getState().importGeneratedAsset({ filename: 'missing.png', path: 'assets/missing.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/missing.png' });
    expect(useStore.getState().toast?.code).toBe('FETCH_FAILED');
    expect(useStore.getState().importedByProject['42'] ?? []).not.toContain('missing.png');
  });

  test('已有资产占位时向下避让落位', async () => {
    useStore.setState({ currentProjectId: 42, importedByProject: {},
      assets: [{ id: 'x', key: 'x', label: 'x', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 } }] });
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 2, item_id: 'imp-2', type: 'image', status: 'ready', url: null, reference: null });
    await useStore.getState().importGeneratedAsset({ filename: 'next.png', path: 'assets/next.png', kind: 'image', previewUrl: 'https://pgc.example/preview/42/next.png' });
    expect(api.writeCanvasItemFromUrl.mock.calls[0][1].canvas_x).toBe(0);
    // 避让按已占卡的「真实高」推(image=200),不是 CARD_H(150)——否则两张 image 卡贴死压边
    expect(api.writeCanvasItemFromUrl.mock.calls[0][1].canvas_y).toBe(CARD_SIZE.image.h + GAP_Y);
    expect(useStore.getState().assets.find((a) => a.id === 'imp-2')).toBeTruthy();
    expect(useStore.getState().importedByProject['42']).toContain('assets/next.png');
  });
});

describe('genTasksByProject 持久化', () => {
  test('registerAgentGenTask 后 genTasksByProject 按当前项目登记任务', async () => {
    useStore.setState({ currentProjectId: 7, assets: [], genTasks: [], genTasksByProject: {} });
    api.pollVideo.mockResolvedValue({ task_id: 't9', status: 'queued', item: { id: 1, item_id: 'vid-9', type: 'video', status: 'generating', url: null } });
    await useStore.getState().registerAgentGenTask('t9', 'video');
    expect(useStore.getState().genTasksByProject['7']).toHaveLength(1);
    expect(useStore.getState().genTasksByProject['7'][0].taskId).toBe('t9');
  });

  // 「跨刷新」的唯一落点就是 partialize 那一行,且少一个键 tsc 不报(返回的是对象字面量)——
  // 没有这条护栏,将来整理白名单误删它,CI 全绿而线上回到「刷新吞掉在飞生成」(评审 I1)
  test('inflightCardsByProject 持久化到 localStorage(partialize 含它)', () => {
    localStorage.clear();
    useStore.setState({ inflightCardsByProject: { '7': [{ id: 'pending_p1', key: 'pending_p1', label: 'x', kind: 'video',
      source: 'generated', status: 'generating', position: { x: 1, y: 2 } } as unknown as Asset] } });
    window.dispatchEvent(new Event('pagehide'));
    const raw = localStorage.getItem('rezonalab-v4');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.inflightCardsByProject['7'][0].id).toBe('pending_p1');
  });

  test('genTasksByProject 持久化到 localStorage(partialize 含 genTasksByProject)', () => {
    localStorage.clear();
    useStore.setState({ genTasksByProject: { '7': [{ itemId: 'vid-9', kind: 'video', taskId: 't9', startedAt: 123 }] } });
    // 持久化的序列化与写入已节流合并(见 persist-storage/createThrottledPersistStorage),不再逐次同步落盘;
    // pagehide 会立即 flush 最新快照,故此处先触发 flush 再断言
    window.dispatchEvent(new Event('pagehide'));
    const raw = localStorage.getItem('rezonalab-v4');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.genTasksByProject['7'][0].taskId).toBe('t9');
  });
});

describe('对话窗附件上传/移除', () => {
  test('uploadChatAttachment 成功 → 附件 ready 带 url/itemId/kind,标记 chat_attachment,且不入 assets', async () => {
    useStore.setState({ currentProjectId: 7, assets: [], composer: { draft: '', attachments: [], baseLines: 2 } });
    api.updateCanvasReference.mockResolvedValue({});
    uploadMock.mockResolvedValue({ id: 1, item_id: 'ci1', type: 'image', status: 'ready', url: 'http://x/a.png' });

    const file = new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });
    await useStore.getState().uploadChatAttachment(file);

    const att = useStore.getState().composer.attachments;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ name: 'a.png', kind: 'image', status: 'ready', url: 'http://x/a.png', itemId: 'ci1' });
    expect(api.updateCanvasReference).toHaveBeenCalledWith(7, 'ci1', { chat_attachment: true });
    expect(useStore.getState().assets).toEqual([]);
  });

  test('uploadChatAttachment 失败(PgcError)→ 附件 error + toast', async () => {
    useStore.setState({ currentProjectId: 7, composer: { draft: '', attachments: [], baseLines: 2 } });
    uploadMock.mockRejectedValue(new PgcError('UPLOAD', '太大了', 413));
    await useStore.getState().uploadChatAttachment(new File([], 'b.png', { type: 'image/png' }));
    expect(useStore.getState().composer.attachments[0].status).toBe('error');
    expect(useStore.getState().toast).toMatchObject({ code: 'UPLOAD' });
  });

  test('removeChatAttachment 有 itemId → 调 deleteCanvasItem 并移除', () => {
    useStore.setState({
      currentProjectId: 7,
      composer: { draft: '', attachments: [{ id: 'x', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png', itemId: 'ci1' }], baseLines: 2 },
    });
    useStore.getState().removeChatAttachment('x');
    expect(api.deleteCanvasItem).toHaveBeenCalledWith(7, 'ci1');
    expect(useStore.getState().composer.attachments).toEqual([]);
  });

  test('removeChatAttachment 无 itemId(上传中)→ 仅本地移除,不调删除', () => {
    useStore.setState({
      currentProjectId: 7,
      composer: { draft: '', attachments: [{ id: 'y', name: 'a.png', mime: 'image/png', kind: 'image', status: 'uploading' }], baseLines: 2 },
    });
    useStore.getState().removeChatAttachment('y');
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
    expect(useStore.getState().composer.attachments).toEqual([]);
  });
});

describe('registerAgentGenTask(agent 生成 → 画布加载卡 + 轮询)', () => {
  const item = (id: string, status = 'generating', type = 'video') => ({ item_id: id, type, status, url: status === 'ready' ? `https://x/${id}.mp4` : null, name: id });

  beforeEach(() => {
    useStore.setState({ currentProjectId: 7, assets: [], genTasks: [], agentTasksByProject: {} });
  });

  test('首拉拿到 generating item → 落真实 item_id 卡(generating) + 登记 GenTask + 记去重', async () => {
    api.pollVideo.mockResolvedValue({ task_id: 'gt1', status: 'running', item: item('itm1') });
    await useStore.getState().registerAgentGenTask('gt1', 'video');
    const st = useStore.getState();
    expect(api.pollVideo).toHaveBeenCalledWith(7, 'gt1');
    expect(st.assets.map((a) => a.id)).toEqual(['itm1']);            // 占位卡已被真实卡原位替换
    expect(st.assets[0].status).toBe('generating');
    expect(st.genTasks).toEqual([expect.objectContaining({ itemId: 'itm1', kind: 'video', taskId: 'gt1' })]);
    expect(st.agentTasksByProject['7']).toContain('gt1');
  });

  test('首拉即 ready → 落 ready 卡,不登记 GenTask(无需轮询)', async () => {
    api.pollVideo.mockResolvedValue({ task_id: 'gt2', status: 'succeeded', item: item('itm2', 'ready') });
    await useStore.getState().registerAgentGenTask('gt2', 'video');
    const st = useStore.getState();
    expect(st.assets.map((a) => a.id)).toEqual(['itm2']);
    expect(st.assets[0].status).toBe('ready');
    expect(st.genTasks).toEqual([]);
    expect(st.agentTasksByProject['7']).toContain('gt2');
  });

  // —— 血缘归因(异步任务):占位卡出现时就已连线并落在源卡右侧,产物回来原位替换不跳位 ——
  const SRC_URL = 'https://pgc.example/preview/7/hero.png';
  const srcCard = {
    id: 'img-src', key: 'img-src', label: 'hero', kind: 'image' as const, source: 'generated' as const,
    status: 'ready' as const, position: { x: 300, y: 400 }, preview: { src: SRC_URL },
  };
  const submitMsg = (taskId: string, input: unknown) => ({
    id: `m-${taskId}`, role: 'assistant' as const, status: 'ready' as const,
    parts: [{
      type: 'tool' as const, id: `toolu-${taskId}`, name: 'mcp__media__submit_model3d_generation',
      input, status: 'ready' as const,
      result: JSON.stringify({ type: 'media.task_submitted', kind: 'model3d', task_id: taskId }),
    }],
  });

  test('图生 3D 的 source_url 命中源卡 → 占位卡即带 parentId 且落在源卡右侧', async () => {
    useStore.setState({ assets: [srcCard], messages: [submitMsg('gt-l1', { source_url: SRC_URL })] });
    // 首拉停在 running 且 item 缺失:占位卡保留,便于断言占位卡自身的血缘与坐标
    api.pollModel3d.mockResolvedValue({ task_id: 'gt-l1', status: 'running', item: null });
    await useStore.getState().registerAgentGenTask('gt-l1', 'model3d');

    const placeholder = useStore.getState().assets.find((a) => a.id !== 'img-src')!;
    expect(placeholder).toMatchObject({ parentId: 'img-src', source: 'derived', status: 'generating' });
    expect(placeholder.position.x).toBeGreaterThan(srcCard.position.x);
  });

  test('产物回来 adopt 后 parentId 保留(不被服务端旧 reference 冲掉)', async () => {
    useStore.setState({ assets: [srcCard], messages: [submitMsg('gt-l2', { source_url: SRC_URL })] });
    api.pollModel3d.mockResolvedValue({ task_id: 'gt-l2', status: 'running', item: item('itm-l2', 'generating', 'model3d') });
    await useStore.getState().registerAgentGenTask('gt-l2', 'model3d');

    expect(useStore.getState().assets.find((a) => a.id === 'itm-l2')).toMatchObject({ parentId: 'img-src' });
  });

  // —— 创作溯源(异步路径):与血缘同一次回溯,挂在占位卡上由 adoptAgentItem 携带到真实卡 ——
  test('占位卡即带溯源,adopt 后真实卡仍带(服务端那份没有,不得被 undefined 冲掉)', async () => {
    const input = { prompt: '一只宝箱', model_version: 'v2.5-20250123', pbr: true };
    useStore.setState({ assets: [], messages: [submitMsg('gt-p1', input)] });
    api.pollModel3d.mockResolvedValue({ task_id: 'gt-p1', status: 'running', item: item('itm-p1', 'generating', 'model3d') });
    await useStore.getState().registerAgentGenTask('gt-p1', 'model3d');

    expect(useStore.getState().assets.find((a) => a.id === 'itm-p1')?.provenance)
      .toEqual({ kind: '3d', req: input, at: expect.any(String), agent: true });
  });

  // 占位卡还在时走的是 else 分支(**无条件**回写坐标),故本条不钉回写条件,只钉「溯源确实进了 reference」;
  // 回写条件由紧随其后的「loadCanvas 抢先 + 纯文生」那条钉死(评审 M4)
  test('纯文生(无血缘、有溯源)→ 溯源随 reference 一并回写', async () => {
    const input = { prompt: '纯文生的宝箱' };
    useStore.setState({ assets: [], messages: [submitMsg('gt-p2', input)] });
    api.pollModel3d.mockResolvedValue({ task_id: 'gt-p2', status: 'running', item: item('itm-p2', 'generating', 'model3d') });
    api.batchUpdateCanvasItems.mockResolvedValue({ updated: 1, failed: [] });
    await useStore.getState().registerAgentGenTask('gt-p2', 'model3d');

    const written = api.batchUpdateCanvasItems.mock.calls
      .flatMap((c) => c[1] as { item_id: string; reference: Record<string, unknown> }[])
      .filter((it) => it.item_id === 'itm-p2');
    expect(written.length).toBeGreaterThan(0);
    expect(written.at(-1)!.reference).toMatchObject({ provenance: { req: input, agent: true } });
    expect(useStore.getState().assets.find((a) => a.id === 'itm-p2')?.parentId).toBeUndefined();
  });

  // loadCanvas 抢先分支是回写条件真正管着的地方(占位卡还在那条分支本来就无条件回写)。
  // 纯文生 + 抢先 = 无血缘可写但有溯源要写,条件只看血缘就会把溯源留在内存,刷新即丢
  test('loadCanvas 抢先 + 纯文生:无血缘但有溯源,仍须回写落库', async () => {
    const input = { prompt: '抢先落表的纯文生宝箱' };
    useStore.setState({ assets: [], messages: [submitMsg('gt-p3', input)] });
    api.pollModel3d.mockImplementation(async () => {
      // 首拉在途期间 loadCanvas 把真实卡带进来了(服务端那份既无血缘也无溯源)
      useStore.setState({ assets: [...useStore.getState().assets, {
        id: 'itm-p3', key: 'itm-p3', label: 'itm-p3', kind: '3d' as const, source: 'generated' as const,
        status: 'generating' as const, position: { x: 11, y: 22 },
      }] });
      return { task_id: 'gt-p3', status: 'running', item: item('itm-p3', 'generating', 'model3d') };
    });
    await useStore.getState().registerAgentGenTask('gt-p3', 'model3d');

    expect(useStore.getState().assets.find((a) => a.id === 'itm-p3')?.provenance)
      .toMatchObject({ req: input, agent: true });
    expect(refWriteFor('itm-p3')).toMatchObject({ provenance: { req: input, agent: true } });
  });

  // loadCanvas 抢先(run.finished 后台刷画布与首拉赛跑):真实卡已在表里 → 走原位更新分支。
  // 血缘只留在内存等于白连 —— 下一次整表替换(loadCanvas 无本地合并,actions.ts:181)就冲掉,
  // 用户看到的正是「产物回来时有连线,刷一下没了」
  test('loadCanvas 抢先时血缘也要回写落库(否则刷新即丢)', async () => {
    useStore.setState({ assets: [srcCard], messages: [submitMsg('gt-l4', { source_url: SRC_URL })] });
    api.pollModel3d.mockImplementation(async () => {
      // 首拉在途期间 loadCanvas 把真实卡带进来了(服务端那份没有血缘)
      useStore.setState({ assets: [...useStore.getState().assets, { ...srcCard, id: 'itm-l4', key: 'itm-l4', parentId: undefined, preview: undefined, kind: '3d' as const, status: 'generating' as const }] });
      return { task_id: 'gt-l4', status: 'running', item: item('itm-l4', 'generating', 'model3d') };
    });
    await useStore.getState().registerAgentGenTask('gt-l4', 'model3d');

    expect(useStore.getState().assets.find((a) => a.id === 'itm-l4')).toMatchObject({ parentId: 'img-src' });
    expect(refWriteFor('itm-l4')).toMatchObject({ parent_id: 'img-src' });
  });

  test('无源(纯文生 3D)→ 占位卡无 parentId,落位与现状一致', async () => {
    useStore.setState({ assets: [srcCard], messages: [submitMsg('gt-l3', { prompt: '一棵树' })] });
    api.pollModel3d.mockResolvedValue({ task_id: 'gt-l3', status: 'running', item: null });
    await useStore.getState().registerAgentGenTask('gt-l3', 'model3d');

    const placeholder = useStore.getState().assets.find((a) => a.id !== 'img-src')!;
    expect(placeholder.parentId).toBeUndefined();
    expect(placeholder.source).not.toBe('derived');
  });

  test('重复 taskId(已在去重集)→ 直接返回,不重复落卡/不再 poll', async () => {
    useStore.setState({ agentTasksByProject: { '7': ['gt3'] } });
    await useStore.getState().registerAgentGenTask('gt3', 'video');
    expect(api.pollVideo).not.toHaveBeenCalled();
    expect(useStore.getState().assets).toEqual([]);
  });

  test('首拉 RPC 失败 → 移除占位卡,不记去重(可重试),toast 置位', async () => {
    api.pollVideo.mockRejectedValue(new PgcError('GEN_FAILED', 'boom', 500));
    await useStore.getState().registerAgentGenTask('gt4', 'video');
    const st = useStore.getState();
    expect(st.assets).toEqual([]);                                   // 占位卡已移除
    expect(st.agentTasksByProject['7'] ?? []).not.toContain('gt4');  // 未记去重
    expect(st.toast?.code).toBe('GEN_FAILED');
  });

  // 契约已变(spec 2026-08-03-canvas-gen-failure-retry):失败不再删卡,占位卡就地转失败态供用户看原因
  test('首拉任务级失败(status=failed)→ 占位卡转失败态 + Toast(透传 failure) + 记去重', async () => {
    api.pollModel3d.mockResolvedValue({ task_id: 'gt5', status: 'failed', item: null, failure: { code: 'PROVIDER_X', category: 'x', message: '违规', retryable: false } });
    await useStore.getState().registerAgentGenTask('gt5', 'model3d');
    const st = useStore.getState();
    expect(st.assets).toHaveLength(1);
    expect(st.assets[0].status).toBe('error');
    expect(st.assets[0].failure).toMatchObject({ code: 'PROVIDER_X', message: '违规' });
    expect(st.toast).toEqual(expect.objectContaining({ code: 'PROVIDER_X', message: '违规' }));
    expect(st.agentTasksByProject['7']).toContain('gt5');
  });

  test('首拉暂无 item → 保留占位卡 + 登记 GenTask(itemId=占位卡 id) + 记去重', async () => {
    api.pollVideo.mockResolvedValue({ task_id: 'gt6', status: 'pending', item: null });
    await useStore.getState().registerAgentGenTask('gt6', 'video');
    const st = useStore.getState();
    expect(st.assets).toHaveLength(1);
    expect(st.assets[0].id.startsWith('pending_')).toBe(true);
    expect(st.assets[0].status).toBe('generating');
    expect(st.genTasks).toEqual([expect.objectContaining({ itemId: st.assets[0].id, taskId: 'gt6', kind: 'video' })]);
    expect(st.agentTasksByProject['7']).toContain('gt6');
  });

  test('upsert:loadCanvas 抢先拉到同 item_id → 不重复 add,原位更新并删占位卡', async () => {
    // 预置一张已由 loadCanvas 落上来的同 item_id 卡(自带前端坐标)
    useStore.setState({ assets: [{ id: 'itm7', key: 'itm7', label: 'itm7', kind: 'video', source: 'generated', status: 'generating', position: { x: 111, y: 222 } }] });
    api.pollVideo.mockResolvedValue({ task_id: 'gt7', status: 'running', item: item('itm7') });
    await useStore.getState().registerAgentGenTask('gt7', 'video');
    const st = useStore.getState();
    const ids = st.assets.map((a) => a.id);
    expect(ids.filter((id) => id === 'itm7')).toHaveLength(1);       // 不重复
    expect(ids.some((id) => id.startsWith('pending_'))).toBe(false); // 占位卡已删
    expect(st.assets.find((a) => a.id === 'itm7')?.position).toEqual({ x: 111, y: 222 }); // 保留前端坐标
  });

  test('pollGenTasks 适配:占位卡 GenTask 首次拿到 ready item → 替换真实卡 + 移除任务', async () => {
    useStore.setState({
      assets: [{ id: 'pending_x', key: 'pending_x', label: '', kind: 'video', source: 'generated', status: 'generating', position: { x: 5, y: 6 } }],
      genTasks: [{ itemId: 'pending_x', kind: 'video', taskId: 'gt8', startedAt: Date.now(), fails: 0 }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 'gt8', status: 'succeeded', item: item('itm8', 'ready') });
    await useStore.getState().pollGenTasks();
    const st = useStore.getState();
    expect(st.assets.map((a) => a.id)).toEqual(['itm8']);
    expect(st.assets[0].position).toEqual({ x: 5, y: 6 });          // 保留占位卡坐标
    expect(st.genTasks).toEqual([]);
  });
});

describe('importProjectArchive(压缩包导入项目)', () => {
  const importArchiveMock = importProjectArchive as unknown as ReturnType<typeof vi.fn>;
  const importedProject = {
    ...proj(9, 'Imported'),
    version_id: 'v1', version_status: 'ready', play_url: '/play/x', preview_url: '/pv/x', file_count: 3,
    assets: [
      { type: 'image', rel_path: 'src/assets/hero.png', name: 'hero', source_url: '/pv/x/hero.png', thumbnail_url: null, meta_url: null },
      { type: 'audio', rel_path: 'src/assets/bgm.mp3', name: 'bgm', source_url: '/pv/x/bgm.mp3', thumbnail_url: null, meta_url: null },
    ],
  };
  const file = new File(['z'], 'game.zip');

  beforeEach(() => {
    // selectProject 内 loadCanvas/loadVersions 需要可解析的返回
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
  });

  test('成功:并入项目列表、切到新项目、逐条落画布', async () => {
    importArchiveMock.mockResolvedValue(importedProject);
    api.writeCanvasItemFromUrl
      .mockResolvedValueOnce({ item_id: 'ci1', type: 'image', name: 'hero', status: 'ready', canvas_x: 0, canvas_y: 0 })
      .mockResolvedValueOnce({ item_id: 'ci2', type: 'audio', name: 'bgm', status: 'ready', canvas_x: 0, canvas_y: 260 });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    const s = useStore.getState();
    expect(importArchiveMock).toHaveBeenCalledWith(file, 'Imported', expect.any(Function), expect.any(AbortSignal));
    expect(s.currentProjectId).toBe(9);
    expect(s.projects.map((p) => p.id)).toContain(9);
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(2);
    // type 直传枚举、name/reference 对齐契约
    // source 必须一并下发:压缩包里的素材是用户上传进来的,不填的话面板报「Generated」,
    // 且用户拖一下卡 assetReference 就把这个错值固化进服务端(终审 rv-canvas-provenance)
    expect(api.writeCanvasItemFromUrl.mock.calls[0][1]).toMatchObject({
      type: 'image', name: 'hero', reference: { import_rel_path: 'src/assets/hero.png', source: 'uploaded' },
    });
    expect(s.assets.map((a) => a.id)).toEqual(['ci1', 'ci2']);
    // 同素材库那处:mock 不回显 reference,本地这份仍须是 uploaded(否则面板报 Generated)
    expect(s.assets.map((a) => a.source)).toEqual(['uploaded', 'uploaded']);
  });

  test('上传失败:reject + toast,不切项目', async () => {
    importArchiveMock.mockRejectedValue(new PgcError('ARCHIVE_TOO_LARGE', '包太大', 413));
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await expect(useStore.getState().importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ARCHIVE_TOO_LARGE' });
    expect(useStore.getState().currentProjectId).toBe(1);
    expect(useStore.getState().toast?.code).toBe('ARCHIVE_TOO_LARGE');
  });

  test('落画布途中切走项目:丢弃后续写入', async () => {
    importArchiveMock.mockResolvedValue(importedProject);
    // 第一条 import 返回时模拟用户已切走
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      useStore.setState({ currentProjectId: 1 });
      return { item_id: 'ci1', type: 'image', name: 'hero', status: 'ready', canvas_x: 0, canvas_y: 0 };
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(1);   // 第二条不再发起
    expect(useStore.getState().assets).toEqual([]);                 // 过期写入被丢弃
  });

  test('单条素材失败:其余照常,弹一次部分失败 Toast', async () => {
    importArchiveMock.mockResolvedValue(importedProject);
    api.writeCanvasItemFromUrl
      .mockRejectedValueOnce(new PgcError('IMPORT_FAILED', 'x', 500))
      .mockResolvedValueOnce({ item_id: 'ci2', type: 'audio', name: 'bgm', status: 'ready', canvas_x: 0, canvas_y: 0 });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    const s = useStore.getState();
    expect(s.assets.map((a) => a.id)).toEqual(['ci2']);
    expect(s.toast?.code).toBe('IMPORT_ASSETS_PARTIAL');
  });

  test('无素材导入:不触发整理回写', async () => {
    importArchiveMock.mockResolvedValue({ ...importedProject, assets: [] });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
    expect(refWrittenIds()).toEqual([]);
  });

  test('状态机:uploading(带进度)→creating→importing_assets(计数)→结束清 null', async () => {
    const seen: unknown[] = [];
    importArchiveMock.mockImplementation(async (_f: File, _n: string, onProgress: (r: number) => void) => {
      // 上传中回报进度:此刻应处 uploading 且 progress 跟随
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'uploading', progress: 0 });
      onProgress(0.4);
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'uploading', progress: 0.4 });
      return importedProject;
    });
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      seen.push(useStore.getState().importArchiveStatus);   // 素材阶段逐条采样
      return { item_id: 'ci' + seen.length, type: 'image', name: 'x', status: 'ready', canvas_x: 0, canvas_y: 0 };
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    expect(seen[0]).toMatchObject({ step: 'importing_assets', done: 0, total: 2 });
    expect(seen[1]).toMatchObject({ step: 'importing_assets', done: 1, total: 2 });
    expect(useStore.getState().importArchiveStatus).toBeNull();   // 结束清态
  });

  test('cancelImportArchive:uploading 阶段 abort signal;非 uploading 阶段 no-op', async () => {
    let captured: AbortSignal | null = null;
    let release: (v: unknown) => void = () => {};
    importArchiveMock.mockImplementation((_f: File, _n: string, _p: unknown, signal: AbortSignal) => {
      captured = signal;
      return new Promise((res) => { release = res; });   // 挂起模拟上传在途
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    const run = useStore.getState().importProjectArchive(file, 'Imported');
    await vi.waitFor(() => expect(captured).not.toBeNull());
    useStore.getState().cancelImportArchive();
    expect(captured!.aborted).toBe(true);   // uploading 阶段:真 abort
    release(importedProject);   // 假 client 不感知 abort,照常返回;真实 client 会 reject ABORTED
    await run;
    // 结束后再调:状态已清,no-op 不抛
    expect(() => useStore.getState().cancelImportArchive()).not.toThrow();
  });

  test('ABORTED 静默:不写 toast、清状态,但照样 reject', async () => {
    importArchiveMock.mockRejectedValue(new PgcError('ABORTED', 'Upload aborted', 0));
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await expect(useStore.getState().importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ABORTED' });
    expect(useStore.getState().toast).toBeNull();
    expect(useStore.getState().importArchiveStatus).toBeNull();
    expect(useStore.getState().currentProjectId).toBe(1);
  });

  test('非 ABORTED 失败:仍写 toast 且清状态', async () => {
    importArchiveMock.mockRejectedValue(new PgcError('ARCHIVE_TOO_LARGE', '包太大', 413));
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await expect(useStore.getState().importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ARCHIVE_TOO_LARGE' });
    expect(useStore.getState().toast?.code).toBe('ARCHIVE_TOO_LARGE');
    expect(useStore.getState().importArchiveStatus).toBeNull();
  });

  test('上传成功→success toast;素材完成→done 态停留 1.2s 后清态才 resolve', async () => {
    vi.useFakeTimers();
    try {
      importArchiveMock.mockResolvedValue(importedProject);
      api.writeCanvasItemFromUrl.mockResolvedValue({ item_id: 'ci1', type: 'image', name: 'x', status: 'ready', canvas_x: 0, canvas_y: 0 });
      useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
      let resolved = false;
      const run = useStore.getState().importProjectArchive(file, 'Imported').then(() => { resolved = true; });
      // 推进到素材完成:微任务耗尽后应处于 done 态且尚未 resolve
      await vi.advanceTimersByTimeAsync(0);
      expect(useStore.getState().toast).toMatchObject({ code: 'PROJECT_IMPORTED', kind: 'success' });
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'done', done: 2, total: 2 });
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1200);
      await run;
      expect(useStore.getState().importArchiveStatus).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resumeImportQueue(压缩包导入中断续跑)', () => {
  const queueItem = (relPath: string, name = relPath) => ({ sourceUrl: `/pv/x/${name}`, type: 'image', name, relPath });

  beforeEach(() => {
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
  });

  test('持久化队列有剩余:续跑落画布并清队列;弹窗态完整走 importing_assets→done→清 null', async () => {
    vi.useFakeTimers();
    try {
      const seen: unknown[] = [];
      api.writeCanvasItemFromUrl.mockImplementation(async () => {
        seen.push(useStore.getState().importArchiveStatus);   // 逐条采样弹窗态
        return { item_id: `ci${seen.length}`, type: 'image', name: 'x', status: 'ready', canvas_x: 0, canvas_y: 0 };
      });
      useStore.setState({
        currentProjectId: 9, projects: [proj(9)],
        importQueueByProject: { '9': { total: 2, items: [queueItem('a.png'), queueItem('b.png')] } },
      });
      const run = useStore.getState().resumeImportQueue(9);
      await vi.advanceTimersByTimeAsync(0);
      // done 停留态:进度已到 2/2
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'done', done: 2, total: 2 });
      await vi.advanceTimersByTimeAsync(1200);
      await run;
      const s = useStore.getState();
      expect(seen[0]).toMatchObject({ step: 'importing_assets', done: 0, total: 2 });
      expect(seen[1]).toMatchObject({ step: 'importing_assets', done: 1, total: 2 });
      expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(2);
      expect(s.assets.map((a) => a.id)).toEqual(['ci1', 'ci2']);
      expect(s.importQueueByProject['9']).toBeUndefined();   // 跑完清键
      expect(s.importArchiveStatus).toBeNull();              // 停留结束清态,弹窗随之卸载
    } finally {
      vi.useRealTimers();
    }
  });

  test('还原进度:去重后从中断处继续计数(done 从 total-剩余 起步)', async () => {
    vi.useFakeTimers();
    try {
      let statusDuringWrite: unknown;
      api.writeCanvasItemFromUrl.mockImplementation(async () => {
        statusDuringWrite = useStore.getState().importArchiveStatus;
        return { item_id: 'ci3', type: 'image', name: 'c', status: 'ready', canvas_x: 0, canvas_y: 0 };
      });
      useStore.setState({
        currentProjectId: 9, projects: [proj(9)],
        assets: [{ ...makeAsset('image', { label: 'a' }), importRelPath: 'a.png' }],
        // total=3:a 已在画布(去重),b 已出队,仅剩 c → 续跑起点 done=2
        importQueueByProject: { '9': { total: 3, items: [queueItem('a.png'), queueItem('c.png')] } },
      });
      const run = useStore.getState().resumeImportQueue(9);
      await vi.advanceTimersByTimeAsync(1200);
      await run;
      expect(statusDuringWrite).toMatchObject({ step: 'importing_assets', done: 2, total: 3 });
      expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(1);   // a.png 去重跳过
      expect(api.writeCanvasItemFromUrl.mock.calls[0][1]).toMatchObject({ reference: { import_rel_path: 'c.png', source: 'uploaded' } });
      expect(useStore.getState().importArchiveStatus).toBeNull();
      expect(useStore.getState().importQueueByProject['9']).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('空队列 no-op(不亮弹窗态);用户导入在途时不抢状态通道', async () => {
    await useStore.getState().resumeImportQueue(9);
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
    expect(useStore.getState().importArchiveStatus).toBeNull();

    // 用户主导的导入在途(status 非空):resume 直接返回,不动队列
    useStore.setState({
      currentProjectId: 9, projects: [proj(9)],
      importArchiveStatus: { step: 'uploading', progress: 0.5, done: 0, total: 0 },
      importQueueByProject: { '9': { total: 1, items: [queueItem('a.png')] } },
    });
    await useStore.getState().resumeImportQueue(9);
    expect(api.writeCanvasItemFromUrl).not.toHaveBeenCalled();
    expect(useStore.getState().importQueueByProject['9']).toEqual({ total: 1, items: [queueItem('a.png')] });
  });

  test('写入失败:整轮跑完清队列不落画布,弹窗态最终清 null', async () => {
    vi.useFakeTimers();
    try {
      api.writeCanvasItemFromUrl.mockRejectedValue(new PgcError('IMPORT_FAILED', 'x', 500));
      useStore.setState({
        currentProjectId: 9, projects: [proj(9)],
        importQueueByProject: { '9': { total: 1, items: [queueItem('a.png')] } },
      });
      const run = useStore.getState().resumeImportQueue(9);
      await vi.advanceTimersByTimeAsync(1200);
      await run;
      // 整轮跑完(仅剩失败项)清队列避免无限重试挂账;失败弹一次部分失败 Toast
      expect(useStore.getState().assets).toEqual([]);
      expect(useStore.getState().importQueueByProject['9']).toBeUndefined();
      expect(useStore.getState().toast?.code).toBe('IMPORT_ASSETS_PARTIAL');
      expect(useStore.getState().importArchiveStatus).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('selectProject 进入项目自动触发续跑', async () => {
    api.writeCanvasItemFromUrl.mockResolvedValue({ item_id: 'ci1', type: 'image', name: 'a', status: 'ready', canvas_x: 0, canvas_y: 0 });
    useStore.setState({
      currentProjectId: 1, projects: [proj(1), proj(9)],
      importQueueByProject: { '9': { total: 1, items: [queueItem('a.png')] } },
    });
    await useStore.getState().selectProject(9);
    await vi.waitFor(() => expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useStore.getState().importQueueByProject['9']).toBeUndefined());
    expect(useStore.getState().assets.map((a) => a.id)).toEqual(['ci1']);
  });

  test('切走项目中断续跑:剩余队列保留(含 total),弹窗态被清', async () => {
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      useStore.setState({ currentProjectId: 1 });   // 第一条返回时用户已切走
      return { item_id: 'ci1', type: 'image', name: 'a', status: 'ready', canvas_x: 0, canvas_y: 0 };
    });
    useStore.setState({
      currentProjectId: 9, projects: [proj(9)],
      importQueueByProject: { '9': { total: 2, items: [queueItem('a.png'), queueItem('b.png')] } },
    });
    await useStore.getState().resumeImportQueue(9);
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(1);
    expect(useStore.getState().importQueueByProject['9']).toEqual({ total: 2, items: [queueItem('b.png')] });   // b 留待下次,total 不变
    expect(useStore.getState().importArchiveStatus).toBeNull();   // finally 清态,弹窗不悬挂
  });

  test('首次导入即持久化队列(带 total);完成后清空', async () => {
    const importArchiveMock = importProjectArchive as unknown as ReturnType<typeof vi.fn>;
    importArchiveMock.mockResolvedValue({
      ...proj(9, 'Imported'),
      version_id: 'v1', version_status: 'ready', play_url: '/play/x', preview_url: '/pv/x', file_count: 1,
      assets: [{ type: 'image', rel_path: 'hero.png', name: 'hero', source_url: '/pv/x/hero.png', thumbnail_url: null, meta_url: null }],
    });
    let queueDuringWrite: unknown;
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      queueDuringWrite = useStore.getState().importQueueByProject['9'];   // 写入在途:队列已持久化
      return { item_id: 'ci1', type: 'image', name: 'hero', status: 'ready', canvas_x: 0, canvas_y: 0 };
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(new File(['z'], 'game.zip'), 'Imported');
    expect(queueDuringWrite).toEqual({ total: 1, items: [{ sourceUrl: '/pv/x/hero.png', type: 'image', name: 'hero', relPath: 'hero.png' }] });
    expect(useStore.getState().importQueueByProject['9']).toBeUndefined();
  });
});

describe('replay 状态与素材分流', () => {
  test('setReplaySpeed / setReplayCursor / setReplayTotal / skipReplay 改 replay 摘要', () => {
    useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's', total: 0, cursor: 0, speed: 1 } });
    useStore.getState().setReplayTotal(10);
    useStore.getState().setReplayCursor(3);
    useStore.getState().setReplaySpeed(2);
    useStore.getState().skipReplay();
    const r = useStore.getState().replay!;
    expect(r.total).toBe(10);
    expect(r.cursor).toBe(3);
    expect(r.speed).toBe(2);
    expect(r.phase).toBe('skipping');
  });

  test('replay 为 null 时 setter no-op(不抛)', () => {
    useStore.setState({ replay: null });
    expect(() => useStore.getState().setReplayCursor(5)).not.toThrow();
    expect(useStore.getState().replay).toBeNull();
  });

  test('failReplay:置 error 态 + 弹 toast(供 useReplayPlayer 播放期拉取失败时调用)', () => {
    useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's', total: 5, cursor: 2, speed: 1 } });
    useStore.getState().failReplay('REPLAY_LOAD_FAILED');
    const r = useStore.getState().replay!;
    expect(r.phase).toBe('error');
    expect(r.errorCode).toBe('REPLAY_LOAD_FAILED');
    expect(useStore.getState().toast).toMatchObject({ code: 'REPLAY_LOAD_FAILED', kind: 'error' });
  });

  test('failReplay:replay 已被收尾为 null 时不复活它,但仍弹 toast(错误真实发生,不因竞态吞掉)', () => {
    useStore.setState({ replay: null });
    useStore.getState().failReplay('REPLAY_LOAD_FAILED');
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().toast).toMatchObject({ code: 'REPLAY_LOAD_FAILED', kind: 'error' });
  });

  // 注:importGeneratedAsset/registerAgentGenTask 是本文件内闭包互调(见 CLAUDE.md「actions 通过本地闭包互相调用,
  // 从不经 get() 取 action」),vi.spyOn(useStore.getState(), 'xxx') 只替换 state 对象上的属性,拦不住闭包内部的直接调用
  // (已用探针验证:spy 计 0 次,真实 api.writeCanvasItemFromUrl 计 1 次)。故改走与上方 importFromLiveEvent 同款的
  // api mock 断言,直接验证「media 走导入通路 / task 不进轮询通路」这一可观察行为。
  const userToolResult = (content: string): ServerEvent => ({
    type: 'claude.message', project_id: '1', session_id: 's1',
    payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', content }] } },
  } as unknown as ServerEvent);

  test('importMediaFromEvent 回放 media 帧 → 调 writeCanvasItemFromUrl(与 live 共用 eventAssets 导入通路)', async () => {
    api.writeCanvasItemFromUrl.mockResolvedValue({ id: 'ci1', kind: 'image', name: 'hero.png', canvas_x: 0, canvas_y: 0 });
    useStore.setState({ currentProjectId: 1 });
    useStore.getState().importMediaFromEvent(userToolResult(JSON.stringify({
      type: 'media.tasks.status',
      items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'hero.png', preview_url: 'https://x/hero.png' }],
    })));
    await vi.waitFor(() => expect(api.writeCanvasItemFromUrl).toHaveBeenCalled());
    expect(api.writeCanvasItemFromUrl.mock.calls[0][1]).toMatchObject({ name: 'hero.png', type: 'image' });
  });

  test('importMediaFromEvent 丢弃 video/3D task,不调 pollVideo/pollModel3d(死任务 id 不轮询)', async () => {
    useStore.setState({ currentProjectId: 1 });
    useStore.getState().importMediaFromEvent(userToolResult(JSON.stringify({
      type: 'media.task_submitted', task_id: 'gt1', kind: 'video',
    })));
    await Promise.resolve(); await Promise.resolve();
    expect(api.pollVideo).not.toHaveBeenCalled();
    expect(api.pollModel3d).not.toHaveBeenCalled();
  });
});

describe('enterReplay 编排', () => {
  beforeEach(() => {
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
  });

  test('provisioning:start→selectProject→clone→finalize(v1)→phase=playing', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    (koubouApi.cloneFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ session_id: 'sess_c', already_provisioned: false });
    (pgcApi.finalizeReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'ready' });
    useStore.setState({ projects: [proj(7)], booting: true });
    await useStore.getState().enterReplay('tpl');
    const r = useStore.getState().replay!;
    expect(r.phase).toBe('playing');
    expect(r.projectId).toBe(7);
    expect(r.sessionId).toBe('sess_c');
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(pgcApi.finalizeReplay).toHaveBeenCalledWith(7, 'v1');
    // 回放不经 loadProjects 的 finally,须自行撤全局加载层,否则整段回放被 LoadingScreen 盖住
    expect(useStore.getState().booting).toBe(false);
  });

  test('clone 409 → listSessions 兜底既有会话后继续', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    (koubouApi.cloneFromTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new KoubouError(409, 'REPLAY_ALREADY_PROVISIONED', 200));
    (koubouApi.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{ session_id: 'sess_existing', project_id: '7', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }]);
    (pgcApi.finalizeReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'ready' });
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay!.sessionId).toBe('sess_existing');
    expect(useStore.getState().replay!.phase).toBe('playing');
  });

  test('ready:跳过 clone,listSessions 取 session 直接 playing', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'ready' });
    (koubouApi.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{ session_id: 'sess_r', project_id: '7', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }]);
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    expect(koubouApi.cloneFromTemplate).not.toHaveBeenCalled();
    expect(useStore.getState().replay!.phase).toBe('playing');
    expect(useStore.getState().replay!.sessionId).toBe('sess_r');
  });

  test('completed:不回放,replay=null,当正常项目', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'completed' });
    useStore.setState({ projects: [proj(7)], booting: true });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(koubouApi.cloneFromTemplate).not.toHaveBeenCalled();
    expect(useStore.getState().booting).toBe(false);
  });

  test('进入回放补拉项目列表(fire-and-forget):projects 不再为空(回归:回放入口绕过 loadProjects 项目菜单空)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    (koubouApi.cloneFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ session_id: 'sess_c', already_provisioned: false });
    (pgcApi.finalizeReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'ready' });
    api.listProjects.mockResolvedValue({ items: [proj(7), proj(8)], total: 2, page: 1, page_size: 100 });
    useStore.setState({ projects: [], booting: true });
    await useStore.getState().enterReplay('tpl');
    await Promise.resolve(); await Promise.resolve();   // refreshProjectList 是 fire-and-forget,冲刷微任务
    expect(api.listProjects).toHaveBeenCalled();
    expect(useStore.getState().projects.map((p) => p.id)).toEqual([7, 8]);
  });

  test('start 失败:phase=error + toast', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockRejectedValue(new PgcError('REPLAY_TEMPLATE_NOT_FOUND', '模板不存在', 404));
    useStore.setState({ booting: true });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay!.phase).toBe('error');
    expect(useStore.getState().replay!.errorCode).toBe('REPLAY_TEMPLATE_NOT_FOUND');
    expect(useStore.getState().toast?.code).toBe('REPLAY_TEMPLATE_NOT_FOUND');
    // provisioning 失败也要撤加载层,否则错误态被压在 LoadingScreen 下面看不见
    expect(useStore.getState().booting).toBe(false);
  });

  test('start 遇 401 → 只置 authRequired,不写 toast(未登录不报错)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockRejectedValue(new PgcError('UNAUTHORIZED', '未授权', 401));
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().toast).toBeNull();
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().authRequired).toBe(true);
    expect(useStore.getState().replay?.phase).toBe('error');
    expect(useStore.getState().toast).toBeNull();
  });

  test('start 遇未知错误 → phase=error 后照抛,不吞(暴露 bug)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await expect(useStore.getState().enterReplay('tpl')).rejects.toThrow('boom');
    expect(useStore.getState().replay?.phase).toBe('error');
  });

  // 同 bug #13870465 的一族:await 后校验作废本次编排时的早退,曾经漏撤加载层 —— 调用方是 bootstrap
  // 的 void enterReplay(),没人接手,LoadingScreen 也没有自身超时兜底,用户永久停在 loading 页。
  // 现由函数级 try/finally 统一收口(镜像 applyStudioPrelude),这两条钉住「任何出口都撤层」这个不变式,
  // 而非钉住某个手写撤层点 —— 以后新增早退/抛出路径也自动被覆盖。
  test('start 后编排作废(用户切走/重进)→ 早退也要撤 booting,不留 loading 页', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      // start 在途时用户又点了另一个模板:replay 被换成别的 templateId,本次编排作废
      useStore.setState({ replay: { ...useStore.getState().replay!, templateId: 'tpl-other' } });
      return { target_project_id: 7, template_id: 'tpl', status: 'provisioning' };
    });
    useStore.setState({ projects: [proj(7)], booting: true });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().currentProjectId).toBeNull();   // 确实走了早退,没往下编排
    expect(useStore.getState().booting).toBe(false);
  });

  test('selectProject 后编排作废 → 早退也要撤 booting,不留 loading 页', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    // selectProject 内部 await listVersions 期间用户切走,replay 被清空
    api.listVersions.mockImplementation(async () => {
      useStore.setState({ replay: null });
      return { items: [], total: 0 };
    });
    useStore.setState({ projects: [proj(7)], booting: true });
    await useStore.getState().enterReplay('tpl');
    expect(koubouApi.cloneFromTemplate).not.toHaveBeenCalled();  // 确实走了早退,没继续克隆
    expect(useStore.getState().booting).toBe(false);
  });
});

describe('completeReplay', () => {
  test('落快照 + state=completed + 置 handoff + replay=null', async () => {
    (pgcApi.updateReplayState as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'completed' });
    useStore.setState({
      currentProjectId: 7,
      replay: { phase: 'playing', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 3, cursor: 3, speed: 1 },
      sessionId: 'sess_c', lastSequence: 42, messages: [{ id: 'm1', role: 'assistant', status: 'ready', parts: [] }], turns: [], tasks: [],
    });
    useStore.getState().completeReplay();
    const s = useStore.getState();
    expect(s.replay).toBeNull();
    expect(s.replayHandoff).toEqual({ sessionId: 'sess_c', afterSequence: 42, projectId: 7 });
    expect(s.koubouByProject['7'].lastSequence).toBe(42);
    expect(s.koubouByProject['7'].messages).toHaveLength(1);
    expect(pgcApi.updateReplayState).toHaveBeenCalledWith(7, 'completed');
  });

  test('state=completed 失败不阻断(仍置 handoff、清 replay)', async () => {
    (pgcApi.updateReplayState as ReturnType<typeof vi.fn>).mockRejectedValue(new PgcError('X', 'x', 500));
    useStore.setState({
      currentProjectId: 7,
      replay: { phase: 'skipping', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 3, cursor: 1, speed: 1 },
      sessionId: 'sess_c', lastSequence: 10, messages: [], turns: [], tasks: [],
    });
    useStore.getState().completeReplay();
    await Promise.resolve();
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().replayHandoff).toEqual({ sessionId: 'sess_c', afterSequence: 10, projectId: 7 });
  });

  test('收尾补拉画布/版本(回归:v1 由 finalize 创建,selectProject 那次 loadVersions 拉在其前,播完右侧预览无版本)', async () => {
    (pgcApi.updateReplayState as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'completed' });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [{ version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true }], total: 1 });
    useStore.setState({
      currentProjectId: 7, versions: [],
      replay: { phase: 'playing', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 3, cursor: 3, speed: 1 },
      sessionId: 'sess_c', lastSequence: 42, messages: [], turns: [], tasks: [],
    });
    useStore.getState().completeReplay();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(api.listVersions).toHaveBeenCalled();
    expect(useStore.getState().versions.map((v) => v.id)).toEqual(['v1']);
  });

  test('收尾(含 skip)预览切到最新版本:即便后端 is_current 指向旧版本也不停留', async () => {
    (pgcApi.updateReplayState as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'completed' });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: false },
    ], total: 2 });
    useStore.setState({
      currentProjectId: 7, versions: [], activeVersionId: null,
      replay: { phase: 'skipping', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 3, cursor: 1, speed: 1 },
      sessionId: 'sess_c', lastSequence: 10, messages: [], turns: [], tasks: [],
    });
    useStore.getState().completeReplay();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(useStore.getState().activeVersionId).toBe('v2');
    expect(useStore.getState().versions.find((v) => v.current)?.id).toBe('v2');
  });
});

describe('轮询健壮性(C1)', () => {
  const genAsset = (id: string) => ({ id, key: id, label: 'x', kind: 'video' as const, source: 'generated' as const, status: 'generating' as const, position: { x: 0, y: 0 } });

  test('pollGenTasks 在途时重入直接返回,不叠加并发同请求', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [genAsset('vid-1')],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    });
    let resolvePoll!: (v: unknown) => void;
    api.pollVideo.mockReturnValue(new Promise((r) => { resolvePoll = r; }));   // 悬挂:模拟后端卡住
    const first = useStore.getState().pollGenTasks();
    void useStore.getState().pollGenTasks();   // 第一轮未归还时 interval 再触发
    await Promise.resolve();
    expect(api.pollVideo).toHaveBeenCalledTimes(1);
    // 归还请求释放在途守卫(生产由 pgc 超时保证必然归还),避免守卫状态泄漏到后续用例
    resolvePoll({ task_id: 't1', status: 'running' });
    await first;
  });

  test('pollGenTasks 并行推进:一个卡住的任务不阻塞同轮其余任务', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [genAsset('vid-1'), { ...genAsset('m3d-1'), kind: '3d' as const }],
      genTasks: [
        { itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() },   // 排前面且悬挂
        { itemId: 'm3d-1', kind: 'model3d', taskId: 't2', startedAt: Date.now() },
      ],
    });
    let resolvePoll!: (v: unknown) => void;
    api.pollVideo.mockReturnValue(new Promise((r) => { resolvePoll = r; }));
    api.pollModel3d.mockResolvedValue({ task_id: 't2', status: 'ready', item: { id: 2, item_id: 'm3d-1', type: 'model3d', status: 'ready', url: '/p/m.glb' } });
    const round = useStore.getState().pollGenTasks();
    // t1 仍悬挂期间,t2 应照常完成(ready 落库 + 任务出队)
    await vi.waitFor(() => {
      expect(useStore.getState().assets.find((a) => a.id === 'm3d-1')?.status).toBe('ready');
      expect(useStore.getState().genTasks.map((t) => t.taskId)).toEqual(['t1']);
    });
    resolvePoll({ task_id: 't1', status: 'running' });
    await round;
  });

  test('pollVersions 在途时重入直接返回,不叠加并发同请求', async () => {
    // 守卫是「列表里存在非 ready 行」,故先摆一条构建中的版本让轮询得以进入
    useStore.setState({
      currentProjectId: 42,
      versions: [{ id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: false, status: 'building', assetKeys: [], game: { title: '', palette: '' } }],
    });
    let resolveList!: (v: unknown) => void;
    api.listVersions.mockReturnValue(new Promise((r) => { resolveList = r; }));
    const first = useStore.getState().pollVersions();
    void useStore.getState().pollVersions();
    await Promise.resolve();
    expect(api.listVersions).toHaveBeenCalledTimes(1);
    resolveList({ items: [], total: 0 });
    await first;
  });
});


// 首条 prompt 自动命名:仅默认占位名项目触发,失败静默,renamed 后同步本地名字
describe('autoNameProject', () => {
  const DEFAULT_NAME = 'Untitled game'; // 与 pgc 侧 DEFAULT_PLACEHOLDER_NAME 共享契约(改任一侧必须同步)

  test('default-named project triggers call and updates local name on renamed', async () => {
    const before = proj(1, DEFAULT_NAME);
    useStore.setState({ projects: [before], currentProjectId: 1 });
    api.autoNameProject.mockResolvedValue({ ...before, name: '忍者跳跃闯关', renamed: true });

    await useStore.getState().autoNameProject('做一个忍者跳跃闯关游戏');

    expect(api.autoNameProject).toHaveBeenCalledWith(1, '做一个忍者跳跃闯关游戏');
    expect(useStore.getState().projects[0].name).toBe('忍者跳跃闯关');
  });

  test('renamed project does not trigger call', async () => {
    useStore.setState({ projects: [proj(1, '我的游戏')], currentProjectId: 1 });

    await useStore.getState().autoNameProject('做一个游戏');

    expect(api.autoNameProject).not.toHaveBeenCalled();
  });

  test('rejection is silent and keeps name; next call retries by name check', async () => {
    const before = proj(1, DEFAULT_NAME);
    useStore.setState({ projects: [before], currentProjectId: 1 });
    api.autoNameProject.mockRejectedValue(new Error('gateway down'));

    await expect(useStore.getState().autoNameProject('做一个游戏')).resolves.toBeUndefined();
    expect(useStore.getState().projects[0].name).toBe(DEFAULT_NAME);
    expect(useStore.getState().toast).toBeFalsy();

    // 名字仍为默认名 → 第二条消息再次触发(天然重试)
    api.autoNameProject.mockResolvedValue({ ...before, name: '好名字', renamed: true });
    await useStore.getState().autoNameProject('再来一条');
    expect(api.autoNameProject).toHaveBeenCalledTimes(2);
    expect(useStore.getState().projects[0].name).toBe('好名字');
  });

  test('renamed=false keeps local name unchanged', async () => {
    const before = proj(1, DEFAULT_NAME);
    useStore.setState({ projects: [before], currentProjectId: 1 });
    api.autoNameProject.mockResolvedValue({ ...before, renamed: false });

    await useStore.getState().autoNameProject('做一个游戏');

    expect(useStore.getState().projects[0].name).toBe(DEFAULT_NAME);
  });

  test('blank prompt does not trigger call', async () => {
    useStore.setState({ projects: [proj(1, DEFAULT_NAME)], currentProjectId: 1 });
    await useStore.getState().autoNameProject('   ');
    expect(api.autoNameProject).not.toHaveBeenCalled();
  });

  test('stale response does not overwrite a manual rename made while in flight', async () => {
    const before = proj(1, DEFAULT_NAME);
    useStore.setState({ projects: [before], currentProjectId: 1 });
    // auto-name 在途期间用户手动改名:响应到达前本地已变为「我的游戏」
    api.autoNameProject.mockImplementation(async () => {
      useStore.setState({ projects: [{ ...before, name: '我的游戏' }] });
      return { ...before, name: 'LLM 起的名', renamed: true };
    });

    await useStore.getState().autoNameProject('做一个游戏');

    // 迟到的 renamed 响应不得覆盖手动名
    expect(useStore.getState().projects[0].name).toBe('我的游戏');
  });
});

describe('回放断点续播(spec 2026-07-14)', () => {
  beforeEach(() => {
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    api.updateReplayState.mockResolvedValue({});
  });
  // 快照工厂:与 live 检查点同构(lastSequence ↔ messages 一致)
  const snap = (sid: string, seq: number) => ({
    sessionId: sid, lastSequence: seq, turns: [], tasks: [],
    messages: [{ id: 'm1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'hi' }], status: 'ready' as const }],
  });

  test('回放中切走 → replay 挂起为 null(进度已随检查点持久化,不丢)', async () => {
    useStore.setState({ projects: [proj(1), proj(2)], currentProjectId: 1, replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's1', total: 5, cursor: 2, speed: 1 } });
    await useStore.getState().selectProject(2);
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().currentProjectId).toBe(2);
  });

  test('切到有未完成进度标记的项目 → 同一 set 灌快照 + 恢复 playing(resumeAfterSequence=快照 lastSequence)', async () => {
    useStore.setState({ projects: [proj(5)], replayProgressByProject: { '5': { templateId: 'tpl', sessionId: 's5' } }, koubouByProject: { '5': snap('s5', 42) } });
    await useStore.getState().selectProject(5);
    expect(useStore.getState().replay).toMatchObject({ phase: 'playing', templateId: 'tpl', projectId: 5, sessionId: 's5', resumeAfterSequence: 42 });
    expect(useStore.getState().messages).toHaveLength(1);
    expect(useStore.getState().lastSequence).toBe(42);
    expect(useStore.getState().sessionId).toBe('s5');
  });

  test('进度标记存在但快照缺失 → 仍恢复 playing,从头播(resumeAfterSequence=0)', async () => {
    useStore.setState({ projects: [proj(5)], replayProgressByProject: { '5': { templateId: 'tpl', sessionId: 's5' } } });
    await useStore.getState().selectProject(5);
    expect(useStore.getState().replay).toMatchObject({ phase: 'playing', sessionId: 's5', resumeAfterSequence: 0 });
  });

  test('enterReplay 编排在途(replay.projectId===id)→ selectProject 不动 replay', async () => {
    useStore.setState({ projects: [proj(7)], replay: { phase: 'provisioning', templateId: 'tpl', projectId: 7, sessionId: null, total: 0, cursor: 0, speed: 1 } });
    await useStore.getState().selectProject(7);
    expect(useStore.getState().replay).toMatchObject({ phase: 'provisioning', templateId: 'tpl' });
  });

  test('enterReplay ready + 本地进度/快照会话一致 → 断点恢复(灌快照消息,从 lastSequence 续播)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'ready' });
    (koubouApi.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{ session_id: 'sess_r', project_id: '7', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }]);
    useStore.setState({ projects: [proj(7)], replayProgressByProject: { '7': { templateId: 'tpl', sessionId: 'sess_r' } }, koubouByProject: { '7': snap('sess_r', 10) } });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay).toMatchObject({ phase: 'playing', sessionId: 'sess_r', resumeAfterSequence: 10 });
    expect(useStore.getState().messages).toHaveLength(1);
    expect(useStore.getState().lastSequence).toBe(10);
  });

  test('enterReplay 进度标记会话与后端解析不一致 → 不恢复,从头播且改写标记(防灌错会话快照)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'ready' });
    (koubouApi.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{ session_id: 'sess_new', project_id: '7', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }]);
    useStore.setState({ projects: [proj(7)], replayProgressByProject: { '7': { templateId: 'tpl', sessionId: 'sess_old' } }, koubouByProject: { '7': snap('sess_old', 10) } });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay).toMatchObject({ phase: 'playing', sessionId: 'sess_new', resumeAfterSequence: 0 });
    expect(useStore.getState().messages).toHaveLength(0);
    expect(useStore.getState().replayProgressByProject['7']).toEqual({ templateId: 'tpl', sessionId: 'sess_new' });
  });

  test('enterReplay 全新起播 → 写进度标记(此后逐帧检查点即可断点恢复)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    (koubouApi.cloneFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ session_id: 'sess_c', already_provisioned: false });
    (pgcApi.finalizeReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'ready' });
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replayProgressByProject['7']).toEqual({ templateId: 'tpl', sessionId: 'sess_c' });
  });

  test('enterReplay status=completed → 清残留进度标记(防 selectProject 误触发恢复)', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'completed' });
    useStore.setState({ projects: [proj(7)], replayProgressByProject: { '7': { templateId: 'tpl', sessionId: 'sess_stale' } } });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().replayProgressByProject['7']).toBeUndefined();
  });

  test('completeReplay → 清进度标记 + 置续接握手(播完不再断点恢复)', () => {
    useStore.setState({
      currentProjectId: 7, lastSequence: 9,
      replay: { phase: 'playing', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 2, cursor: 2, speed: 1 },
      replayProgressByProject: { '7': { templateId: 'tpl', sessionId: 'sess_c' } },
    });
    useStore.getState().completeReplay();
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().replayProgressByProject['7']).toBeUndefined();
    expect(useStore.getState().replayHandoff).toMatchObject({ projectId: 7, sessionId: 'sess_c', afterSequence: 9 });
  });
});

test('replayProgressByProject 进持久化切片(回归:断点续播标记必须落盘,刷新才恢复得了)', () => {
  useStore.setState({ replayProgressByProject: { '5': { templateId: 'tpl', sessionId: 's5' } } });
  const partialize = useStore.persist.getOptions().partialize!;
  expect((partialize(useStore.getState()) as { replayProgressByProject?: unknown }).replayProgressByProject)
    .toEqual({ '5': { templateId: 'tpl', sessionId: 's5' } });
});

describe('previewVersionById 本地 Koubou 调试分流', () => {
  test('NEXT_PUBLIC_KOUBOU_BASE_URL 设置时返回本地预览路由,不打 PGC', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOUBOU_BASE_URL', 'http://127.0.0.1:8000');
    useStore.setState({
      currentProjectId: 535,
      versions: [{ id: 'ver_9', index: 3, label: 'V3', summary: '', createdAt: '', current: true, status: 'ready', assetKeys: [], game: { title: '', palette: '' } }],
    });
    const url = await useStore.getState().previewVersionById('ver_9');
    expect(url).toBe('/api/local-preview/535/v3/dist/index.html');
    expect(api.previewVersion).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  test('未设覆盖时仍走 PGC preview 端点', async () => {
    api.previewVersion.mockResolvedValue({ preview_url: 'https://pgc.local/pv/x/v3/dist/index.html' });
    useStore.setState({
      currentProjectId: 535,
      versions: [{ id: 'ver_9', index: 3, label: 'V3', summary: '', createdAt: '', current: true, status: 'ready', assetKeys: [], game: { title: '', palette: '' } }],
    });
    const url = await useStore.getState().previewVersionById('ver_9');
    expect(url).toBe('https://pgc.local/pv/x/v3/dist/index.html');
    expect(api.previewVersion).toHaveBeenCalledWith(535, 'ver_9');
  });
});

describe('loadVersions 本地 Koubou 调试分流', () => {
  test('本地模式:版本列表来自 /api/local-preview/{pid}/versions,映射为最小 Version 并选中最新', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOUBOU_BASE_URL', 'http://127.0.0.1:8000');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { items: [{ version: 1, created_at: '2026-07-16T00:00:00Z' }, { version: 2, created_at: '2026-07-17T00:00:00Z' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    useStore.setState({ currentProjectId: 535, versions: [], activeVersionId: null });
    await useStore.getState().loadVersions();
    const vs = useStore.getState().versions;
    expect(vs.map((v) => ({ id: v.id, index: v.index, label: v.label }))).toEqual([
      { id: 'localv_1', index: 1, label: 'V1' },
      { id: 'localv_2', index: 2, label: 'V2' },
    ]);
    expect(useStore.getState().activeVersionId).toBe('localv_2'); // 冷启动选中最新(current 兜底)
    expect(api.listVersions).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});


// createdAt 此前只在纯函数层被证明存在 —— store 层零覆盖:evaluator 实测「整表刷新时用本地值
// 顶掉服务端 createdAt」的变异能穿过全部 3023 条测试(tv-contract 的 M2/M7)。
// 下游 bucketOf / relativeParts 消费的就是 store.assets 上的这个字段,这里把它端到端钉住
describe('createdAt 到达 store.assets', () => {
  const item = (over: object = {}) => ({
    id: 1, item_id: 'img-1', type: 'image', status: 'ready', url: '/p/a.png',
    created_at: '2026-08-08T03:04:05Z', ...over,
  });

  test('loadCanvas 后,服务端的 created_at 落到 store.assets[].createdAt', async () => {
    useStore.setState({ currentProjectId: 42, assets: [] } as never);
    api.listCanvasItems.mockResolvedValue({ items: [item()], total: 1 });
    await useStore.getState().loadCanvas();
    expect(useStore.getState().assets[0].createdAt).toBe('2026-08-08T03:04:05Z');
  });

  // 整表刷新时,本地那份**不得**顶掉服务端的时间 —— 与「位置归前端所有」相反,
  // createdAt 是服务端口径,前端没有它的真相
  test('整表刷新:服务端的 createdAt 覆盖本地旧值,不被本地顶掉', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ ...makeAsset('image'), id: 'img-1', key: 'img-1', createdAt: '2020-01-01T00:00:00Z' }],
    } as never);
    api.listCanvasItems.mockResolvedValue({ items: [item({ created_at: '2026-08-08T09:00:00Z' })], total: 1 });
    await useStore.getState().loadCanvas();
    expect(useStore.getState().assets[0].createdAt).toBe('2026-08-08T09:00:00Z');
  });

  // reference 是前端整体覆盖写的 —— 只读的服务端字段泄进去会往 DB 写垃圾
  test('createdAt 不泄进 reference 回写体', async () => {
    useStore.setState({ currentProjectId: 42, assets: [] } as never);
    api.listCanvasItems.mockResolvedValue({ items: [item()], total: 1 });
    await useStore.getState().loadCanvas();
    const a = useStore.getState().assets[0];
    expect(JSON.stringify(assetReference(a))).not.toContain('2026-08-08');
    expect(assetReference(a)).not.toHaveProperty('created_at');
    expect(assetReference(a)).not.toHaveProperty('createdAt');
  });
});
