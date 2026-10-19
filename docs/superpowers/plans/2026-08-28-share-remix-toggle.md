# 实现计划：分享游戏弹窗的 Remix 开关

设计稿：`docs/superpowers/specs/2026-08-28-share-remix-toggle-design.md`

任务按「可独立测试、可独立评审」拆分；T1→T4 顺序推进（T4 依赖 T1/T2）。

## T1 协议层：`RemixPolicyData` 类型 + `pgcApi.remixPolicy`

- `src/lib/pgc/types.ts`：加 `RemixPolicyData`（照文档字段，全 snake_case，不臆测别名）与
  `UpdateRemixPolicyRequest`。
- `src/lib/pgc/client.ts`：新增 `remixPolicy: { get(projectId), set(projectId, body) }`，路径相对 `PREFIX`
  → 上游 `/api/projects/{id}/remix-policy`。默认超时（纯策略读写，非生成类，不放宽）。
- 测试：`src/lib/pgc/remix-policy.test.ts` —— stub `fetch`，断言 method / URL / body；
  `enabled=false` 时不带 `version_id`；错误信封 → `PgcError`（含 409 code 透出）。

## T2 纯逻辑：开关可用性与提示判据

`src/lib/remix-policy.ts` + 同目录单测。纯函数，不碰 store / 网络：

- `remixToggleState({ policy, activeVersionId, activeStatus, loading, busy })` →
  `{ checked, disabled, reason: 'loading' | 'notBuilt' | null, boundElsewhere: string | null }`。
- 判据集中在这一处，避免组件里散着写 `status === 'ready'` 与版本比对（重试判据的旧账已教过一次）。

## T3 i18n：11 套词典补 key

`preview.remix.{label, notBuilt, unavailable, boundElsewhere, failed}`；`boundElsewhere` 带 `{{version}}` 插值。
`i18n.test.ts` 的 key 集合断言即验收。

> 实际 key 集合以实现为准（本行为落地后回填，评审 M-4）。原先写的是
> `{title, desc, on, off, …}`：`title/desc` 没有落点（弹窗标题沿用既有 `preview.shareGame`，
> 开关不需要独立说明段），`on/off` 也没用上 —— 右侧是恒定的「允许 Remix」静态标签而非随态切换的
> 文案，开关自身的置位就是状态反馈。`unavailable` 是设计稿成功标准里 GET 失败那条要求的，补入。

## T4 UI：`SharePopover` 标题行右侧开关

- 入参从 `{ url }` 扩到 `{ url, projectId, versionId, versionStatus }`；`PreviewPanel` 传
  `currentProjectId` / `active.id` / `active.status`（`shareUrl` 非空即二者俱在，仍做防御性 null 收敛）。
- 挂载 effect：`remixPolicy.get` → 落 `policy`；`aborted` 守卫（StrictMode 双挂载幂等）；
  401 → `setAuthRequired`，其余 → `setError`。
- `toggle(next)`：乐观置位 → `remixPolicy.set` → 以回执覆盖；失败回滚 + `setError`；`busy` 期间禁用。
- 标题行布局照 `WorkbenchSharePopover`：`justify-between` + 右侧「on/off 文案 + Switch」。
- 测试 `SharePopover.test.tsx` 补：GET 落位 / 拨开发对请求体 / 失败回滚 / 未 build 禁用 /
  版本不一致出提示 / 401 走 authRequired。

## 验收

`pnpm exec tsc --noEmit` · `pnpm test` · `pnpm lint` 全绿，且本轮新增测试有针对性失败→通过记录。
