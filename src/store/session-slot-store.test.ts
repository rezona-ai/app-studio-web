import { beforeEach, expect, test } from 'vitest';
import { useStore } from '@/store';
import { createInitialServerState } from '@/store/types';

// 同一项目在 cc / codex 下是两个独立会话:快照与模型记忆各存各的槽位
beforeEach(() => useStore.setState({
  ...createInitialServerState(),
  agentBackend: 'cc',
  availableModels: [],
  selectedModel: null,
  modelByProject: {},
  booting: false,
}));

test('cc 读纯项目 id 槽位(老快照零迁移)', () => {
  useStore.setState({
    koubouByProject: { '5': { sessionId: 'cc-sess', lastSequence: 3, messages: [], turns: [], tasks: [] } },
  });
  useStore.getState().switchProjectSession(5);
  expect(useStore.getState().sessionId).toBe('cc-sess');
  expect(useStore.getState().backend).toBe('cc');
});

test('codex 读独立槽位,不误用 cc 快照', () => {
  useStore.setState({
    agentBackend: 'codex',
    koubouByProject: {
      '5': { sessionId: 'cc-sess', lastSequence: 3, messages: [], turns: [], tasks: [] },
      '5:codex': { sessionId: 'codex-sess', lastSequence: 9, messages: [], turns: [], tasks: [] },
    },
  });
  useStore.getState().switchProjectSession(5);
  expect(useStore.getState().sessionId).toBe('codex-sess');
  expect(useStore.getState().lastSequence).toBe(9);
  // 预选渲染器 = 开关值,随后由 session.ready.backend 校正
  expect(useStore.getState().backend).toBe('codex');
});

test('codex 无快照时不回落到 cc 会话(宁可新建)', () => {
  useStore.setState({
    agentBackend: 'codex',
    koubouByProject: { '5': { sessionId: 'cc-sess', lastSequence: 3, messages: [], turns: [], tasks: [] } },
  });
  useStore.getState().switchProjectSession(5);
  expect(useStore.getState().sessionId).toBeNull();
});

test('模型记忆按 backend 分槽:codex 选的模型不污染 cc', () => {
  useStore.setState({ currentProjectId: 5, availableModels: ['gpt-5.5'], agentBackend: 'codex' });
  useStore.getState().setSelectedModel('gpt-5.5');
  expect(useStore.getState().modelByProject['5:codex']).toBe('gpt-5.5');
  expect(useStore.getState().modelByProject['5']).toBeUndefined();
});
