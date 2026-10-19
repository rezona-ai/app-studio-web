import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/koubou/client', () => ({
  koubouApi: { listEvents: vi.fn() },
  KoubouError: class extends Error {},
}));

import { useReplayPlayer } from './useReplayPlayer';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const listEvents = koubouApi.listEvents as unknown as ReturnType<typeof vi.fn>;
const ev = (seq: number, createdAt: string) => ({ type: 'run.started', project_id: '7', session_id: 'sess_c', sequence: seq, created_at: createdAt, payload: {} });

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('useReplayPlayer', () => {
  test('playing:拉全量→按 sequence 升序逐帧派发→drain 调 completeReplay', async () => {
    vi.useFakeTimers();
    listEvents.mockResolvedValueOnce({ events: [ev(2, '2026-01-01T00:00:00.300Z'), ev(1, '2026-01-01T00:00:00.000Z')], oldest_sequence: 1, newest_sequence: 2, latest_sequence: 2, has_more: false });
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });   // 等 fetch 完成
    expect(useStore.getState().replay!.total).toBe(2);
    // 第一帧立即(floor)派发,升序:先 sequence=1
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(ingest.mock.calls[0][0]).toMatchObject({ sequence: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(ingest.mock.calls[1][0]).toMatchObject({ sequence: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(complete).toHaveBeenCalled();
  });

  test('skipping:清定时器,同步 flush 剩余后 completeReplay', async () => {
    vi.useFakeTimers();
    listEvents.mockResolvedValueOnce({ events: [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T00:01:00.000Z'), ev(3, '2026-01-01T00:02:00.000Z')], oldest_sequence: 1, newest_sequence: 3, latest_sequence: 3, has_more: false });
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    const { rerender } = renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });   // 派发第 1 帧
    // 用户 skip
    act(() => { useStore.setState({ replay: { ...useStore.getState().replay!, phase: 'skipping' } }); });
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(ingest).toHaveBeenCalledTimes(3);   // 剩余 2 帧瞬时 flush
    expect(complete).toHaveBeenCalled();
  });

  test('skip 早于 playing 的拉取 resolve:不 flush 空/陈旧队列,补拉后终态仍等于全量(回归:spec §5)', async () => {
    vi.useFakeTimers();
    const events = [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T00:01:00.000Z'), ev(3, '2026-01-01T00:02:00.000Z')];
    const neverResolves = new Promise<never>(() => {});   // playing 的拉取:被 skip 打断,永远不 resolve
    listEvents
      .mockReturnValueOnce(neverResolves)
      .mockResolvedValueOnce({ events, oldest_sequence: 1, newest_sequence: 3, latest_sequence: 3, has_more: false });   // skipping effect 自行补拉
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    const { rerender } = renderHook(() => useReplayPlayer());
    // 不等 fetch resolve,立刻 skip(用户抢在拉取完成前点了跳过)
    act(() => { useStore.setState({ replay: { ...useStore.getState().replay!, phase: 'skipping' } }); });
    rerender();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(ingest).toHaveBeenCalledTimes(3);   // 全量补拉后 flush,不是空/陈旧队列
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test('playing 拉取失败(listEvents reject)→ 置 error 态,不 dispatch/不 completeReplay(回归:此前无 catch 会挂死播放器)', async () => {
    vi.useFakeTimers();
    listEvents.mockRejectedValueOnce(new Error('network down'));
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(ingest).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(useStore.getState().replay?.phase).toBe('error');
    expect(useStore.getState().replay?.errorCode).toBe('REPLAY_LOAD_FAILED');
  });

  test('skip 需自补拉且 listEvents reject → 同样置 error 态,不 flush/不 completeReplay(回归:skip 分支同款兜底)', async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<never>(() => {});   // playing 的拉取:被 skip 打断,永远不 resolve
    listEvents
      .mockReturnValueOnce(neverResolves)
      .mockRejectedValueOnce(new Error('boom'));   // skipping effect 自行补拉,拉取失败
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    const { rerender } = renderHook(() => useReplayPlayer());
    act(() => { useStore.setState({ replay: { ...useStore.getState().replay!, phase: 'skipping' } }); });
    rerender();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(ingest).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(useStore.getState().replay?.phase).toBe('error');
  });

  test('流式开播:第二页仍挂起时,首页事件已开始派发(不等全量);第二页到达后继续播完并 completeReplay', async () => {
    vi.useFakeTimers();
    const page1 = [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T00:00:00.200Z')];
    const page2 = [ev(3, '2026-01-01T00:00:00.400Z')];
    let resolvePage2: (v: unknown) => void;
    listEvents
      .mockResolvedValueOnce({ events: page1, oldest_sequence: 1, newest_sequence: 2, latest_sequence: 3, has_more: true })
      .mockReturnValueOnce(new Promise((res) => { resolvePage2 = res; }));   // 第二页挂起
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });   // 首页 resolve
    // 初次进入总量即为会话 latest_sequence(3),不是首页已入队数(2)——分母不随翻页回跳(Meegle 13559715)
    expect(useStore.getState().replay!.total).toBe(3);
    // 第二页未回,首页两帧已可播出
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();   // 拉取在途:队列吃空≠播完
    // 第二页到达:唤醒续播
    await act(async () => { resolvePage2!({ events: page2, oldest_sequence: 3, newest_sequence: 3, latest_sequence: 3, has_more: false }); await Promise.resolve(); });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(ingest).toHaveBeenCalledTimes(3);
    expect(ingest.mock.calls[2][0]).toMatchObject({ sequence: 3 });
    expect(complete).toHaveBeenCalled();
  });

  test('user.message 事件走 ingestReplayUserMessage 成用户气泡(回归:灌 live reducer 被吞,回放丢用户消息)', async () => {
    vi.useFakeTimers();
    const userEv = { type: 'user.message', project_id: '7', session_id: 'sess_c', event_id: 'evt_u', sequence: 1, created_at: '2026-01-01T00:00:00.000Z', payload: { message: { role: 'user', content: '做个跳跃游戏' } } };
    listEvents.mockResolvedValueOnce({ events: [userEv, ev(2, '2026-01-01T00:00:00.200Z')], oldest_sequence: 1, newest_sequence: 2, latest_sequence: 2, has_more: false });
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.runAllTimersAsync(); });
    // user.message 不进 live reducer 入口,而是成了用户气泡
    expect(ingest.mock.calls.every(([e]) => (e as { type: string }).type !== 'user.message')).toBe(true);
    const msgs = useStore.getState().messages;
    expect(msgs.some((m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && p.text === '做个跳跃游戏'))).toBe(true);
  });

  test('多页翻页:has_more=true 时按 afterSequence 前进拉第二页,全部拼接后按序 flush(回归:fetchAllEvents 的翻页循环)', async () => {
    vi.useFakeTimers();
    const page1 = [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T00:00:00.200Z')];
    const page2 = [ev(3, '2026-01-01T00:00:00.400Z')];
    listEvents
      .mockResolvedValueOnce({ events: page1, oldest_sequence: 1, newest_sequence: 2, latest_sequence: 3, has_more: true })
      .mockResolvedValueOnce({ events: page2, oldest_sequence: 3, newest_sequence: 3, latest_sequence: 3, has_more: false });
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(listEvents.mock.calls[0][2]).toMatchObject({ limit: 100, afterSequence: 0 });
    expect(listEvents.mock.calls[1][2]).toMatchObject({ limit: 100, afterSequence: 2 });   // 第二页从第一页 newest_sequence 续拉
    expect(useStore.getState().replay!.total).toBe(3);   // 两页拼接后的全量
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(ingest).toHaveBeenCalledTimes(3);
    expect(ingest.mock.calls[0][0]).toMatchObject({ sequence: 1 });
    expect(ingest.mock.calls[1][0]).toMatchObject({ sequence: 2 });
    expect(ingest.mock.calls[2][0]).toMatchObject({ sequence: 3 });
    expect(complete).toHaveBeenCalled();
  });

  test('断点续播:resumeAfterSequence=42 → 首次拉取从 42 之后增量拉,已播部分不重拉(spec 2026-07-14)', async () => {
    vi.useFakeTimers();
    listEvents.mockResolvedValueOnce({ events: [ev(43, '2026-01-01T00:00:00.000Z')], oldest_sequence: 43, newest_sequence: 43, latest_sequence: 43, has_more: false });
    vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1, resumeAfterSequence: 42 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(listEvents.mock.calls[0][2]).toMatchObject({ limit: 100, afterSequence: 42 });
  });

  test('每帧派发落检查点:koubouByProject[pid] 快照 lastSequence 随派发推进(刷新/切走可断点恢复)', async () => {
    vi.useFakeTimers();
    listEvents.mockResolvedValueOnce({ events: [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T00:00:00.200Z')], oldest_sequence: 1, newest_sequence: 2, latest_sequence: 2, has_more: false });
    vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });   // 派发第 1 帧
    expect(useStore.getState().koubouByProject['7']).toMatchObject({ sessionId: 'sess_c', lastSequence: 1 });
    // 播放头随派发推进到该帧 created_at(TurnFooter 回放期计时终点)
    expect(useStore.getState().replay!.playheadAt).toBe('2026-01-01T00:00:00.000Z');
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(useStore.getState().koubouByProject['7']).toMatchObject({ sessionId: 'sess_c', lastSequence: 2 });
  });
});

test('ask_user_question.answered 帧:合成回答气泡(标题:选项排版)+ 清 pending(事件流无对应 user.message)', async () => {
  vi.useFakeTimers();
  const reqEv = { type: 'ask_user_question.requested', project_id: '7', session_id: 'sess_c', sequence: 1, created_at: '2026-01-01T00:00:00.000Z',
    payload: { interaction_id: 'q1', tool_name: 'AskUserQuestion', input: { questions: [{ question: '选哪种?', header: '节奏', options: [{ label: 'A' }] }, { question: '主题?', header: '主题', options: [{ label: 'B' }] }] } } };
  const ansEv = { type: 'ask_user_question.answered', project_id: '7', session_id: 'sess_c', sequence: 2, created_at: '2026-01-01T00:00:00.200Z',
    payload: { interaction_id: 'q1', answers: { '选哪种?': '逐回合停条', '主题?': '经典奇幻' }, resolved: true } };
  listEvents.mockResolvedValueOnce({ events: [reqEv, ansEv], oldest_sequence: 1, newest_sequence: 2, latest_sequence: 2, has_more: false });
  vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
  useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
  renderHook(() => useReplayPlayer());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await vi.runAllTimersAsync(); });
  const msgs = useStore.getState().messages;
  const bubble = msgs.find((m) => m.role === 'user');
  expect(bubble).toBeTruthy();
  expect(bubble!.parts[0]).toMatchObject({ type: 'text', text: '节奏：逐回合停条\n主题：经典奇幻' });
  expect(useStore.getState().pendingInteractions).toEqual({});
  expect(useStore.getState().lastSequence).toBe(2);
});
