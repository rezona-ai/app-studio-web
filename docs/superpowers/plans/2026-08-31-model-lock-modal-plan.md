# 实现计划：模型锁定弹窗

设计稿：`docs/superpowers/specs/2026-08-31-model-lock-modal-design.md`

## T1 · 抽出共享单卡主体 `UpsellPlanBody`

`src/components/ui/UpsellPlanBody.tsx`：把 `CreditUpsellModal` 里的 `PlanBody`（`PlanCard` + `See all plans` + 全宽 CTA + `useSubscribeFlow`）原样搬出，props 为 `{ plans, plan, source, requestClose, onSeeAllPlans }`。`CreditUpsellModal` 改为引用它，删除本地副本。

验收：`CreditUpsellModal.test.tsx` 全绿（行为零变化），无新增快照差异。

## T2 · 文案

`upsell.descModelLocked` 加进 11 个 locale：en 用截图原句，其余语言照既有 `upsell.*` 的翻译风格给出对应译文。

## T3 · `ModelLockModal`

`src/components/ui/ModelLockModal.tsx`：640 壳（`modal-pop` + `rounded-[24px]` + `--color-pop`）+ 右上圆形关闭钮 + 说明行 + `UpsellPlanBody`；`plans == null` 渲染失败态 + 重试（复用 `CreditUpsellModal` 的 `PlansFallback` 形态，一并抽出或就地复刻最小版）。Esc / 点遮罩关闭、`useRequestClose` 退场，与既有弹窗同参。

测试 `ModelLockModal.test.tsx`：说明行文案、单卡是 Starter、`See all plans` 回调、CTA 触发订阅流、无 hero（断言不渲染 hero 元素）。

## T4 · Gate 路由

`CreditModalGate`：`source === 'modelLocked'` 且 `plans.current_tier === 'free'` 且目标档存在 → `ModelLockModal`；否则回落既有分流（保住「不出死窗」）。曝光埋点沿用现有 `out_of_credits_show`，`variant` 取 `plan`（单卡）。

测试补进 `CreditModalGate.test.tsx`：modelLocked → 渲染新弹窗；其他三个触发源不受影响；目标档缺失 → 回落三档并排。

## 验证

`pnpm exec vitest run`（相关文件）→ `pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` 全量 → `pnpm build`。
