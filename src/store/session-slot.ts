import type { AgentBackend } from '@/lib/agent-backend';

// 会话/模型记忆的持久化槽位 key。backend 建会话时固定,同一项目下 cc 与 codex 是两个**不同会话**:
// 若共用 key,切 backend 后会用 cc 的消息快照渲染 codex 会话(渲染器错配),或反之。
// cc 刻意沿用纯项目 id —— 线上老快照(以及 replay/share 的 pin 写入)无需迁移。
export function sessionSlotKey(pid: number | string, backend: AgentBackend): string {
  return backend === 'cc' ? String(pid) : `${pid}:${backend}`;
}
