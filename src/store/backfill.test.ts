import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';
import type { ServerEvent } from '@/koubou/protocol';
import { createInitialKoubouState } from './types';

vi.mock('@/lib/koubou/client', () => ({ koubouApi: { listEvents: vi.fn() } }));
const listEvents = koubouApi.listEvents as unknown as ReturnType<typeof vi.fn>;

const page = (events: ServerEvent[], latest?: number) => ({
  events,
  oldest_sequence: typeof events[0]?.sequence === 'number' ? events[0].sequence : 0,
  newest_sequence: typeof events[events.length - 1]?.sequence === 'number' ? (events[events.length - 1].sequence as number) : 0,
  latest_sequence: latest ?? (typeof events[events.length - 1]?.sequence === 'number' ? (events[events.length - 1].sequence as number) : 0),
  has_more: false,
});
const amsg = (seq: number, uuid: string, text: string): ServerEvent =>
  ({ type: 'claude.message', project_id: '7', session_id: 's1', sequence: seq, payload: { sdk_type: 'AssistantMessage', payload: { uuid, content: [{ type: 'text', text }] } } }) as unknown as ServerEvent;
const umsg = (seq: number, text: string): ServerEvent =>
  ({ type: 'user.message', project_id: '7', session_id: 's1', sequence: seq, event_id: `evt_${seq}`, payload: { message: { role: 'user', content: text } } }) as unknown as ServerEvent;
const finished = (seq: number, status = 'succeeded'): ServerEvent =>
  ({ type: 'run.finished', project_id: '7', session_id: 's1', sequence: seq, payload: { run_id: 'r1', status } }) as unknown as ServerEvent;

// 副作用替身:回填不应真打 PGC
const loadCanvas = vi.fn().mockResolvedValue(undefined);
const loadVersions = vi.fn().mockResolvedValue(undefined);
const importMediaFromEvent = vi.fn();

beforeEach(() => {
  listEvents.mockReset();
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

describe('backfillSessionGap:重连后补齐断线窗口内的事件缺口', () => {
  test('缺口内的 assistant 消息与 run.finished 被补入;succeeded 触发画布/版本刷新', async () => {
    listEvents.mockResolvedValueOnce(page([amsg(5, 'a5', '断线期间的回复'), finished(6)]));
    await useStore.getState().backfillSessionGap();
    expect(listEvents).toHaveBeenCalledWith(7, 's1', { afterSequence: 4, limit: 100 });
    const s = useStore.getState();
    expect(s.messages.map((m) => m.id)).toContain('a5');
    expect(s.lastSequence).toBe(6);
    expect(loadCanvas).toHaveBeenCalled();
    expect(loadVersions).toHaveBeenCalled();
    expect(importMediaFromEvent).toHaveBeenCalledTimes(2);
  });

  test('幂等:重复回填同一缺口不产生重复消息(seenSequences 去重)', async () => {
    listEvents.mockResolvedValue(page([amsg(5, 'a5', 'x')]));
    await useStore.getState().backfillSessionGap();
    useStore.setState({ lastSequence: 4 });   // 模拟旧游标再次触发
    await useStore.getState().backfillSessionGap();
    expect(useStore.getState().messages.filter((m) => m.id === 'a5')).toHaveLength(1);
  });

  test('user.message 与尾部既有 user 气泡同文本 → 跳过(own-tab 冲刷竞态);不同文本照常补入', async () => {
    useStore.setState({ messages: [{ id: 'opt1', role: 'user', status: 'ready', parts: [{ type: 'text', text: '你好' }] }] });
    listEvents.mockResolvedValueOnce(page([umsg(5, '你好'), umsg(6, '另一句')]));
    await useStore.getState().backfillSessionGap();
    const users = useStore.getState().messages.filter((m) => m.role === 'user');
    expect(users.map((m) => m.parts[0]).filter((p) => p.type === 'text' && p.text === '你好')).toHaveLength(1);
    expect(users.some((m) => m.parts[0]?.type === 'text' && m.parts[0].text === '另一句')).toBe(true);
  });

  test('缺口为空(无新事件)→ 无副作用', async () => {
    listEvents.mockResolvedValueOnce(page([]));
    await useStore.getState().backfillSessionGap();
    expect(useStore.getState().messages).toHaveLength(0);
    expect(loadCanvas).not.toHaveBeenCalled();
  });

  test('run.finished 非 succeeded → 不触发画布/版本刷新', async () => {
    listEvents.mockResolvedValueOnce(page([finished(5, 'interrupted')]));
    await useStore.getState().backfillSessionGap();
    expect(loadCanvas).not.toHaveBeenCalled();
  });

  test('回放期间不回填', async () => {
    useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's1', total: 3, cursor: 1, speed: 1 } });
    await useStore.getState().backfillSessionGap();
    expect(listEvents).not.toHaveBeenCalled();
  });
});
