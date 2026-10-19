# 模型锁定弹窗（对齐主站形态）

日期：2026-08-31 · 状态：已批（照 Nick 提供的主站截图）· 前置：`2026-08-28-new-user-model-gate-design.md`

## 目的

新用户点了 Rez1 以外的模型时弹的那张窗，要和主站保持一致。现状是复用了本项目的 `AllPlansModal`（1106 宽三档并排 + `UPGRADE FOR MORE` hero），与主站形态不同。

## 稿子来源

**主站真实实现**（2026-08-31 拉到最新代码后确认，最初一版是照截图目测的，已按源码校正）：

- 组件：`features/studio/components/recharge-popup.tsx` 的 `GameModelLockedPopup` = `PaywallBody` + `hero={null}` + `trigger='game_model_locked'`；
- 文案：`studio_popup_game_model_locked_body`；
- 主体：`features/studio/paywall/upgrade-section.tsx`（单档卡 + See all plans + CTA），色板 `paywall-design.ts` 的 `PAYWALL_C`；
- CTA 文案：`upgradeCtaCopy` —— 可享首期优惠打 `Upgrade - {price} first month`，否则 `Upgrade - {price}/mo`，**价格取月付原价** `monthly_price_cents`；
- 主站的 `hero={null}` 也有代价说明：没有大标题（标题是烘焙在 hero 图里的艺术字），关闭 × 由外壳补一枚真按钮。

主站色板与本项目既有的 `--upsell-*` 令牌是**同一批稿面色**：`planSheen` 的 `rgba(209,254,23)` = `--upsell-glow-creator: #d1fe17`，`planCreditsAccent: #9CE6F3` = `--upsell-perk-hi`，`planCreditsBg` = `--upsell-panel`，`overlay` = `--upsell-scrim`，`planBg: rgba(24,25,28)` = `--upsell-card`。故本项目不引入第二份字面色值，直接用既有令牌复刻。

## 目标形态（照截图）

640 宽深色弹窗，自上而下五段：

1. 右上角圆形关闭按钮（深色半透明底，无 hero 图）；
2. 单行说明文案：`Rez1 is free for your first game. Subscribe to unlock every other model.`；
3. **单档订阅卡**（`free` 的下一档 = Starter）：左侧积分面板（`13,200 credits` + 两行等价换算），右侧价格（`$12 per month`）+ 四行权益（积分 / 商用授权 / premium 模型 / 并发与队列）；
4. 居中 `See all plans` 文字链 → 开三档并排弹窗；
5. 全宽橙色 CTA。

## 实现口径

- `ModelLockModal`：640 恒暗面板（`--upsell-surface` + 0.5px `--upsell-line` 描边 + `--upsell-scrim` 遮罩）+ 右上关闭钮 + 说明行 + 单档卡 + `See all plans` + 橙键帽 CTA。
- `PlanCardPaywall`：**第三张档位卡**，恒暗横向双栏、月付口径（不出现划线原价 / `20% OFF` / billed annually——那些是三档窗的促销语汇）。与随主题翻的 `PlanCard`、三档窗的 `PlanCardDark` 并列，三者只共用 `plan-display.ts` 的数据映射，样式互不牵连（沿用 2026-08-12 spec 约束 2 的分工）。
- 样式集中在 `globals.css`：新增 `.upsell-card-paywall`（柠檬绿斜向光泽，**不分档位**——三档窗那三套是按档换光晕，语义不同）与 `.upsell-key-orange`（主站 `ctaFill` + `ctaShadow`），三个新令牌 `--upsell-cta-orange-from/to`、`--upsell-key-orange-edge`。
- `CreditModalGate` 路由：`source === 'modelLocked'` → `ModelLockModal`，且必须排在 `all_plans` 分流**之前**（free 在 `upsellVariant` 表里恒 `all_plans`，不先截住永远走不到这张窗）。曝光埋点 `variant` 报 `plan`，否则两种窗的曝光在下游混成一条。
- 文案：`upsell.descModelLocked` / `upsell.ctaPaywall` / `upsell.ctaPaywallIntro` / `plan.creditsPlain` / `plan.perMonth`，11 个语言同步。

### 一度抽过又回退的共享件

第一版把单卡主体抽成了 `UpsellPlanBody` 给两张弹窗共用；校正成恒暗形态后，两张窗的卡片、CTA、失败态全不同（正如 `PlanCard` vs `PlanCardDark` 的既有分工），共享件只剩一个使用者，已 revert——不留为单一使用者而生的间接层。

## 与主站的三处刻意差异

1. **CTA 行为**：主站存 checkout intent 后跳 `/studio/pricing`；本项目没有定价页路由，故直接走既有订阅流 `useSubscribeFlow` 下单。`See all plans` 同理——主站跳定价页，本项目开三档并排弹窗。
2. **首月价**：判据与主站 `upgradeCtaCopy` 一致（`intro_eligible && intro_price_cents > 0`）。⚠️ `lib/biz/types.ts` 那句「后端四份配置恒 0」**已过期**——dev 实测 `intro_eligible=true`、starter `intro_price_cents=960`，真机渲染的就是 `Upgrade - $9.60 first month`，与主站截图一致。
3. **权益四行文案**：主站按 `entitlements` 实际值出行（`planCardFeatureLabel`），本项目按档静态取 `plan.perks.<tier>.*`（既有口径，注释里写明并发数写在文案里）。故 Starter 卡的第二/三行措辞与主站截图不完全相同。

## 成功标准

1. 新用户点非 Rez1 → 弹 640 宽、无 hero、恒暗单档 Starter 卡的窗，说明行是 Rez1 那句，CTA 是 `Upgrade - $12/mo`。
2. 点 `See all plans` → 仍开三档并排 `AllPlansModal`。
3. CTA 走既有订阅流（`useSubscribeFlow`）；埋点 trigger 字面值 = 主站的 `game_model_locked`，两端同一漏斗可同表对比。
4. 其他三个触发源（insufficient / lowBalance / manual）弹窗行为**零变化**。
5. 套餐配置未就绪 / 目标档缺失时不出死窗：前者渲染失败态 + 重试，后者回落 `AllPlansModal`。

## 真机验证（2026-08-31，dev 后端 + 真实登录态）

`PORT=3100 pnpm dev` + Playwright，只用路由拦截把 `is_new_user` 改成 `true` 造锁定态，其余（套餐、模型列表、渲染、订阅流）全走真实链路：

| 路径 | 结果 |
|---|---|
| 下拉列出全部模型、不加锁标 | ✅ 13 个模型照常列出 |
| 点 Fable 5 / Opus 5 | ✅ `selectedModel` 仍是 Rez1，弹出模型锁定窗 |
| 说明行 / 卡片 / CTA | ✅ `Rez1 is free…` · STARTER $12 per month · `Upgrade - $9.60 first month` |
| 等价换算两行 | ✅ `≈ 338 Nano Banana Pro images` / `≈ 125 Seedance 2.0 videos`（首版取了展示顺序前两条，第二行错成 ChatGPT images，已修：`usageEquivalents` 支持 `keys`） |
| See all plans | ✅ 回落三档并排（三张 per month 卡） |
| 取消拦截（真实 `is_new_user=false`） | ✅ 不锁，切到 Fable 5 成功，无弹窗 |

### 一处曾被当成矛盾、查证后不成立的点

真机看到 dev 后端 `starter.entitlements.premium_models = false`（creator 才是 true），一度据此判断「用户升到 Starter 仍用不了非 Rez1 模型，会二次撞门」。**该结论错误，已撤回**：

- biz-api 明写 `premium_models` **仅展示、后端无强制**（`internal/types/types.go` 的字段注释 + `internal/service/subscription/catalog.go` 的类型注释）；后端真正强校验的只有 `topup_allowed` 与 `concurrent_jobs`。`min_tier` 只在 biz-api `/models` 列表上标注 `locked`，生成入口不校验。
- 对话模型列表走 koubou 的 `GET /models?backend=`，与 biz-api 那份带 `min_tier` 的资产生成模型目录是两套东西，那条链上没有 tier 校验。

所以订阅任意档后本弹窗的承诺可以兑现：前端锁看 `current_tier !== 'free'` 即解除，后端不再拦。错误的源头是本项目 `lib/biz/types.ts` 里「本期后端只强校验 topup_allowed 与 premium_models」这句过期注释，已在同一轮改正。

## 不做

- 不改门禁判据（上一轮 spec 已定）。
- 不迁移主站 `PaywallShell` 的 hero 图与 4 种 hero 分流（本弹窗无 hero）。
- 不替换其他三个触发源的弹窗（Nick 定案：只对 modelLocked 生效）。
