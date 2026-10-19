import { KOUBOU_PREFIX, KOUBOU_WS_PROXY_PREFIX } from '@/lib/backend-routes';

// 把 HTTP(S) 基址转成 WS(S) 基址:Koubou 与 PGC 同址,WS 直接从 PGC 基址派生
export function toWsBase(httpBase: string): string {
  return httpBase.replace(/\/$/, '').replace(/^http/, 'ws');
}

// Koubou WS 基址解析,优先级从高到低:
// 1. 本地调试覆盖(NEXT_PUBLIC_KOUBOU_BASE_URL,如 http://127.0.0.1:8000)直连本地 Koubou——挂根路径,不拼网关前缀;
// 2. 本地开发(devProxyOrigin=window.location.origin)经本服务 WS 代理——同源 upgrade 自动携带
//    亲和 cookie,由代理转发上游打通 LB 会话亲和(直连跨站会丢 SameSite=Lax cookie);
// 3. 生产:PGC 基址派生 + /game/koubou(与 BFF 同站,直连即带 cookie)。
export function resolveKoubouWsBase(
  koubouOverride: string | undefined,
  pgcBase: string,
  devProxyOrigin?: string | null,
): string {
  if (koubouOverride) return toWsBase(koubouOverride);
  if (devProxyOrigin) return toWsBase(devProxyOrigin) + KOUBOU_WS_PROXY_PREFIX;
  return toWsBase(pgcBase) + KOUBOU_PREFIX;
}
