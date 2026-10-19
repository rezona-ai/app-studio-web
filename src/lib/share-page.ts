// 对外分享页(/share/{code}/v{n})的纯逻辑:参数校验 + 三条出站地址的构造。
// 与页面 / 取数分离,便于单测(见 share-page.test.ts)。设计稿 2026-09-01-share-page-topbar-design。

import { PGC_PREFIX } from './backend-routes';

// 先校验再拼接:挡住越界 / 畸形参数,拼出的 URL 因此不含需转义的字符。
// 两条正则从旧的 route.ts 直出实现原样搬来,口径不变(code=项目 public_id,仅字母数字;version=v{n})。
const CODE_RE = /^[A-Za-z0-9]{6,}$/;
const VERSION_RE = /^v\d+$/;

export const isShareCode = (s: string): boolean => CODE_RE.test(s);
export const isShareVersion = (s: string): boolean => VERSION_RE.test(s);

/** iframe 里那份游戏的地址:pgc 公开的 /pv 静态产物。生产与本应用同源,相对资源天然归位,
    故外壳页不再需要给 index.html 注入 <base>(旧直出实现的 injectBaseHref 随之退役)。
    未配置基址时产出的是相对路径,而本服务并不服务 /game/pgcserver/*(代理只挂在 /api/pgc/*),
    届时 iframe 必然 404 —— 这里不额外兜底:缺 env 就是配置缺失,伪装成能用只会把问题推到更远处
    (与 resolveAssetUrl「未配置就原样返回」同调)。 */
export function buildGamePvUrl(code: string, version: string): string {
  const base = (process.env.NEXT_PUBLIC_PGC_BASE_URL ?? '').replace(/\/$/, '');
  return `${base}${PGC_PREFIX}/pv/${code}/${version}/dist/index.html`;
}

/** 顶栏 Remix 的落点:本应用工作台的 fork 入口(studio-prelude 解析 ?remix=,actions 的
    applyStudioRemix 执行 fork;未登录由 useAuthGuard 跳 sign-in 后回跳)。
    自身绝对路径必经 basePath,否则部署在 /game/* 下会被 LB 路由到别的后端。
    这里直接读 env 而不用 basePath.ts 的模块级 BASE_PATH 常量:后者在测试里 stubEnv 改不动
    (与 lib/pgc/url.ts 的 buildSharePageUrl 同一写法与同一理由)。 */
export function buildRemixHref(code: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${basePath}/?remix=${code}`;
}

/** 顶栏 Create your game / logo 的落点:主站游戏落地页。主站与本应用同源但挂在 /studio 下,
    **刻意不经 basePath** —— 补了前缀会指到本应用自己不存在的 /game/studio/game(同 buildSignInUrl)。 */
export const STUDIO_GAME_HREF = '/studio/game';
