import type { TFunction } from 'i18next';

// 后端 error code → i18n key。收录 PGC 已知 code + Koubou WS 本地维护 code。
export const ERROR_KEYS: Record<string, string> = {
  // 不归因的兜底提示:给「这里区分不出错误来源」的路径用(如分享编排的未知错误照抛)。
  // 刻意不声称任何业务原因 —— 声称了就是把程序 bug 伪装成业务失败;只告诉用户可以重试。
  UNKNOWN: 'errors.unknown',
  GEN_FAILED: 'errors.GEN_FAILED',
  CLIPBOARD: 'errors.CLIPBOARD',
  AUTH: 'errors.AUTH',
  UPSTREAM_UNAVAILABLE: 'errors.UPSTREAM_UNAVAILABLE',
  // seed 系模型受后端 feature flag 门控,关闭时 503;flag 状态无接口可查,只能事后兜底
  SEEDREAM_IMAGE_DISABLED: 'errors.SEEDREAM_IMAGE_DISABLED',
  SEEDAUDIO_SPEECH_DISABLED: 'errors.SEEDAUDIO_SPEECH_DISABLED',
  // 音乐模型同理。Suno 走异步任务端点,这个 code 有**两条**露出路径:受理期 flag 关着 →
  // 同步 503 当场拒(不产生可轮询任务);任务在飞时 flag 被关(灰度期止血)→ runner 复检抛出,
  // 经轮询以 failed + failure.code 回来。后者在服务端被登记进 _PROVIDER_NOT_CONFIGURED_CODES,
  // 故带 retryable=false 而不是掉进 503 兜底的「请稍后重试」。两条都落到本词条
  SUNO_MUSIC_DISABLED: 'errors.SUNO_MUSIC_DISABLED',
  // 会话落库的对话模型已从后端 allowed_models 摘掉,已自动切到列表首项(带 from/to 两个展示名插值)。
  // 后端不拦这种会话(koubou _ensure_client 不校验 is_model_allowed,照样把下架模型打给上游),
  // 故这条提示伴随的是一次真实的补救动作,不是单纯告知
  MODEL_RETIRED: 'errors.modelRetired',
  PROJECT_IMPORTED: 'errors.projectImported',
  REPLAY_LOAD_FAILED: 'chat.replay.error',   // 播放期拉取失败(useReplayPlayer 的 failReplay);复用回放已有的六语文案
  // Koubou WS 错误(本地维护;后端应用层错误无机器码,故前端落地 code 枚举)
  INVALID_USER_MESSAGE: 'errors.koubou.invalidUserMessage',
  RUN_ALREADY_ACTIVE: 'errors.koubou.runAlreadyActive',
  INVALID_PERMISSION_MODE: 'errors.koubou.invalidPermissionMode',
  INVALID_MODEL: 'errors.koubou.invalidModel',
  STALE_TOOL_APPROVAL: 'errors.koubou.staleToolApproval',
  STALE_QUESTION_ANSWER: 'errors.koubou.staleQuestionAnswer',
  AGENT_RUN_ERROR: 'errors.koubou.runError',
  // 后端上游/模型侧失败的机器码,**原样**下发(snake_case,不做大小写归一 —— 归一就是臆造)。
  // 后端 message 是脱敏英文句,这里配译文让主行说人话;原文与 HTTP 状态码走 detail。
  upstream_unavailable: 'errors.koubou.upstreamUnavailable',
  upstream_auth_failed: 'errors.koubou.upstreamAuthFailed',
  upstream_error: 'errors.koubou.upstreamError',
  output_limit: 'errors.koubou.outputLimit',
  budget_exceeded: 'errors.koubou.budgetExceeded',
  execution_error: 'errors.koubou.executionError',
  run_error: 'errors.koubou.runFailed',
  BUILD_FAILED: 'errors.koubou.buildFailed',
  RUN_ABANDONED: 'errors.koubou.runAbandoned',
  CONNECTION: 'errors.koubou.connection',
  SESSION_SUPERSEDED: 'errors.koubou.superseded',
  CONN_NOT_READY: 'errors.koubou.connNotReady',   // 发送门控:连接未就绪阻发提示
  SEND_TIMEOUT: 'errors.koubou.sendTimeout',      // 乐观发送计时超时兜底
  COPIED: 'canvas.inspector.copied',   // 复制成功反馈(success 类 code,同 PROJECT_IMPORTED 先例)
};

// 应用层 error 事件无机器码,只能按已知 message 文案归一到本地 code(纯函数,不触 i18n)
const KOUBOU_MESSAGE_CODES: Record<string, string> = {
  'invalid user message': 'INVALID_USER_MESSAGE',
  'run already active': 'RUN_ALREADY_ACTIVE',
  'invalid permission mode': 'INVALID_PERMISSION_MODE',
  'invalid model': 'INVALID_MODEL',
  'stale tool approval': 'STALE_TOOL_APPROVAL',
  'stale question answer': 'STALE_QUESTION_ANSWER',
};

// 把 error 事件 payload 归一成 {code, fallback}。优先级:
// ① 后端机器码 code(上游/模型侧失败带,见 KoubouErrorPayload 注释)——它是权威分类,不必猜;
// ② 固定 message 命中 → 对应本地 code(协议/操作类错误,后端确实无机器码);
// ③ 有 type(Claude run 执行异常 / 孤儿 run) → 通用 run 错误码;
// ④ 再否则不臆造 → 无 code,回退后端原文。
export function classifyKoubouError(p: KoubouErrorPayload): { code?: string; fallback: string } {
  const msg = (typeof p.message === 'string' ? p.message : '').trim();
  const backendCode = typeof p.code === 'string' && p.code ? p.code : undefined;
  const code = backendCode ?? KOUBOU_MESSAGE_CODES[msg] ?? (p.type ? 'AGENT_RUN_ERROR' : undefined);
  return { code, fallback: msg || 'agent error' };
}

// koubou error 事件 payload 的四种形状(契约见 koubou docs/websocket-events.md §error):
//   { message }                                   协议/操作类(run already active…)
//   { message, interaction_id }                   stale 交互(只清弹窗,不进本路径)
//   { type: 'ExceptionName' | 'OrphanedRun', message }   run 执行异常 / 孤儿 run
//   { code, message, api_error_status, retryable } 上游/模型侧失败 ← 过载 / 限流 / 5xx 走这支
// **原始上游文本绝不下发**(后端 MessageError.raw 只进服务端 trace),故 code 与
// api_error_status 就是排障能拿到的全部信息。
export interface KoubouErrorPayload {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  api_error_status?: unknown;
  retryable?: unknown;
}

// detail 随 error part 落进持久化的 messages,故截断 —— 上游文案 + 异常信息可能很长,
// 不截会把 localStorage 会话快照撑爆
const DETAIL_MAX = 2000;

// 上游原文详情:有异常类名时拼成 `Type: message`,否则原样 message。
// 与 classifyKoubouError 分工:那个出「稳定 code + 主行 fallback」(命中 code 时主行会被译文
// 覆盖),这个出「给人看的完整原文」—— 否则上游动态异常全落一条通用 AGENT_RUN_ERROR,
// 界面只剩一句「agent 运行出错」,真正的 Overloaded / 5xx / 超时文案被丢掉。
export function koubouErrorDetail(p: KoubouErrorPayload): string | undefined {
  const msg = (typeof p.message === 'string' ? p.message : '').trim();
  const type = (typeof p.type === 'string' ? p.type : '').trim();
  const code = (typeof p.code === 'string' ? p.code : '').trim();
  // api_error_status 是上游 HTTP 状态码(429 / 529 / 401…),排障的关键一环
  const status = typeof p.api_error_status === 'number' ? p.api_error_status : undefined;
  // 异常类名比机器码更具体,优先;上游族没有 type,用 code(+ 状态码)当前缀
  const head = type || (code && status ? `${code} (HTTP ${status})` : code);
  const full = head && msg ? `${head}: ${msg}` : head || msg;
  if (!full) return undefined;
  return full.length > DETAIL_MAX ? `${full.slice(0, DETAIL_MAX)}…` : full;
}

// 传输层终态 → 通用提示(纯函数)。superseded 为多标签顶替,归入柔和 warning 类。
// fatal 与其余非终态(connecting/open/closed/error/stalled)返回 null:fatal 由 ReconnectBanner 内联条接管(持久提示+手动重连),不再叠加一次性 toast(避免与内联条双重通知)。
export function connErrorToast(status: string): { code: string; message: string; kind: 'error' | 'warning' } | null {
  if (status === 'superseded') return { code: 'SESSION_SUPERSEDED', message: '', kind: 'warning' };
  return null;
}

// 命中映射且词条存在 → 译文;否则回退后端原 message(尊重契约不臆造)。
// params:带数量的文案(如「N 张卡的位置未能保存」)靠它插值。没有它时,store 只能提前把
// 已翻译文案拼好塞进 toast.message(UPLOAD 那条的历史包袱),等于把本地化泄漏进状态层
export function resolveErrorMessage(
  code: string,
  fallbackMessage: string,
  t: TFunction,
  params?: Record<string, unknown>,
): string {
  const key = ERROR_KEYS[code];
  if (key && t(key) !== key) return t(key, params ?? {});
  return fallbackMessage;
}
