# 手动入口回归：积分条可点，按档位分流到 all-plans / 充值弹窗

- 日期：2026-08-12
- 状态：待实现
- 影响范围：`src/components/preview/UserInfo.tsx`（入口）、`src/components/ui/CreditModalGate.tsx`（路由）、`src/components/ui/TopupModal.tsx`（埋点维度）、`src/store/`（弹窗态 + topup 触发源）、`src/lib/subscription/plan-display.ts`（trigger 维度）、`src/i18n/locales/*`
- 前序 spec：
  - [2026-08-11 积分弹窗重做为订阅升档弹窗](2026-08-11-subscription-upsell-modal-design.md)——其约束 2「手动入口整个去掉」由本 spec **推翻**
  - [2026-08-12 完整订阅弹窗改版](2026-08-12-all-plans-modal-redesign.md)
- 设计稿：充值弹窗 `6180:109915`（= 现有 `TopupModal`：余额卡 + 首充券横幅 + 五档 + Customize + 结算条，已实现，本次不改视觉）

## 目的

2026-08-11 那轮把手动入口整个去掉，理由是「弹窗种类只由 tier 决定，入口只决定埋点」。实际结果是：用户想主动看价格 / 充值时**没有任何入口**，只能等积分不足被动弹窗。本次加回来，并且明确它的分流与被动触发**不同**：

- 手动点击是「我想看方案」，不是「我这次做不成」——低档用户不该只看到高一级那一张单卡，要直接摆出全部档位。
- 只有 Max（`master`）没有可升的档，手动点击对他们唯一有意义的动作是充值 → 走 `6180:109915` 的完整充值弹窗（含自定义金额档），而不是升购弹窗里的三档充值卡。

## 约束（盘问结论）

1. **入口位置照旧**：预览区账户条的积分块整块可点（闪电 + 数字 + 单位），恢复到删除前的形态与样式，不新增别处入口。
2. **手动分流只看是不是 Max**：
   - `free` / `starter` / `creator` → **AllPlansModal**（2026-08-12 改版后的三档并排）
   - `master` → **TopupModal**（`6180:109915`）

   与被动触发的路由**不同**（被动下 starter/creator 走高一级单卡、master 走升购弹窗的三档充值卡）。两套路由并存，被动那套一行不改。
3. **档位只能来自 `plans.current_tier`**：`CurrentUser` 无档位字段，故手动点击必须先拿到 `plans` 才能决定开哪个弹窗。
4. **等待期给明确反馈**：首次点击（`plansCache` 为空）积分块进 loading——禁用 + 转圈，拿到 `plans` 再开对应弹窗；**不先开壳再换脸**（否则 master 会看到 all-plans 一闪）。之后走缓存瞬开。
5. **埋点复用现有事件**：`out_of_credits_show` / `subscribe_click` / `out_of_credits_recharge_click` 的 `trigger` 维度加回 `manual`，`variant` 继续区分 `all_plans` / `topup`；不新增事件名——三个入口的转化漏斗要能在同一张表里对比。
6. 低余额频控不受影响：手动开窗时 `refreshBalance` 的 `busy` 判定本就让 `lowBalance` 不抢窗；手动开窗**不动**低余额锁。

## 成功标准

1. free / starter / creator 点积分块 → all-plans；master 点 → `6180:109915` 充值弹窗。四档各验一次。
2. 被动触发（`insufficient` / `lowBalance`）路由与改动前**逐档一致**：starter → Creator 单卡、creator → Max 单卡、master → 三档充值卡、free → all-plans。
3. 首次点击（无缓存）积分块进 loading 且不可重复点；`plans` 到位后开窗、loading 解除；再次点击瞬开。
4. `plans` 拉取失败 → 与被动触发同款失败态 + 重试，积分块不会永久卡在 loading。
5. 埋点：三种 trigger（`generate` / `low_balance` / `manual`）在 `out_of_credits_show` 上可区分；manual + master 报 `variant='topup'`，manual + 其余报 `variant='all_plans'`；`TopupModal` 的充值点击带真实来源而非恒 `generate`。
6. `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿。

## 实现要点

- `creditModalOpen` 取值扩为 `'insufficient' | 'lowBalance' | 'manual' | false`；`UpsellTrigger` 同步扩。
- `triggerDimension('manual') → 'manual'`。
- `CreditModalGate`：`source === 'manual'` 时
  - `current_tier === 'master'` → 关自身 + `setTopupModalOpen(true, 'manual')`（复用顶档「View all pricing options」已验证的切换路径）
  - 其余 → `AllPlansModal`
- `TopupModal` 的 `trigger` 由 store 的 `topupTrigger` 决定（`setTopupModalOpen(open, trigger)` 写入），不再恒 `generate`。
- 积分块 loading 判据 `creditModalOpen === 'manual' && plansCache == null` 由 store 派生，组件内不另开一份 state。

## 测试要求

- `src/lib/subscription/plan-display.test.ts`：`triggerDimension` 三种取值。
- `src/components/ui/CreditModalGate.test.tsx`：manual × 四档 → 弹窗种类；被动触发路由回归不变；manual + master 置 `topupModalOpen` 且不渲染升购弹窗。
- `src/components/preview/UserInfo.test.tsx`：点击写入 `creditModalOpen='manual'`；`plansCache` 为空时禁用并有 loading 标记，缓存命中时不禁用。
- `src/components/ui/TopupModal.test.tsx`：充值点击埋点带 store 的 `topupTrigger`。

## 本期不做

- 会员管理 / 降档 / 退订入口（仍走主站）。
- 手动入口的其他落点（Composer、画布工具条等）。
- 充值弹窗视觉改动（`6180:109915` 已实现）。
