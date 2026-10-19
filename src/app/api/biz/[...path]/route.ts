import type { NextRequest } from 'next/server';
import { proxyFetch } from '@/server/biz/proxy';
import { pickProxyHeaders } from '@/server/proxy-response';
import { resolveForwardCookie } from '@/server/cookie';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = '/' + path.join('/');
  const method = req.method;
  const hasBody = method === 'POST' || method === 'PATCH' || method === 'PUT';

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  // cookie 制鉴权:透传浏览器 cookie 给 biz-api(本地开发回落 DEV_COOKIE)
  const cookie = resolveForwardCookie(req.headers.get('cookie'), process.env.DEV_COOKIE);
  if (cookie) headers['cookie'] = cookie;

  const body = hasBody ? Buffer.from(await req.arrayBuffer()) : undefined;
  const res = await proxyFetch(method, target, { headers, body, search: req.nextUrl.search });

  return new Response(res.body, { status: res.status, headers: pickProxyHeaders(res.headers) });
}

export { handle as GET, handle as POST };
