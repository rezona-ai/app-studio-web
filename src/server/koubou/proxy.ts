// Koubou HTTP 代理:与 PGC 同址(共用 PGC_BASE_URL 裸域名),但 devlab 网关下 Koubou 全量挂 /game/koubou 前缀。
// 鉴权走 cookie 制:headers 已含调用方透传的 Cookie(路由层从浏览器透传,本地开发回落 DEV_COOKIE),
// koubou 据此转发 pgc /api/auth/me 自省用户。不再有服务账号 token / 401 重登。
import { KOUBOU_PREFIX } from '@/lib/backend-routes';
import { logger } from '@/server/logging';

function base(): string {
  // 本地 Koubou 调试:KOUBOU_BASE_URL(如 http://127.0.0.1:8000)覆盖时直连——
  // 本地服务挂根路径,不拼网关前缀;空串视同未设
  const local = process.env.KOUBOU_BASE_URL;
  if (local) return local.replace(/\/$/, '');
  const b = process.env.PGC_BASE_URL;
  if (!b) throw new Error('PGC_BASE_URL 未配置');
  return b.replace(/\/$/, '') + KOUBOU_PREFIX;
}

export interface ProxyInit {
  body?: BodyInit | null;
  headers?: Record<string, string>;
  search?: string; // 含前导 ?
}

// base() 缺配置仍抛出(框架返回 500,代表我方配置错误);
// 运行期上游不可达统一收敛为 502 + JSON envelope,避免裸 500 掩盖真实原因。
export async function proxyFetch(method: string, path: string, init: ProxyInit = {}): Promise<Response> {
  const url = `${base()}${path}${init.search ?? ''}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { ...init.headers },
      body: init.body ?? undefined,
    });
    // 上游 5xx 结构化记一条 error，便于按 upstream=koubou 聚合排障。
    if (res.status >= 500) {
      logger.error('bff_upstream_5xx', {
        upstream: 'koubou',
        method,
        path,
        status: res.status,
        durationMs: Date.now() - start,
      });
    }
    return res;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // 上游不可达：结构化记 error（取代裸 console.error），再收敛为 502 + JSON envelope。
    logger.error('bff_upstream_error', {
      upstream: 'koubou',
      method,
      path,
      durationMs: Date.now() - start,
      error: detail,
    });
    return new Response(
      JSON.stringify({ success: false, code: 'UPSTREAM_UNAVAILABLE', message: `Koubou 服务不可用: ${detail}` }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}
