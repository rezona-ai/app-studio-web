// Agent backend(cc = Claude Agent SDK / codex = Codex app-server)的解析纯逻辑。
// backend 在建会话时固定,决定:建连参数 ?backend=、模型 / skill 列表、agent 消息渲染器。
// 本期不给产品化入口:`?agent=codex` / `?agent=cc` 切换并落 localStorage,每浏览器独立生效
// (见设计稿 2026-07-30-codex-backend-integration)。
// 纯函数无副作用:localStorage / location 读写由调用方(src/client/useAgentBackend.ts)负责。

export type AgentBackend = 'cc' | 'codex';

// 独立存储 key:不并进 zustand persist 的 `rezonalab-v4` —— 那份切片形状变更风险高;
// 调试性开关用独立 key(与主站下发主题 / 语言的 rezonalab-config 同范式,但本 key 由本应用独占写读,非跨应用契约)
export const AGENT_BACKEND_KEY = 'rezonalab-agent-backend';

const BACKENDS: readonly AgentBackend[] = ['cc', 'codex'];

// 只放行词表内的值;词表外(如 single)/ 非字符串一律视作无,由调用方回落
export function normalizeBackend(v: unknown): AgentBackend | null {
  return typeof v === 'string' && (BACKENDS as readonly string[]).includes(v) ? (v as AgentBackend) : null;
}

export interface ResolvedAgentBackend {
  backend: AgentBackend;
  persist: boolean;   // 真 = query 显式指定且与存储不同,调用方应写回存储
}

// 优先级:URL query(显式意图,写回存储)> 存储 > 'cc'
export function resolveAgentBackend(search: string, stored: string | null): ResolvedAgentBackend {
  const fromStore = normalizeBackend(stored);
  const fromQuery = normalizeBackend(new URLSearchParams(search).get('agent'));
  if (fromQuery) return { backend: fromQuery, persist: fromQuery !== fromStore };
  return { backend: fromStore ?? 'cc', persist: false };
}
