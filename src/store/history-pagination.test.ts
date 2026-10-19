import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EventsPage } from '@/lib/koubou/client';

// mock 必须在 import store 之前生效(store 模块顶层引用 koubouApi)
vi.mock('@/lib/koubou/client', () => ({
  koubouApi: { listSessions: vi.fn(), listEvents: vi.fn() },
}));

import { koubouApi } from '@/lib/koubou/client';
import { useStore } from './index';
import { createInitialKoubouState, createInitialServerState } from './types';

const listEvents = koubouApi.listEvents as ReturnType<typeof vi.fn>;

const umsg = (text: string, id: string, sequence: number) =>
  ({ type: 'user.message', project_id: '42', session_id: 's1', event_id: id, sequence, payload: { message: { role: 'user', content: text } } });

// 非展示事件(rebuild 跳过):thinking_tokens 等 SystemMessage,不产可见消息
const dead = (id: string, sequence: number) =>
  ({ type: 'claude.message', project_id: '42', session_id: 's1', event_id: id, sequence, payload: { sdk_type: 'SystemMessage', payload: { subtype: 'thinking_tokens', data: {} } } });

const page = (events: unknown[], has_more: boolean, latest = 100): EventsPage =>
  ({ events, has_more, oldest_sequence: 0, newest_sequence: 0, latest_sequence: latest }) as EventsPage;

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState(), currentProjectId: 42, sessionId: 's1' });
});

describe('seedKoubouHistory + loadOlderMessages', () => {
  test('种子化最新一页后,滚顶翻页前插更早消息', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 51)], true, 51));
    expect(useStore.getState().messages.map((m) => m.id)).toEqual(['evt_new']);
    expect(useStore.getState().historyOldestSeq).toBe(51);

    listEvents.mockResolvedValue(page([umsg('更早', 'evt_old', 1)], false, 51));
    await useStore.getState().loadOlderMessages();
    expect(listEvents).toHaveBeenCalledWith(42, 's1', { limit: 100, beforeSequence: 51 });
    expect(useStore.getState().messages.map((m) => m.id)).toEqual(['evt_old', 'evt_new']);
    expect(useStore.getState().historyHasMore).toBe(false);
    expect(useStore.getState().historyLoading).toBe(false);
  });

  test('has_more 为 false 时不再请求', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('hi', 'evt_1', 5)], false, 5));
    await useStore.getState().loadOlderMessages();
    expect(listEvents).not.toHaveBeenCalled();
  });

  test('await 期间切项目 → 丢弃过期响应', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('hi', 'evt_1', 51)], true, 51));
    let resolve!: (p: EventsPage) => void;
    listEvents.mockReturnValue(new Promise<EventsPage>((r) => { resolve = r; }));
    const p = useStore.getState().loadOlderMessages();
    useStore.getState().switchProjectSession(99);
    useStore.setState({ currentProjectId: 99 });
    resolve(page([umsg('过期', 'evt_stale', 1)], false, 51));
    await p;
    expect(useStore.getState().messages.map((m) => m.id)).not.toContain('evt_stale');
  });

  // 回归:同项目内 sessionId 变更(重连改建新会话)走 await 后守卫 return 时,
  // 曾不复位 historyLoading → 永卡 true,此后所有翻页静默失效
  test('await 期间同项目 sessionId 变更 → 丢弃响应且复位 loading,不死锁', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('hi', 'evt_1', 51)], true, 51));
    let resolve!: (p: EventsPage) => void;
    listEvents.mockReturnValue(new Promise<EventsPage>((r) => { resolve = r; }));
    const p = useStore.getState().loadOlderMessages();
    useStore.setState({ sessionId: 's2' });   // 重连后改建新会话,项目未变
    resolve(page([umsg('过期', 'evt_stale', 1)], false, 51));
    await p;
    expect(useStore.getState().messages.map((m) => m.id)).not.toContain('evt_stale');
    expect(useStore.getState().historyLoading).toBe(false);
  });

  test('请求失败 → 静默复位 loading,可重试', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('hi', 'evt_1', 51)], true, 51));
    listEvents.mockRejectedValue(new Error('网络错误'));
    await useStore.getState().loadOlderMessages();
    expect(useStore.getState().historyLoading).toBe(false);
    expect(useStore.getState().historyHasMore).toBe(true);
  });

  // 回归(Bug #13426934):整页只含非展示事件(thinking_tokens 死区)时,
  // 单页前插产出 0 可见消息,滚动无法再触发下一页 → 分页静默停摆。
  // 修复后 loadOlderMessages 应在一次调用内自动续拉,抽干死区直到出现可见消息。
  test('整页非展示事件(死区)→ 单次手势内自动续拉直到出现可见消息', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 300)], true, 300));
    // 两页纯 thinking_tokens(升序:最旧在前;游标 300→250→200,均 has_more=true 且 0 可见增长),第三页才带可见消息
    listEvents
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => dead(`d1_${i}`, 250 + i)), true, 300))
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => dead(`d2_${i}`, 200 + i)), true, 300))
      .mockResolvedValueOnce(page([umsg('更早', 'evt_old', 199)], false, 300));

    await useStore.getState().loadOlderMessages();

    // 一次调用抽干两页死区并拿到可见消息,而非停在第一页
    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(listEvents).toHaveBeenNthCalledWith(1, 42, 's1', { limit: 100, beforeSequence: 300 });
    expect(listEvents).toHaveBeenNthCalledWith(2, 42, 's1', { limit: 100, beforeSequence: 250 });
    expect(listEvents).toHaveBeenNthCalledWith(3, 42, 's1', { limit: 100, beforeSequence: 200 });
    expect(useStore.getState().messages.map((m) => m.id)).toEqual(['evt_old', 'evt_new']);
    expect(useStore.getState().historyHasMore).toBe(false);
    expect(useStore.getState().historyLoading).toBe(false);
  });

  // 每次手势凑满 50 条可见消息才停:单页只出少量可见消息时继续续拉,不再逐页停
  test('单页可见消息不足 50 → 同一手势内续拉,累计 ≥50 条才停', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 1000)], true, 1000));
    // 每页 25 条可见消息:第 1 页后累计 25(<50)继续,第 2 页后累计 50 停,不请求第 3 页
    listEvents
      .mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => umsg(`m${i}`, `p1_${i}`, 900 + i)), true, 1000))
      .mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => umsg(`m${i}`, `p2_${i}`, 800 + i)), true, 1000));
    // 不再预置第 3 页:若误发第 3 次请求会拿到 undefined 抛错,下方 times(2) 兜底断言
    await useStore.getState().loadOlderMessages();
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(useStore.getState().historyMsgCount).toBe(51);   // 种子 1 + 前插 50
    expect(useStore.getState().historyHasMore).toBe(true);
    expect(useStore.getState().historyLoading).toBe(false);
  });

  // 批量模式(batch:true,不满一屏自动续拉用):循环内只累积不逐页落库,凑满后一次性 commit。
  // 大屏刷新后自动续拉曾逐页整体重建列表,视觉上横幅常驻 + 列表连闪数秒(2026-07-23 排查)
  test('batch:true → 多页续拉只落库一次,最终消息完整', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 1000)], true, 1000));
    listEvents
      .mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => umsg(`m${i}`, `p1_${i}`, 900 + i)), true, 1000))
      .mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => umsg(`m${i}`, `p2_${i}`, 800 + i)), true, 1000));
    let commits = 0;
    let prevCount = useStore.getState().historyMsgCount;
    const unsub = useStore.subscribe((s) => {
      if (s.historyMsgCount !== prevCount) { commits += 1; prevCount = s.historyMsgCount; }
    });
    await useStore.getState().loadOlderMessages({ batch: true });
    unsub();
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(commits).toBe(1);   // 两页只产生一次消息落库
    expect(useStore.getState().historyMsgCount).toBe(51);
    // 前插顺序正确:第 2 页(更旧,seq 800+)在第 1 页(seq 900+)之前
    const ids = useStore.getState().messages.map((m) => m.id);
    expect(ids[0]).toBe('p2_0');
    expect(ids[25]).toBe('p1_0');
    expect(ids[50]).toBe('evt_new');
    expect(useStore.getState().historyHasMore).toBe(true);
    expect(useStore.getState().historyLoading).toBe(false);
  });

  // batch 下即便本轮 0 可见消息、翻到顶,也必须把 has_more=false 落库——
  // 否则触发方(不满一屏 effect)看到 hasMore 恒 true 会无限重试
  test('batch:true 翻到顶(0 可见消息)→ has_more=false 仍落库', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 300)], true, 300));
    listEvents.mockResolvedValueOnce(page([dead('d1', 299)], false, 300));
    await useStore.getState().loadOlderMessages({ batch: true });
    expect(useStore.getState().historyHasMore).toBe(false);
    expect(useStore.getState().historyLoading).toBe(false);
  });

  // batch 累积期间 live 尾部新消息到达 → 最终一次性 commit 不得冲掉尾部
  test('batch:true 期间 live 追加消息 → 尾部保留', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 1000)], true, 1000));
    // live 管线没有 user.message 分支(用户气泡由 Composer 乐观渲染),用 AssistantMessage 模拟 live 尾部
    const live = { type: 'claude.message', project_id: '42', session_id: 's1', event_id: 'evt_live', sequence: 1001, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'evt_live', content: [{ type: 'text', text: 'live' }] } } };
    listEvents.mockImplementationOnce(async () => {
      // 页在途时 live 事件落地(经正常 ingest 路径)
      useStore.getState().ingestKoubou(live as never);
      return page([umsg('更早', 'evt_old', 500)], false, 1000);
    });
    await useStore.getState().loadOlderMessages({ batch: true });
    expect(useStore.getState().messages.map((m) => m.id)).toEqual(['evt_old', 'evt_new', 'evt_live']);
  });

  // 凑满 50 之前翻到顶(has_more=false)也正常收尾
  test('凑满前翻到顶 → 前插已有部分并停止', async () => {
    useStore.getState().seedKoubouHistory(page([umsg('近期', 'evt_new', 100)], true, 100));
    listEvents.mockResolvedValue(page([umsg('更早', 'evt_old', 50)], false, 100));
    await useStore.getState().loadOlderMessages();
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(useStore.getState().historyHasMore).toBe(false);
    expect(useStore.getState().messages.map((m) => m.id)).toEqual(['evt_old', 'evt_new']);
  });
});
