// Koubou HTTP 客户端:经 /api/koubou/* 代理(透传 cookie 鉴权),与 mintTicket 同通道。
// 注:koubou 信封是 { code: 0, message, data },code===0 为成功,无 PGC 的 success 字段,故独立 unwrap。
import { apiPath } from '@/lib/basePath';

const PREFIX = apiPath('/api/koubou');

import type { ServerEvent } from '@/koubou/protocol';
import type { AgentBackend } from '@/lib/agent-backend';

// 会话轻量摘要(GET sessions 返回元素),见 koubou http-api.md 的 SessionSummary
export interface SessionSummary {
  session_id: string;
  project_id: string;
  status: string;
  // 会话所属 backend(建会话时固定);老服务端/老记录可能缺失,消费方按 'cc' 兜底
  backend?: string;
  title: string | null;
  active_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface KoubouEnvelope<T> { code: number; message: string; data: T }

export class KoubouError extends Error {
  constructor(public code: number, message: string, public status: number) {
    super(message);
    this.name = 'KoubouError';
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: KoubouEnvelope<T> | null = null;
  try { env = (await res.json()) as KoubouEnvelope<T>; } catch { /* 非 JSON */ }
  if (!res.ok || !env || env.code !== 0) {
    throw new KoubouError(env?.code ?? res.status, env?.message ?? `HTTP ${res.status}`, res.status);
  }
  return env.data;
}

// 默认 15s:休眠恢复后悬挂的 fetch 有界失败,调用方各有回退分支(如 resolveSession 回退新建);
// 本 helper 下**绝大多数**接口是轻量控制面调用,15s 足够。
// clone 系是例外:服务端要整份复制一个会话(provisioning),几十秒到分钟级都正常,压在默认值上会把一个
// 其实会成功的操作误杀成前端失败(bug #13870465)。口径对齐 pgc/client 的 SLOW_TIMEOUT_MS —— 同一条
// 分享/回放编排里 pgc 那半截(workbenchShare.open / startReplay)早就放宽了,koubou 这半截漏配。
const DEFAULT_TIMEOUT_MS = 15_000;
const SLOW_TIMEOUT_MS = 300_000;

async function koubou<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  // credentials:'include' 让浏览器附上 .rezona.ai session cookie(cookie 制鉴权)
  const init: RequestInit = { method, credentials: 'include', signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return unwrap<T>(await fetch(`${PREFIX}${path}`, init));
}

// 历史事件分页(GET events 返回信封):events 升序,与 WS 帧同构;
// has_more 表示本页之前还有更早事件;latest_sequence 为会话最新 sequence(建连续传用)
export interface EventsPage {
  events: ServerEvent[];
  oldest_sequence: number;
  newest_sequence: number;
  latest_sequence: number;
  has_more: boolean;
}

export const koubouApi = {
  // 列出当前用户在该项目下的会话,按 updated_at 倒序;已删除的不出现。project_id 进存储层会被规范化小写
  listSessions: (projectId: string | number) =>
    koubou<SessionSummary[]>('GET', `/projects/${projectId}/sessions`),
  // 可用模型列表(GET /models),仅取契约约定的 data.models。两个 backend 列表不同(且有重叠 id),
  // 必须按当前 backend 取,否则 codex 会话带上 claude 模型建连会被 4400 拒
  listModels: (backend: AgentBackend) =>
    koubou<{ backend: string; default_model: string | null; models: string[] }>('GET', `/models?backend=${backend}`)
      .then((d) => d.models),
  // 可选 skill 列表(GET /skills,公开接口):name 是稳定名(前端 i18n 映射显示名/描述),
  // invocation 是该 backend 的原生调用串(cc 为 /name、codex 为 $name),原样插入输入框
  listSkills: (backend: AgentBackend) =>
    koubou<{ backend: string; skills: { name: string; invocation?: string }[] }>('GET', `/skills?backend=${backend}`)
      // invocation 缺失(老服务端)时按 cc 惯例兜底,避免 picker 插不出调用串
      .then((d) => d.skills.map((s) => ({ name: s.name, invocation: s.invocation || `/${s.name}` }))),
  // 历史事件分页:beforeSequence 反向(向旧翻页)/ afterSequence 正向(回放全量拉取);两者互斥,不同时传
  listEvents: (projectId: string | number, sessionId: string, opts: { limit?: number; beforeSequence?: number; afterSequence?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.beforeSequence != null) q.set('before_sequence', String(opts.beforeSequence));
    if (opts.afterSequence != null) q.set('after_sequence', String(opts.afterSequence));
    const qs = q.toString();
    return koubou<EventsPage>('GET', `/projects/${projectId}/sessions/${sessionId}/events${qs ? `?${qs}` : ''}`);
  },
  // 回放 onboarding:把白名单模板克隆成当前用户 project 下的可续接会话(target 身份取鉴权上下文,不由 body 指定)。
  // 409 REPLAY_ALREADY_PROVISIONED 由调用方兜底(改查既有会话,勿重克隆)
  cloneFromTemplate: (projectId: string | number, templateId: string) =>
    koubou<{ session_id: string; already_provisioned: boolean }>('POST', `/projects/${projectId}/sessions/clone-from-template`, { template_id: templateId }, SLOW_TIMEOUT_MS),
  // 分享工作台:把源用户某 session 克隆成 target(=recipient 名下新建 project)下的可续接会话。
  // target 身份取鉴权上下文 + path(projectId),不由 body 指定;source_* + share_token 为不可信输入,
  // 由 koubou 用 pgc 签发的 share_token 验签放行(见计划 KTD4)。
  // 幂等:同一 share 二次克隆 → 200 返回既有 session_id(already_provisioned=true);
  // target 已有无关 session/非空 → 409 零写入,由调用方兜底路由到既有项目(不 dead-end)。
  cloneFromShare: (
    projectId: string | number,
    // koubou Pydantic v2 不做 int→str 强转,四字段须全为字符串,否则送数字 → 422
    body: { source_user_id: string; source_project_id: string; source_session_id: string; share_token: string },
  ) =>
    koubou<{ session_id: string; already_provisioned: boolean }>('POST', `/projects/${projectId}/sessions/clone-from-share`, body, SLOW_TIMEOUT_MS),
};
