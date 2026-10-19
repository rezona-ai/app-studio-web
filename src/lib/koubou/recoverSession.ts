// 决定进入项目时用哪个 session_id 建立 WS 连接。
// 抽成纯函数(注入 listSessions 依赖)以便单测,不耦合 WS / React。
import type { SessionSummary } from './client';
import type { AgentBackend } from '@/lib/agent-backend';

export interface LocalSession { sessionId: string | null; lastSequence: number }
export interface ResolvedSession { sessionId: string | null; afterSequence: number | null }

// - 本地有 sessionId → 信任本地,续传(afterSequence = lastSequence),保持现状
// - 本地无(如清空 localStorage / 换设备)→ 查后端取「最近一条有对话的会话」,
//   冷加载全量历史(afterSequence = null,由 session.ready 回灌)
// - listSessions 抛错 → 回退新建(sessionId = null),永不比现状更差
//
// backend 过滤(codex 接入):backend 建会话时固定、attach 改不了。恢复到别的 backend 的会话会
// 用错渲染器(codex 会话灌进 claude.message 分支 → 整段历史不显示),故目标 backend 无会话时宁可新建。
export async function resolveSession(
  local: LocalSession,
  listSessions: () => Promise<SessionSummary[]>,
  backend: AgentBackend = 'cc',
): Promise<ResolvedSession> {
  if (local.sessionId) return { sessionId: local.sessionId, afterSequence: local.lastSequence };
  try {
    const sessions = await listSessions();
    // 缺 backend 字段的老会话按服务端缺省值 cc 处理
    const matched = sessions.filter((s) => (s.backend ?? 'cc') === backend);
    return { sessionId: pickRecoverable(matched), afterSequence: null };
  } catch {
    return { sessionId: null, afterSequence: null };
  }
}

// 列表按 updated_at 倒序。无 sessionId 连接会即时创建空会话(updated_at == created_at),
// 这类空会话常堆在最前,纯取 data[0] 会命中空会话、恢复不出历史。
// 故优先取「最近一条有活动(updated_at !== created_at,即产生过消息/run)」的会话;
// 全是空会话时回退 data[0] —— 严格不劣于直接取 data[0]。
function pickRecoverable(sessions: SessionSummary[]): string | null {
  const active = sessions.find((s) => s.updated_at !== s.created_at);
  return (active ?? sessions[0])?.session_id ?? null;
}
