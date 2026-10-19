import { PGC_PREFIX } from '@/lib/backend-routes';
import { apiPath } from '@/lib/basePath';

// 媒体直连:相对 /preview/... 补「pgc 域名 + /game/pgcserver 前缀」(在函数内读 env,便于测试 stub)。
// 后端返回的相对路径不含前缀(沿用 /preview/...),由前端在此拼齐 devlab 网关前缀。
export function resolveAssetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_PGC_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) return url;
  return `${base}${PGC_PREFIX}/${url.replace(/^\//, '')}`;
}

// GLB 等需 fetch 的媒体(model-viewer 内部走 fetch + three.js GLTFLoader)必须经**同源**代理:
// 本地开发时 app(localhost)与 PGC 域(NEXT_PUBLIC_PGC_BASE_URL)跨源,model-viewer 的 fetch 会被 CORS 拦,
// 并在 IntersectionObserver 回调里抛未捕获 TypeError → dev 下触发 Next 错误遮罩盖住整块画布。
// 包成 /api/pgc/asset?url=<原地址>(服务端 resolveAssetProxyTarget 限定 PGC 同源转发,防 SSRF),
// 浏览器即同源取字节、无跨域。data: URL 为内联字节,无需代理。
// 注:<img>/<video>/<audio> 跨域直显不受 CORS 影响,不必经此;仅 fetch 类媒体(GLB)需要。
export function assetProxyUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  return `${apiPath('/api/pgc/asset')}?url=${encodeURIComponent(url)}`;
}

// 构造对外「分享页」链接:{本站 origin}{basePath}/share/{code}/v{seq}。
// 分享页由本前端服务(与编辑器同源),故用本站 origin + basePath(/game),不指向 pgc 裸域名;
// 打开后 /share 路由注入 <base> 直出该版本游戏,地址栏保持这条干净链接
// (见 docs/plans/2026-07-20-001-feat-clean-share-url-plan.md)。
// code=项目 public_id;versionSeq=v{seq}(某个已 build 的稳定版本,即 project_version)。
// 缺 publicId/seq 或非浏览器环境时返回 null(调用方据此禁用分享按钮)。
export function buildSharePageUrl(
  publicId: string | null | undefined,
  versionSeq: number | null | undefined,
): string | null {
  if (!publicId || versionSeq == null || !Number.isFinite(versionSeq)) return null;
  if (typeof window === 'undefined') return null;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${window.location.origin}${basePath}/share/${publicId}/v${versionSeq}`;
}
