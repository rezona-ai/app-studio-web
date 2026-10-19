import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SharePage from '@/components/share/SharePage';
import { isShareCode, isShareVersion, buildGamePvUrl, buildRemixHref } from '@/lib/share-page';
import { fetchVersionStatus, fetchRemixAvailable } from '@/server/pgc/share-page';

export const dynamic = 'force-dynamic';

// 页签标题由本页决定(旧的直出实现用的是游戏自己的 <title>)。分享页是对外拉新入口,
// 页签上印品牌比印游戏内部标题更有用 —— 且游戏标题本就不进这条链路(URL 只有 code/version)。
export const metadata: Metadata = { title: 'Rezona Lab · Play' };

// 对外「分享页」:GET /game/share/{code}/v{n}(basePath=/game 由 Next 前置)。
//
// 外壳页 + iframe:顶栏(品牌 + Remix / Create your game)在顶层文档,游戏在 iframe 里跑 pgc 的
// /pv 静态产物。地址栏仍是这条干净短链 —— 旧直出实现收敛掉的是「落地页 + 脏地址栏」,那份收益不变。
// 不往游戏文档里注入顶栏:游戏普遍用 100vh / fixed canvas 铺满,注入的 header 会被盖住或挤错位,
// 且两边 CSS 同作用域各游戏表现不可控。详见设计稿 2026-09-01-share-page-topbar-design.md。
//
// code=项目 public_id(仅字母数字);version=v{n}。非法参数 / 未 build / 未知版本 → 404(本段的
// not-found.tsx,带顶栏);上游 5xx 或不可达 → 带顶栏的错误页。
// ⚠️ 后者**刻意返 HTTP 200**:页面路由要返 5xx 得绕 error.tsx 或多一层路由,不值得为此拆散外壳。
// 代价是 uptime 探测 / LB 5xx 率看不见这类故障 —— 可观测性由 proxyFetch 已有的结构化日志
// (bff_upstream_5xx / bff_upstream_error,带 upstream=pgc 与 request_id)承担,要告警从日志指标取。
export default async function SharePageRoute({
  params,
}: {
  params: Promise<{ code: string; version: string }>;
}) {
  const { code, version } = await params;
  // 先校验再拼接:挡住越界 / 畸形参数,且一次上游都不打
  if (!isShareCode(code) || !isShareVersion(version)) notFound();

  // 两条互不依赖,并发取:Remix 可用性不该让游戏多等一个 RTT
  const [status, canRemix] = await Promise.all([
    fetchVersionStatus(code, version),
    fetchRemixAvailable(code),
  ]);
  if (status === 'notFound') notFound();

  return (
    <SharePage
      gameUrl={buildGamePvUrl(code, version)}
      remixHref={canRemix ? buildRemixHref(code) : null}
      unavailable={status === 'upstream'}
    />
  );
}
