import { PGC_PREFIX } from '@/lib/backend-routes';

// 解析 GLB 媒体代理目标:仅允许指向 PGC_BASE_URL 同源的地址,阻断 SSRF。
// 返回可安全 fetch 的绝对地址;非法或跨源一律返回 null(由调用方回 400)。
export function resolveAssetProxyTarget(raw: string, base: string): string | null {
  const trimmedBase = base.replace(/\/$/, '');
  if (!trimmedBase) return null;
  // 相对路径 → 拼到 base + PGC 前缀之下(始终落在 pgc host /game/pgcserver)
  if (!/^https?:\/\//i.test(raw)) {
    return `${trimmedBase}${PGC_PREFIX}/${raw.replace(/^\//, '')}`;
  }
  // 绝对地址 → 必须与 base 同源,否则拒绝
  try {
    if (new URL(raw).origin === new URL(trimmedBase).origin) return raw;
  } catch { /* 非法 URL */ }
  return null;
}
