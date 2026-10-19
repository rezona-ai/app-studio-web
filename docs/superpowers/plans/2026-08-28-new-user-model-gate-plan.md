# 实现计划：新用户模型门禁

设计稿：`docs/superpowers/specs/2026-08-28-new-user-model-gate-design.md`

任务按「纯逻辑 → 数据源 → store → 副作用 → UI」推进，每个任务可独立测试、独立评审。

## T1 · 纯逻辑：门禁判据（TDD）

新增 `src/lib/subscription/model-gate.ts`：

- `export const BASE_MODEL = 'Rez1'`（与 `lib/koubou/models.ts` 的 `KNOWN_MODELS.Rez1` 同一 ID，大小写敏感）。
- `modelGateLocked({ isNewUser, tier, models })`：三项齐备且 `isNewUser === true && tier === 'free' && models.includes(BASE_MODEL)` → `true`；`isNewUser` 为 `null`、`tier` 为 `null`、列表无 `Rez1` → `false`。
- `gatedModel(model, locked)`：锁定时恒返回 `BASE_MODEL`，否则原样返回（建连与归位共用一份）。

测试 `model-gate.test.ts` 覆盖 spec 成功标准 1–5 的判据面。

## T2 · 数据源：pgc client

- `src/lib/pgc/types.ts` 加 `NewUserStatusData`（`user_id / is_new_user / modes / self_authored_project_count / scanned_project_count / built_project_public_id / notes`，按文档字段，只取契约字段不加别名）。
- `src/lib/pgc/client.ts` 加 `getNewUserStatus: () => pgc<NewUserStatusData>('GET', '/api/auth/me/new-user-status')`（不传 `modes`，用后端默认口径）。

## T3 · 埋点维度

- `src/lib/subscription/plan-display.ts`：`UpsellSource` 增 `'modelLocked'`，`TriggerDimension` 增 `'model_locked'`，`triggerDimension` 映射之；同步 `src/lib/analytics/events.ts` 的维度联合类型（若有）。
- 补 `plan-display.test.ts` 用例。

## T4 · store 字段

- `ServerState` 加 `newUserStatus: boolean | null`（初始 `null` = 未知），**不进 persist 白名单**。
- Action `setNewUserStatus(v: boolean | null)`。
- 归位：`setSelectedModel` 不动（它是用户显式选择的入口）；新增 `enforceModelGate()`——按当前 `newUserStatus / plansCache.current_tier / availableModels` 算锁，锁定且 `selectedModel !== 'Rez1'` 时改写 `selectedModel` 并同步 `modelByProject`（复用 `setSelectedModel` 的写法）。

## T5 · client hook `useNewUserGate`

新增 `src/client/useNewUserGate.ts`，挂进 `Workspace`（`useUserInfo()` 附近）：

1. 挂载拉一次 `pgcApi.getNewUserStatus()` → `setNewUserStatus(data.is_new_user)`；任何失败静默且置 `null`（未知 = 放行）。
2. `newUserStatus === true` 时以 `useSubscriptionPlans(true)` 触发套餐拉取（拿 `current_tier`）。
3. `versions` 数量增长（build 出新版本）且当前 `newUserStatus === true` → 重拉一次。
4. 任一输入变化后调 `enforceModelGate()`，锁定时把 `selectedModel` 归位到 `Rez1`。

测试 `useNewUserGate.test.tsx`：拉取成功/失败、build 后重拉、归位生效。

## T6 · 建连侧兜底

`src/client/useKoubouConnection.ts` 取建连 `model` 处套 `gatedModel(...)`：归位 effect 还没跑完就建连时，仍用 `Rez1`。

## T7 · ModelSelector 拦截

`src/components/chat/ModelSelector.tsx`：`onChange` 里若锁定且目标 ≠ `Rez1` → 不写 store、不发 `setModel`，只 `setCreditModalOpen('modelLocked')` 并 return。锁定状态由 store 派生（组件不算判据，读一份 selector）。

测试补进 `ModelSelector.test.tsx`：锁定态点其他模型 → `selectedModel` 不变、`client.setModel` 未调用、`creditModalOpen === 'modelLocked'`；非锁定态照常切换。

## 验证

`pnpm exec vitest run`（相关文件）→ `pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` 全量。
