# 一键发布到 Rezona：直发改造（实现计划）

设计稿：`docs/superpowers/specs/2026-08-12-rezona-publish-direct-design.md`
分支：`feat/rezona-publish-direct`（worktree `.orca/worktrees/rezona-publish-direct`）

任务按「可独立测试 / 可独立评审」拆分。T1、T2 是可单独编译通过的前置铺垫；T3 是原子切换
（删接口 + 改 UI + 改 i18n 必须同批，否则类型不通过）；T4 收口。

---

## T1 — `PgcError` 透传 `request_id`

**动机**：契约 §6 的兜底文案要带追踪 ID；信封里已有 `request_id`，只是 `resolveEnvelope` 丢了。

**改动**
- `src/lib/pgc/client.ts`：`PgcError` 构造函数追加可选参数 `requestId: string | null = null`（放 `failure` 之后，向后兼容既有 5 处以内的构造点）；`resolveEnvelope` 传 `env?.request_id ?? null`。

**测试（先写失败用例）**
- `src/lib/pgc/client.test.ts`：错误信封带 `request_id` → 抛出的 `PgcError.requestId` 等于该值；不带时为 `null`。

**验收**：`pnpm exec vitest run src/lib/pgc/client.test.ts` 绿；`tsc --noEmit` 绿。

**提交**：`feat(pgc): PgcError 透传 request_id`

---

## T2 — `Version.status` 提进 store

**动机**：发布前预检「版本已 build」需要 status，现在它只在映射层被转成 `summary: 'Building…'` 后丢弃。

> 评审后回写：该预检在当前生产链路上不可达（`versions` 只装 ready 版本），属防御性冗余，口径见设计稿 §4.5 的告示块。

**改动**
- `src/store/types.ts`：`Version` 增 `status: string`（值域 `ready` / `building`，注释写明来自 PGC 契约）。
- `src/lib/pgc/map.ts`：`versionToVersion` 带上 `status: v.status`（`summary` 现有逻辑不动）。

**测试**
- `src/lib/pgc/map.test.ts`：`versionToVersion` 保留 `status`；`building` 版本 `status === 'building'` 且 `summary === 'Building…'`。

**验收**：`pnpm exec vitest run src/lib/pgc/map.test.ts` 绿；`tsc --noEmit` 绿（`actions.ts:1180` 的占位版本经同一映射函数构造，无需额外改）。

**提交**：`feat(version): 版本 build 状态提进 store`

---

## T3 — 原子切换：删绑定链路，弹窗改直发

**改动（一次提交，缺一不可编译）**

1. 纯逻辑 `src/lib/rezona/publish.ts`
   - 删 `POLL_INTERVAL_MS` / `POLL_TIMEOUT_MS` / `normalizePublishToggles`
   - `PublishToggles` 收敛为 `{ public: boolean; sync_to_community: boolean }`
   - 重写 `mapRezonaError(code, unavailableFails, hasRequestId)`（第三参在评审后追加，见下方回写），按设计稿 §4.4 全表；`REZONA_UNAVAILABLE` / `TIMEOUT` / `NETWORK` 在 `unavailableFails >= 2` 时升级为联系支持文案
   - 新增 `isUnavailable(code: string): boolean` 供弹窗计数（保持计数判定与文案映射同源）
2. 协议/客户端
   - `src/lib/pgc/types.ts`：删 `RezonaAccount` / `RezonaBinding*` / `RezonaBind*`；`RezonaPublishRequest` 删 `remixable`
   - `src/lib/pgc/client.ts`：删 `rezona.{binding,bind,pollBind,unbind}`；`rezona.publish` 改用新常量 `PUBLISH_TIMEOUT_MS = 60_000`
3. 删除文件：`src/components/preview/rezona/LinkStep.tsx(+test)`、`src/client/useRezonaBindPoll.ts(+test)`、`src/lib/rezona/links.ts`（`qr.ts` 保留，APK 弹窗在用）
4. `src/components/preview/RezonaPublishModal.tsx`
   - `Step` 收敛为 `'form' | 'posting' | 'published'`，初始即 `form`，name 预填逻辑移到初始化
   - 删 binding 查询 effect、`startBind` / `switchAccount` / 轮询 / qr / expired / rejected / account 状态
   - 失败路径：`isUnavailable` 计数（成功清零）→ `mapRezonaError(code, fails)` → `setError`；`err.support` 内插 `e.requestId`；`resetIdempotency` 时换新 key
5. `src/components/preview/rezona/PublishForm.tsx`
   - 删账号行 / 切换账号 / Remixable 开关
   - 新增告知区（自动建号 + 不开放 Remix + 既有 settingsNote）
   - 新增 `versionReady` prop：false 时 CTA `disabled` + 未构建提示
6. i18n 11 语言（`en` 改动会经 `Messages` 类型强制其余同构）：删设计稿 §5 列出的废弃 key（评审后另删了随死分支作废的 `noVersion`），新增 `accountNotice` / `noRemixNotice` / `notBuiltHint` 与 `err.{unauthorized,projectNotFound,notBuilt,inProgress,publishFailed,support,supportNoId}`（`support` 带 `{{requestId}}` 插值，`supportNoId` 为无追踪 ID 时的退化文案）

**测试**
- `src/lib/rezona/publish.test.ts`：重写——全错误码映射表逐条断言；unavailable 计数 0/1 → `err.unavailable`，2/3 → `err.support`；`IDEMPOTENCY_CONFLICT` → `resetIdempotency === true`
- `src/components/preview/rezona/PublishForm.test.tsx`：无账号行 / 无 Remixable 开关；两条告知文案可见；`versionReady=false` 时 CTA 禁用
- `src/components/preview/RezonaPublishModal.test.tsx`：打开弹窗**零请求**且直接渲染表单；提交请求体不含 `remixable` 且含 `cover_ref: 'version_cover'`；连续 3 次 `REZONA_UNAVAILABLE` 第 3 次文案含 request_id；`IDEMPOTENCY_CONFLICT` 后重试用新 key
- `src/lib/pgc/rezona-client.test.ts`：删绑定端点用例，保留/补齐 publish 端点用例（路径 + 超时 + 信封）
- `src/i18n/i18n.test.ts`：既有同构断言自动覆盖新增/删除 key

**验收**：`pnpm exec vitest run src/lib/rezona src/lib/pgc src/components/preview src/i18n` 绿；`grep -rn "rezona/bind\|rezona/binding\|eligibility" src/` 无命中。

**提交**：`feat(rezona): 发布改直发,删掉整条扫码绑定链路`

---

## T4 — 收口与文档回写

**改动**
- 旧设计稿 `docs/superpowers/specs/2026-07-02-rezona-publish-flow-design.md` 顶部加一行作废指路，指向本次设计稿
- 本计划与设计稿回写实际落点与偏差

**验收（本轮跑出的完整输出）**
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `pnpm test`
- `pnpm build`

**提交**：`docs(rezona): 直发改造终审记录与旧稿作废指路`

---

## 评审节奏

T1 / T2 / T3 各自提交后，派干净上下文子代理基于 commit 范围独立评审（只给设计稿 + diff）；
Critical / Important 修完才进下一任务，Minor 记录留终审。合并前对全分支做一次终审，
`--no-ff` 合入 dev 后在合并结果上重跑完整验证。

## 上线提醒

契约 §0：**前端必须先于后端发布**。本分支合并、dev 环境发布后再通知后端删端点。
