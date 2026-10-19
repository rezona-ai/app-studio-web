import type { DesktopBuildStatus } from './pgc/types';

// 桌面(Windows / Steam)导出纯逻辑(spec: docs/superpowers/specs/2026-08-26-export-steam-package.md)
// 与 apk-export.ts 平行而非复用:两条链路是不同端点族、不同下载机制、不同表单契约

// 契约建议 2–5s 轮一次,取中值
export const DESKTOP_POLL_INTERVAL_MS = 3500;

// name 上限 64(后端 DesktopBuildRequest.name maxLength)
export const DESKTOP_NAME_MAX = 64;

// Windows 文件名保留字符:后端 422 的判据之一(name 会进内容包目录名与 exe 名)
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*]/;
// 同一字符集的 global 版本,供预填清洗用(正则带 g 有 lastIndex 状态,不能与 test() 那份共用一个对象)
const ILLEGAL_NAME_CHARS_G = /[<>:"/\\|?*]/g;
// Windows 保留设备名:**加了扩展名依然保留**(CON.exe 一样打不开),而 name 正是要变成 <name>.exe 的,
// 故后端按第一段不分大小写地拒。⚠️ 契约文档 §1 没列这条,只有后端 app/schemas/desktop.py 有 ——
// 不进前端闸门就会撞 422 VALIDATION_ERROR(无专属映射→通用文案),而项目名恰好叫 CON 的用户
// 一个字都不改点导出就永远失败,且指不到是标题的问题
const RESERVED_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);
// 控制字符(C0 + DEL):后端一律剔除,剔后为空即 422
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// 已知错误码 → i18n key;未知回落通用文案
const ERROR_KEYS: Record<string, string> = {
  DESKTOP_EXPORT_DISABLED: 'preview.steam.err.disabled',
  DESKTOP_VERSION_NOT_BUILDABLE: 'preview.steam.err.notBuildable',
  DESKTOP_PACKAGE_TOO_LARGE: 'preview.steam.err.tooLarge',
  DESKTOP_BUILD_WORKER_UNAVAILABLE: 'preview.steam.err.workerUnavailable',
  DESKTOP_BUILD_NOT_READY: 'preview.steam.err.notReady',
  DESKTOP_BUILD_NOT_FOUND: 'preview.steam.err.notFound',
  DESKTOP_BUILD_QUOTA_EXCEEDED: 'preview.steam.err.quotaExceeded',
  IDEMPOTENCY_CONFLICT: 'preview.steam.err.idempotencyConflict',
  // 后端 name 校验(含契约未列的保留设备名那条)失败一律落这个通用码。前端闸门已尽量对齐,
  // 但契约口径可能再变 —— 落进 generic「导出失败」会让用户指不到是标题的问题,故给专属文案
  VALIDATION_ERROR: 'preview.steam.err.nameRejected',
};
export function mapDesktopError(code: string): string {
  return ERROR_KEYS[code] ?? 'preview.steam.err.generic';
}

export function isDesktopTerminal(status: DesktopBuildStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/**
 * 提交前清洗:剔控制字符 + trim,与后端「控制字符会被剔除」对齐。
 * **刻意不做 ASCII 提取** —— exe 名取 ASCII 部分那套派生规则(含空值回落 RezonaLabGame)只在后端,
 * 前端复刻一份就是两份平行的字符串规则,漂了不会报错,只会给用户一个自信但错的文件名,
 * 而那正是用户要手填进 Steamworks 启动项的值。包内 README 是单一真相源(spec 约束 3)
 */
export function sanitizeDesktopName(s: string): string {
  return s.replace(CONTROL_CHARS, '').trim();
}

/** 表单闸门:与后端 422 口径逐条对齐(清洗后非空、不含保留字符、不以点结尾、≤64) */
export function isValidDesktopName(s: string): boolean {
  const v = sanitizeDesktopName(s);
  if (v.length === 0 || v.length > DESKTOP_NAME_MAX) return false;
  if (ILLEGAL_NAME_CHARS.test(v)) return false;
  if (v.endsWith('.')) return false;
  if (RESERVED_DEVICE_NAMES.has(v.split('.')[0].trim().toLowerCase())) return false;
  return true;
}

/** 表单预填:项目名截 64;空白回落 'Game'(name 后端必填 1..64) */
export function defaultDesktopName(projectName: string | undefined): string {
  // 预填要**开箱即合法**:项目名叫 `Slime Clicker: Demo` / `Game v1.0.` / `CON` 时,若原样填进去,
  // 弹窗一开就是红框 + 灰 CTA —— 用户一个字都没输入却被判非法。故此处额外剔非法字符、削尾点、
  // 撞保留名就退回 'Game'。**只清洗预填,不放宽 isValidDesktopName** 的口径(那条与后端 422 逐条对齐)
  let n = sanitizeDesktopName(projectName ?? '').replace(ILLEGAL_NAME_CHARS_G, '');
  // 按**码位**截断:slice 走 UTF-16 码元,项目名含 emoji 且超长时会截出孤立代理项,
  // 后端拼幂等键时 encode 该串会抛 UnicodeEncodeError → 用户可控输入换来 500。
  // 先截再削尾点:截断本身可能截出一个新的尾点
  n = Array.from(n).slice(0, DESKTOP_NAME_MAX).join('').replace(/\.+$/, '').trim();
  if (!n || RESERVED_DEVICE_NAMES.has(n.split('.')[0].trim().toLowerCase())) return 'Game';
  return n;
}

/** 产物体积展示。恒用 MB 档:138MB 量级是 Electron 运行时地板价,换 GB 反而看不出量级 */
export function formatPackageSize(bytes: number | null | undefined): string | null {
  if (bytes == null) return null;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 下载路径(相对,basePath 由调用方经 apiPath() 补 —— 同 assetProxyUrl 范式)。
 * 恒经本服务 /api/pgc 代理:代理是流式的(直传 res.body 不缓冲)、cookie 同源自动带、
 * 本地开发靠代理层 DEV_COOKIE 同样跑通 —— 两环境同一条路,本地验到的就是生产行为(spec 约束 2)
 */
/**
 * 单个作业在**上游 pgc** 上的路径(相对 pgc client 的 PREFIX)。
 * `pgcApi.desktop.status` 与下载直链共用这一份 —— 两处各写一份就漂过一次:下载链漏了 `/api` 段,
 * 打到 /game/pgcserver/projects/... → 404,而 `<a download>` 会把 404 的 JSON 信封当文件存下来,
 * 没有 Toast、没有 console,用户只拿到一个打不开的文件(评审 C1)
 */
export function desktopBuildPath(publicId: string, buildId: number): string {
  return `/api/projects/${publicId}/desktop-builds/${buildId}`;
}

/**
 * 下载直链(相对,basePath 由调用方经 apiPath() 补 —— 同 assetProxyUrl 范式)。
 * 两段前缀都不能少:`/api/pgc` 是**本服务代理**的挂载点,`desktopBuildPath` 那段才是上游真实路径
 * (代理把其后的路径原样拼到 PGC_BASE_URL + /game/pgcserver)。范式同 client.ts 的 downloadVersion。
 * 恒经代理:代理流式直传 res.body、cookie 同源自动带、本地开发靠代理层 DEV_COOKIE 同样跑通 ——
 * 两环境同一条路,本地验到的就是生产行为(spec 约束 2)
 */
export function desktopDownloadPath(publicId: string, buildId: number): string {
  return `/api/pgc${desktopBuildPath(publicId, buildId)}/download`;
}
