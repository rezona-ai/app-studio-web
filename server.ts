import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { logRequest, resolveRequestId, isLogSkippedPath } from '@/server/logging';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT) || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();
const upgrade = app.getUpgradeHandler();

const server = createServer((req, res) => {
  // 访问日志：透传/生成 request id，请求收尾时记一条 JSON 日志（5xx 标 error）。
  // 跳过 /_next 等高频静态资源，避免淹没业务请求。
  const start = Date.now();
  const requestId = resolveRequestId(req.headers['x-request-id']);
  res.setHeader('x-request-id', requestId);
  const path = (req.url ?? '/').split('?')[0];
  if (!isLogSkippedPath(path)) {
    res.on('finish', () => {
      logRequest({
        method: req.method ?? 'GET',
        path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        requestId,
      });
    });
  }
  handle(req, res, parse(req.url!, true));
});
// 生产:对话直连 Koubou WS(同站,cookie 直达),本地不托管 agent WS,upgrade 全量交 Next(HMR)。
// 本地开发:/dev-ws/koubou/* 走 dev WS 代理打通 LB 会话亲和(浏览器直连跨站丢 SameSite cookie,
// 见 docs/superpowers/specs/2026-07-24-dev-ws-proxy-affinity.md),其余仍交 Next。
if (dev) {
  const { createDevWsUpgradeHandler, resolveWsUpstreamBase } = await import('@/server/koubou/ws-proxy');
  const upstreamBase = resolveWsUpstreamBase({
    KOUBOU_BASE_URL: process.env.KOUBOU_BASE_URL,
    PGC_BASE_URL: process.env.PGC_BASE_URL,
  });
  if (upstreamBase) {
    server.on('upgrade', createDevWsUpgradeHandler({
      upstreamBase,
      devCookie: process.env.DEV_COOKIE,
      fallback: (req, socket, head) => upgrade(req, socket, head),
    }));
  } else {
    console.warn('[ws-proxy] PGC_BASE_URL 未配置,dev WS 代理未挂载');
    server.on('upgrade', (req, socket, head) => upgrade(req, socket, head));
  }
} else {
  server.on('upgrade', (req, socket, head) => upgrade(req, socket, head));
}

// Node 18+ 默认 requestTimeout=300s:大压缩包慢速上传(如 /game/api/pgc/api/projects/import)
// 超 5 分钟整条请求被 Node 掐断回 408。对齐链路上限(GCLB backend timeout 3600s)。
// headersTimeout 保持默认 60s,慢速头攻击防线不变;这里只放宽请求体的传输时长。
server.requestTimeout = 3_600_000;
server.listen(port, () => console.log(`> Ready on http://localhost:${port}`));
