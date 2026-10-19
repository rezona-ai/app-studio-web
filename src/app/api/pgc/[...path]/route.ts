import type { NextRequest } from 'next/server';
import { proxyFetch } from '@/server/pgc/proxy';
import { pickProxyHeaders } from '@/server/proxy-response';
import { resolveForwardCookie } from '@/server/cookie';
import { appendDevSetCookies } from '@/server/dev-set-cookie';
import { logRequest, resolveRequestId } from '@/server/logging';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = '/' + path.join('/');
  const method = req.method;
  const hasBody = method === 'POST' || method === 'PATCH' || method === 'PUT';
  const start = Date.now();

  // 链路关联：复用入站 x-request-id（经 charset+length 校验）或生成，转发给 pgc 并记入本地访问日志，
  // 使前端 BFF 日志与 pgc 访问日志能用同一个 request_id 串成完整链路。
  const requestId = resolveRequestId(req.headers.get('x-request-id') ?? undefined);

  const headers: Record<string, string> = { 'x-request-id': requestId };
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  // cookie 制鉴权:透传浏览器 cookie 给 pgc(本地开发回落 DEV_COOKIE)
  const cookie = resolveForwardCookie(req.headers.get('cookie'), process.env.DEV_COOKIE);
  if (cookie) headers['cookie'] = cookie;

  // 带体请求流式透传(不整包缓冲):浏览器上传进度受「代理→PGC」背压牵引,近似真实端到端;
  // 代价是转发变 chunked(无 content-length),上游接受度已经真实链路验证(见 spec)
  const body = hasBody ? req.body : undefined;
  const res = await proxyFetch(method, target, { headers, body, search: req.nextUrl.search, requestId });

  logRequest({ method, path: target, status: res.status, durationMs: Date.now() - start, requestId });

  const outHeaders = pickProxyHeaders(res.headers);
  // 本地开发:回传重写后的上游 Set-Cookie(LB 亲和 cookie 落地浏览器,形成会话亲和闭环)
  appendDevSetCookies(outHeaders, res.headers, process.env.DEV_COOKIE);
  return new Response(res.body, { status: res.status, headers: outHeaders });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
