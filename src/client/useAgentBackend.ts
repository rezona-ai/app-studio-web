'use client';
import { useEffect } from 'react';
import { AGENT_BACKEND_KEY, resolveAgentBackend } from '@/lib/agent-backend';

// `?agent=codex` / `?agent=cc` 的写回副作用:URL 显式指定时把选择落 localStorage,
// 此后不带 query 也保持该 backend。**读取**在 store 初值就同步完成(见 initialAgentBackend),
// 故本 hook 只管持久化,不改 store —— 也就不存在「建连早于 effect」的顺序问题。
export function useAgentBackend() {
  useEffect(() => {
    try {
      const { backend, persist } = resolveAgentBackend(window.location.search, window.localStorage.getItem(AGENT_BACKEND_KEY));
      if (persist) window.localStorage.setItem(AGENT_BACKEND_KEY, backend);
    } catch { /* localStorage 不可用(隐私模式等):本次生效但不持久化 */ }
  }, []);
}
