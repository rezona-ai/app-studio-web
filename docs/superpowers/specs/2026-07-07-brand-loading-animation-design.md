# 品牌化加载动画设计（LoadingScreen 统一升级）

日期：2026-07-07

## 背景与目标

当前 `src/components/ui/LoadingScreen.tsx` 是「shimmer 微光底 + 灰色转圈 + 文案」，与整体设计语言（品牌青 `--color-teal`、Sekuya 字标、统一动效语汇）相比过于朴素。目标：统一升级所有使用处的加载动画，全屏进入 workspace 时呈现品牌化动效，小容器场景升级为品牌青 spinner。

## 组件形态：一个组件，两档形态

保持单一 `LoadingScreen` 组件，对外 API 不变（`label` / `className` / `closing`），新增可选 prop `variant`：

- **`brand` 档**（仅 `Workspace.tsx` 全屏启动加载显式传入）：彩色 logo + Sekuya 字体 "Taluna" 字标 + 循环动效（见下）。
- **`spinner` 档**（默认，Preview / CompareView / GameFrame 零改动）：现有灰色转圈升级为**品牌青轨道环**——青色弧线（`--color-teal`）+ 淡青底环（`--color-teal-soft`），尺寸不变（size-7），小容器不引入字标。

## `brand` 档动效编排

进场序列（一次性，约 600ms，缓动统一 `cubic-bezier(0.22, 1, 0.36, 1)`）：

1. **logo 弹入**：`scale(0.6) + opacity 0` → 原位（`.anim-pop-in` 语汇），`FigIcon`（`figAsset.logo`，tone `original`）放大渲染（size 48）。
2. **字标逐字浮现**："Taluna" 六个字母依次 `translateY(8px) → 0 + 淡入`，每字延迟约 50ms，`.font-display`（Sekuya weight 400，不可合成加粗）。
3. **循环动效（等待期）**，两层叠加：
   - logo **呼吸浮动**：上下 3px 缓慢浮动 + 青色柔光（`--color-teal-soft`）光晕呼吸；
   - 字标**青色扫光**：`background-clip: text` 渐变高光从左至右扫过，周期约 2.2s，承担「正在加载」的感知。
4. 字标下方保留 `label` 文案（`--color-muted` 小字）；底层保留 `skeleton-shimmer` 微光。

退场沿用现有 `closing` → `.anim-fade-out`，不改 `useExitTransition` 链路。

## 实现约束

- 新 keyframes（`brand-float` / `brand-glow` / `wordmark-sheen` / 逐字进场）集中加入 `globals.css`，并全部补进 `@media (prefers-reduced-motion: reduce)` 禁用列表（降级为静态 logo + 字标 + 普通淡入）。
- 颜色只用 `--color-teal` / `--color-teal-soft` / `--color-ink` / `--color-muted` 变量，深浅主题自动适配，组件不写主题分支。
- 外层容器约束不变：不加 `relative`，定位由调用方 className 提供（避免覆盖 fixed/absolute）。

## 测试

组件测试（同目录 `LoadingScreen.test.tsx`）：

1. `variant="brand"` 渲染 logo 与 "Taluna" 字标；
2. 默认档不渲染字标，仍渲染 `role="status"` spinner；
3. `label` / `closing` 行为不回归。
