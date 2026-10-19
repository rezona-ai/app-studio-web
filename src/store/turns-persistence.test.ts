import { afterEach, expect, test } from 'vitest';
import { useStore } from './index';
import type { TurnMeta, PersistedSession } from './types';

const turn: TurnMeta = { runId: 'r1', model: 'claude-opus-4-8', startedAt: 'A', finishedAt: 'B', status: 'succeeded', lastMessageId: 'm1' };

afterEach(() => { localStorage.clear(); });

test('switchProjectSession 从快照载入 turns', () => {
  useStore.setState({ koubouByProject: { '7': { sessionId: 's7', lastSequence: 9, messages: [], turns: [turn], tasks: [] } } });
  useStore.getState().switchProjectSession(7);
  expect(useStore.getState().turns).toEqual([turn]);
});

test('快照无 turns(老数据)→ 降级空数组', () => {
  // 模拟旧持久化结构(无 turns 字段)
  useStore.setState({ koubouByProject: { '8': { sessionId: 's8', lastSequence: 3, messages: [] } as unknown as never } });
  useStore.getState().switchProjectSession(8);
  expect(useStore.getState().turns).toEqual([]);
});

test('tasks 随会话快照恢复;旧快照缺 tasks 回退空数组', () => {
  const tasks = [{ id: '1', subject: 'a', status: 'pending' as const }];
  useStore.setState({
    koubouByProject: {
      '1': { sessionId: 's1', lastSequence: 3, messages: [], turns: [], tasks },
      // 模拟 v1 旧快照:无 tasks 字段
      '2': { sessionId: 's2', lastSequence: 5, messages: [], turns: [] } as unknown as PersistedSession,
    },
  });
  useStore.getState().switchProjectSession(1);
  expect(useStore.getState().tasks).toEqual(tasks);
  useStore.getState().switchProjectSession(2);
  expect(useStore.getState().tasks).toEqual([]);
});

test('togglePlanCollapsed 翻转折叠态', () => {
  expect(useStore.getState().planCollapsed).toBe(false);
  useStore.getState().togglePlanCollapsed();
  expect(useStore.getState().planCollapsed).toBe(true);
  useStore.getState().togglePlanCollapsed();
  expect(useStore.getState().planCollapsed).toBe(false);
});
