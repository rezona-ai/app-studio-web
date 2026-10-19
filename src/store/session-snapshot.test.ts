// 守的是「形状一致性」这件事本身:五个快照读写点各写一份字面量时,加字段必漏(评审 I-1 实发)。
import { describe, expect, test } from 'vitest';
import { sessionSnapshot, restoreSnapshot } from './session-snapshot';
import { createInitialKoubouState } from './types';
import type { KoubouState, PersistedSession } from './types';
import { createSubagentState, type SubagentCard } from '@/lib/subagent-tasks';

const card = (over: Partial<SubagentCard> = {}): SubagentCard => ({
  taskId: 't1', toolUseId: 'tu-1', runId: 'run-1', kind: 'agent',
  description: '查找落位逻辑', status: 'running', ...over,
});

const stateWith = (over: Partial<KoubouState> = {}): KoubouState => ({ ...createInitialKoubouState(), ...over });

describe('sessionSnapshot', () => {
  // 这条是本文件的存在理由:字段清单变了就在这里红一次,而不是等回放链路上丢卡
  test('快照形状恒含全部会话字段', () => {
    const snap = sessionSnapshot(stateWith({ lastSequence: 7 }), 's1');
    expect(Object.keys(snap).sort()).toEqual(['lastSequence', 'messages', 'sessionId', 'subagents', 'tasks', 'turns']);
  });

  test('sessionId 用传入值,不用 state.sessionId(回放要钉住 clone 会话)', () => {
    const snap = sessionSnapshot(stateWith({ sessionId: 'live-session' }), 'replay-session');
    expect(snap.sessionId).toBe('replay-session');
  });

  test('剥掉 lastToolName,其余字段照留', () => {
    const st = stateWith({ subagents: { ...createSubagentState(), cards: [card({ lastToolName: 'Bash' })], knownToolUseIds: ['tu-1'] } });
    const snap = sessionSnapshot(st, 's1');
    expect(snap.subagents!.cards[0].lastToolName).toBeUndefined();
    expect(snap.subagents!.cards[0].status).toBe('running');
    expect(snap.subagents!.knownToolUseIds).toEqual(['tu-1']);
  });

  test('无 lastToolName 时按同引用透传(零拷贝,流式期每 set 都会走这里)', () => {
    const subagents = { ...createSubagentState(), cards: [card()] };
    expect(sessionSnapshot(stateWith({ subagents }), 's1').subagents).toBe(subagents);
  });
});

describe('restoreSnapshot', () => {
  test('老快照缺 subagents → 归一成空态', () => {
    const legacy: PersistedSession = { sessionId: 's', lastSequence: 1, messages: [], turns: [], tasks: [] };
    expect(restoreSnapshot(legacy).subagents).toEqual(createSubagentState());
  });

  test('内部键残缺的坏快照也归一到完整形状', () => {
    const broken = { sessionId: 's', lastSequence: 1, messages: [], turns: [], tasks: [], subagents: { cards: [card()] } } as unknown as PersistedSession;
    const st = restoreSnapshot(broken).subagents;
    expect(st.cards).toHaveLength(1);
    expect(st.knownToolUseIds).toEqual([]);
    expect(st.deferred).toEqual({});
    expect(st.sealedRunIds).toEqual([]);
  });

  test('无快照 → 全空态', () => {
    expect(restoreSnapshot(undefined)).toEqual({ messages: [], turns: [], tasks: [], subagents: createSubagentState() });
  });
});

// 存量清洗(设计稿 2026-08-27):报错改成固定槽的瞬态字段后,老快照里那些 error 消息在流里
// 已无渲染分支 —— 不滤掉就是一段带间距的空壳节点。新写入的快照不会再有,故这是一次性清洗。
describe('老快照里的存量 error 消息', () => {
  const snap = (messages: PersistedSession['messages']): PersistedSession =>
    ({ sessionId: 's1', lastSequence: 9, turns: [], tasks: [], subagents: createSubagentState(), messages });

  test('被滤掉,其余消息与顺序不变', () => {
    const saved = snap([
      { id: 'u1', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'e1', role: 'assistant', status: 'error', parts: [{ type: 'error', text: 'boom' }] },
      { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '好的' }] },
    ]);
    expect(restoreSnapshot(saved).messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  // 只滤「整条都是 error」的:混排消息(理论上不该出现,但老数据不由我们担保)不该被整条丢掉
  test('混排消息不被整条丢弃', () => {
    const saved = snap([
      { id: 'm1', role: 'assistant', status: 'ready', parts: [
        { type: 'text', text: '说了半句' }, { type: 'error', text: 'boom' },
      ] },
    ]);
    expect(restoreSnapshot(saved).messages.map((m) => m.id)).toEqual(['m1']);
  });

  // 没有存量时不该白造一个新数组:messages 引用不变是「未超限即零拷贝」那套承诺的一部分
  test('无存量时返回原数组引用', () => {
    const messages: PersistedSession['messages'] = [
      { id: 'u1', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] },
    ];
    expect(restoreSnapshot(snap(messages)).messages).toBe(messages);
  });
});
