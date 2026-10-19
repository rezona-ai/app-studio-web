import { PGC_PREFIX } from '@/lib/backend-routes';
import { logger } from '@/server/logging';

// devlab 共享网关:PGC 全量挂 /game/pgcserver 前缀下。env 仅存裸域名,前缀在此拼接。
function base(): string {
  const b = process.env.PGC_BASE_URL;
  if (!b) throw new Error('PGC_BASE_URL 未配置');
  return b.replace(/\/$/, '') + PGC_PREFIX;
}

export interface ProxyInit {
  body?: BodyInit | ReadableStream<Uint8Array> | null;
  headers?: Record<string, string>;
  search?: string; // 含前导 ?
  requestId?: string; // 链路关联 id，仅用于本层错误日志（x-request-id 已在 headers 里随 fetch 转发）
}

// 转发到 pgc。鉴权走 cookie 制:headers 已含调用方透传的 Cookie(由路由层从浏览器透传,
// 本地开发回落 DEV_COOKIE),pgc 据此转发 biz-api 自省当前用户。不再有服务账号 token / 401 重登。
export async function proxyFetch(method: string, path: string, init: ProxyInit = {}): Promise<Response> {
  const url = `${base()}${path}${init.search ?? ''}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { ...init.headers },
      body: init.body ?? undefined,
      // undici 约束:流式 request body 必须显式声明半双工,否则直接抛错
      ...(init.body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
    } as RequestInit);
    // 上游 5xx 结构化记一条 error，便于在 Cloud Logging 按 upstream=pgc / request_id 聚合排障。
    if (res.status >= 500) {
      logger.error('bff_upstream_5xx', {
        upstream: 'pgc',
        method,
        path,
        status: res.status,
        durationMs: Date.now() - start,
        request_id: init.requestId,
      });
    }
    return res;
  } catch (err) {
    // 上游不可达（DNS/连接/超时）：记 error 后原样抛出。
    // ⚠️ 注意实际对外行为是 **500**，不是 502——route.ts 的 handle() 没有 try/catch，
    // 异常由 Next 兜底。koubou 侧才在 proxy 内收敛成 502 + UPSTREAM_UNAVAILABLE 信封
    // （见 src/server/koubou/proxy.ts:45-58）。两侧口径不一致是已知差异，排障以实际状态码为准。
    logger.error('bff_upstream_error', {
      upstream: 'pgc',
      method,
      path,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      request_id: init.requestId,
    });
    throw err;
  }
}
