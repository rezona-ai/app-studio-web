// 后端共享网关（devlab.rezona.ai）路由前缀:同域名下按服务分流。
// PGC 全量(REST/preview/媒体字节/公开页 /pv)挂 /game/pgcserver;Koubou(REST + ws-ticket + WS)挂 /game/koubou。
// env 仍存裸域名(PGC_BASE_URL / NEXT_PUBLIC_PGC_BASE_URL 被两服务共用,装不下两个前缀),前缀在各接入点拼接,本文件为唯一契约源。
export const PGC_PREFIX = '/game/pgcserver';
export const KOUBOU_PREFIX = '/game/koubou';
// biz-api(主站业务后端:充值配置/建单等)同网关直挂 /tln/biz,无服务级前缀
export const BIZ_PREFIX = '/tln/biz';
// 仅本地开发:Koubou WS 经本服务(server.ts)代理的挂载前缀,前端拼 URL 与服务端 upgrade 分流共用。
// 不可挂 /api/* 等任何 Next 路由命中的路径:Next dev 收到首个请求后会自行往 http server 加挂
// upgrade 监听(setupWebSocketHandler),其 upgradeHandler 对命中路由的 upgrade 一律 socket.end()
// (如 /api/koubou/ws/* 命中 [...path] catch-all),只有不命中任何路由的路径才留给自定义 WS 服务。
export const KOUBOU_WS_PROXY_PREFIX = '/dev-ws/koubou';
