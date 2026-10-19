import { beforeEach, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentBackend } from './useAgentBackend';
import { AGENT_BACKEND_KEY } from '@/lib/agent-backend';

beforeEach(() => {
  window.localStorage.removeItem(AGENT_BACKEND_KEY);
  window.history.replaceState({}, '', '/');
});

test('?agent=codex 写回存储(此后不带 query 也保持)', () => {
  window.history.replaceState({}, '', '/?agent=codex');
  renderHook(() => useAgentBackend());
  expect(window.localStorage.getItem(AGENT_BACKEND_KEY)).toBe('codex');
});

test('?agent=cc 写回存储(切回默认 backend)', () => {
  window.localStorage.setItem(AGENT_BACKEND_KEY, 'codex');
  window.history.replaceState({}, '', '/?agent=cc');
  renderHook(() => useAgentBackend());
  expect(window.localStorage.getItem(AGENT_BACKEND_KEY)).toBe('cc');
});

test('无 query 不写存储', () => {
  renderHook(() => useAgentBackend());
  expect(window.localStorage.getItem(AGENT_BACKEND_KEY)).toBeNull();
});

test('非法 query 不写存储', () => {
  window.history.replaceState({}, '', '/?agent=single');
  renderHook(() => useAgentBackend());
  expect(window.localStorage.getItem(AGENT_BACKEND_KEY)).toBeNull();
});
