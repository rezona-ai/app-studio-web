import { beforeEach, expect, test } from 'vitest';
import { initialAgentBackend, useStore } from '@/store';
import { AGENT_BACKEND_KEY } from '@/lib/agent-backend';

beforeEach(() => {
  window.localStorage.removeItem(AGENT_BACKEND_KEY);
  window.history.replaceState({}, '', '/');
});

test('默认 cc', () => {
  expect(initialAgentBackend()).toBe('cc');
});

test('URL query 指定即生效(不依赖存储)', () => {
  window.history.replaceState({}, '', '/?agent=codex');
  expect(initialAgentBackend()).toBe('codex');
});

test('存储值在无 query 时生效', () => {
  window.localStorage.setItem(AGENT_BACKEND_KEY, 'codex');
  expect(initialAgentBackend()).toBe('codex');
});

test('query 可覆盖存储切回 cc', () => {
  window.localStorage.setItem(AGENT_BACKEND_KEY, 'codex');
  window.history.replaceState({}, '', '/?agent=cc');
  expect(initialAgentBackend()).toBe('cc');
});

test('store 暴露 agentBackend 字段(建连时读)', () => {
  expect(['cc', 'codex']).toContain(useStore.getState().agentBackend);
});
