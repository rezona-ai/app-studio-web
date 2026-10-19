# 实现计划：本地 LB 亲和 cookie 闭环 + dev WS 代理

对应设计稿：`docs/superpowers/specs/2026-07-24-dev-ws-proxy-affinity.md`

每任务先测后码（TDD），独立可验，各自成一次提交。验证命令统一：
`pnpm exec vitest run <文件>`；收尾全量 `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`。

## 任务 1：cookie 合并语义（覆盖 → 合并）

- 文件：`src/server/cookie.ts` + `src/server/cookie.test.ts`
- `resolveForwardCookie(incoming, devCookie)`：设 DEV_COOKIE 时不再丢弃 incoming，而是合并——按 cookie 名去重，DEV_COOKIE 键优先，incoming 其余键追加。
- 用例：仅 dev / 仅 incoming / 合并且同名 dev 优先 / incoming 空白段容错 / 两者皆空。
- 验证：`pnpm exec vitest run src/server/cookie.test.ts`

## 任务 2：Set-Cookie 重写回传（仅 dev）

- 新文件：`src/server/dev-set-cookie.ts`（纯函数）+ 同目录测试
- `rewriteSetCookieForDev(sc: string): string`：去 `Domain` / 去 `Secure` / `SameSite=None`→`Lax`，其余属性原样。
- 接线：`src/app/api/{pgc,koubou}/[...path]/route.ts` 在 `process.env.DEV_COOKIE` 存在时，将上游 `res.headers.getSetCookie()` 逐条重写后 `headers.append('set-cookie', ...)`。
- 验证：`pnpm exec vitest run src/server/dev-set-cookie.test.ts`

## 任务 3：前端 WS 基址走本地代理

- 文件：`src/koubou/wsBase.ts` + `wsBase.test.ts`、`src/client/useKoubouConnection.ts`
- `resolveKoubouWsBase(override, pgcBase, devProxyOrigin?)`：override 优先（本地 Koubou 直连）＞ devProxyOrigin（拼 `/dev-ws/koubou`，http→ws）＞ 生产派生。
- `useKoubouConnection` 传第三参：`process.env.NODE_ENV === 'development' ? window.location.origin : null`（含 basePath 前缀经 `apiPath`）。
- 验证：`pnpm exec vitest run src/koubou/wsBase.test.ts`

## 任务 4：dev WS 代理模块 + server.ts 分流

- 新文件：`src/server/koubou/ws-proxy.ts` + 测试（`@vitest-environment node`，真实 ws 服务端集成测）
- 纯函数 `stripWsProxyPrefix(url)`（匹配/剥前缀）与 `sanitizeCloseCode(code)`（1000/3000–4999 透传，其余降级无码）。
- `attachDevWsProxy(server, { upstreamBase, devCookie, fallback })`：见 spec §2。
- `server.ts`：dev 模式挂代理分流，非 dev 保持现状。
- 集成用例：cookie 头到达上游 / 帧双向 / 关闭码 4401 透传 / 上游拒绝时浏览器侧断开。
- 验证：`pnpm exec vitest run src/server/koubou/ws-proxy.test.ts`

## 任务 5：文档与收尾

- CLAUDE.md 环境变量表 & 链路表补充说明（WS 本地经代理）。
- 全量验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
