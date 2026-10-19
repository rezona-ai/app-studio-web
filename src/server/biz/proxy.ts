// biz-api 代理:与 PGC/Koubou 同址(共用 PGC_BASE_URL 裸域名),devlab 网关下 biz-api 挂 /tln/biz 前缀。
// 鉴权走 cookie 制:headers 已含调用方透传的 Cookie(路由层从浏览器透传,本地开发回落 DEV_COOKIE)。
// 注意:biz-api 响应为裸 JSON(无 PGC 的 {success,data} / Koubou 的 {code,data} 信封),
// 错误语义由浏览器侧 src/lib/biz/client.ts 按 HTTP 状态码判定。
import { BIZ_PREFIX } from '@/lib/backend-routes';
import { logger } from '@/server/logging';

function base(): string {
  const b = process.env.PGC_BASE_URL;
  if (!b) throw new Error('PGC_BASE_URL 未配置');
  return b.replace(/\/$/, '') + BIZ_PREFIX;
}

export interface ProxyInit {
  body?: BodyInit | null;
  headers?: Record<string, string>;
  search?: string; // 含前导 ?
}

// base() 缺配置仍抛出(框架返回 500,代表我方配置错误);
// 运行期上游不可达统一收敛为 502 + JSON,避免裸 500 掩盖真实原因。
export async function proxyFetch(method: string, path: string, init: ProxyInit = {}): Promise<Response> {
  const url = `${base()}${path}${init.search ?? ''}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { ...init.headers },
      body: init.body ?? undefined,
    });
    // 上游 5xx 结构化记一条 error,便于按 upstream=biz 聚合排障。
    if (res.status >= 500) {
      logger.error('bff_upstream_5xx', {
        upstream: 'biz',
        method,
        path,
        status: res.status,
        durationMs: Date.now() - start,
      });
    }
    return res;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('bff_upstream_error', {
      upstream: 'biz',
      method,
      path,
      durationMs: Date.now() - start,
      error: detail,
    });
    return new Response(
      JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: `biz-api 服务不可用: ${detail}` }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}
