# 实现计划：手动入口回归

- spec：[2026-08-12 手动入口回归](../specs/2026-08-12-manual-upsell-entry.md)
- 分支：`feat/manual-upsell-entry`（基于 `feat/all-plans-modal-redesign`，会话被移回 `.claude/worktrees/feat+subscription-upsell-modal` 后在此续做）
- 推进方式：先把「多一种 source」贯通（类型 + 维度 + store），再接入口与路由，最后修埋点来源

## 任务 1：`manual` 这条取值贯通类型与埋点维度（先测后码）

- `creditModalOpen` / `UpsellTrigger` 扩到 `'manual'`；`triggerDimension('manual') → 'manual'`。
- store 增加 `topupTrigger`，由 `setTopupModalOpen(open, trigger)` 写入，关窗时复位。
- 此时无人产出 `manual`，行为不变。
- 验证：`pnpm exec vitest run src/lib/subscription/ src/store/`

## 任务 2：`CreditModalGate` 认 manual 分流（先测后码）

- `source === 'manual'`：`master` → 关自身 + 开 TopupModal（带 `'manual'`）；其余 → AllPlansModal。
- 被动触发路由**一行不改**，测试里同时锁住回归。
- 验证：`pnpm exec vitest run src/components/ui/CreditModalGate.test.tsx`

## 任务 3：积分块恢复可点 + loading 态（先测后码）

- `UserInfo` 恢复成删除前的 button 形态（样式照旧），点击 `setCreditModalOpen('manual')`。
- loading 判据 `creditModalOpen === 'manual' && plansCache == null`：禁用 + 转圈，防重复点。
- 验证：`pnpm exec vitest run src/components/preview/UserInfo.test.tsx`

## 任务 4：`TopupModal` 埋点来源改成真实值

- `trigger` 从恒 `'generate'` 改为读 store 的 `topupTrigger`；注释同步（现有注释写着「手动入口已废」，本轮推翻）。
- 验证：`pnpm exec vitest run src/components/ui/TopupModal.test.tsx`

## 任务 5：回归与终审

- 四档 × 三种 trigger 手动走查（dev 起本地 + 浏览器实截）。
- 全量：`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build`，贴完整输出与退出码。
- 前序 spec（2026-08-11）的约束 2 已被推翻，在那份 spec 上留一行指向本 spec，避免后来者按旧口径改回去。

## 回滚

改动集中在 gate 路由与 UserInfo 入口；回滚任务 2、3 两个提交即回到「无手动入口」的状态，被动触发链路不受影响。
