# 计划：BFF 接入 biz-api cookie 制鉴权

> 上游权威设计稿：pgc-server 仓库 `docs/biz-api-auth-integration.md`（§10 前端 BFF）。
> 本计划只覆盖 taluna-game（`/game` BFF）一侧的改动。

## 背景

pgc / koubou 已上线统一鉴权（cookie 制）：

- pgc 删除 `POST /api/auth/login`、`/api/auth/register` 与本地 `users`/JWT；`GET /api/auth/me`
  改为转发 Cookie/Authorization 给 biz-api `/tln/biz/me` 自省。
- koubou `pgc_bearer` → `pgc_session`：转发 Cookie（兼容 Authorization）给 pgc `/api/auth/me`。
- 统一凭据 = `.taluna.ai` 的 new-api session cookie（HttpOnly），全链路靠浏览器自动携带 +
  各跳原样转发，**不再有任何「服务自有 token / 服务账号登录」**。

本 BFF 旧实现用 `.env` 的 `PGC_EMAIL`/`PGC_PASSWORD` 调 pgc 已删的 `/api/auth/login` 换
`access_token` 并注入 `Authorization: Bearer`——pgc 删除该端点后这一步 404，导致 `/game` 对
pgc + koubou 的所有调用报 502。需切到「透传用户 cookie」。

## 约束（来自 Nick）

- 当前页面是某站点的子页面，用户登录由父页面处理：**不实现 Firebase 登录**。
- 生产：浏览器在 `*.taluna.ai/game`，与 BFF 同源，请求自动携带 `.taluna.ai` cookie。
- 本地开发：浏览器在 `localhost`，无 `.taluna.ai` cookie。需注入一条**开发用 cookie**
  （`DEV_COOKIE`，服务端环境变量）打通鉴权。

## 改动清单

1. **`src/server/cookie.ts`（新增，纯函数）** `resolveForwardCookie(incoming, devCookie)`：
   - `DEV_COOKIE` 非空 → 强制返回它（覆盖请求自带 cookie）。本地 localhost 拿不到目标域
     cookie，覆盖语义最稳；生产不设此 env，故只在本地生效。
   - 否则返回 `incoming`（trim 后；空 → `undefined`）。

2. **`src/server/pgc/proxy.ts`** 去掉 `getToken`/`Bearer`/401 重登，纯转发：
   `fetch(url, { method, headers: { ...init.headers }, body })`（headers 已含 cookie）。

3. **`src/server/koubou/proxy.ts`** 同上去掉 Bearer/401 重登，**保留**网络错误 → 502 JSON
   envelope（避免裸 500）。

4. **删除** `src/server/pgc/auth.ts` 与 `auth.test.ts`（服务账号登录/缓存/失效）。

5. **两个 catch-all 路由** `src/app/api/{pgc,koubou}/[...path]/route.ts`：
   `headers['cookie'] = resolveForwardCookie(req.headers.get('cookie'), process.env.DEV_COOKIE)`。

6. **浏览器 `/api/*` fetch 加 `credentials: 'include'`**：`src/lib/pgc/client.ts`（pgc /
   upload / download）、`src/lib/koubou/client.ts`、`src/client/useKoubouConnection.ts`
   （mintTicket）。同源默认 `same-origin` 已带 cookie，显式 `include` 更稳且对齐文档。

7. **配置 / 文档**：
   - `.env` / `.env.example`：删 `PGC_EMAIL`/`PGC_PASSWORD`，加 `DEV_COOKIE`。
   - `deploy/k8s-deployment.yaml`：删 `PGC_EMAIL`/`PGC_PASSWORD` env 与 Secret 引用。
   - `CLAUDE.md`：代理链路改「透传 cookie」，env 表更新。

## 测试

- `cookie.test.ts`：覆盖 DEV_COOKIE 覆盖 / 透传 incoming / 空值 → undefined（TDD）。
- 重写两个 `proxy.test.ts`：断言「转发 cookie、不注入 Bearer」（pgc）、「转发 cookie + 网络错误
  502」（koubou）；删去 Bearer/401 重登/getToken 相关用例。

## 验证

`pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test` · `pnpm build`。

## 备注（需 Nick 确认）

- 本地 `.env` 的 `PGC_BASE_URL` 须指向**支持 cookie 自省**的 pgc（dev 为
  `https://pgcgame.taluna.ai`，其 `BIZ_API__BASE_URL` 指 `https://tlndev.taluna.ai`）。若仍指旧
  IP 而该实例未接 cookie 自省，dev cookie 无法通过鉴权。
