// Rezona 发布流程的纯逻辑:幂等键、错误码→UX 文案映射。无副作用,易测。
// 契约:rezonalab-game-server docs/rezona-contract/frontend-integration.md(账号绑定由服务端在发布时自行完成,
// 前端不再有绑定态/扫码,故无轮询常量)。

// 发布表单输入上限(Bug 13353840):title ≤30、introduction ≤200
export const REZONA_TITLE_MAX = 30;
export const REZONA_SUMMARY_MAX = 200;

// 幂等键:每次发布意图生成一次,重试复用(契约 §7)
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface PublishToggles { public: boolean; sync_to_community: boolean }

export interface RezonaErrorUX {
  messageKey: string;         // i18n key
  resetIdempotency: boolean;  // 是否必须换新幂等键才能重试
  // 所选目标游戏已失效:清空目标并重拉列表,逼用户明确重选。不自动回选别的游戏或「创建」——
  // 用户原本明确选过,任何自动候选都可能被顺手再点一次就发错,两种误发都不可逆
  resetTarget?: true;
}

// 「不可用」家族:上游不可达 / 自动建号失败(REZONA_UNAVAILABLE),以及前端侧超时与断网。
// 契约 §6 说明 pgc 无法区分「抖动(重试会好)」与「建号失败(重试永远不会好)」,故前端按次数递增兜底。
const UNAVAILABLE_CODES = new Set(['REZONA_UNAVAILABLE', 'TIMEOUT', 'NETWORK']);
export function isUnavailable(code: string): boolean {
  return UNAVAILABLE_CODES.has(code);
}

// 连续不可用达到该次数后,改为展示带 request_id 的联系支持文案,不再劝用户继续点(契约 §6)
const UNAVAILABLE_SUPPORT_AFTER = 2;

// 发布目标:'new'=创建新游戏,number=给该已导入游戏(game_id)发新版本,null=尚未选择(目标失效后强制重选)
export type PublishTarget = number | 'new' | null;

// 默认目标:有已导入游戏就选最近发布的那个(后端已按 last_published_at 倒序,取第一项)——
// 同一项目反复发布最常见的意图是迭代同一个游戏;没有就创建
export function defaultTarget(games: readonly { game_id: number }[]): PublishTarget {
  return games[0]?.game_id ?? 'new';
}

// 目标 ↔ Select 的字符串值。null 不映射到任何选项值,Select 据此显示 placeholder
export function targetValue(target: PublishTarget): string | null {
  return target === null ? null : String(target);
}
export function targetFromValue(value: string): Exclude<PublishTarget, null> {
  return value === 'new' ? 'new' : Number(value);
}

// 发布错误码 → UX。unavailableFails 是本次失败**之前**已累计的不可用次数;未知码回落通用文案。
// hasRequestId:本地超时/断网(TIMEOUT/NETWORK)根本没有信封,拿不到追踪 ID,升级联系支持时须换用不带 ID 的文案。
export function mapRezonaError(code: string, unavailableFails = 0, hasRequestId = false): RezonaErrorUX {
  if (isUnavailable(code)) {
    const escalate = unavailableFails >= UNAVAILABLE_SUPPORT_AFTER;
    return {
      messageKey: escalate
        ? (hasRequestId ? 'preview.rezona.err.support' : 'preview.rezona.err.supportNoId')
        : 'preview.rezona.err.unavailable',
      resetIdempotency: false,
    };
  }
  switch (code) {
    case 'UNAUTHORIZED':
      // 登录态失效:文案提示重新登录,跳转由全局鉴权链路负责
      return { messageKey: 'preview.rezona.err.unauthorized', resetIdempotency: false };
    case 'PROJECT_NOT_FOUND':
      return { messageKey: 'preview.rezona.err.projectNotFound', resetIdempotency: false };
    case 'VERSION_NOT_FOUND':
      return { messageKey: 'preview.rezona.err.versionNotFound', resetIdempotency: false };
    case 'REZONA_VERSION_NOT_BUILT':
      return { messageKey: 'preview.rezona.err.notBuilt', resetIdempotency: false };
    case 'VALIDATION_ERROR':
      return { messageKey: 'preview.rezona.err.validation', resetIdempotency: false };
    case 'REZONA_COVER_INVALID':
      return { messageKey: 'preview.rezona.err.cover', resetIdempotency: false };
    case 'IDEMPOTENCY_CONFLICT':
      // 同 key 内容变了:必须换新 key 才可能成功
      return { messageKey: 'preview.rezona.err.idempotency', resetIdempotency: true };
    case 'REZONA_PUBLISH_IN_PROGRESS':
      return { messageKey: 'preview.rezona.err.inProgress', resetIdempotency: false };
    case 'REZONA_PUBLISH_FAILED':
      return { messageKey: 'preview.rezona.err.publishFailed', resetIdempotency: false };
    case 'REZONA_GAME_NOT_FOUND':
      return { messageKey: 'preview.rezona.err.gameNotFound', resetIdempotency: false, resetTarget: true };
    default:
      return { messageKey: 'preview.rezona.err.generic', resetIdempotency: false };
  }
}

// 封面上传(POST /projects/{id}/cover,PR #272)错误码 → i18n key。与发布错误(mapRezonaError)分开:
// 上传失败只弹 Toast,不影响发布本身。未知码回落通用封面上传失败文案。
export function mapCoverUploadError(code: string): string {
  switch (code) {
    case 'UNSUPPORTED_COVER_TYPE': return 'preview.rezona.err.coverType';
    case 'EMPTY_COVER_UPLOAD': return 'preview.rezona.err.coverEmpty';
    case 'CANVAS_UPLOAD_TOO_LARGE': return 'preview.rezona.err.coverTooLarge';
    default: return 'preview.rezona.err.coverUpload';
  }
}
