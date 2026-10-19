import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  capPersistedSessions,
  createThrottledPersistStorage,
  PERSIST_MAX_MESSAGES,
  PERSIST_MAX_SUBAGENT_CARDS,
  PERSIST_MAX_TURNS,
} from './persist-storage';
import type { Message, PersistedSession, TurnMeta } from './types';
import { createSubagentState, type SubagentCard } from '@/lib/subagent-tasks';

// 内存版 Storage,setItem/removeItem 打桩以断言底层写入次数与内容
function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn((k: string) => void map.delete(k)),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage & { map: Map<string, string>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
}

describe('createThrottledPersistStorage(对象级:序列化与写盘都进节流窗口)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const sv = (n: number) => ({ state: { n }, version: 1 });

  test('窗口内高频 setItem:不序列化不落盘;到点只对最新值 stringify 一次', () => {
    const store = memStore();
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    const [v1, v2, v3] = [sv(1), sv(2), sv(3)];
    const spy = vi.spyOn(JSON, 'stringify');
    s.setItem('k', v1);
    s.setItem('k', v2);
    s.setItem('k', v3);
    // 合并窗口内:零序列化、零写盘(这正是 D1 要消灭的 per-token stringify)
    const oursDuringWindow = spy.mock.calls.filter((c) => c[0] === v1 || c[0] === v2 || c[0] === v3);
    expect(oursDuringWindow).toHaveLength(0);
    expect(store.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    const ours = spy.mock.calls.filter((c) => c[0] === v1 || c[0] === v2 || c[0] === v3);
    expect(ours).toHaveLength(1);
    expect(ours[0][0]).toBe(v3);   // 只序列化最新值
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(store.setItem).toHaveBeenCalledWith('k', JSON.stringify(v3));
  });

  test('getItem 读回底层 JSON 并解析为 StorageValue(round-trip)', () => {
    const store = memStore();
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    s.setItem('k', sv(7));
    vi.advanceTimersByTime(1000);
    expect(s.getItem('k')).toEqual({ state: { n: 7 }, version: 1 });
    expect(s.getItem('missing')).toBeNull();
  });

  test('pagehide 立即 flush(含序列化),不等窗口结束', () => {
    const store = memStore();
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    s.setItem('k', sv(1));
    window.dispatchEvent(new Event('pagehide'));
    expect(store.setItem).toHaveBeenCalledWith('k', JSON.stringify(sv(1)));
  });

  test('visibilitychange=hidden 立即 flush(切后台可能被系统回收)', () => {
    const store = memStore();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    s.setItem('k', sv(2));
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.setItem).toHaveBeenCalledWith('k', JSON.stringify(sv(2)));
  });

  test('removeItem 取消待写并删除,窗口到点不再写回', () => {
    const store = memStore();
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    store.setItem('k', JSON.stringify(sv(0)));
    store.setItem.mockClear();
    s.setItem('k', sv(9)); // 排入待写
    s.removeItem('k');     // 取消待写 + 删除
    vi.advanceTimersByTime(1000);
    expect(store.removeItem).toHaveBeenCalledWith('k');
    expect(store.setItem).not.toHaveBeenCalled();
    expect(s.getItem('k')).toBeNull();
  });

  test('底层 setItem 抛错(QuotaExceeded)被吞,不冒泡', () => {
    const store = memStore();
    store.setItem.mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    s.setItem('k', sv(1));
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  test('损坏的底层 JSON:getItem 返回 null 不抛错', () => {
    const store = memStore();
    store.setItem('k', '{broken');
    const s = createThrottledPersistStorage<{ n: number }>(() => store, 1000);
    expect(s.getItem('k')).toBeNull();
  });
});

describe('capPersistedSessions', () => {
  const msg = (i: number): Message => ({ id: `m${i}`, role: 'assistant', parts: [{ type: 'text', text: 'x' }], status: 'ready' });
  const turn = (i: number): TurnMeta => ({ runId: `r${i}`, model: 'm', startedAt: null, finishedAt: null, status: 'succeeded', lastMessageId: `m${i}` });

  test('超限会话裁剪到尾部上限,保留最新的那批', () => {
    const messages = Array.from({ length: 250 }, (_, i) => msg(i));
    const turns = Array.from({ length: 200 }, (_, i) => turn(i));
    const capped = capPersistedSessions({ '7': { sessionId: 's', lastSequence: 9, messages, turns, tasks: [] } });
    expect(capped['7'].messages).toHaveLength(PERSIST_MAX_MESSAGES);
    expect(capped['7'].turns).toHaveLength(PERSIST_MAX_TURNS);
    expect(capped['7'].messages[0].id).toBe(`m${250 - PERSIST_MAX_MESSAGES}`); // 切的是头部,留尾部
    expect(capped['7'].messages.at(-1)!.id).toBe('m249');
    expect(capped['7'].sessionId).toBe('s'); // 其余字段透传
    expect(capped['7'].lastSequence).toBe(9);
  });

  test('未超限的会话按同引用透传(零拷贝)', () => {
    const session: PersistedSession = { sessionId: 's', lastSequence: 1, messages: [msg(0)], turns: [turn(0)], tasks: [] };
    const capped = capPersistedSessions({ '7': session });
    expect(capped['7']).toBe(session);
  });

  test('空 map 返回空 map', () => {
    expect(capPersistedSessions({})).toEqual({});
  });

  test('老数据缺 turns/messages 字段不抛错,原样透传', () => {
    const legacy = { sessionId: 's8', lastSequence: 3 } as unknown as PersistedSession; // 无 messages/turns
    const capped = capPersistedSessions({ '8': legacy });
    expect(capped['8']).toBe(legacy);
  });

  // spec 2026-08-24-refresh-restore-turn-model-and-subagents:子代理卡片进快照后的落盘投影
  describe('子代理卡片(subagents)', () => {
    const card = (i: number, over: Partial<SubagentCard> = {}): SubagentCard => ({
      taskId: `t${i}`, toolUseId: `tu${i}`, runId: 'run-1', kind: 'agent',
      description: `任务 ${i}`, status: 'completed', ...over,
    });
    const withCards = (cards: SubagentCard[]): PersistedSession => ({
      sessionId: 's', lastSequence: 1, messages: [msg(0)], turns: [turn(0)], tasks: [],
      subagents: { ...createSubagentState(), cards },
    });

    test('卡片超限时切尾留最近 N 张', () => {
      const cards = Array.from({ length: PERSIST_MAX_SUBAGENT_CARDS + 20 }, (_, i) => card(i));
      const capped = capPersistedSessions({ '9': withCards(cards) });
      expect(capped['9'].subagents!.cards).toHaveLength(PERSIST_MAX_SUBAGENT_CARDS);
      expect(capped['9'].subagents!.cards.at(-1)!.taskId).toBe(`t${PERSIST_MAX_SUBAGENT_CARDS + 19}`);
    });

    // 这里只管切尾。live-only 字段(lastToolName)的剥离在写快照时做 —— partialize 每次 set()
    // 都跑,在这里剥会让零拷贝承诺在整个活跃回合里失效,守护点见 session-snapshot.test.ts
    test('未超限时按同引用透传(零拷贝),不因卡片内容重建对象', () => {
      const session = withCards([card(0, { status: 'running', lastToolName: 'Bash' })]);
      expect(capPersistedSessions({ '9': session })['9']).toBe(session);
    });

    test('老快照缺 subagents 字段不抛错', () => {
      const legacy: PersistedSession = { sessionId: 's', lastSequence: 1, messages: [msg(0)], turns: [turn(0)], tasks: [] };
      expect(capPersistedSessions({ '9': legacy })['9']).toBe(legacy);
    });
  });
});
