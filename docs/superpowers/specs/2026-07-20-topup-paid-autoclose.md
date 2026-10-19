# 充值成功态 + 弹窗自动关闭

日期:2026-07-20 ｜ 来源:Meegle Bug 13602050([recharge] 充值完成后页面不自动跳转,弹窗消失)

## 现状

`useTopupFlow` 支付轮询到 `paid_at` 非空后:刷余额 + 发全局 success Toast + phase 回 `idle`。
两个充值弹窗(TopupModal / InsufficientCreditsModal)停留在原地,CTA 恢复为 "Recharge Now",
用户支付完回到页面看不到明确的成功落点,弹窗也不会收起。

## 目标行为

支付确认到账后:

1. 弹窗内 CTA 切换为「充值成功」态(新增 phase `paid`,CTA 禁用防重复下单);
2. 保留现有 success Toast(弹窗关闭后反馈仍在);
3. 停留 1.5s 后自动调用 `requestClose()` 播退场动画关闭弹窗。

## 方案

- `useTopupFlow`:`TopupPhase` 增加 `'paid'`;轮询 paid 分支 `setPhase('paid')`(原为回 `idle`),
  新增 effect:phase 进入 `paid` 后 `setTimeout(requestClose, 1500)`,卸载清理。
  自动关闭放在共享 hook 内,两个弹窗行为天然一致。
- 两弹窗 CTA:`phase === 'paid'` 时展示新 i18n 文案 `topup.paid`(短句「充值成功」),
  沿用 `phase !== 'idle'` 的禁用逻辑。
- i18n:新增 `topup.paid`,11 语言全量补齐(en 为单一真相源)。

## 不做

- 不改「积分不够」触发场景的后续跳转/重试生成——到账后余额已刷新,用户关弹窗即回原页面继续,
  自动重放生成请求超出本 bug 范围(YAGNI)。
- 不改超时/失败分支行为。

## 验证

- `pnpm exec vitest run src/components/ui/TopupModal.test.tsx src/components/ui/InsufficientCreditsModal.test.tsx`
- `pnpm exec tsc --noEmit` / `pnpm lint`
