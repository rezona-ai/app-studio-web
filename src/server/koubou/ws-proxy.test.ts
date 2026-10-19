// @vitest-environment node
// dev WS 代理:纯函数 + 真实 ws 服务端集成测(浏览器←代理←→上游三方,不 mock 传输层)
import { afterEach, describe, expect, test } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { createDevWsUpgradeHandler, sanitizeCloseCode, stripWsProxyPrefix } from './ws-proxy';

describe('stripWsProxyPrefix', () => {
  test('匹配前缀:剥掉后保留会话路径与 query', () => {
    expect(stripWsProxyPrefix('/dev-ws/koubou/projects/7/ws?ws_ticket=t')).toBe('/projects/7/ws?ws_ticket=t');
  });

  test('非代理路径(如 Next HMR)返回 null 交回 fallback', () => {
    expect(stripWsProxyPrefix('/_next/webpack-hmr')).toBeNull();
    expect(stripWsProxyPrefix(undefined)).toBeNull();
  });

  test('前缀是另一路径的前串时不误匹配', () => {
    expect(stripWsProxyPrefix('/dev-ws/kouboux/foo')).toBeNull();
  });
});

describe('sanitizeCloseCode', () => {
  test('1000 与 3000–4999(含 Koubou 4401/4000)透传', () => {
    expect(sanitizeCloseCode(1000)).toBe(1000);
    expect(sanitizeCloseCode(4401)).toBe(4401);
    expect(sanitizeCloseCode(4000)).toBe(4000);
  });

  test('不可主动发送的码(1005/1006/1001)降级为无码', () => {
    expect(sanitizeCloseCode(1006)).toBeUndefined();
    expect(sanitizeCloseCode(1005)).toBeUndefined();
    expect(sanitizeCloseCode(1001)).toBeUndefined();
  });
});

// —— 集成:起真实上游 WSS 与代理 HTTP 服务 ——
const servers: Server[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function listen(s: Server): Promise<number> {
  servers.push(s);
  return new Promise((r) => s.listen(0, () => r((s.address() as AddressInfo).port)));
}

// 上游:记录握手请求,echo 一切帧
async function startUpstream(onConn?: (ws: WebSocket, req: IncomingMessage) => void) {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  const seen: IncomingMessage[] = [];
  wss.on('connection', (ws, req) => {
    seen.push(req);
    ws.on('message', (d) => ws.send(d));
    onConn?.(ws, req);
  });
  const port = await listen(http);
  return { port, seen };
}

async function startProxy(upstreamPort: number, devCookie?: string) {
  const http = createServer();
  const handler = createDevWsUpgradeHandler({
    upstreamBase: `ws://127.0.0.1:${upstreamPort}`,
    devCookie,
    fallback: (_req, socket) => socket.destroy(),
  });
  http.on('upgrade', handler);
  return listen(http);
}

function connect(port: number, path: string, headers?: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(ws);
  return ws;
}

const once = <T>(ws: WebSocket, ev: string) => new Promise<T>((r) => ws.once(ev, (...a: unknown[]) => r(a as T)));

describe('createDevWsUpgradeHandler(集成)', () => {
  test('路径/query 透传上游,cookie 为 DEV_COOKIE 与浏览器 cookie 合并;帧双向 echo', async () => {
    const up = await startUpstream();
    const proxyPort = await startProxy(up.port, 'session=dev');
    const ws = connect(proxyPort, '/dev-ws/koubou/projects/7/ws?ws_ticket=t', { cookie: 'GCLB=pod-a' });
    await once(ws, 'open');
    expect(up.seen[0].url).toBe('/projects/7/ws?ws_ticket=t');
    expect(up.seen[0].headers.cookie).toBe('session=dev; GCLB=pod-a');
    ws.send('hello');
    const [echo] = await once<[Buffer]>(ws, 'message');
    expect(String(echo)).toBe('hello');
  });

  test('上游关闭码与 reason 透传浏览器侧(4401 驱动前端重签票)', async () => {
    const up = await startUpstream((serverWs) => serverWs.close(4401, 'ticket expired'));
    const proxyPort = await startProxy(up.port, 'session=dev');
    const ws = connect(proxyPort, '/dev-ws/koubou/projects/7/ws');
    const [code, reason] = await once<[number, Buffer]>(ws, 'close');
    expect(code).toBe(4401);
    expect(String(reason)).toBe('ticket expired');
  });

  test('浏览器侧关闭码透传上游', async () => {
    let upstreamClose: Promise<[number]> | null = null;
    const up = await startUpstream((serverWs) => { upstreamClose = once<[number]>(serverWs, 'close'); });
    const proxyPort = await startProxy(up.port, 'session=dev');
    const ws = connect(proxyPort, '/dev-ws/koubou/projects/7/ws');
    await once(ws, 'open');
    ws.close(4001, 'bye');
    const [code] = await upstreamClose!;
    expect(code).toBe(4001);
  });

  test('上游不可达:浏览器侧连接失败(前端走既有退避重连)', async () => {
    const proxyPort = await startProxy(1, 'session=dev'); // 端口 1 必然拒绝
    const ws = connect(proxyPort, '/dev-ws/koubou/projects/7/ws');
    await once(ws, 'error');
    expect(ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED).toBe(true);
  });
});
