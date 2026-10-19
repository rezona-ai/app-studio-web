# 一键发布到 Rezona：删除扫码绑定，直发改造（设计稿）

- 日期：2026-08-12
- 上游契约：`rezonalab-game-server` `docs/rezona-contract/frontend-integration.md`（dev 分支）
- 取代：`docs/superpowers/specs/2026-07-02-rezona-publish-flow-design.md` 的绑定部分（该稿的扫码/绑定状态机自本稿起作废）

## 1. 目的

后端把「lab 用户 ↔ Rezona 账号」的匹配与建号整个收进发布接口内部：发布时若用户已有正式账号就用它，
没有就自动建号并双向绑定。前端因此不再需要（也不再可能）查绑定态、出二维码、轮询扫码结果。

本次改造把前端从「五态绑定状态机」收敛成「填表 → 发布 → 成功」三态，并按契约补齐告知文案、
错误码映射与重试兜底。

## 2. 约束（来自契约文档）

| 契约点 | 要求 |
|---|---|
| §0 | `GET /rezona/eligibility`、`GET /rezona/binding`、`POST /rezona/bind`、`GET /rezona/bind/{sid}`、`DELETE /rezona/binding` 全部下线，前端不得再调 |
| §0 | 发布入口无条件渲染；弹窗内不再有账号条、切换账号、Remixable 开关 |
| §0 | **上线顺序：前端先发，后端后发** |
| §1 | 唯一接口 `POST /projects/{id}/rezona/publish`；`version_id` 为已 build 的稳定版本 `v{n}` |
| §2 | 弹窗须在用户点确认**之前**明示：发布将使用你的 Rezona 账号，若没有会自动创建 |
| §3 | Remixable 开关原位留静态说明：本次发布不开放二次创作（Remix） |
| §4 | 不支持解绑 / 换绑，前端不提供任何切换账号能力 |
| §5 | 点发布后无条件展示同一段 loading，不做首次/非首次分支 |
| §6 | 错误码表见 §6；`REZONA_UNAVAILABLE` 前 2 次提示重试，之后展示 `request_id` + 联系支持 |
| §7 | 请求体**不再传 `remixable`**；`cover_ref` 仅 `"version_cover"`；同一次发布意图复用同一个 `idempotency_key` |

## 3. 盘问结论（2026-08-12，Nick 拍板）

1. **删除范围**：全量删除扫码绑定链路，**不加**前端先发窗口期的过渡文案——窗口期内未绑定用户点发布拿到的 409 落通用错误文案即可。
2. **版本预检**：做。把 PGC 的 `version.status` 提进 store 的 `Version`（现在只被转成 `summary: 'Building…'` 丢掉），未 build 时置灰发布 CTA 并给文案，`REZONA_VERSION_NOT_BUILT` 的 409 仍保留为兜底。
3. **`request_id`**：给 `PgcError` 补 `requestId`（信封 `ApiResponse.request_id` 已有字段，只是 `resolveEnvelope` 丢了），全局所有 pgc 错误都能拿到追踪 ID；重试次数由发布弹窗自己计。
4. **超时**：发布请求从 `SLOW_TIMEOUT_MS`（300s）收成专用 60s——后端 30s 出站超时即返 `REZONA_UNAVAILABLE`，前端留一倍余量；前端自身超时归一成 `TIMEOUT` 码，与 `REZONA_UNAVAILABLE` 走同一套递增兜底。

## 4. 改造后的形态

### 4.1 状态机

```
打开弹窗 ──▶ form ──发布──▶ posting ──成功──▶ published
                ▲              │
                └──── 失败 ────┘（错误落 Toast，回 form 原样保留输入）
```

删除 `resolving`（无绑定态可查）与 `link`（无扫码）两态。

### 4.2 发布弹窗内容（自上而下）

1. badge「Post to Rezona」+ 关闭
2. 封面预览 + 自定义上传（**保留现状**：上传替换的是项目级封面，发布请求恒带 `cover_ref: "version_cover"`）
3. 标题（≤30）/ 简介（≤200）
4. 分隔线
5. 两个开关：Public、Sync to community（**Remixable 开关删除**）
6. **告知区**（新增，位于开关组与 CTA 之间，即原 Remixable 开关所在块的下沿）：
   - 发布将使用你的 Rezona 账号，若没有会自动为你创建。
   - 本次发布不开放二次创作（Remix）。
   - （保留）以上设置发布后无法在 Rezona Lab 修改，需调整请前往 Rezona。
7. CTA「Post to Rezona」——所选版本 `status !== 'ready'` 时置灰并显示未构建提示
8. 页脚说明

**删除**：账号头像/昵称行、切换账号按钮、Remixable 开关及其描述文案。

### 4.3 请求体

```jsonc
{
  "version_id": "v{index}",
  "name": "...",                  // 1..30（前端上限，契约上限 255）
  "summary": "...",               // ≤200（前端上限，契约上限 2000）
  "cover_ref": "version_cover",
  "public": true,
  "sync_to_community": true,
  "idempotency_key": "<弹窗打开时生成的 uuid-v4>"
}
```

`remixable` 从 `RezonaPublishRequest` 类型与请求体中删除；`PublishToggles` 收敛成 `{ public, sync_to_community }`，
随之删除 `normalizePublishToggles`（它唯一职责是 `public=false → remixable=false` 的镜像归一）。

### 4.4 错误码 → UX

| code | HTTP | i18n key | 附加动作 |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | `err.unauthorized` | 无（登录态由全局鉴权链路兜底） |
| `PROJECT_NOT_FOUND` | 404 | `err.projectNotFound` | 无 |
| `VERSION_NOT_FOUND` | 404 | `err.versionNotFound` | 无 |
| `REZONA_VERSION_NOT_BUILT` | 409 | `err.notBuilt` | 无 |
| `VALIDATION_ERROR` | 422 | `err.validation` | 无 |
| `REZONA_COVER_INVALID` | 422 | `err.cover` | 无 |
| `IDEMPOTENCY_CONFLICT` | 409 | `err.idempotency` | **换新 `idempotency_key`** |
| `REZONA_PUBLISH_IN_PROGRESS` | 409 | `err.inProgress` | 无 |
| `REZONA_PUBLISH_FAILED` | 502 | `err.publishFailed` | 无 |
| `REZONA_UNAVAILABLE` / `TIMEOUT` / `NETWORK` | 503 / — | 前 2 次 `err.unavailable`；第 3 次起 `err.support`（内插 `request_id`），无 `request_id` 时用 `err.supportNoId` | 计数 +1 |
| `HTTP_ERROR` 且 HTTP ≥ 500 | 500 / 502 / 503 | 同上——本服务 pgc 代理不可达时路由层不兜底、对外是裸 500，LB 侧则是 502/503，都没有业务信封，在弹窗边界归一成 `REZONA_UNAVAILABLE` 后再映射 | 计数 +1 |
| 其他 | — | `err.generic` | 无 |

作废并删除：`REZONA_BIND_EXPIRED`、`REZONA_SESSION_NOT_FOUND`（连同 `restartBinding` 语义）、`REZONA_PACKAGE_TOO_LARGE`。

映射保持纯函数、可单测：

```ts
mapRezonaError(code: string, unavailableFails: number, hasRequestId: boolean): { messageKey: string; resetIdempotency: boolean }
```

`unavailableFails` 是**在本次调用之前**已累计的不可用失败次数（0、1 → `err.unavailable`；≥2 → 升级联系支持）。
`hasRequestId` 区分升级后的两条文案：`TIMEOUT` / `NETWORK` 是前端本地归一出来的错误、根本没有信封，
结构上拿不到 `request_id`，此时必须用 `err.supportNoId`，否则用户会看到「请联系支持，ID：（空）」。
计数只在 unavailable 家族累加，其他错误码不影响它；发布成功后计数归零。

### 4.5 版本预检

`VersionData.status`（`ready` / `building`）经 `versionToVersion` 提进 `Version.status`。
`status !== 'ready'` 时发布 CTA 置灰 + 提示文案。**入口菜单不置灰**——契约 §0 要求入口无条件渲染，
且弹窗内的告知信息本身有价值。

> ⚠️ **该预检目前是防御性的，不是已兑现的用户可见行为**（2026-08-12 评审发现）。
> 本仓 `loadVersions` 的注释与 `VersionData.status` 的注释都写明「`listVersions` 只返回 ready 版本」，
> 构建中的占位版本存在独立字段 `buildingVersion`、从不进 `versions`，因此 `active.status` 在生产链路上恒为 `ready`，
> CTA 实际不会被置灰。真正的守卫是服务端 409 `REZONA_VERSION_NOT_BUILT`。
> 保留预检的理由：上游契约 §7 明确写「时间线里 `status == "ready"`」，暗示该端点**可能**返回非 ready 版本；
> 一旦后端放开，前端无需再改即可生效，且方向是 fail-closed（`status` 缺失/异常时禁用而非放行）。
> **待办**：向后端确认 `GET /versions` 是否会返回 `building` 版本——若会，需补一条从 `listVersions` 灌入到 CTA 置灰的真实链路测试。

## 5. 删除清单

| 文件 / 符号 | 处置 |
|---|---|
| `src/components/preview/rezona/LinkStep.tsx` + `.test.tsx` | 删除 |
| `src/client/useRezonaBindPoll.ts` + `.test.tsx` | 删除 |
| `src/lib/rezona/links.ts` | 删除（仅 LinkStep 使用；`qr.ts` **保留**，APK 弹窗仍在用） |
| `pgcApi.rezona.{binding,bind,pollBind,unbind}` | 删除 |
| `RezonaAccount` / `RezonaBindingState` / `RezonaBindingData` / `RezonaBindData` / `RezonaBindStatus` / `RezonaBindSessionData` | 删除 |
| `POLL_INTERVAL_MS` / `POLL_TIMEOUT_MS` / `normalizePublishToggles` / `PublishToggles.remixable` | 删除 |
| `RezonaPublishRequest.remixable` | 删除 |
| i18n `preview.rezona.{linkTitle,linkDesc1,linkDesc2,scanTitle,linkStep1,linkStep2,linkStep3,notOnRezona,downloadQrAlt,agreePrefix,terms,agreeAnd,privacy,agreeSuffix,qrExpired,refresh,rejected,resolving,switchAccount,remixable,remixableDesc}` 与 `err.{bindExpired,tooLarge}` | 11 个语言全部删除 |

新增 i18n（11 语言）：`preview.rezona.{accountNotice,noRemixNotice,notBuiltHint}`、
`preview.rezona.err.{unauthorized,projectNotFound,notBuilt,inProgress,publishFailed,support,supportNoId}`。

## 6. 非目标

- 不动封面上传（`POST /projects/{id}/cover`）行为
- 不动 APK 导出、Share Game、Workbench 分享
- 不为前端先发窗口期做任何兼容分支（盘问结论 1）
- 不做「换绑 / 解绑」的任何替代入口（契约 §4）

## 7. 成功标准

1. 全仓不再存在对 `/api/rezona/binding`、`/api/rezona/bind`、`/api/rezona/eligibility` 的引用。
2. 打开发布弹窗零请求，直接呈现表单；点发布只打一个 `POST /projects/{id}/rezona/publish`，请求体不含 `remixable`。
3. 用户在点 CTA 之前能同时看到「自动建号」与「不开放 Remix」两条告知。
4. 服务端 409 `REZONA_VERSION_NOT_BUILT` 有对应文案；前端预检在拿到非 ready 版本时置灰 CTA（见 §4.5 的口径说明：当前生产链路取不到非 ready 版本，故这是防御性冗余而非可演示行为）。
5. 连续第 3 次 `REZONA_UNAVAILABLE` 起，提示文案带上 `request_id`。
6. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 8. 风险

- **窗口期 409**：前端先发、后端未发时，未绑定用户点发布会拿到旧后端的 409，落通用文案。按盘问结论接受此表现，发布节奏上尽量压缩两者间隔。
- **`status` 值域**：预检依赖后端 `version.status` 恒返回 `ready`/`building`。若后端引入第三种值且不是 `ready`，会误置灰 CTA——故 409 兜底必须保留，不能只靠预检。
