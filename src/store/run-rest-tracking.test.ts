// trackActiveRunViaRest:刷新/重连后进行中 run 的 REST 轮询跟跑
// (spec 2026-07-23 run-rest-tracking:后端 run 事件按连接投递,新连接收不到旧 run 的帧)
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';
import type { ServerEvent } from '@/koubou/protocol';
import { createInitialKoubouState } from './types';
import { createSubagentState } from '@/lib/subagent-tasks';

vi.mock('@/lib/koubou/client', () => ({ koubouApi: { listEvents: vi.fn(), listSessions: vi.fn() } }));
const listEvents = koubouApi.listEvents as unknown as ReturnType<typeof vi.fn>;
const listSessions = koubouApi.listSessions as unknown as ReturnType<typeof vi.fn>;

const page = (events: ServerEvent[]) => ({
  events,
  oldest_sequence: typeof events[0]?.sequence === 'number' ? events[0].sequence : 0,
  newest_sequence: typeof events[events.length - 1]?.sequence === 'number' ? (events[events.length - 1].sequence as number) : 0,
  latest_sequence: typeof events[events.length - 1]?.sequence === 'number' ? (events[events.length - 1].sequence as number) : 0,
  has_more: false,
});
const amsg = (seq: number, uuid: string, text: string): ServerEvent =>
  ({ type: 'claude.message', project_id: '7', session_id: 's1', sequence: seq, payload: { sdk_type: 'AssistantMessage', payload: { uuid, content: [{ type: 'text', text }] } } }) as unknown as ServerEvent;
const finished = (seq: number, status = 'succeeded'): ServerEvent =>
  ({ type: 'run.finished', project_id: '7', session_id: 's1', sequence: seq, payload: { run_id: 'r1', status } }) as unknown as ServerEvent;
const summary = (activeRunId: string | null, updatedAt = '') =>
  [{ session_id: 's1', project_id: '7', status: 'ready', title: null, active_run_id: activeRunId, created_at: '2026-07-24T13:08:17.950172', updated_at: updatedAt }];

const loadCanvas = vi.fn().mockResolvedValue(undefined);
const loadVersions = vi.fn().mockResolvedValue(undefined);
const importMediaFromEvent = vi.fn();
const notOwned = () => false;

beforeEach(() => {
  listEvents.mockReset();
  listSessions.mockReset();
  loadCanvas.mockClear();
  loadVersions.mockClear();
  importMediaFromEvent.mockClear();
  useStore.setState({
    ...createInitialKoubouState(),
    currentProjectId: 7,
    sessionId: 's1',
    lastSequence: 4,
    replay: null,
    loadCanvas,
    loadVersions,
    importMediaFromEvent,
  });
});

describe('trackActiveRunViaRest:REST 权威跟跑进行中 run', () => {
  test('active_run_id 为空 → 不复开不轮询', async () => {
    listSessions.mockResolvedValueOnce(summary(null));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(listEvents).not.toHaveBeenCalled();
    expect(useStore.getState().runStatus).toBe('idle');
  });

  test('active run 为本连接发起(豁免集命中)→ 不轮询,交给 WS 流式路径', async () => {
    listSessions.mockResolvedValueOnce(summary('r1'));
    await useStore.getState().trackActiveRunViaRest((id) => id === 'r1', 0);
    expect(listEvents).not.toHaveBeenCalled();
  });

  test('活跃 run:复开轮 + 轮询回填直到 run.finished 落地后停止', async () => {
    listSessions.mockResolvedValueOnce(summary('r1'));
    listEvents
      .mockResolvedValueOnce(page([amsg(5, 'a5', '跟跑第一批')]))
      .mockResolvedValueOnce(page([amsg(6, 'a6', '第二批'), finished(7)]));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    const s = useStore.getState();
    expect(s.messages.map((m) => m.id)).toEqual(expect.arrayContaining(['a5', 'a6']));
    expect(s.runStatus).toBe('idle');
    expect(s.turns.at(-1)).toMatchObject({ runId: 'r1', status: 'succeeded' });
    expect(listEvents).toHaveBeenCalledTimes(2);   // 终态后不再轮询
  });

  test('轮询期展示态:复开后 runStatus=running、turn 复开(计时/骨架依赖)', async () => {
    listSessions.mockResolvedValueOnce(summary('r1'));
    let sampled: string | null = null;
    listEvents.mockImplementationOnce(async () => {
      sampled = useStore.getState().runStatus;   // 首次回填时应已复开
      return page([finished(5)]);
    });
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(sampled).toBe('running');
  });

  test('轮询中切项目 → 立即停止,不再请求', async () => {
    listSessions.mockResolvedValueOnce(summary('r1'));
    listEvents.mockImplementationOnce(async () => {
      useStore.setState({ currentProjectId: 8 });   // 回填期间用户切走
      return page([amsg(5, 'a5', 'x')]);
    });
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  test('重入守卫:同一会话的并发二次调用直接返回', async () => {
    let resolveSessions: (v: unknown) => void = () => {};
    listSessions.mockImplementationOnce(() => new Promise((r) => { resolveSessions = r; }));
    const first = useStore.getState().trackActiveRunViaRest(notOwned, 0);
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);   // 立即返回,不发第二次 listSessions
    expect(listSessions).toHaveBeenCalledTimes(1);
    resolveSessions(summary(null));
    await first;
  });

  test('WS 接管收敛:轮询中该 run 的帧开始经 WS 到达(豁免集命中)→ 退出轮询让位流式路径', async () => {
    listSessions.mockResolvedValueOnce(summary('r1'));
    let wsTookOver = false;
    listEvents.mockImplementation(async () => {
      wsTookOver = true;   // 首次回填后模拟 WS 开始投递该 run(单进程部署下刷新 attach 接管)
      return page([amsg(5, 'a5', 'x')]);   // 无终态帧,若不退位会继续轮询
    });
    await useStore.getState().trackActiveRunViaRest(() => wsTookOver, 0);
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(useStore.getState().runStatus).toBe('running');   // run 仍在跑,收口交给 WS 终态帧
  });

  test('回放期不跟跑', async () => {
    useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's1', total: 3, cursor: 1, speed: 1 } });
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(listSessions).not.toHaveBeenCalled();
  });

  test('listSessions 抛错 → 静默返回(下次 ready 重试),状态不变', async () => {
    listSessions.mockRejectedValueOnce(new Error('network'));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(useStore.getState().runStatus).toBe('idle');
    expect(listEvents).not.toHaveBeenCalled();
  });
});

// 起始时刻兜底(spec 2026-07-31 refresh-run-start-backfill):长 run 的 run.started 落在种子窗口外时
// 轮的 startedAt 为 null(脚注退化成纯 "Running…");用 /sessions.updated_at 补 —— 活跃 run 期该行
// 最后一次写入即 run 开始那一刻(实测 3 个 run 均差 ~0.2s,且 22 分钟事件流不推进它)
describe('trackActiveRunViaRest:用 updated_at 兜底 run 起始时刻', () => {
  test('补建轮:updated_at 无 Z 也按 UTC 解析(不偏 8 小时)', async () => {
    listSessions.mockResolvedValueOnce(summary('r1', '2026-07-31T11:16:49.796923'));
    listEvents.mockResolvedValueOnce(page([finished(5)]));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(useStore.getState().turns.at(-1)?.startedAt).toBe('2026-07-31T11:16:49.796923Z');
  });

  test('已有 startedAt 的轮(live 值更准)→ 不被 updated_at 覆盖', async () => {
    useStore.setState({
      turns: [{ runId: 'r1', model: 'claude-opus-5', startedAt: '2026-07-31T11:16:50.028431Z', finishedAt: null, status: 'running', lastMessageId: null }],
    });
    listSessions.mockResolvedValueOnce(summary('r1', '2026-07-31T09:00:00.000000'));
    listEvents.mockResolvedValueOnce(page([finished(5)]));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(useStore.getState().turns.at(-1)?.startedAt).toBe('2026-07-31T11:16:50.028431Z');
  });

  test('updated_at 缺失/非法 → startedAt 维持 null,不谎报时长', async () => {
    listSessions.mockResolvedValueOnce(summary('r1', 'not-a-date'));
    listEvents.mockResolvedValueOnce(page([finished(5)]));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(useStore.getState().turns.at(-1)?.startedAt).toBeNull();
  });

  test('别的会话的 updated_at 不串用(按 session_id 取本会话那条)', async () => {
    listSessions.mockResolvedValueOnce([
      { session_id: 's_other', project_id: '7', status: 'ready', title: null, active_run_id: 'r_other', created_at: '', updated_at: '2026-07-30T00:00:00.000000' },
      ...summary('r1', '2026-07-31T11:16:49.796923'),
    ]);
    listEvents.mockResolvedValueOnce(page([finished(5)]));
    await useStore.getState().trackActiveRunViaRest(notOwned, 0);
    expect(useStore.getState().turns.at(-1)?.startedAt).toBe('2026-07-31T11:16:49.796923Z');
  });

  // spec 2026-08-24:卡片进快照后,刷新恢复出来的非终态卡要在这里按权威 active_run 校正 ——
  // session.ready.active_run 对新连接恒为 null,靠它一刀切会误收仍在跑的卡且不可逆
  describe('快照恢复的子代理卡片按权威 active_run 校正', () => {
    const restoredCards = (runId: string | null) => ({
      ...createSubagentState(),
      cards: [{
        taskId: 't1', toolUseId: 'tu-1', runId, kind: 'agent' as const,
        description: '查找落位逻辑', status: 'running' as const,
      }],
    });

    test('卡属于活跃 run → 保持 running,留给后续帧推进', async () => {
      useStore.setState({ subagents: restoredCards('r1') });
      listSessions.mockResolvedValueOnce(summary('r1'));
      // WS 已接管该 run(早退),校正仍先跑一遍 —— 属于 r1 的卡不该被它碰
      await useStore.getState().trackActiveRunViaRest((id) => id === 'r1', 0);
      expect(useStore.getState().subagents.cards[0].status).toBe('running');
    });

    test('无活跃 run → 陈旧卡收成结局未知(早退分支之前就要收)', async () => {
      useStore.setState({ subagents: restoredCards('r-old') });
      listSessions.mockResolvedValueOnce(summary(null));
      await useStore.getState().trackActiveRunViaRest(notOwned, 0);
      expect(useStore.getState().subagents.cards[0]).toMatchObject({
        status: 'ended_without_terminal', sealReason: 'unknown',
      });
    });

    // listSessions 的往返窗口内本地可能已经开了新一轮:REST 带回的是**请求发出那一刻**的快照,
    // 拿它去收当下的卡片会误伤正在跑的新卡,且合成态不可逆(cardPatch 不允许改回 running)
    test('REST 答案落后于本地 run(窗口内新开一轮)→ 跳过校正,不误收新卡', async () => {
      listSessions.mockImplementationOnce(async () => {
        // 模拟往返窗口内新一轮开跑:本地 activeRunId 推进到 r2 并开出属于它的卡
        useStore.setState({ activeRunId: 'r2', runStatus: 'running', subagents: restoredCards('r2') });
        return summary(null);   // 服务端快照仍停在「无活跃 run」
      });
      await useStore.getState().trackActiveRunViaRest(notOwned, 0);
      expect(useStore.getState().subagents.cards[0].status).toBe('running');
    });

    test('活跃 run 已被 WS 接管 → 仍先收掉不属于它的陈旧卡', async () => {
      useStore.setState({ subagents: restoredCards('r-old') });
      listSessions.mockResolvedValueOnce(summary('r1'));
      await useStore.getState().trackActiveRunViaRest((id) => id === 'r1', 0);
      expect(useStore.getState().subagents.cards[0].status).toBe('ended_without_terminal');
    });
  });
});
