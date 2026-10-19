import { beforeEach, expect, test } from 'vitest';
import { useStore } from '@/store';

beforeEach(() => useStore.setState({ availableModels: [], selectedModel: null, modelByProject: {}, currentProjectId: null, agentBackend: 'cc', modelBackend: null }));

test('setAvailableModels 无选择时默认取首项', () => {
  useStore.getState().setAvailableModels(['claude-opus-4-8', 'claude-fable-5']);
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
  expect(useStore.getState().availableModels).toHaveLength(2);
});
test('已选且仍在列表 → 保留', () => {
  useStore.setState({ selectedModel: 'claude-fable-5' });
  useStore.getState().setAvailableModels(['claude-opus-4-8', 'claude-fable-5']);
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
});
test('已选但不在新列表 → 回落首项', () => {
  useStore.setState({ selectedModel: 'gone-model' });
  useStore.getState().setAvailableModels(['claude-opus-4-8']);
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
});
test('setSelectedModel 写入选择', () => {
  useStore.setState({ availableModels: ['a', 'b'] });
  useStore.getState().setSelectedModel('b');
  expect(useStore.getState().selectedModel).toBe('b');
});

// —— 按项目记忆(spec 2026-07-23 model-per-project)——

test('setSelectedModel 在有当前项目时同步落 modelByProject', () => {
  useStore.setState({ currentProjectId: 7 });
  useStore.getState().setSelectedModel('claude-fable-5');
  expect(useStore.getState().modelByProject['7']).toBe('claude-fable-5');
});
test('setSelectedModel 无当前项目时只写视图不落映射', () => {
  useStore.getState().setSelectedModel('claude-fable-5');
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
  expect(useStore.getState().modelByProject).toEqual({});
});
test('switchProjectSession 载入目标项目的模型记忆', () => {
  useStore.setState({
    availableModels: ['claude-opus-4-8', 'claude-fable-5'],
    selectedModel: 'claude-opus-4-8',
    modelByProject: { '2': 'claude-fable-5' },
  });
  useStore.getState().switchProjectSession(2);
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
});
test('switchProjectSession 无记忆时沿用当前选择(全局兜底)', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-fable-5' });
  useStore.getState().switchProjectSession(3);
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
});
test('switchProjectSession 记忆不在可用列表 → 回落首项(不冲掉映射)', () => {
  useStore.setState({
    availableModels: ['claude-opus-4-8'],
    selectedModel: 'claude-opus-4-8',
    modelByProject: { '2': 'gone-model' },
  });
  useStore.getState().switchProjectSession(2);
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
  expect(useStore.getState().modelByProject['2']).toBe('gone-model');
});
test('switchProjectSession 可用列表为空(冷启动) → 先信记忆', () => {
  useStore.setState({ modelByProject: { '2': 'claude-fable-5' } });
  useStore.getState().switchProjectSession(2);
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
});
test('setAvailableModels 回落只改视图,不冲掉项目映射', () => {
  useStore.setState({ currentProjectId: 2, selectedModel: 'gone-model', modelByProject: { '2': 'gone-model' } });
  useStore.getState().setAvailableModels(['claude-opus-4-8']);
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
  expect(useStore.getState().modelByProject['2']).toBe('gone-model');
});
test('两个项目各记各的:A 选 X、B 选 Y、切回 A 仍是 X', () => {
  useStore.setState({ availableModels: ['x', 'y'] });
  useStore.setState({ currentProjectId: 1 });
  useStore.getState().switchProjectSession(1);
  useStore.getState().setSelectedModel('x');
  useStore.setState({ currentProjectId: 2 });
  useStore.getState().switchProjectSession(2);
  useStore.getState().setSelectedModel('y');
  useStore.setState({ currentProjectId: 1 });
  useStore.getState().switchProjectSession(1);
  expect(useStore.getState().selectedModel).toBe('x');
});

// —— 模型与 backend 绑定(codex 接入):带错 backend 的模型建新会话会被服务端 invalid model + 4400 拒 ——

test('setAvailableModels 记下列表所属 backend', () => {
  useStore.getState().setAvailableModels(['gpt-5.6', 'gpt-5.5'], 'codex');
  expect(useStore.getState().modelBackend).toBe('codex');
});

test('switchProjectSession 跨 backend 不继承模型(宁可留空由服务端给默认)', () => {
  useStore.setState({ agentBackend: 'codex', modelBackend: 'cc', selectedModel: 'claude-opus-5', availableModels: [], modelByProject: {} });
  useStore.getState().switchProjectSession(9);
  expect(useStore.getState().selectedModel).toBeNull();
});

test('switchProjectSession 同 backend 仍继承最近一次全局选择', () => {
  useStore.setState({ agentBackend: 'codex', modelBackend: 'codex', selectedModel: 'gpt-5.5', availableModels: [], modelByProject: {} });
  useStore.getState().switchProjectSession(9);
  expect(useStore.getState().selectedModel).toBe('gpt-5.5');
});

test('同 backend 的项目记忆照旧优先于全局兜底', () => {
  useStore.setState({
    agentBackend: 'codex', modelBackend: 'codex', selectedModel: 'gpt-5.5',
    availableModels: ['gpt-5.6', 'gpt-5.5'], modelByProject: { '9:codex': 'gpt-5.6' },
  });
  useStore.getState().switchProjectSession(9);
  expect(useStore.getState().selectedModel).toBe('gpt-5.6');
});
