# 实现计划：失败卡「修改后重试」改为替换原卡

spec：`docs/superpowers/specs/2026-08-14-retry-form-replace-card.md`

机制都已存在（`discardFailedCard` + `pinAt`），本轮是"把表单这条路接上去"。
接缝在**提交时刻**，故拆成「store 侧的一次性取用」→「UI 侧在提交时取」→「回归护栏」。

## 任务 1：`genForm` 记住要替换的卡

- 红：`store/retry-form-replace.test.ts`（新）
  - 失败卡调 `openRetryForm` → `genForm.replaceAssetId === 原卡 id`，且**原卡仍在** `assets`。
  - 成功卡（agent 成功卡）调 `openRetryForm` → `genForm.replaceAssetId` 为 `undefined`（约束 1）。
- 绿：`GenFormState` 加可选字段 `replaceAssetId?: string`；`openRetryForm` 在
  `asset.status === 'error'` 时带上它。**此时不做任何丢弃**（成功标准 1）。

## 任务 2：提交时取用 —— 新 action `takeGenFormReplacement`

- 红：同文件
  - 失败卡场景：调用后原卡从 `assets` 消失、返回 `{ pinAt: 原卡位置 }`，且 `genForm.replaceAssetId`
    被清空（一次性，重复调用不再丢第二张卡）。
  - 孤儿卡场景：`discardFailedCard` 回报 false → 返回 `{}`（不带 pinAt），卡仍在。
  - 卡已被手动删除：返回 `{}`，不抛（成功标准 8）。
  - 无 `replaceAssetId`（普通生成 / 成功卡）：返回 `{}`，不碰任何卡。
- 绿：在 store 加 action：读 `genForm.replaceAssetId` → 找卡 → 仅当 `status === 'error'`
  且 `discardFailedCard(pid, id)` 为真时返回 `{ pinAt: asset.position }`，并清空该字段。

> 为什么是"取用"而不是让 UI 自己判断：丢弃与落位是 store 的业务，`GenerateForm` 只需要知道
> "这次该怎么落"（约束 4）。一次性清空避免同一表单连点两次生成丢掉两张卡。

## 任务 3：`GenerateForm` 提交时接上

- 红：`GenerateForm.test.tsx`
  - 带 `replaceAssetId` 的表单提交 → `generateImage` 收到的 placement 含 `pinAt`（原卡位置）。
  - 拖动过弹窗（`dropped`）时提交 → placement 用 `spawnAt: dropped`，**且替换照样发生**
    （`takeGenFormReplacement` 仍被调用、原卡仍被丢弃）——成功标准 4。
- 绿：提交路径先调 `takeGenFormReplacement()`，再按既有优先级拼 placement：
  `dropped ? { spawnAt: dropped } : pinAt ? { pinAt } : nearAt ? { nearAt } : spawnAt ? { spawnAt } : {}`。

## 任务 4：回归护栏

- `store/retry-routing.test.ts` 既有那条「content_policy 卡：表单真的开出来、prefill 带原参数、
  原卡仍在画布」保持绿（成功标准 1 不许退化）。
- 补：成功卡走 editForm 时提交 → 原卡仍在（成功标准 6）。

## 任务 5：文档对账

`2026-08-07-retry-path-guards.md` 成功标准 7 补一行：失败卡改为占原位，指向本轮 spec。

## 验证

`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`。
⚠️ 本机 `fonts.googleapis.com` 不可达（2026-08-13 实测 `http=000`），`next/font` 拉 Inter 失败
导致 `pnpm build` 无法完成；若仍不通则如实记录、留给 CI，不冒充通过。
