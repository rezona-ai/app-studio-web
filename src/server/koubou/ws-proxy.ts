// 仅本地开发:Koubou WS 经本服务代理,打通 LB 会话亲和。
//
// 为什么需要:本地浏览器直连 wss://devlab... 是跨站请求,LB 亲和 cookie(SameSite=Lax)不随
// 跨站 WS 握手发送 → 每次建连随机落 pod,命令落非属主 pod。改走同源代理后,浏览器 upgrade
// 请求自动携带 localhost 亲和 cookie(由 REST 代理回传落地,见 dev-set-cookie.ts),
// 本模块以服务端身份转发给上游——服务端请求不受 SameSite 约束,亲和链路打通。
//
// 生产不挂载(server.ts 仅 dev 分流),生产 WS 与 BFF 同站直连,无此问题。
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { KOUBOU_PREFIX, KOUBOU_WS_PROXY_PREFIX } from '@/lib/backend-routes';
import { toWsBase } from '@/koubou/wsBase';
import { resolveForwardCookie } from '@/server/cookie';
import { rewriteSetCookieForDev } from '@/server/dev-set-cookie';

// 剥代理前缀,余下为上游会话路径(/projects/{id}/ws?...);非代理路径返回 null 交回 fallback(Next HMR)
export function stripWsProxyPrefix(url: string | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith(KOUBOU_WS_PROXY_PREFIX)) return null;
  const rest = url.slice(KOUBOU_WS_PROXY_PREFIX.length);
  if (rest && !rest.startsWith('/') && !rest.startsWith('?')) return null; // /dev-ws/kouboux 不误匹配
  return rest || '/';
}

// WS 关闭码透传约束:1005/1006 等保留码不可主动发送(ws 会抛),仅 1000 与应用码 3000–4999
// (含 Koubou 语义码 4401/4404/4000/4400/4403)原样透传,其余降级为无码 close(默认 1000 语义)
export function sanitizeCloseCode(code: number | undefined): number | undefined {
  if (code === 1000 || (code != null && code >= 3000 && code <= 4999)) return code;
  return undefined;
}

// 上游 WS 基址:KOUBOU_BASE_URL 覆盖(本地 Koubou 挂根路径)优先,否则 PGC 基址 + /game/koubou
export function resolveWsUpstreamBase(env: { KOUBOU_BASE_URL?: string; PGC_BASE_URL?: string }): string | null {
  if (env.KOUBOU_BASE_URL) return toWsBase(env.KOUBOU_BASE_URL);
  if (env.PGC_BASE_URL) return toWsBase(env.PGC_BASE_URL) + KOUBOU_PREFIX;
  return null;
}

export interface DevWsProxyOpts {
  upstreamBase: string; // ws(s)://...(已含服务前缀)
  devCookie?: string;
  fallback: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

// 按关闭码约束向对端转发 close;对端已关/发送失败时兜底断开
function forwardClose(peer: WebSocket, code: number, reason: Buffer) {
  const c = sanitizeCloseCode(code);
  try {
    if (c != null) peer.close(c, reason.toString());
    else peer.close();
  } catch {
    peer.terminate();
  }
}

export function createDevWsUpgradeHandler(opts: DevWsProxyOpts): UpgradeHandler {
  return (req, socket, head) => {
    const rest = stripWsProxyPrefix(req.url);
    if (rest == null) return opts.fallback(req, socket, head);

    // 服务端对服务端握手:cookie = DEV_COOKIE 优先合并浏览器同源携带的亲和 cookie
    const cookie = resolveForwardCookie(req.headers.cookie, opts.devCookie);
    const upstream = new WebSocket(opts.upstreamBase + rest, {
      headers: cookie ? { cookie } : {},
    });

    // 上游握手 101 的 Set-Cookie(可能含 LB 首发的亲和 cookie)重写后附到给浏览器的 101
    let setCookies: string[] = [];
    upstream.on('upgrade', (res) => {
      setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    });

    let opened = false;
    upstream.on('open', () => {
      opened = true;
      // 每次 upgrade 新建 noServer 实例:headers 事件仅作用于本次握手,不跨连接串 cookie
      const wss = new WebSocketServer({ noServer: true });
      wss.on('headers', (headers) => {
        for (const sc of setCookies) headers.push(`Set-Cookie: ${rewriteSetCookieForDev(sc)}`);
      });
      wss.handleUpgrade(req, socket, head, (client) => {
        // 双向 pipe 帧 + 关闭码/reason 透传(4401/4404/4000/... 驱动前端 classifyClose 状态机)
        client.on('message', (d, isBinary) => upstream.send(d, { binary: isBinary }));
        upstream.on('message', (d, isBinary) => client.send(d, { binary: isBinary }));
        client.on('close', (code, reason) => forwardClose(upstream, code, reason));
        upstream.on('close', (code, reason) => forwardClose(client, code, reason));
        client.on('error', () => upstream.terminate());
        upstream.on('error', () => client.terminate());
      });
    });
    // 握手前失败(上游拒绝/不可达):直接断浏览器侧 socket,前端走既有退避重连
    upstream.on('error', () => {
      if (!opened) socket.destroy();
    });
  };
}
