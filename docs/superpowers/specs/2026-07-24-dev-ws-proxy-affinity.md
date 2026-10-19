# 本地开发 LB 会话亲和打通：cookie 回传 + WS 走本地代理

日期：2026-07-24　状态：已定稿

## 背景与问题

正式/联调环境（tlndev.rezona.ai）的 LB 用一个 **Set-Cookie 下发的亲和 cookie** 做会话亲和（把同一浏览器会话的请求粘到同一个 pod）。本地开发（localhost:3000）有两条链路都带不上这个 cookie：

1. **REST（经 Next 代理）**：代理是无状态服务端 fetch——上游 `Set-Cookie` 没回传给浏览器，转发时也不会带；每个请求可能落到不同 pod。
2. **WS（浏览器直连 `wss://tlndev...`）**：跨站请求，LB 亲和 cookie 默认 `SameSite=Lax` 且属性不可配，浏览器在跨站 WS 握手时不会发送。

Koubou 是有状态服务（会话属主 pod），亲和失效直接导致本地开发命令落非属主 pod、run 事件断流等问题。

## 目标与成功标准

- 本地开发下，REST 与 WS 均携带同一份亲和 cookie，LB 能把整个浏览器会话粘到同一 pod。
- 零环境配置：clone + 设 `DEV_COOKIE` 即用，不需要 hosts / mkcert。
- 生产路径零变化：WS 仍直连，代理不启用，cookie 语义不变。

## 方案（已比选，选 B + WS 代理）

- 方案 A（hosts + mkcert 同站域名）：零代码但每人配环境，放弃。
- **方案 B + WS 代理（本方案）**：代码一次投入，团队零配置。

### 1. REST：亲和 cookie 回传闭环（仅 dev）

- **回传**：pgc / koubou 两个 catch-all 代理路由在 **设了 `DEV_COOKIE` 时**（即本地开发），把上游响应的全部 `Set-Cookie` 重写后透传给浏览器：
  - 去掉 `Domain`（落成 localhost host-only cookie）；
  - 去掉 `Secure`（本地是 http）；
  - `SameSite=None` 改 `Lax`（None 必须配 Secure，否则浏览器拒收）。
  - 重写为纯函数 `rewriteSetCookieForDev`，单测覆盖。
- **合并转发**：`resolveForwardCookie` 的 DEV_COOKIE 语义从「覆盖」改「合并」——DEV_COOKIE 的键优先，浏览器带来的其余 cookie（含亲和 cookie）拼接在后。不识别亲和 cookie 名（LB 生成名不可预知），全量合并，上游忽略无关 cookie。

### 2. WS：本地开发经 Next 自定义服务器代理

- `server.ts` 的 `upgrade` 按路径分流：`/dev-ws/koubou/*` 走自建 WS 代理（**仅 dev 模式挂载**，即 `NODE_ENV !== 'production'`），其余照旧交 Next HMR。
- 代理流程（`src/server/koubou/ws-proxy.ts`，用已有 `ws` 依赖）：
  1. 剥掉 `/dev-ws/koubou` 前缀，余下 `/projects/{id}/ws?...` 原样拼到上游基址（`KOUBOU_BASE_URL` 覆盖优先，否则 `PGC_BASE_URL` + `/game/koubou`，http→ws）。
  2. 服务端对服务端向上游握手，`Cookie` 头 = `resolveForwardCookie(浏览器 upgrade 请求的 cookie, DEV_COOKIE)`——浏览器对 localhost 的 upgrade 是同源请求，自动带上第 1 步落下的亲和 cookie。SameSite 对服务端请求不生效，链路打通。
  3. 上游握手 101 的 `Set-Cookie` 同样重写后附到给浏览器的 101 响应（每次 upgrade 新建 `noServer` 的 `WebSocketServer`，用其 `headers` 事件注入）。
  4. 双向 pipe 帧；**关闭码 + reason 双向透传**（4401/4404/4000/4400/4403 驱动前端 `classifyClose` 状态机，不可丢）。非法透传码（1005/1006 等不可主动发送的码）降级为无码 close。
  5. 任一侧 error → 两侧关闭；上游握手失败 → 直接 destroy 浏览器侧 socket（前端走既有退避重连）。
- **前端切换**（`wsBase.ts` + `useKoubouConnection`）：`NODE_ENV === 'development'` 且未设 `NEXT_PUBLIC_KOUBOU_BASE_URL`（本地 Koubou 直连调试优先级更高）时，WS 基址改为 `ws://<location.host>/dev-ws/koubou`；`buildWsUrl` 在其后拼会话路径不变。生产构建不受影响。

### 3. 不做的事（YAGNI）

- 不做生产 WS 代理（生产同源直连没有问题）。
- 不做亲和 cookie 名单/白名单配置。
- 不动 biz 代理（biz-api 无 pod 亲和诉求）。
- 不做代理侧心跳/重放（应用层心跳 `server.heartbeat`/`client.ping` 本来就是端到端帧，pipe 即可）。

## 风险与取舍

- dev/prod WS 拓扑分叉：本地多一跳，生产直连的问题（如 LB idle 超时）本地可能复现不出——接受，文档标注。
- 合并浏览器 cookie 可能把 localhost 残留杂 cookie 带给上游——上游忽略未知 cookie，DEV_COOKIE 键优先保证鉴权不被残留覆盖。

## 踩坑记录（2026-07-24 实测修正）

- 代理前缀最初定为 `/api/koubou/ws`，实测浏览器侧 `socket hang up`：Next dev 在收到首个
  HTTP 请求后会自行往同一 http server 加挂 upgrade 监听（`setupWebSocketHandler`），其
  upgradeHandler 对**命中任何 Next 路由**的 upgrade 一律 `socket.end()`——`/api/koubou/ws/*`
  恰好命中 `/api/koubou/[...path]` catch-all，两个监听器竞争销毁连接。Next 只把「不命中
  任何路由」的 upgrade 留给自定义 WS 服务，故前缀改为 `/dev-ws/koubou`。
- 顺带实测确认：tlndev 的 LB 亲和 cookie 名为 `GCLB`，随 WS 101 握手响应 `Set-Cookie` 下发。
