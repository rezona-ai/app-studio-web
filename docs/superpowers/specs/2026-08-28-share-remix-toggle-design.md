# 分享游戏弹窗的 Remix 开关

日期：2026-08-28 · 状态：已批准（盘问结论见「决策」）

## 目的

「分享游戏」弹窗（`SharePopover`）目前只给一条公开试玩直链。上游 pgc 已提供项目 owner 自助的
Remix 策略接口（`docs/api/remix.md`），但前端**只实现了消费侧**——`?remix=<code>` 进入即 fork
（`parseRemixSource` → `applyStudioRemix` → `POST /api/remixes`）。owner 侧没有任何入口开关，
只能靠运营脚本 `seed_remix_sources.py` 写策略。

本轮补上 owner 侧：在分享游戏弹窗标题行右侧加一个 Remix 开关，拨开即为当前分享的版本开放
Remix，拨关即立刻禁用本项目所有 Remix 策略。

## 后端契约（`rezonalab-game-server/docs/api/remix.md`）

| 端点 | 语义 |
|---|---|
| `GET /api/projects/{id}/remix-policy` | owner 读当前策略，返回 `RemixPolicyData`；未开启时 `enabled=false` 且其余字段为 null |
| `PATCH /api/projects/{id}/remix-policy` | `{enabled, version_id?, display_title?, display_description?}`；`enabled=true` 必传 `version_id`，且只能是**已含 `dist/index.html` 的稳定版本 `v{n}`**；`enabled=false` 立即禁用本项目所有策略 |

`RemixPolicyData` = `{ enabled, source_code, source_version_id, remix_url, display_title, display_description }`。

错误：`401 UNAUTHORIZED` / `403 FORBIDDEN` / `404 PROJECT_NOT_FOUND` /
`409 REMIX_SOURCE_NOT_READY`（版本缺 `dist/index.html` 或不存在）/ `422 VALIDATION_ERROR`。

`project_id` 兼容期双收 `public_id` 与 legacy int；本仓与 `workbenchShare.get` 保持一致，传数字
`currentProjectId`。

## 约束

- **`remix_url` 不进 UI**。它指向 `{host}/game?remix={code}`，是给分享页 / 精选源用的 fork 入口；
  owner 只需要「开 / 关」这一个语义，弹窗里再挂第二条链接只会让人发错。
- **版本跟随弹窗当前分享的那个版本**（`selectActiveVersion` 的结果，`Version.id` 即 `v{n}`）。
  弹窗里的链接是 `/share/{code}/v{n}`，开关开的就是同一个 `v{n}`，语义自洽。
- **不隐式改绑**。已开启但后端 `source_version_id` 与当前分享版本不一致（例如策略绑在 v2、
  弹窗正分享 v3）时，只在开关下方给一行提示，改绑靠用户「先拨关再拨开」。打开弹窗看一眼就
  改掉对外策略是不可接受的副作用。
- **未 build 的版本不给开，但**照样**给关**。`status !== 'ready'` 时禁止拨开并给出原因（对齐
  `PublishForm` 的 `versionReady` 范式），否则必然吃一发 409；反之若策略已开启、用户只是当前停在
  一个 building 版本上，开关必须仍能拨关 —— 否则「已对外开放」被锁死在关不掉的状态。
  同理拨关不校验 `version_id`（契约里该字段只在开启时必填）。
- 不新增按钮种类 / toast / keyframes：开关用现成 `Switch`，错误走全局 `setError` → `Toast`，
  401 走 `setAuthRequired` 全局登录门闸——三者都照 `WorkbenchSharePopover` 的现成范式。

## 决策（盘问结论）

1. **绑定版本**：跟随弹窗当前分享的版本（`active.id`），并在与后端 `source_version_id` 不一致时提示。
2. **remix 链接**：不展示，只做开关。
3. **写入节奏**：即时 PATCH，**乐观置位**，失败回滚到后端事实 + 弹 Toast；在飞期间开关禁用防连点。
   —— 与 `WorkbenchSharePopover` 的「不乐观翻转」刻意不同：那边拨开还要等 `share_url` 才有东西可复制，
   这边开关自己就是全部反馈，等一个来回手感发涩。
4. **版本不一致**：只提示，不给「改绑」按钮，也绝不隐式改绑。

## 成功标准

- 打开分享游戏弹窗 → 自动 `GET` 策略，开关反映后端事实；GET 未回来前开关禁用。
- 拨开 → 开关立即置位，后台 `PATCH {enabled:true, version_id:'v{n}'}`；成功后以回执为准，
  失败回滚并弹 Toast。拨关 → `PATCH {enabled:false}`，同上。
- 当前版本 `status !== 'ready'` 且策略当前为关 → 开关禁用 + 说明文案，不发请求；策略已开时仍可拨关。
- GET 策略失败 → 开关禁用 + 一行说明，**不弹 Toast**（用户点的是「分享」，仅打开弹窗就红字刷屏太吵）；401 仍走登录门闸。
- 已开启且 `source_version_id !== active.id` → 开关下一行提示「Remix 当前开放的是 vN」。
- 401 不弹红字，置 `authRequired`。
- 11 套 i18n key 齐全（`i18n.test.ts` 的 key 集合断言）。

## 评审处置（2026-08-28，干净上下文子代理按 commit 范围独立评审）

Critical 0 · Important 1（已修）· Minor 6。

已修：

- **I-1** GET 401 分支无测试覆盖（GET 与 PATCH 是两条独立 catch，后者绿灯不保护前者）。
  行为本就正确，补的是防回归用例。
- **M-1** `projectId` 变更时未作废旧策略事实：组件不带 key 故不重挂，新 GET 落地前开关按**旧项目**
  的事实可点，一点就对新项目发 PATCH。已在 effect setup 首两行清 `policy` / 复位 `loading`，
  并补用例（修前实测复现）。
- **M-4** 计划里的 i18n key 集合与实现漂移（`title/desc/on/off` 未用上，实际是
  `{label, notBuilt, unavailable, boundElsewhere, failed}`）。已在计划里注明以实现为准。
- **M-5** 两个 `remix-policy.test.ts` 同名（一测纯函数、一测 client），client 侧改名
  `remix-policy-client.test.ts`，对齐 `rezona-client.test.ts` 命名。

记录不改（Minor，留待有实际触发再动）：

- **M-2 已知假设：链接用 `seq`、开关绑 `version_id`。** `buildSharePageUrl` 拼的是 `/share/{code}/v{seq}`，
  而策略绑 `Version.id`（= 后端 `version_id`）；`map.ts:212-213` 里这是后端两个**独立**字段，
  当前按约定同为 `v{n}`。**若后端让二者漂移，用户看到的链接与实际开放 Remix 的版本会不一致且不报错。**
  真要钉死得在映射层加约定守护单测，但那断言的是后端约定、不是本仓行为，故先记录。
- **M-3** 409 `REMIX_SOURCE_NOT_READY` / 403 `FORBIDDEN` 复用了「请重试」文案，而这两种重试永远失败。
  两者都被前置条件挡在门外（未 build 不给拨开、非属主进不到该面板），真出现再按 `e.code` 分文案。
- **M-6** 开关下方的 note 未经 `aria-describedby` 关联到 `Switch`，读屏拿不到「为什么不能动」。
  要改共享组件 `Switch` 的签名（现不透传额外 aria 属性），本轮不为单个调用方动它。

## 不做

- 分享页（`/share/{code}/v{n}`）上的 Remix 入口渲染 —— 那要读公开 `GET /remix/{code}`，属另一轮。
- `display_title` / `display_description`：本轮不传，后端可选。
- `RezonaPublishModal` 里那个恒 false 的 Remixable 开关：那是 Rezona 社区发布的字段（契约 §7 不传），
  与本项目级 Remix 策略无关，不动。
