# 实现计划：宝箱系 hero 重做 + 大 CTA 白字

- spec：[2026-08-12 宝箱系 hero 按稿重做](../specs/2026-08-12-chest-heroes-and-cta.md)
- 分支：`fix/chest-heroes`（worktree `.claude/worktrees/fix-chest-heroes`）

## 任务 1：满箱素材落库 + 令牌

- `159938bc…png`（1024×755 透明底满箱）缩到 900 宽落 `public/figma/lowbalance-chest.png`；PNG 带 alpha，本机 sips 写不了 webp，沿用 PNG（同 upgrade-lab 用 jpg 的判断:能压就压、不为格式硬凑工具）。
- `globals.css` 新增 `--hero-tint-low`、`--hero-stroke-chest`、`--color-on-primary-strong`，并把宝箱系字标的描边类挂上可注入的描边色。
- 验证：`pnpm exec tsc --noEmit` + 用项目 postcss 管线确认令牌产出。

## 任务 2：`UpsellHero` 宝箱系按变体分参数（先测后码）

- `HERO_ART` 扩成带 `art / tint / size / offsets / glow`；构图共用一份 JSX。
- 字标换成两层贴纸结构（复用 all-plans 那套），描边色走宝箱系深棕。
- 测试先写：两变体主视觉不同、描边层存在且 aria-hidden、`upgradeForMore` 不变；删掉「满箱未导出」的欠账用例。
- 验证：`pnpm exec vitest run src/components/ui/UpsellHero.test.tsx`

## 任务 3：三个大 CTA 改白字（先测后码）

- `CreditUpsellModal` 两处全宽 CTA、`TopupModal` 的 `Recharge Now` 换 `--color-on-primary-strong`。
- 测试断言类名，防以后被顺手改回深字。
- 验证：`pnpm exec vitest run src/components/ui/CreditUpsellModal.test.tsx src/components/ui/TopupModal.test.tsx`

## 任务 4：视觉走查与终审

- dev 起本地，逐个截 insufficient / lowBalance hero 与两张稿比对；确认 all-plans hero 无变化。
- 全量：`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build`，贴完整输出与退出码。
- 清掉主仓的 `public/figma/tmp-hero-*` 两个临时目录（Figma 导出的原始素材,含一张 19MB 原图)。

## 回滚

改动集中在 `UpsellHero` 与三个 CTA 的类名;回滚任务 2 即回到近似实现,不影响弹窗路由与支付链路。
