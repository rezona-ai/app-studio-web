# 宝箱系 hero 按稿重做 + 升购弹窗大 CTA 改白字

- 日期：2026-08-12
- 状态：待实现
- 影响范围：`src/components/ui/UpsellHero.tsx`、`src/components/ui/CreditUpsellModal.tsx`、`src/components/ui/TopupModal.tsx`、`src/app/globals.css`、`public/figma/`
- 设计稿（Figma `Rezona Lab`）：
  - 积分不足 hero：`5952:84376`（所在单卡弹窗 `5952:84375`）
  - 低余额 hero：`8047:165129`
  - 充值弹窗：`6180:109915`
- 前序：[2026-08-11 积分弹窗重做为订阅升档弹窗](2026-08-11-subscription-upsell-modal-design.md)、[2026-08-12 完整订阅弹窗改版](2026-08-12-all-plans-modal-redesign.md)

## 目的

`upgradeForMore`（all-plans）那张 hero 已经对稿，但**宝箱系两张一直是近似实现**：两个变体共用一份底色与一套字标参数，与稿逐项对不上。同时单卡 / 充值弹窗的橙底大 CTA 用的是深色文字，稿上是白字。

从 Figma 取到的实际参数（两份 `get_design_context` 输出）：

| | 积分不足 `5952:84376` | 低余额 `8047:165129` | 当前实现 |
|---|---|---|---|
| 底色渐变 | `167.91deg, rgba(254,52,102,.6) 1.3% → 0 62.7%` | `167.91deg, rgba(255,214,48,.5) 1.3% → 0 62.7%` | 两者共用粉色 `173deg .6` |
| 漩涡底纹 | `opacity .1` `object-cover` | 同左 | 同左 ✅ |
| 主视觉 | 空箱（2 道闪电） | **满箱（6 道闪电）** | 两者共用空箱 ❌ |
| 字标字号 | 56.359px | 48.049px | 两者共用 56px |
| 字标变换 | `rotate(-8.25deg) scaleY(.99) skewX(-8.72deg)` | 同左 | 同左（缺 scaleY） |
| 字标填充 | `180deg, #FF7719 .5% → #D86C21 35.8% → #FFAE76 67.9%` | 同左 | `--color-primary` 派生的近似三段 |
| 行偏移 | 行1 `-17px` / 行2 `+116.77px` | 行1 `+0.49px` / 行2 `+66.12px` | 两者共用 `-75px` / `+150px` ❌ |
| 内发光边 | `inset 0 4px 24px 3px #fb923c` | 同左 + 再叠一层 `.2` alpha | 无 ❌ |
| 字标描边 | 深棕描边 + 落影（见下） | 同左 | 无 ❌ |

## 约束（盘问结论 + 取自设计稿的事实）

1. **字标描边照目测实现**：两份 `get_design_context` 输出里都**没有** stroke —— Figma 的文字描边不会转进代码，但两张稿的截图上都清楚可见一圈深棕描边加落影。故按目测复刻（深棕、约 5px、右下落影），并在代码里注明这条不是从 context 抄来的。
2. **满箱素材本次落库**：`8047:165129` 的主视觉是 6 道闪电的满箱（透明底 PNG，1024×755）。这张就是 `PENDING_HERO_ART` 欠了一路的素材，本次补上并删掉那个回落标记。
3. **宝箱不复刻 Figma 的 mask 拼接**：稿里主视觉是两三层 mask group 拼出来的（满箱图 + 原始整帧图局部叠加）。前端只用对应的那张透明底立绘，视觉等价，不引入三层遮罩。
4. **底色不同源**：两个变体的渐变色分别登记令牌 —— 积分不足复用既有 `--color-promo`（#fe3466，与稿的 254,52,102 同值），低余额新增一个黄色令牌。
5. **CTA 白字只改升购弹窗族的大按钮**（盘问结论）：单卡弹窗的升档 / 充值两个全宽 CTA + 充值弹窗的 `Recharge Now`。新增语义令牌承载，不改 `--color-on-primary`（它还服务于橙底小徽章与画布表单按钮，那些无稿依据且小字号深字对比更好）。
6. 字标仍是装饰艺术字，**不做 i18n**（沿用既有约定）。

## 成功标准

1. 积分不足 hero 与 `5952:84376`、低余额 hero 与 `8047:165129` 逐项对上：底色、主视觉、字号、行偏移、内发光边、描边。两张 hero 摆在一起颜色明显不同（粉 / 黄）。
2. 低余额 hero 用满箱素材，`PENDING_HERO_ART` 回落机制与它对应的「欠账提醒」测试一并移除。
3. 单卡弹窗的两个全宽 CTA 与充值弹窗的 `Recharge Now` 是白字；橙底小徽章、画布表单按钮不受影响。
4. all-plans 的 `upgradeForMore` hero 一像素不动（它已经对过稿）。
5. `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿。

## 实现要点

- `HERO_ART` 表扩成携带每个变体的全部差异：`art` / `tint`（底色令牌）/ `size`（字号）/ `offsets`（两行偏移）/ `glow`（内发光层数）。构图与图层顺序共用一份 JSX。
- 字标复用上一轮为 all-plans 建的两层贴纸结构（描边副本 + 渐变文字），描边色由 CSS 变量注入：all-plans 白、宝箱系深棕。
- 新增令牌：`--hero-tint-low`（低余额黄）、`--hero-stroke-chest`（宝箱系深棕描边）、`--color-on-primary-strong`（橙底大按钮上的白字）。
- 字标填充改用稿上的三段实色（`#FF7719 / #D86C21 / #FFAE76`）而非 `--color-primary` 派生 —— 这三段与品牌橙不是同一条曲线，派生值在深底上偏灰。

## 测试要求

- `src/components/ui/UpsellHero.test.tsx`：两个宝箱变体各自的主视觉文件名不同（满箱不再回落空箱）、字标描边层存在且 `aria-hidden`、`upgradeForMore` 结构不变。删除「满箱未导出」那条欠账提醒用例。
- `src/components/ui/CreditUpsellModal.test.tsx`：两个全宽 CTA 带白字令牌类。
- `src/components/ui/TopupModal.test.tsx`：`Recharge Now` 带白字令牌类。
- 视觉走查：dev 起本地逐个截图比对两张稿。

## 本期不做

- 单卡弹窗除 CTA 字色外的其他部分（进度卡、档位卡、文字链）—— 无新稿要求。
- 宝箱 hero 的动效（稿是静帧）。
