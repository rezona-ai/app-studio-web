import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';
import { createInitialKoubouState, createInitialServerState, type PersistedSession } from './types';
import { createSubagentState, type SubagentCard } from '@/lib/subagent-tasks';
import { sessionSlotKey } from './session-slot';

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(),
    ...createInitialServerState(),
    planView: 'tasks',
  } as never);
});

const persistedSlice = () =>
  useStore.persist.getOptions().partialize?.(useStore.getState()) as Record<string, unknown>;

describe('子代理卡片切片与视图切换态', () => {
  test('初值:空卡片集合,默认停在任务清单段', () => {
    const s = useStore.getState();
    expect(s.subagents.cards).toEqual([]);
    expect(s.subagents.knownToolUseIds).toEqual([]);
    expect(s.planView).toBe('tasks');
  });

  test('setPlanView 切换视图', () => {
    useStore.getState().setPlanView('subagents');
    expect(useStore.getState().planView).toBe('subagents');
    useStore.getState().setPlanView('tasks');
    expect(useStore.getState().planView).toBe('tasks');
  });

  // 视图选中段是「这一刻在看哪段」而非长期偏好 → 不落盘。
  // 卡片本身则**进快照**(spec 2026-08-24):运行中刷新要能立刻看回刷新前那批卡,
  // 僵尸卡由 sealStaleCards 按 REST 权威 active_run 收口,不再靠「干脆不存」来回避
  test('planView 不进持久化切片', () => {
    useStore.getState().setPlanView('subagents');
    expect(persistedSlice()).not.toHaveProperty('planView');
  });

  test('卡片随会话快照进持久化切片', () => {
    const card: SubagentCard = {
      taskId: 't1', toolUseId: 'tu-1', runId: 'run-1', kind: 'agent',
      description: '查找落位逻辑', status: 'running',
    };
    useStore.setState({
      currentProjectId: 7,
      koubouByProject: {
        [sessionSlotKey(7, 'cc')]: {
          sessionId: 's1', lastSequence: 3, messages: [], turns: [], tasks: [],
          subagents: { ...createSubagentState(), cards: [card] },
        },
      },
    } as never);
    const slot = (persistedSlice().koubouByProject as Record<string, PersistedSession>)[sessionSlotKey(7, 'cc')];
    expect(slot.subagents!.cards).toHaveLength(1);
    expect(slot.subagents!.cards[0]).toMatchObject({ taskId: 't1', status: 'running' });
  });

  test('switchProjectSession 从快照恢复卡片', () => {
    const card: SubagentCard = {
      taskId: 't1', toolUseId: 'tu-1', runId: 'run-1', kind: 'agent', description: '查找落位逻辑', status: 'running',
    };
    useStore.setState({
      koubouByProject: {
        [sessionSlotKey(7, 'cc')]: {
          sessionId: 's1', lastSequence: 3, messages: [], turns: [], tasks: [],
          subagents: { ...createSubagentState(), cards: [card], knownToolUseIds: ['tu-1'] },
        },
      },
    } as never);
    useStore.getState().switchProjectSession(7);
    const s = useStore.getState();
    expect(s.subagents.cards).toEqual([card]);
    expect(s.subagents.knownToolUseIds).toEqual(['tu-1']);
  });

  // 卡片按项目隔离:切到没有快照的项目必须清空,否则 A 项目的卡会挂在 B 项目的对话里
  test('切到无快照的项目时清空卡片,不串项目', () => {
    const card: SubagentCard = {
      taskId: 't1', toolUseId: 'tu-1', runId: 'run-1', kind: 'agent', description: '查找落位逻辑', status: 'running',
    };
    useStore.setState({
      currentProjectId: 7,
      subagents: { ...createSubagentState(), cards: [card] },
      koubouByProject: {},
    } as never);
    useStore.getState().switchProjectSession(8);
    expect(useStore.getState().subagents.cards).toEqual([]);
  });

  test('老快照缺 subagents 字段时按空态兜底', () => {
    useStore.setState({
      koubouByProject: {
        [sessionSlotKey(7, 'cc')]: { sessionId: 's1', lastSequence: 3, messages: [], turns: [], tasks: [] },
      },
    } as never);
    useStore.getState().switchProjectSession(7);
    expect(useStore.getState().subagents).toEqual(createSubagentState());
  });
});
