# 后端 base url 迁移 + 服务前缀拆分

## 背景

后端从 `pgcgame.taluna.ai` 迁到共享网关 `tlndev.taluna.ai`。新网关在**同一域名**下按服务前缀分流：

- PGC 全量（REST API / preview / 媒体字节 / 公开页 `/pv`）挂 `/game/pgcserver`
- Koubou 全量（REST / ws-ticket / WS）挂 `/game/koubou`

## 关键决策

- **前缀注入在代码层，env 仍存裸域名**。因为 `PGC_BASE_URL` / `NEXT_PUBLIC_PGC_BASE_URL` 被 PGC 与 Koubou **共用**，单个 env 装不下两个不同前缀；且 `NEXT_PUBLIC_PGC_BASE_URL` 同时供「媒体（`/game/pgcserver`）」与「Koubou WS（`/game/koubou`）」派生。故前缀必须按服务在各接入点拼接。
- **统一常量**：新增 `src/lib/backend-routes.ts` 导出 `PGC_PREFIX` / `KOUBOU_PREFIX` 作为唯一契约源，所有接入点引用，避免漂移。
- **媒体也带前缀**：`preview_url` 相对路径与 GLB SSRF 代理的相对分支均补 `/game/pgcserver`（Nick 确认）。
- **demo 游戏一并迁 tlndev**：`games.ts` 三条硬编码公开页链接改为 `tlndev.taluna.ai/game/pgcserver/pv/...`。

## 链路对照

| 流量 | 改造前 | 改造后 |
|---|---|---|
| PGC REST | `pgcgame.taluna.ai/api/...` | `tlndev.taluna.ai/game/pgcserver/api/...` |
| Koubou REST + ws-ticket | `pgcgame.taluna.ai/...` | `tlndev.taluna.ai/game/koubou/...` |
| Koubou WS | `wss://pgcgame.taluna.ai/projects/{id}/ws` | `wss://tlndev.taluna.ai/game/koubou/projects/{id}/ws` |
| 媒体 / preview | `pgcgame.taluna.ai/preview/...` | `tlndev.taluna.ai/game/pgcserver/preview/...` |

## 改动清单

代码：
1. 新增 `src/lib/backend-routes.ts`：`PGC_PREFIX='/game/pgcserver'`、`KOUBOU_PREFIX='/game/koubou'`。
2. `src/server/pgc/proxy.ts`：`base()` 追加 `PGC_PREFIX`。
3. `src/server/koubou/proxy.ts`：`base()` 追加 `KOUBOU_PREFIX`。
4. `src/server/pgc/asset-target.ts`：相对分支补 `PGC_PREFIX`（绝对同源校验不变）。
5. `src/lib/pgc/url.ts`：`resolveAssetUrl` 相对分支补 `PGC_PREFIX`。
6. `src/client/useKoubouConnection.ts`：`wsBaseUrl` 追加 `KOUBOU_PREFIX`。
7. `src/components/landing/games.ts`：三条链接换 tlndev + `/game/pgcserver`。

env / 部署：
8. `.env` / `.env.example`：两个 base url 改 `https://tlndev.taluna.ai`（仍裸域名）。
9. `.github/workflows/deploy_dev.yml`：`pgc_base_url` / `public_pgc_base_url` 改 tlndev。

测试：
10. `pgc/proxy.test.ts`、`koubou/proxy.test.ts`、`pgc/url.test.ts`、`pgc/asset-target.test.ts`、`pgc/map.test.ts` 同步新前缀期望。`buildWsUrl` 不变（前缀在 WS base 层拼），其测试保持绿。
