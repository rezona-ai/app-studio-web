# 积分弹窗重做为订阅升档弹窗

- 日期：2026-08-11
- 状态：已实现、已终审（终审条目与处置见 [终审记录](../plans/2026-08-11-subscription-upsell-modal-review.md)）
- 影响范围：`src/components/ui/`（充值/订阅弹窗）、`src/lib/biz/`（订阅接口层）、`src/client/`（订阅支付流程 hook）、`src/store/`（弹窗打开态与低余额频控）、`src/components/preview/UserInfo.tsx`（去掉手动入口）、`src/i18n/locales/*`
- 前序 spec：
  - [2026-07-05 积分不足模态分流](2026-07-05-credit-insufficient-modal-design.md)
  - [2026-07-13 充值弹窗](2026-07-13-topup-modal.md)
  - [2026-07-14 积分不足弹窗](2026-07-14-insufficient-credits-modal.md)
  - [2026-07-20 支付成功自动关窗](2026-07-20-topup-paid-autoclose.md)
  - [2026-07-28 credit 动态刷新](2026-07-28-credit-dynamic-refresh-design.md)
- 后端契约来源：rezona-lab `docs/superpowers/specs/2026-07-28-taluna-subscription-waffo-design.md`；字段以 Apifox 项目 8391231（taluna-biz-api）`Subscription` / `Credits` 目录为准
- 设计稿（Figma `Rezona Lab`）：
  - Starter→Creator 单卡：`5952:84375`
  - Creator→Max 单卡：`8047:165320`
  - Max→积分充值：`8047:167015`
  - 低余额 hero（ALMOST OUT OF CREDITS!）：`8047:165129`
  - 完整订阅弹窗（三档并排 + WELCOME BACK hero）：`8372:178533`

## 目的

后端已上线三档订阅（`starter` / `creator` / `master`），并把**充值改为付费会员专属**（`GET /credits/topup/options` 下发 `topup_allowed`，非会员建单必被拒）。前端目前零订阅感知，积分不足时一律弹充值弹窗——对 free 用户是一条必然失败的死路，对 Starter / Creator 用户也没有把「升档」这个真正的转化路径摆出来。

本次把积分类弹窗从「充值」重做为「按当前档位升档」：低档触发展示高一级方案，Max 触发才展示积分充值。

## 约束（盘问结论）

以下每条都是已拍板的决策，实现不得偏离：

1. **弹窗种类只由当前 tier 决定，入口只决定埋点 trigger。**
2. ~~**触发源两种，手动入口整个去掉**~~：`insufficient`（生成被积分不足拒绝）与 `lowBalance`（上一次生成完成后余额 < 20）。~~预览区积分条不再可点，只作展示。~~
   > ⚠️ **本条已于 2026-08-12 被推翻**：手动入口加回来了，且它的分流与被动触发不同（非 Max → all-plans，Max → 完整充值弹窗）。见 [2026-08-12 手动入口回归](2026-08-12-manual-upsell-entry.md)。本条其余部分（两种被动触发源的定义）仍有效。
3. **lowBalance 频控**：每次生成完成后查最新余额，命中即弹；弹过上锁，余额回升到 ≥ 20 才重置。锁**持久化**，刷新页面不重弹。阈值 20 为前端常量（后端无下发字段）。
4. **free 用户直接开完整订阅弹窗**（三档并排），不走单卡。
5. **`master`(Max) 用户触发展示积分充值弹窗**（现有三档充值卡形态）。
6. **计费周期固定年付**：`billing_period` 恒 `yearly`；卡上划线价取 `monthly_price_cents`、大号价取 `yearly_monthly_price_cents`，OFF 徽标百分比由两者算出，**不写死设计稿上的 20% / 23%**。
7. **完整订阅弹窗只允许升档**：当前档 CTA 置「Current plan」禁用，低于当前档的卡 CTA 置「Included」禁用。降档 / 退订不在本弹窗内做。
8. **hero 素材三张，all-plans 弹窗恒用 WELCOME BACK**；单卡与积分弹窗按触发源选宝箱 hero（`insufficient` → INSUFFICIENT CREDITS…，`lowBalance` → ALMOST OUT OF CREDITS!）。
9. **进度卡只做能拿到的部分**：显示资产类型图标 + 名称 + 当前余额；`X / Y`、进度条、`N short` 因后端不下发「所需积分」而不渲染。同时向后端提 `required_credits` + `asset_kind` 需求，字段到位再补满。

## 成功标准

1. free / Starter / Creator / Max 四种档位分别触发，弹出的弹窗与上表一致；`GET /subscription/plans` 只请求一次即可渲染（`current_tier` 与 `plans` 同源下发）。
2. Starter 用户点 CTA → `POST /subscription/change`（`tier=creator, billing_period=yearly`）；free 用户点 CTA → `POST /subscription/subscribe`。两者返回 `redirect_url` 时在用户手势栈内开出的占位窗里跳收银台，支付完成经 `GET /subscription/order` 轮询到 `status=active` 后刷余额、Toast、关窗。
3. 余额从 ≥20 掉到 <20 的那次生成后弹一次；此后再生成不再弹；刷新页面不再弹；充值/续订让余额回到 ≥20 后再掉下去会重新弹一次。
4. 卡片上的价格、积分、OFF 百分比、权益行全部来自 `plans` 响应，改后端配置后前端数字随之变化，无硬编码金额。
5. `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿。

## 触发与路由

```
生成被积分不足拒绝(PGC 错误 / koubou credit.insufficient)  ──▶ source='insufficient'
生成完成后余额 < 20 且未上锁                                ──▶ source='lowBalance'
                                    │
                                    ▼
                       plans.current_tier
        ┌───────────────┬───────────────┬───────────────┐
      free           starter         creator         master
        │               │               │               │
        ▼               ▼               ▼               ▼
  AllPlansModal   单卡(Creator)    单卡(Max)      积分充值弹窗
  (WELCOME BACK)  (宝箱 hero)      (宝箱 hero)     (宝箱 hero)
                        │               │               │
                  See all plans ────────┘        View all pricing
                        │                          options
                        ▼                              ▼
                  AllPlansModal                    TopupModal
                  (WELCOME BACK)                   (现有完整充值弹窗，不改)
```

- `master` 用户不给 all-plans 入口（三档全不可升，进去无事可做）。
- `TopupModal` 保留原样，只改「唯一可达路径变成 Max 弹窗的 view-all」这一点；手动入口去掉后它不再由积分条打开。

## 接口契约

全部经现有 `src/lib/biz/client.ts`（裸 JSON、`credentials:'include'`、错误归一为 `BizError`）扩展，路径挂在 `/api/biz` 代理下。

| 方法 | 路径 | 本次用途 |
|---|---|---|
| `GET` | `/subscription/plans` | 一次拿全：`current_tier`、`plans[]`、`usage_units`、`intro_eligible`。**未登录也可访问**，匿名按 free 返回 |
| `POST` | `/subscription/subscribe` | free → 付费首次订阅。body `{ tier, billing_period:'yearly', idempotency_key }`，返回 `{ id, redirect_url, status }` |
| `POST` | `/subscription/change` | 已付费用户升档。同 body，返回 `{ id, direction, status, redirect_url? }`——**`redirect_url` 可能缺失**（无需重新授权，Waffo 直接扣差价） |
| `GET` | `/subscription/order?id=` | 支付轮询，判据 `status`（`pending/active/past_due/...`） |
| `GET` | `/credits/topup/options` | Max 分支复用现有调用；新增字段 `topup_allowed` **参与判定**：`=== false` 时禁用充值 CTA 并给说明、不静默下单（Max 恒 true，故这是防御性分支）。原稿此处写「只读不判」与下文「降级与边界」自相矛盾，以后者为准 |

> 实现注记（2026-08-11 终审回写）：`plans` 的拉取落在 `src/client/useSubscriptionPlans.ts`，结果缓存进 store
> 瞬态 `plansCache`；弹窗路由归 `src/components/ui/CreditModalGate.tsx`。**没有** `openCreditModal` action——
> 触发仍由 `guard` 内联置 `creditModalOpen`，资产类型经 `runGen` 的 catch 旁路写入，这样 `guard` 保持同步。

不使用 `GET /subscription/me`：`plans` 已带 `current_tier`，多一个请求只为拿分桶明细，本期不展示。
不使用 `GET /subscription/change/preview`：设计稿无差价展示层。

`plans[]` 单项字段（Apifox 已文档化，snake_case，**不加 camelCase 兜底**）：

```
tier                        starter | creator | master
monthly_price_cents         月付价(分)          → 卡上划线价
yearly_price_cents          年付整年价(分)      → 本期不展示
yearly_monthly_price_cents  年付折后月单价(分)  → 卡上大号价
credits_per_month           每期积分            → credits/mo. 与权益首行
intro_price_cents           首期优惠价(分)；0=无 → 见「设计稿与后端的差异」
entitlements                { watermark_free, commercial_license, premium_models,
                              concurrent_jobs, queue_priority, topup_allowed }
```

## 数据映射

### 价格与折扣徽标

- 划线价 `monthly_price_cents`，大号价 `yearly_monthly_price_cents`，后缀固定文案 `per month, billed annually`。
- OFF 百分比 = `round((1 - yearly_monthly / monthly) * 100)`。按当前后端配置三档同为 **17%**（年付省 2 个月）；设计稿上的 20% / 23% 是旧定价时代的产物，不照抄。
- `discounted`/`yearly_monthly` 为 0 或大于月付价时不渲染徽标与划线（fail-closed，不展示负折扣）。

### 积分与等价行

- `credits/mo.` 直接取 `credits_per_month`，`toLocaleString('en-US')`。
- 等价行 = `credits_per_month ÷ usage_units[key]`，展示顺序固定 `nano_image` / `gpt_image` / `seedance_video` / `game`，`tripo_3d` 有下发但**不展示**（沿用主站口径）。
- `seedance_video` 单位是**秒**，按单条 5 秒折算：`floor(credits / (unit × 5))`。该假定只在展示层，接口口径不变。
- 算出不足 1 个单位的类别整行不渲染，故各档行数 0~4 不定。**单卡弹窗取前 2 行**（设计稿两行），all-plans 弹窗取全部。
- 行前缀一律 `≈`：这套单价仅供展示、不参与实际计费，与真实扣费存在偏差。

### 「Fixed amount of N credits/mo」chip

语义是「每期固定额度、当期有效不结转」。数值与上方 `credits/mo.` **同源**取 `credits_per_month`——设计稿上写 6,000 与 8,000 两个不同数是稿内笔误，不复刻。

### 权益 4 行

不是纯数据驱动：设计稿 Max 卡第二行是「Everything in Creator」而非某个 entitlement 值。故按 tier 取静态 i18n 模板，只把 `credits_per_month` 注入首行：

| 行 | starter | creator | master |
|---|---|---|---|
| 1 | `{n} Credits / month` | 同 | 同 |
| 2 | Watermarked-free export | Full commercial license | Everything in Creator |
| 3 | Personal commercial use | All premium models · HD video, 3D | 12 parallel runs · top priority |
| 4 | 2 Parallel generations | 5 parallel runs · priority queue | Maximum asset storage |

第 3/4 行里的并发数（2 / 5 / 12）与设计稿一致且与后端 `entitlements.concurrent_jobs` 当前配置一致；写在 i18n 文案里而非从 entitlements 拼装，理由是句式各档不同、拼装会得到读不通的英文。后端调并发数时需同步改文案，在 i18n 处留注释指路。

### 徽标与主推档

- `RECOMMENDED`（creator）/ `BEST VALUE`（master）按 tier 静态挂，与后端无关。
- all-plans 弹窗里 creator 卡的亮黄 CTA 是「主推档」视觉，固定给 creator。亮黄不在现有令牌里，新增 `--color-cta-highlight` + `--color-on-cta-highlight`（恒定不随主题翻，同 `--color-primary` 策略），**不硬编码色值**。

### 进度卡

- 资产类型来源：画布生成链路已知（`image/video/audio/3d/game`），在打开弹窗时随 source 一并存入 store。
- agent 侧 `credit.insufficient` 不带类型 → 整卡退化为「当前余额」一行。
- `X / Y`、进度条、`N short` 一律不渲染（缺 `required_credits`）。

## UI 结构

三个弹窗共享一套壳（`modal-backdrop` + `modal-pop` + `useRequestClose` 退场 + Escape 关闭 + `z-40`），复用既有令牌与动效类，不引入一次性 keyframes。

**触发式弹窗**（单卡 / 积分两种主体）：
```
hero(328px, 宝箱 + WordArt, 按 source 选素材)
进度卡(资产类型 + 余额)
说明行
主体：PlanCard(单档) | 三档充值卡(现有 InsufficientCreditsModal 形态)
文字链：See all plans → | View all pricing options →
全宽 CTA(品牌橙胶囊)
```

**完整订阅弹窗**：
```
hero(WELCOME BACK, 吉祥物实验室大图)
说明行
三张 PlanCard 并排(各自带 CTA)
```

- `PlanCard` 抽成共用组件：单卡版为横向双栏（左积分面板 / 右价格 + 权益），all-plans 版为纵向（积分面板 → 价格 → CTA → 权益）。同一份数据映射，两套排布。
- 新增素材需从 Figma 导出到 `public/figma/`：满箱宝箱（lowBalance hero）、吉祥物实验室（all-plans hero）。WordArt 沿用现有 `.insufficient-wordart`（Sekuya + 橙渐变 `background-clip` + 斜切）再加一条白描边变体给 WELCOME BACK；装饰性艺术字**不做 i18n**。
- 图标一律 `FigIcon`，`check` / `sparkle` / `arrowRight` / `close` 均已在册。

## 支付闭环

沿用 `useTopupFlow` 已验证的形状，新开 `useSubscribeFlow`（不与充值混在一个 hook 里——判据与终态不同）：

1. 用户手势同步栈内先 `window.open('', '_blank')` 开占位窗（防弹窗拦截）。
2. `subscribe` / `change` 建单：free 走 `subscribe`，其余走 `change`。
3. 有 `redirect_url` → 写入占位窗；**无 `redirect_url`**（change 直接生效）→ 关掉占位窗，直接进轮询。
4. `GET /subscription/order?id=` 每 3s 轮询，判据是 **`status='active'` 且 `tier` 已切到目标档**——升档改的是同一条订阅行，授权与扣款期间它一直是 `active`，只看 `status` 会在支付完成前误报成功（实现期发现，2026-08-11 加严；首次订阅走同一判据，不需分支）。命中后刷 `loadUserInfo()` + success Toast + 停留 1.5s 后自动关窗；`status` 落 `closed`/`expired` → error Toast 回 idle；超过 10min → 只停轮询回可重试态（到账由 webhook 保证）。
5. 弹窗关闭随组件卸载清理计时器。

## 降级与边界

- `plans` 拉取失败 → 弹窗内失败态 + 重试按钮（同现有 `topup.loadFailed`）。
- `current_tier` 是 `master` 但 `topup_allowed=false`（理论不出现）→ 积分卡区域给不可充值文案，CTA 禁用，不静默下单。
- `plans` 里缺目标档位（配置异常）→ 该弹窗回落 all-plans；all-plans 也为空 → 失败态。
- 未登录（匿名按 free 返回）→ 点 CTA 时后端 401，走既有 `authRequired` 分流去 sign-in。
- 低余额锁与 `currentProjectId` 无关，按账号维度存（余额是账号级的）。

## 埋点

沿用现有事件名与 `trigger` 维度，`trigger` 取值扩为 `generate` | `low_balance`（原 `manual` 随手动入口一并废弃）：

- `out_of_credits_show`：`{ trigger, tier, variant: 'plan' | 'topup' | 'all_plans' }`
- `out_of_credits_recharge_click`：Max 积分分支保留原语义
- 新增 `subscribe_click`：`{ trigger, tier, target_tier, billing_period, from: 'upsell' | 'all_plans' }`

## 测试要求

纯逻辑同目录 TDD，先写失败测试：

- `src/lib/subscription/plan-display.test.ts`：下一档推导（free→all-plans / starter→creator / creator→master / master→topup）、OFF 百分比取整与 fail-closed、等价行换算（含视频 5 秒折算、不足 1 单位丢行、`tripo_3d` 不展示）。
- `src/lib/subscription/low-balance.test.ts`：阈值判定 + 上锁/解锁状态机（<20 弹一次、再降不弹、回升 ≥20 解锁、再降重弹）。
- `src/store/*.test.ts`：弹窗打开态分流、生成完成后触发低余额检查、切账号/登出清锁。
- 组件测试：三种档位渲染出的弹窗种类、当前档/低档 CTA 禁用、`redirect_url` 缺失时不开新窗直接轮询。

## 本期不做

- 降档、退订、挽留、宽限期横幅、账单页、支付方式管理（均有后端接口，属会员管理页范畴）。
- 月/年切换。
- `intro_price_cents` 首期优惠展示：后端当前四份配置全为 0，`plans` 恒下发 0，设计稿上的「Upgrade - $2.99 first month」无数据可依。实现上留分支——`intro_price_cents > 0` 时 CTA 换首期价文案，否则显示常规价，这样后端 opt-in 打开即生效，前端不用再改。
- 进度卡的 `X / Y` / 进度条 / `N short`（缺后端字段，见约束 9）。
- 欢迎礼包弹窗（`/welcome-pack`）。

## 设计稿与后端的差异（实现按后端，不按稿）

| 稿上 | 实际 | 处置 |
|---|---|---|
| $19→$14 / $39→$29 等金额 | 后端 $12/$49/$99 月付、$10/$40.83/$82.50 年付月单价 | 全部数据驱动 |
| 20% OFF / 23% OFF | 三档同为 17% | 由价格算出 |
| Upgrade - $2.99 first month | `intro_price_cents` 恒 0 | 回落常规价文案，留 opt-in 分支 |
| 3D model 20 / 120 · 100 short | 无 `required_credits` 字段 | 只渲染类型 + 余额 |
| Fixed amount 与上方积分数不一致 | — | 同源取 `credits_per_month` |
| 稿内 tier 名 MAX | 后端枚举 `master`（后端文档产品名 Studio） | 前端展示层映射 `master → Max`，不改后端取值 |
