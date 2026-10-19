# request-id 链路传播（BFF ↔ pgc）

让一次用户请求在 rezonalab-game-web BFF 与 pgc-server 两侧日志共享同一个 `request_id`，
debug 时用一个 id 即可在 Cloud Logging 拼出完整链路，取代「时间窗 + path + cookie」人工对齐。

## 契约

- rezonalab-game-web 的 `/api/pgc/[...path]` BFF 代理在转发给 pgc 时携带小写 `x-request-id` 头。
- 该 id 由 `resolveRequestId()`（`src/server/logging.ts`）解析：**优先复用入站 `x-request-id`**，
  否则生成 UUID。入站值采纳前做 **charset + length 校验**（`≤128` 且 `[A-Za-z0-9._-]+`），
  畸形值（超长 / 含控制字符 / 空白 / 分号等）一律弃用并改为生成新 UUID——入站头客户端可控，
  此校验防其污染前端 / pgc 日志或跨请求投毒。
- pgc 的 `AccessLogMiddleware` 复用入站 `x-request-id` 作为日志 `request_id` 并回写响应头
  （pgc 端已就绪，本次无改动）。
- 前端访问日志（`logRequest`）与上游错误日志（`bff_upstream_5xx` / `bff_upstream_error`）
  均以 **`request_id`** 字段输出（与 pgc 字段名对齐，非 camelCase `requestId`），
  使按字段名的跨服务检索不被字段名差异割裂。

## Cloud Logging 查询示例

```
jsonPayload.request_id="<id>"
```

一个 id 同时命中前端 BFF 与 pgc 两个 logName 的日志。

## 范围与边界

- **只覆盖前端 ↔ pgc**。`/api/koubou/[...path]` 与 koubou 后端不在本契约内：koubou 是独立的
  OpenTelemetry 体系（日志为 `trace_id` / `span_id`，无 `request_id`），且其核心交互
  （WebSocket + detached agent run）经 contextvar 透传 request-id 够不着，需另立方案。
- 入站 `x-request-id` 校验只在 BFF 这一跳；pgc 入站对该头的校验（防直接打 pgc 的非前端来源）
  留作后续防御加固。
