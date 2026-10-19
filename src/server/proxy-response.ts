// 代理回传响应头的挑选规则,koubou / pgc 两个代理路由共用。
//
// 关键:fetch(undici)接收上游 gzip 响应时会自动解压,res.body 是解压后的流,
// 但 res.headers 仍保留上游的 content-encoding: gzip 与「压缩后」的 content-length。
// 若把 content-length 原样透传,浏览器会按压缩长度(远小于解压 body)截断响应体,
// 导致大 JSON 被截断、JSON.parse 失败(典型表现:listSessions 拿不到会话)。
// 故只透传与「编码 / 长度」无关的头,content-length 交由平台按真实 body 重新计算(或分块传输)。
const PASS_THROUGH = ['content-type', 'content-disposition'];

export function pickProxyHeaders(upstream: Headers): Headers {
  const out = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.get(h);
    if (v) out.set(h, v);
  }
  return out;
}
