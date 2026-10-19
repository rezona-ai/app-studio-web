import type { NextRequest } from 'next/server';
import { resolveAssetProxyTarget } from '@/server/pgc/asset-target';

export const dynamic = 'force-dynamic';

// 透传给浏览器的媒体响应头:
// - content-length 是关键 —— 缺它时 <audio>/<video> 视流为未知长度(duration=Infinity),
//   原生控件一直显示 0:00 / 0:00,直到整段下完才得出总时长(表现为播放几秒后才跳出时长)。
// - range 相关头让原生控件可 seek。
// 仅当上游未做内容编码(content-encoding)时才透传 content-length:fetch(undici)会自动解压
// gzip,此时上游 content-length 是压缩后长度,原样透传会按压缩长度截断 body(见 proxy-response.ts)。
// 媒体多为已压缩字节、不会再 gzip,故常态可安全透传。
const ALWAYS = ['content-type', 'content-disposition', 'accept-ranges', 'content-range', 'cache-control', 'etag', 'last-modified'];

// 仅供 fetch 类媒体(如 GLB)规避跨域;preview 字节无需鉴权。
// 目标地址强制限定 PGC_BASE_URL 同源,防止被当作 SSRF 跳板。
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return new Response('missing url', { status: 400 });
  const target = resolveAssetProxyTarget(raw, process.env.PGC_BASE_URL ?? '');
  if (!target) return new Response('invalid url', { status: 400 });

  // 透传浏览器的 Range:支持时上游回 206 + content-range,原生控件即可 seek
  const range = req.headers.get('range');
  const res = await fetch(target, range ? { headers: { range } } : undefined);

  const out = new Headers();
  for (const h of ALWAYS) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  // 未经 content-encoding 解压时,content-length 与真实 body 一致,可透传供浏览器判长度/算时长
  if (!res.headers.get('content-encoding')) {
    const len = res.headers.get('content-length');
    if (len) out.set('content-length', len);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
