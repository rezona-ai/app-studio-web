# 完整订阅弹窗（all-plans）改版为 UPGRADE FOR MORE 设计稿

- 日期：2026-08-12
- 状态：已实现，待 Nick 目测确认后合并
- 影响范围：`src/components/ui/`（`AllPlansModal` / 新 `PlanCardDark` / `UpsellHero` / `PlanCard` 瘦身）、`src/app/globals.css`（新增 upsell 令牌与徽标/键帽样式）、`public/figma/`（新 hero 素材）、`src/i18n/locales/*`
- 前序 spec：[2026-08-11 积分弹窗重做为订阅升档弹窗](2026-08-11-subscription-upsell-modal-design.md)（触发路由、数据映射、支付闭环、埋点全部沿用，本 spec 只改这一个弹窗的视觉与排版）
- 设计稿（Figma `Rezona Lab`）：完整订阅弹窗新版 `9433:70184`（替代旧稿 `8372:178533`）

## 目的

上一版 all-plans 弹窗按旧稿 `8372:178533` 实现，落地后三处不达标（Nick 实测截图）：

1. **hero 不对**：`welcomeBack` 变体的主视觉一直是 `PENDING_HERO_ART` 回落（空宝箱），字标是 WELCOME BACK!；新稿是 **UPGRADE FOR MORE + 吉祥物实验室**。
2. **文案不对**：说明行按触发源分两套，`insufficient` 时显示硬失败口径；新稿只有一句转化口径的文案。
3. **各档卡片排版不对**：新稿是恒暗促销面（三档各一套光晕渐变 + 顶部高光）、斜切徽标、斜杠划线价、实体键帽 CTA；现实现是随主题翻的中性面 + 圆角胶囊徽标 + 平直划线，且价格行在窄列下换行、Creator 档 CTA 填充未生效（实现期一并定位根因，不允许只调样式绕过）。

本次只重做**完整订阅弹窗**的视觉与排版；触发路由、`plans` 数据映射、升档限制、支付闭环、埋点一律不动。

## 约束（盘问结论）

以下每条已拍板，实现不得偏离：

1. **弹窗恒暗色**，不随 `data-theme` 翻转（同 `.btn-raised` 恒浅色 CTA 的既有例外）。新稿用到的所有色值登记成 `--upsell-*` 一组令牌集中在 `globals.css`，组件内**不出现字面色值、不写主题分支**。
2. **只改 all-plans**：新建 `PlanCardDark`（恒暗、纵向、只服务 all-plans）；`PlanCard` 瘦身为只剩 `wide` 单卡形态，单卡 / 积分弹窗视觉零改动。两者共用同一份数据映射 `src/lib/subscription/plan-display.ts`，只分排版与皮肤。
3. **hero 分层复刻**：橙渐变底 + 台面底纹（`mix-blend-color-dodge`）+ 吉祥物实验室透明底位图 + 字标真文本（Sekuya + 橙渐变 + 斜切，沿用 `.hero-wordart`），两行改为 `Upgrade` / `for more`。位图转 webp 落 `public/figma/`。字标是装饰艺术字，**不做 i18n**（沿用既有约定）。
4. **说明行恒用稿上那句**：all-plans 不再按触发源分文案，恒显示「你还剩 N 积分 — 解锁完整创作者工具箱！」（现 `upsell.descLowBalance` 的文案，迁为语义准确的新 key）。与「hero 恒用同一张」同一逻辑。
5. **徽标字体用 Inter Bold 代替 Space Grotesk**，不为 3 个徽标引入第四套字体；斜切形状、颜色、尺寸照稿。
6. 金额 / 积分 / OFF 百分比 / 等价行 **仍全部数据驱动**（沿用前序 spec 约束 6），稿上的 20% / 23% / $7 / $14 / $29 一律不写死。
7. 升档限制不变（前序 spec 约束 7）：当前档 CTA「Current plan」、更低档「Included」，均禁用；禁用态在暗色面上用降饱和填充 + `opacity`，不引入新按钮种类。

## 成功标准

1. 四种档位（free / starter / creator / master）触发路由与改版前完全一致；free 触发弹出的 all-plans 视觉与 `9433:70184` 一致：新 hero、恒暗三卡、斜切徽标、斜杠划线价、三档各自 CTA 填充（Starter 白 / Creator 柠檬绿 / Max 琥珀橙）均正确渲染。
2. 浅色主题下弹窗仍为暗色，正文对比度不塌（说明行 `--upsell-text-muted` 在 `--upsell-surface` 上 ≥ 4.5:1）。
3. 价格行在 1106px 宽三列布局下（卡内可用 307px）**en 文案不换行**：划线价、大号价、`per month, billed annually` 基线对齐同一行。实测三段 37+113+151 = 301，间距收到 2px、后缀去字距后余 6px；**长语言（de/fr 等）放不下时由 `flex-wrap` 把后缀整体挪到下一行**，不从句中劈开 —— 这是数据 / 语言驱动下的可接受降级，不是缺陷。
4. Creator 档 CTA 填充可见。**根因已查明：不是源码缺陷** —— 用项目自身 postcss 管线编译当前 `globals.css`，`--color-cta-highlight` 与 `.bg-[var(--color-cta-highlight)]` 都在产物里（这条工具类能生成，恰证明扫描器读到了 `PlanCard.tsx`），故截图里那次填充丢失是浏览器拿到了旧 CSS chunk。新实现把三档填充改成 `globals.css` 里的真类 `.upsell-key-*`，从结构上不再依赖任意值工具类。
5. 单卡弹窗（starter/creator 触发）与积分弹窗（master 触发）截图与改版前一致 —— 本次不碰。
6. `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿。

## UI 结构（新稿）

```
backdrop: rgba(0,0,0,0.8) + blur(6px)，padding 64
modal-root: w 1106 · radius 24 · bg --upsell-surface · border 0.5px --upsell-line · gap 16
├─ hero(328px, radius 12, overflow-clip, inset 0 4px 24px 3px 光晕)
│   ├─ 底：linear-gradient(173deg, 橙 0.4 → 透明 63%) + 橙 0.2 平铺
│   ├─ 台面底纹位图（mix-blend-color-dodge, object-bottom）
│   ├─ 吉祥物实验室位图（右侧，上下出血）
│   ├─ 字标 Upgrade / for more（Sekuya · 橙渐变 · rotate -13.5° · skewX -14.9°）
│   └─ 关闭按钮（右上 16/16，bg 黑 50%，radius 22，8px padding，16px cancel 图标）
├─ 说明行（Inter 16/24，tracking .24，--upsell-text-2，居中，px 32）
└─ 三卡区（px 32 · pb 32 · gap 12 · items-stretch）
    每卡 radius 20 · overflow-clip · 顶部白色高光遮罩（180deg，白 .15 → 0，72% 收尾）
    ├─ 档名（Sekuya 20/28，tracking -1.2，大写）+ 斜切徽标组
    ├─ 一句话卖点（12/18，--upsell-text-muted）
    ├─ 积分面板（bg 白 5%，radius 12，p 12）
    │    ⟡ N credits/mo.（Inter Bold 14）
    │    「— these credits go as far as:」+ 等价行（12/16，pl 28，--upsell-text-muted）
    │    Fixed amount chip（h 38，radius 8，border 白 5%）
    ├─ 价格行（flex-wrap 基线：斜杠划线价 19px 粉 / 大号价 32px 白 / 说明 12px 灰）
    ├─ CTA（h 48，radius 10，外阴影 + 底部 3px 内阴影键帽）
    └─ 权益 4 行（首行 --upsell-perk-hi 青，其余白，12/16）
```

### 三档卡面（照稿）

| 档 | 面 | CTA 填充 | CTA 底部内阴影 | 文字 |
|---|---|---|---|---|
| starter | `linear-gradient(180deg,#1d1f20,#17191b)` + 左侧径向白光 | 白 `#fff` | `rgba(0,0,0,.1)` | `#131517` |
| creator | `linear-gradient(210deg, #d1fe17/.16 → 0 62%)` + `#18191c` | `#d1fe17`（底部渐亮到 `#ffff14`） | `#829b19` | `#131517` |
| master | 右上角 `#ff005b/.32` 径向 + `linear-gradient(180deg,#ff005b/.13 → 0 72%)` + `#18191c`，另加 `0 24px 64px rgba(0,0,0,.24)` | `#ff9d00` | `rgba(0,0,0,.32)` | `#131517` |

### 徽标（斜切平行四边形，skewX -10.89° + 内层反向 11.79°）

- OFF：底 `#ff005b`，白字（百分比数据驱动）
- RECOMMENDED（creator）/ BEST VALUE（master）：蓝渐变底（`#20caf9 → #2b6ff3 → #3042f0` 径向近似），白字
- 字：Inter Bold 12.5px 大写，`leading 12.5`

## 令牌（新增到 `globals.css`，弹窗内只允许引用这些）

`--upsell-surface`(#171717) · `--upsell-line`(白 .5 描边) · `--upsell-card-base`(#18191c) · `--upsell-card-starter-from/to` · `--upsell-glow-creator`(#d1fe17) · `--upsell-glow-master`/`--upsell-strike`(#ff005b) · `--upsell-cta-creator` · `--upsell-cta-master`(#ff9d00) · `--upsell-cta-ink`(#131517) · `--upsell-text`(#fff) · `--upsell-text-2`(#e5e5e5) · `--upsell-text-muted`(白 .5) · `--upsell-perk-hi`(#9ce6f3) · `--upsell-badge-blue-*` · `--upsell-hero-glow`(#fb923c)

配套样式类同样落 `globals.css`（不写一次性 keyframes，本改版**无新动效**，沿用 `.modal-pop` / `.modal-backdrop`）：`.upsell-badge`（斜切）· `.upsell-key`（键帽 CTA）· `.upsell-strike`（旋转斜杠划线）· `.upsell-card-sheen`（顶部高光）。降低动态无需新增禁用项（无新动画）。

## 数据映射

完全沿用前序 spec §数据映射与 `plan-display.ts`，本次不改一行映射逻辑：档名映射（`master → Max`）、OFF 百分比、等价行换算、权益 4 行、`Fixed amount` 同源取 `credits_per_month`。

## 测试要求

- `src/components/ui/PlanCardDark.test.tsx`（新）：三档各自渲染出对应 CTA 文案与 `data-tier`；`currentTier` 为 creator 时 starter 卡「Included」禁用、creator 卡「Current plan」禁用、master 卡可点；OFF 徽标缺失（两价相等）时不渲染；权益首行取 `credits`。
- `src/components/ui/AllPlansModal.test.tsx`（改）：说明行恒为新 key（`insufficient` 与 `lowBalance` 两种 source 下文案相同）；hero `data-hero` 为新变体；`plans=null` 走失败态；Escape / 遮罩关闭仍生效。
- `src/components/ui/PlanCard.test.tsx`（改）：删掉 `column` 分支用例，只保留 `wide`。
- 视觉走查：`pnpm dev` 下用 Playwright/Chrome DevTools 截图比对 `9433:70184`（Nick 最终目测确认）。

## 本期不做

- 单卡弹窗 / 积分弹窗的视觉改版（无对应新稿）。
- 月/年切换、降档退订、`intro_price_cents` 首期价（沿用前序 spec 的「本期不做」）。
- hero 字标 i18n、hero 动效。
- 移动端断点（项目为固定桌面布局）。
