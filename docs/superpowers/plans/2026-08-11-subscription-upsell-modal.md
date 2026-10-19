# 实现计划：积分弹窗重做为订阅升档弹窗

- 日期：2026-08-11
- spec：[2026-08-11 订阅升档弹窗设计](../specs/2026-08-11-subscription-upsell-modal-design.md)
- 分支：`feat/subscription-upsell-modal`（worktree，基于 dev `4be0030`）

## 推进策略

按「**并存加新 → 原子切换 → 删旧**」：T1–T6 全程不改任何现有行为（旧 `InsufficientCreditsModal` / `TopupModal` 照旧工作），T7 一次性切路由，T8 删旧。任一任务提交后可独立评审（只给 spec + 该 commit 的 diff）。

## 先定的两个实现决策

**1. tier 先于开窗确定（避免弹窗种类闪动）**

free 要开的是**另一个弹窗**（all-plans + WELCOME BACK hero），若在弹窗内部拉 `plans` 再决定，会出现「先开单卡再跳 all-plans」的闪动。故：

- store 新增瞬态 `plansCache`；`openCreditModal(source, kind)` 是 async——先确保 `plans` 已缓存（有则直接用，无则 `await` 拉一次），再 `set` 打开态与 variant。
- 同一会话内二次触发即时开窗（走缓存）。
- 拉取失败 → 仍开触发式弹窗，但主体渲染失败态 + 重试（沿用 `topup.loadFailed` 形状），不静默吞掉。
- 代价：首次触发弹窗延迟一个请求往返。可接受，换掉视觉闪动。

**2. 低余额判定挂在 `refreshBalance` 的写入点**

`refreshBalance`（`actions.ts:1349`）是消耗后余额的**唯一漏斗**——三个生成漏斗（`runGen` 提交 / `pollGenTasks` 任务终态 / `run.finished`）加 15s 兜底 interval 全部汇进它。判定写在它的 `set({ credit })` 处，不在各 `generate*` action 里各撒一行。

- 判据用 `balance`（与账户条展示同源；`spendable` 会被在途 `held` 压低，提交瞬间就误判）。
- **`loadUserInfo` 不接判定**：那是冷启动/账户条首拉，触发条件是「上一次生成后」，冷启动弹窗不符合约束 2。

---

## T1 · 订阅接口层

**交付物**
- `src/lib/biz/types.ts`：`SubscriptionTier`（`'starter' | 'creator' | 'master'`）、`PlanEntitlements`、`SubscriptionPlan`、`SubscriptionPlansData`、`SubscribeRequest`、`SubscribeData`、`ChangePlanData`、`SubscriptionOrder`。字段严格按 Apifox 8391231，snake_case，**不加 camelCase 兜底**。
- `src/lib/biz/client.ts`：`getSubscriptionPlans` / `createSubscription` / `changeSubscription` / `getSubscriptionOrder`。
- `TopupOptions` 补 `topup_allowed: boolean`。

**关键点**
- `ChangePlanData.redirect_url` 标 optional 并注释「Waffo 无需重新授权时不下发，调用方必须兼容缺失」。
- `SubscriptionPlansData.usage_units` 是 `Record<string, number>`（JSON object 无序，展示顺序归前端）。

**验证**：`pnpm exec vitest run src/lib/biz/client.test.ts` —— 新增用例断言四个方法的 path / method / body / 裸 JSON 解包 / 非 2xx 转 `BizError`。

---

## T2 · 纯逻辑 + 单测（TDD，先写失败测试）

**交付物**
- `src/lib/subscription/plan-display.ts`
  - `TIER_ORDER = ['free', 'starter', 'creator', 'master']`；`upsellVariant(tier)` → `'all_plans' | 'plan' | 'topup'`；`nextTier(tier)`。
  - `yearlyOffPercent(plan)`：`round((1 - yearly_monthly / monthly) * 100)`；`monthly <= 0` / `yearly_monthly <= 0` / `yearly_monthly >= monthly` 一律返回 `null`（fail-closed，不展示负折扣）。
  - `usageEquivalents(creditsPerMonth, usageUnits, opts?)`：按固定顺序 `nano_image` / `gpt_image` / `seedance_video` / `game` 产出行；`seedance_video` 按 `SECONDS_PER_VIDEO_CLIP = 5` 折算成条数；`tripo_3d` 不出；算出 `< 1` 的类别丢行；`opts.limit` 截断（单卡弹窗传 2）。
  - `tierDisplayName(tier)`：`master → 'Max'`（展示层映射，不动后端枚举）。
  - `planCtaState(planTier, currentTier)` → `'upgrade' | 'current' | 'included'`。
- `src/lib/subscription/low-balance.ts`
  - `LOW_BALANCE_THRESHOLD = 20`（前端常量，后端无下发字段）。
  - `nextLowBalanceState(balance, locked)` → `{ locked, shouldOpen }`：`balance < 20 && !locked` → 弹并上锁；`balance < 20 && locked` → 不弹；`balance >= 20` → 解锁不弹。
- 同目录 `*.test.ts` 覆盖上述全部分支。

**验证**：`pnpm exec vitest run src/lib/subscription/`

---

## T3 · 设计令牌与素材

**交付物**
- `src/app/globals.css`：新增 `--color-cta-highlight` / `--color-on-cta-highlight`（all-plans 主推档亮黄 CTA），恒定不随主题翻（同 `--color-primary` 策略），在 `@theme` 与 `[data-theme="dark"]` 两处按语义登记。
- `public/figma/`：从 Figma 导出满箱宝箱（lowBalance hero，`8047:165129`）与吉祥物实验室（all-plans hero，`8372:178533`）。
- WordArt：现有 `.insufficient-wordart` 抽成通用 `.hero-wordart`（橙渐变 `background-clip` + 斜切），新增白描边变体 `.hero-wordart-outlined` 给 WELCOME BACK。**保持静态渲染，不加动效**（既有注释已记合成层坑）。

**关键点**：新增的类若带动画必须同步补进 `@media (prefers-reduced-motion: reduce)` 的禁用列表——本任务不新增动画，故只需确认无遗漏。

**验证**：`pnpm build` 通过；截图人工比对三张 hero。

---

## T4 · `PlanCard` 共用组件

**交付物**
- `src/components/ui/PlanCard.tsx`：入参 `{ plan, usageUnits, layout: 'wide' | 'column', ctaState, badge, onSubscribe }`。
  - `wide`：单卡弹窗用，左积分面板（`credits/mo.` + 等价行 ≤2 + Fixed amount chip）/ 右价格 + 权益 4 行。
  - `column`：all-plans 用，纵向（积分面板 → 价格 → CTA → 权益 4 行）。
  - 徽标：OFF 百分比（算出，`null` 则不渲染）+ `RECOMMENDED`（creator）/ `BEST VALUE`（master）静态。
  - `ctaState`：`current` → 文案 `Current plan` 禁用；`included` → `Included` 禁用；`upgrade` → 可点。
- `src/components/ui/PlanCard.test.tsx`：数据映射渲染（价格/积分/等价行/权益行）、`null` 折扣不渲染划线与徽标、三种 `ctaState` 的禁用与文案。

**验证**：`pnpm exec vitest run src/components/ui/PlanCard.test.tsx`

---

## T5 · 触发式弹窗 + 订阅支付流程

**交付物**
- `src/client/useSubscribeFlow.ts`：占位窗 → `subscribe`（free）/ `change`（已付费）→ 有 `redirect_url` 写入占位窗、**无则关掉占位窗直接进轮询** → `getSubscriptionOrder` 每 3s 轮询（`active` → 刷余额 + success Toast + 停留 1.5s 关窗；`closed`/`expired` → error Toast 回 idle；10min → 只停轮询回可重试态）。`phase: 'idle' | 'creating' | 'waiting' | 'active'`。
- `src/components/ui/CreditUpsellModal.tsx`：hero（按 source 选宝箱素材 + WordArt）+ 进度卡（资产类型图标/名称 + 余额；缺 `required_credits` 不渲染 `X/Y`、进度条、`N short`）+ 说明行 + 主体（`plan` 分支 → `PlanCard wide`；`topup` 分支 → 现有三档充值卡形态，复用 `useTopupFlow`）+ 文字链（`See all plans →` / `View all pricing options →`）+ 全宽 CTA。
- i18n 11 份 locale 补键。
- 组件测试：两种 source 的 hero 素材、`plan`/`topup` 两分支、`redirect_url` 缺失时不开新窗直接轮询、`topup_allowed=false` 时充值 CTA 禁用。

**关键点**：本任务**不接线**——组件加进仓库但 `Workspace` 仍渲染旧弹窗，可单独评审。

**验证**：`pnpm exec vitest run src/components/ui/CreditUpsellModal.test.tsx src/client/`

---

## T6 · 完整订阅弹窗

**交付物**
- `src/components/ui/AllPlansModal.tsx`：WELCOME BACK hero + 说明行 + 三张 `PlanCard column`；`ctaState` 由 `planCtaState(plan.tier, current_tier)` 决定；creator 卡 CTA 走亮黄令牌。
- 组件测试：Creator 用户看到 `Included` / `Current plan` / `Upgrade` 三态各一；free 用户三张全 `upgrade`；`plans` 为空 → 失败态 + 重试。

**关键点**：同样不接线。`master` 用户不给入口这件事在 T7 的路由里体现，本组件不做 tier 门禁。

**验证**：`pnpm exec vitest run src/components/ui/AllPlansModal.test.tsx`

---

## T7 · 原子切换（唯一改变现有行为的任务）

**交付物**
- `src/store/types.ts`
  - `CreditModalSource` 改 `'insufficient' | 'lowBalance'`。
  - 新增 `creditModalKind: AssetKind | null`（进度卡的资产类型；agent 侧触发为 `null`）。
  - 新增 `allPlansOpen: boolean`（瞬态）。
  - 新增 `plansCache: SubscriptionPlansData | null`（瞬态）。
  - 新增 `lowBalanceLocked: boolean`（**持久化**）。
- `src/store/index.ts`：`partializeAppState` 加 `lowBalanceLocked`；`ingestKoubou` 的 `credit.insufficient` 分支改调 `openCreditModal('insufficient', null)`。
- `src/store/actions.ts`
  - 新增 async `openCreditModal(source, kind)`：确保 `plansCache` → 按 `upsellVariant(current_tier)` 决定开 `CreditUpsellModal` 还是 `AllPlansModal`。
  - `refreshBalance` 的 `set({ credit })` 处接 `nextLowBalanceState`，命中则 `void openCreditModal('lowBalance', null)`。
  - 四处 `isCreditError(e) → set({ creditModalOpen: 'insufficient' })` 改调 `openCreditModal('insufficient', kind)`，画布生成链路带上资产类型。
- `src/components/workspace/Workspace.tsx`：按 variant 渲染 `CreditUpsellModal` / `AllPlansModal` / `TopupModal`（后者只由 Max 弹窗的 view-all 打开）。
- `src/components/preview/UserInfo.tsx`：**去掉积分条 onClick**（连带 `role`/`title`/hover 态收敛为纯展示）。
- 埋点 `trigger` 取值改 `generate` | `low_balance`，新增 `subscribe_click`。
- store 测试：四档路由、生成完成后低余额触发一次且再生成不弹、余额回升解锁后再降重弹、登出/切账号清锁。

**验证**：`pnpm test` 全绿 + 本地 `pnpm dev` 走四档实测（free / starter / creator / master 各触发一次）。

---

## T8 · 删旧

**交付物**
- 删 `src/components/ui/InsufficientCreditsModal.tsx` 与其测试（形态已并入 `CreditUpsellModal` 的 topup 分支）。
- 清理 i18n 死键（`insufficient.*` 里不再引用的）与 `manual` trigger 相关注释。
- `TopupModal` 头部注释更新：说明唯一可达路径已变。

**验证**：`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 四连；`grep -rn "InsufficientCreditsModal\|'manual'"` 无残留。

---

## 落地与计划的差异（2026-08-11 终审回写）

以计划为索引去找代码会找不到的几处：

- **T7 的 `openCreditModal` action 没有做**。`plansCache` 落地了（store 瞬态），但「先 await 配置再决定开哪个弹窗」
  改由 `src/components/ui/CreditModalGate.tsx` + `src/client/useSubscriptionPlans.ts` 承担——两个文件本计划都未提及。
  触发仍是 `guard`/`guardRethrow` 内联 `set({ creditModalOpen })`，资产类型走 `runGen` catch 旁路。这么改是为了
  让同步的 `guard()` 不必变成 async（代价会扩散到所有生成路径）。
- **T3 说 `--color-cta-highlight` 要在 `@theme` 与 `[data-theme="dark"]` 两处登记——计划写错了**。恒定色不进 dark
  覆盖块（同 `--color-primary` 策略），实际只在 `:root`。代码是对的。
- **T3 承诺导出两张 hero 素材——未导出**，见终审记录的「已知欠账」。
- **T5 承诺的 `topup_allowed=false` 用例——缺失**，记为 Minor M7。

终审的完整条目与处置见 [终审记录](2026-08-11-subscription-upsell-modal-review.md)。

## 合并与收尾

1. `--no-ff` merge 回 dev，合并结果上重跑四连验证。
2. 跑 `/walkthrough` 生成本回合走读并更新 `docs/FEATURE-MAP.md`。
3. 向后端提 `required_credits` + `asset_kind` 字段需求（补满进度卡，见 spec 约束 9）。

## 评审安排

按既有工作方式，每个任务提交后应派干净上下文的子代理基于 commit 范围独立评审（只给 spec + diff）。本会话配置默认不主动派子代理，**每个任务提交后我会问你是否要跑这一轮评审**。
