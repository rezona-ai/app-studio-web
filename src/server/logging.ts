// 统一 JSON 结构化日志（对齐 pgc-server：每行一条 JSON，含 level/severity/msg/ts + 业务字段），
// 输出到 stdout 由 GKE / Cloud Logging 采集。BFF 请求访问日志与上游 5xx/异常都走此模块，
// 取代散落的 console.log/console.error，便于在 Cloud Logging 里按字段检索与告警。
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

/** 日志附加字段；值用 unknown 而非 any，序列化按 JSON 处理。 */
export type LogFields = Record<string, unknown>;

type LogLevel = 'info' | 'warn' | 'error';

// ── Datadog APM 日志-trace 关联 ──────────────────────────────────────────
// 本仓库是手写 JSON logger（非 pino/winston），DD_LOGS_INJECTION 无法自动注入，
// 故在此手动取活跃 span 的 trace/span id，让 Cloud Logging 日志能跳到 APM trace。
// dd-trace 由部署侧 NODE_OPTIONS="--import dd-trace/initialize.mjs" preload 初始化；
// 这里只「读」已初始化的单例，绝不触发 init，未启用时零开销、零副作用。

/** dd-trace 运行时的最小结构化接口（只取关联所需字段，避免 any 与硬编译期依赖）。 */
interface DdSpanContext {
  toTraceId(): string;
  toSpanId(): string;
}
interface DdSpan {
  context(): DdSpanContext;
}
export interface DdTracerLike {
  scope(): { active(): DdSpan | null };
}

/**
 * 从 tracer 取当前活跃 span 的 trace/span id 作为日志关联字段。
 * 无 tracer / 无活跃 span / 取值异常 → 一律返回空对象（绝不影响日志输出）。
 * 纯函数，便于单测注入 fake tracer。
 */
export function traceCorrelation(tracer: DdTracerLike | null): LogFields {
  if (!tracer) return {};
  try {
    const span = tracer.scope().active();
    if (!span) return {};
    const ctx = span.context();
    return { 'dd.trace_id': ctx.toTraceId(), 'dd.span_id': ctx.toSpanId() };
  } catch {
    return {};
  }
}

let cachedTracer: DdTracerLike | null = null;
let tracerResolved = false;

/**
 * 惰性获取已被 preload 初始化的 dd-trace 单例。
 * 仅当 DD_TRACE_ENABLED=true 才尝试；加载失败返回 null。不触发 init。
 */
function activeTracer(): DdTracerLike | null {
  if (process.env.DD_TRACE_ENABLED !== 'true') return null;
  if (!tracerResolved) {
    tracerResolved = true;
    try {
      const requireFn = createRequire(import.meta.url);
      cachedTracer = requireFn('dd-trace') as unknown as DdTracerLike;
    } catch {
      cachedTracer = null;
    }
  }
  return cachedTracer;
}

/**
 * 输出一条单行 JSON 日志。
 * @param level 级别（info/warn/error）
 * @param msg 结构化事件名（可聚合，如 "request" / "bff_upstream_5xx"）
 * @param fields 业务字段
 */
function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    severity: level.toUpperCase(), // GCP Cloud Logging severity 兼容
    msg,
    ts: new Date().toISOString(),
    ...traceCorrelation(activeTracer()), // 启用 APM 时带 dd.trace_id/dd.span_id；否则空
    ...fields,
  });
  process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (msg: string, fields?: LogFields): void => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields): void => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields): void => emit('error', msg, fields),
};

/** 单条请求访问日志的字段。 */
export interface RequestLogFields {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
}

/** 记录一条请求访问日志；5xx 标 error 级，其余 info 级。 */
export function logRequest(fields: RequestLogFields): void {
  // 输出 key 对齐 pgc 的 `request_id`（snake_case），让 Cloud Logging 按字段名跨服务检索。
  const { requestId, ...rest } = fields;
  emit(fields.status >= 500 ? 'error' : 'info', 'request', { ...rest, request_id: requestId });
}

// 入站 x-request-id 是客户端可控值，会原样落进前端/pgc 结构化日志；采纳前限定字符集与长度，
// 畸形值（超长、含控制字符/空白/分号等）一律弃用，改为生成新 UUID，防日志污染与跨请求投毒。
const MAX_REQUEST_ID_LEN = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** 入站 request id 是否为合法、可安全复用的值。 */
function isValidRequestId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_REQUEST_ID_LEN && REQUEST_ID_PATTERN.test(value);
}

/**
 * 解析或生成 request id：优先复用入站 `x-request-id`（须通过 charset+length 校验），
 * 否则生成 UUID，把同一请求的访问日志与上游错误日志串起来。
 */
export function resolveRequestId(headerValue: string | string[] | undefined): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof candidate === 'string' && isValidRequestId(candidate)) return candidate;
  return randomUUID();
}

/** 路径是否跳过访问日志（静态资源/构建产物等高频噪声，避免淹没业务请求）。 */
export function isLogSkippedPath(path: string): boolean {
  return path.startsWith('/_next/') || path === '/favicon.ico';
}
