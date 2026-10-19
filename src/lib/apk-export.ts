import type { ApkBuildRequest, ApkBuildStatus, ApkOutputFormat } from './pgc/types';

// APK 导出纯逻辑(spec: docs/superpowers/specs/2026-07-20-export-apk-menu.md)

// 契约建议 3–5s 轮询(构建走独立服务,冷启动 3–5 分钟属正常)
export const APK_POLL_INTERVAL_MS = 3500;

// 应用名上限 64(后端 ApkBuildRequest.name maxLength)
export const APK_NAME_MAX = 64;

// aab 专属约束(契约 docs/api/apk.md §1):versionName 1..50,versionCode 1..2.1e9(Play 硬上限)
export const AAB_VERSION_NAME_MAX = 50;
// applicationId 长度上限:Play 侧 255,契约未写,取 Play 的口径兜底(超长本来会落进无专属映射的 422)
export const PACKAGE_NAME_MAX = 255;
export const VERSION_CODE_MAX = 2_100_000_000;
// 侧载无所谓,自传 Play 应给语义版本 —— 故 aab 表单预填 1.0.0 / 1
export const DEFAULT_VERSION_NAME = '1.0.0';
export const DEFAULT_VERSION_CODE = 1;

// 已知错误码 → i18n key;未知回落通用文案
const ERROR_KEYS: Record<string, string> = {
  APK_EXPORT_DISABLED: 'preview.apk.err.disabled',
  APK_VERSION_NOT_BUILDABLE: 'preview.apk.err.notBuildable',
  APK_PACKAGE_TOO_LARGE: 'preview.apk.err.tooLarge',
  APK_BUILD_WORKER_UNAVAILABLE: 'preview.apk.err.workerUnavailable',
  APK_BUILD_NOT_READY: 'preview.apk.err.notReady',
  APK_OUTPUT_FORMAT_UNAVAILABLE: 'preview.apk.err.formatUnavailable',
};
export function mapApkError(code: string): string {
  return ERROR_KEYS[code] ?? 'preview.apk.err.generic';
}

export function isApkTerminal(status: ApkBuildStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

// 表单预填:项目名截 64;空白回落 'Game'(name 后端必填 1..64)
export function defaultApkName(projectName: string | undefined): string {
  const n = (projectName ?? '').trim();
  return (n || 'Game').slice(0, APK_NAME_MAX);
}

// 构建耗时展示 m:ss(完成卡 Build time 行;API 不回耗时,客户端从发起时刻计量)
export function formatBuildDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- aab 表单校验(与后端 422 口径对齐,不合法就不发请求)----

// applicationId:小写点分段 ≥2 段,**每段**都须字母开头(Android 标识符规则,不止首段),
// 段内允许小写字母/数字/下划线。放宽到只管首段会让 com.2048game 这类前端放行、后端 422,
// 而 VALIDATION_ERROR 无专属映射,用户只看到通用失败文案,指不到是包名的问题
const PACKAGE_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export function isValidPackageName(s: string): boolean {
  const v = s.trim();
  return v.length <= PACKAGE_NAME_MAX && PACKAGE_NAME_RE.test(v);
}

export function isValidVersionName(s: string): boolean {
  const v = s.trim();
  return v.length >= 1 && v.length <= AAB_VERSION_NAME_MAX;
}

export function isValidVersionCode(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= VERSION_CODE_MAX;
}

// 按格式装配请求体。**apk 分支一律不带 output_format / package_name / version_name / version_code**:
// 这四项参与后端幂等身份,凭空加键会让既有作业幂等不命中 → 重复构建重复计费。
// aab 分支三者必填(缺任一 422),由调用方先过上面三个校验
export function buildApkRequest(input: {
  versionId: string;
  name: string;
  format: ApkOutputFormat;
  iconItemId?: string | null;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
}): ApkBuildRequest {
  const name = input.name.trim().slice(0, APK_NAME_MAX) || defaultApkName(undefined);
  const body: ApkBuildRequest = { version_id: input.versionId, name };
  if (input.iconItemId) body.icon_item_id = input.iconItemId;
  if (input.format === 'aab') {
    body.output_format = 'aab';
    body.package_name = (input.packageName ?? '').trim();
    body.version_name = (input.versionName ?? '').trim();
    body.version_code = input.versionCode;
  }
  return body;
}
