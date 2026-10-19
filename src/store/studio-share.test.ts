import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// 保留真实导出(PgcError / KoubouError 供 instanceof),仅替换 api 方法为 mock(沿用 studio-remix.test.ts 写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listProjects: vi.fn(), listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
      workbenchShare: { open: vi.fn(), finalize: vi.fn(), enable: vi.fn(), disable: vi.fn() },
    },
  };
});
vi.mock('@/lib/koubou/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/koubou/client')>();
  return { ...actual, koubouApi: { cloneFromShare: vi.fn(), listSessions: vi.fn() } };
});

import { useStore } from './index';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { koubouApi, KoubouError } from '@/lib/koubou/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const share = pgcApi.workbenchShare as unknown as Record<string, ReturnType<typeof vi.fn>>;
const kb = koubouApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const proj = (id: number) => ({
  id, public_id: `p${id}`, name: 'P', cover_url: null, cover_source: null,
  current_version_id: null, status: 'draft', created_at: '', updated_at: '',
});
// open 回执带嵌套 target_project(完整 ProjectData,数值 id + public_id),与 pgc 真实响应形状一致
const openData = () => ({
  target_project: proj(9), source_owner_user_id: 100, source_project_id: 55,
  source_session_id: 'src-sess', share_token: 'tok', idempotent_hit: false,
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
  share.finalize.mockResolvedValue({ status: 'ready', current_version_id: 'v1' });
  window.history.replaceState(null, '', '/?share=ShAre123');
});
afterEach(() => vi.restoreAllMocks());

test('三步编排成功:open→clone→finalize;URL 仅 ?project=,会话钉住,选中目标', async () => {
  share.open.mockResolvedValue(openData());
  api.listProjects.mockResolvedValue({ items: [proj(9)], total: 1, page: 1, page_size: 100 });
  kb.cloneFromShare.mockResolvedValue({ session_id: 'sess-x', already_provisioned: false });
  await useStore.getState().applyWorkbenchShare('ShAre123');
  const s = useStore.getState();
  expect(share.open).toHaveBeenCalledWith('ShAre123');
  // koubou clone 用数值 pid;body 四字段全字符串(koubou Pydantic v2 不做 int→str 强转)
  expect(kb.cloneFromShare).toHaveBeenCalledWith(9, {
    source_user_id: '100', source_project_id: '55', source_session_id: 'src-sess', share_token: 'tok',
  });
  expect(share.finalize).toHaveBeenCalledWith(9);
  expect(s.currentProjectId).toBe(9);
  // 会话钉扎:写入 koubouByProject[9],供连接层 switchProjectSession 载入(不 listSessions 猜)
  expect(s.koubouByProject['9']?.sessionId).toBe('sess-x');
  expect(kb.listSessions).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?project=p9');   // ?share= 已剥
  expect(s.booting).toBe(false);
});

test('owner_self:owner 打开自己的分享链接,直接进入原项目,不 clone/finalize', async () => {
  share.open.mockResolvedValue({
    target_project: proj(55), source_owner_user_id: 100, source_project_id: 55,
    source_session_id: 'src-sess', share_token: '', idempotent_hit: true, owner_self: true,
  });
  api.listProjects.mockResolvedValue({ items: [proj(55)], total: 1, page: 1, page_size: 100 });
  await useStore.getState().applyWorkbenchShare('ShAre123');
  const s = useStore.getState();
  expect(kb.cloneFromShare).not.toHaveBeenCalled();      // 不走 koubou clone(token 为空)
  expect(share.finalize).not.toHaveBeenCalled();          // 不 finalize(源项目本就 ready)
  expect(s.currentProjectId).toBe(55);                    // 直接选中源项目
  expect(s.koubouByProject['55']).toBeUndefined();        // 不 pin,连接层常规解析既有会话
  expect(window.location.search).toBe('?project=p55');    // ?share= 已剥,留 ?project=
  expect(s.booting).toBe(false);
});

test('koubou 409:不 dead-end,仍 finalize 并路由到既有项目(不重复 pin)', async () => {
  share.open.mockResolvedValue(openData());
  api.listProjects.mockResolvedValue({ items: [proj(9)], total: 1, page: 1, page_size: 100 });
  kb.cloneFromShare.mockRejectedValue(new KoubouError(409, 'already provisioned', 409));
  await useStore.getState().applyWorkbenchShare('ShAre123');
  const s = useStore.getState();
  expect(share.finalize).toHaveBeenCalledWith(9);        // 仍收口,不 dead-end
  expect(s.currentProjectId).toBe(9);                    // 路由到既有项目
  expect(s.koubouByProject['9']).toBeUndefined();        // 无 session_id → 不 pin,交连接层解析
  expect(window.location.search).toBe('?project=p9');
  expect(s.toast).toBeNull();                            // 409 走成功路由,不弹错误
});

test('open 401:置 authRequired,保留 ?share= 链接,不 fork/不兜底', async () => {
  share.open.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  await useStore.getState().applyWorkbenchShare('ShAre123');
  const s = useStore.getState();
  expect(s.authRequired).toBe(true);
  expect(s.toast).toBeNull();                            // 401 不弹红色报错
  expect(window.location.search).toContain('share');     // 链接保留:登录后回到同一 URL 续 fork
  expect(kb.cloneFromShare).not.toHaveBeenCalled();
});

test('clone 非 409 失败:Toast + 剥 ?share= 防重复 fork + 兜底 loadProjects', async () => {
  share.open.mockResolvedValue(openData());
  // 第一次(解析数值 id)与兜底 loadProjects 各调一次 listProjects
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(3)], total: 2, page: 1, page_size: 100 });
  kb.cloneFromShare.mockRejectedValue(new KoubouError(500, 'boom', 500));
  await useStore.getState().applyWorkbenchShare('ShAre123');
  const s = useStore.getState();
  expect(s.toast?.code).toBe('500');                     // KoubouError 转 toast
  expect(share.finalize).not.toHaveBeenCalled();
  expect(window.location.search).not.toContain('share'); // 剥参防刷新重复 fork
  expect(api.listProjects.mock.calls.length).toBeGreaterThanOrEqual(2); // 解析 + 兜底
  expect(s.currentProjectId).toBe(9);                    // 兜底落在用户项目,非空工作台
  expect(s.booting).toBe(false);
});

// 红线(收窄版):未知错误仍必须照抛暴露、不剥 ?share=、不兜底 loadProjects —— 只是不再无声。
// 提示统一成不归因的 UNKNOWN(「出现错误,请重试」),不声称任何业务原因,故不构成「把程序 bug 伪装成
// 业务报错」;错误照旧 rethrow,监控/控制台照旧看得见。bug #13870465:此前这里连加载层都不撤。
test('未知错误照抛:弹不归因提示、不剥 ?share=、不兜底 loadProjects、撤加载层', async () => {
  share.open.mockRejectedValue(new Error('unexpected bug'));
  await expect(useStore.getState().applyWorkbenchShare('ShAre123')).rejects.toThrow('unexpected bug');
  const s = useStore.getState();
  expect(s.toast?.code).toBe('UNKNOWN');                 // 不归因:不冒充某个业务失败
  expect(window.location.search).toContain('share');     // 保留链接 —— 「请重试」要真能重试(刷新即重试)
  expect(api.listProjects).not.toHaveBeenCalled();       // 不走失败兜底
  expect(s.booting).toBe(false);                         // 撤加载层,否则用户永久停在 loading 页
});

// bug #13870465 的复现集:clone 站点抛出的**任何**非 KoubouError 都走同一条路 —— 不再区分
// 「传输失败」和「程序 bug」(在这个 catch 里区分不了:断网抛 TypeError,空指针也抛 TypeError,
// 且 inner try 内还包着 String(...) 转换与 cloned.session_id 解引用)。故一律照抛 + 不归因提示 +
// 保留链接。超时那条正是用户撞到的:服务端其实跑完了,重试时 clone 返 409 短路,「刷新几秒就好」。
test.each([
  ['超时(AbortSignal.timeout)', new DOMException('signal timed out', 'TimeoutError')],
  ['断网(fetch 失败)', new TypeError('Failed to fetch')],
  ['空指针(真程序 bug 的形状)', new TypeError("Cannot read properties of null (reading 'session_id')")],
  ['裸 Error(断言失败)', new Error('assertion failed: bug')],
])('clone 抛非 KoubouError %s:照抛 + 不归因提示 + 保留 ?share= + 撤加载层', async (_label, err) => {
  share.open.mockResolvedValue(openData());
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(3)], total: 2, page: 1, page_size: 100 });
  kb.cloneFromShare.mockRejectedValue(err);
  await expect(useStore.getState().applyWorkbenchShare('ShAre123')).rejects.toThrow();
  const s = useStore.getState();
  expect(s.toast?.code).toBe('UNKNOWN');                  // 用户看得到提示,但不被告知错误原因
  expect(share.finalize).not.toHaveBeenCalled();          // clone 没成不继续收口
  expect(window.location.search).toContain('share');      // 保留链接:刷新即重试(clone 409 短路收口)
  expect(api.listProjects.mock.calls.length).toBe(1);     // 只有解析那一次,不走失败兜底
  expect(s.booting).toBe(false);                          // 撤加载层
});

// 红线:await 后校验 currentProjectId —— selectProject 载入期间用户切到别的项目,放弃 fork 的成功提交
test('并发切项目:selectProject 后 currentProjectId 已变 → 丢弃 URL 提交,保留用户选择', async () => {
  share.open.mockResolvedValue(openData());
  api.listProjects.mockResolvedValue({ items: [proj(9), proj(3)], total: 2, page: 1, page_size: 100 });
  kb.cloneFromShare.mockResolvedValue({ session_id: 'sess-x', already_provisioned: false });
  // selectProject(9) 内部 await loadVersions 期间模拟用户切到项目 3
  api.listVersions.mockImplementation(async () => {
    useStore.setState({ currentProjectId: 3 });
    return { items: [], total: 0 };
  });
  await useStore.getState().applyWorkbenchShare('ShAre123');
  const s = useStore.getState();
  expect(s.currentProjectId).toBe(3);                    // 用户选择不被 fork 覆盖
  expect(window.location.search).not.toBe('?project=p9');// 不提交 fork 的 URL 重写
  expect(window.location.search).toContain('share');     // 不按成功路径剥参(重复消费由 bootstrap ran 守护挡)
  expect(s.toast).toBeNull();                            // 丢弃 ≠ 失败,不弹错
  expect(s.booting).toBe(false);                         // 撤加载层,不卡 loading
});

// ---- selectProject 自愈:打开卡在 provisioning 的分享 fork 时自动补 finalize ----

test('selectProject 自愈:provisioning 项目自动补调 finalize 并回写 status/版本指针', async () => {
  useStore.setState({ projects: [{ ...proj(9), status: 'provisioning' }] });
  share.finalize.mockResolvedValue({ status: 'ready', current_version_id: 'v16' });
  await useStore.getState().selectProject(9);
  expect(share.finalize).toHaveBeenCalledWith(9);
  const p = useStore.getState().projects.find((x) => x.id === 9)!;
  expect(p.status).toBe('ready');
  expect(p.current_version_id).toBe('v16');
  expect(api.listCanvasItems).toHaveBeenCalled();   // 收口后才拉画布
});

test('selectProject 自愈:finalize 404(非分享 fork,如 replay 开通中)静默吞掉不阻断进入', async () => {
  useStore.setState({ projects: [{ ...proj(9), status: 'provisioning' }] });
  share.finalize.mockRejectedValue(new PgcError('WORKBENCH_SHARE_NOT_AVAILABLE', 'not available', 404));
  await useStore.getState().selectProject(9);
  const s = useStore.getState();
  expect(s.currentProjectId).toBe(9);               // 未被错误打断
  expect(api.listCanvasItems).toHaveBeenCalled();
  expect(s.projects.find((x) => x.id === 9)!.status).toBe('provisioning');
});

test('selectProject 自愈:非 provisioning 项目不触发 finalize', async () => {
  useStore.setState({ projects: [proj(9)] });      // status: draft
  await useStore.getState().selectProject(9);
  expect(share.finalize).not.toHaveBeenCalled();
});
