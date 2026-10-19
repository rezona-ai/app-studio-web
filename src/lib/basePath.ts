// 浏览器端绝对路径不会被 Next basePath 自动加前缀（仅 <Link>/next/image/router 会）。
// 凡是 fetch / WebSocket / <img src> 指向「本服务自己的 /api/...」绝对路径，都要经此补前缀，
// 否则部署在 LB /game/* 下时会命中 /api/* 规则被路由到 new-api。
// 构建期注入 NEXT_PUBLIC_BASE_PATH=/game；本地不设 → 空，仍跑根路径。
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** 给本服务的绝对 API 路径补 basePath，如 apiPath('/api/pgc') → '/game/api/pgc'。 */
export const apiPath = (p: string): string => `${BASE_PATH}${p}`;

/** 给 public/ 下的静态资源绝对路径补 basePath（<img src>/iframe/url() 等不会被自动加前缀）。 */
export const assetPath = (p: string): string => `${BASE_PATH}${p}`;
