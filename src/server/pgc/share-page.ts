// 分享页外壳(/share/{code}/v{n})的服务端取数:版本是否存在、该游戏是否开放 Remix。
// 两条都只看状态码,不读正文 —— 外壳页需要的只是「能不能出页」「按钮能不能点」两个布尔量。
// 设计稿 2026-09-01-share-page-topbar-design。

import { proxyFetch } from '@/server/pgc/proxy';

// 只判状态码 ≠ 可以不管 body:undici 下未消费的响应体会把那条连接扣在 in-flight 直到 GC,
// 连接池不回收。这是全站扇出最高的公开路由,分享出去来一波流量就可能耗尽到 pgc 的连接
// (旧的直出实现 await res.text() 顺手消费了,是本轮改成「只看状态码」时引入的退化)。
// cancel() 失败不影响判定,吞掉即可。
function discard(res: Response): void {
  void res.body?.cancel().catch(() => {});
}

/** ok=该版本可播;notFound=未 build / 未知版本;upstream=pgc 5xx 或不可达 */
export type VersionStatus = 'ok' | 'notFound' | 'upstream';

/** 探该版本的 index.html 是否可取。
    用 GET 而非 HEAD:/pv 是 pgc 自定义的 preview 路由而非通用静态服务,不保证注册了 HEAD,
    405 会被误判成「版本不存在」—— 省这几 KB 不值得赌。正文丢弃不解析。
    状态映射沿用旧直出路由的口径:非 200 且非 5xx 一律当 404(未 build / 未知版本 / 越界)。 */
export async function fetchVersionStatus(code: string, version: string): Promise<VersionStatus> {
  let res: Response;
  try {
    res = await proxyFetch('GET', `/pv/${code}/${version}/dist/index.html`);
  } catch {
    return 'upstream'; // DNS / 连接 / 超时
  }
  discard(res);
  if (res.status >= 500) return 'upstream';
  return res.status === 200 ? 'ok' : 'notFound';
}

/** 查该游戏是否开放 Remix。走 pgc 的**公开无鉴权**端点 GET /remix/{code}
    (root_prefix 直挂,不在 /api 下);未开启 / 非法 code / 源项目软删统一 404 REMIX_NOT_AVAILABLE。
    任何异常一律降级成 false:顶栏按钮能不能点是次要的,为查它把游戏挡在门外才是事故。 */
export async function fetchRemixAvailable(code: string): Promise<boolean> {
  try {
    const res = await proxyFetch('GET', `/remix/${code}`);
    discard(res);
    return res.status === 200;
  } catch {
    return false;
  }
}
