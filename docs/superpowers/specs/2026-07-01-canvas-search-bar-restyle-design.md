# 画布搜索框样式适配设计稿（Figma 1105:26153）

## 背景

画布顶部居中浮动搜索框（`CanvasSearchBar`，`AssetCanvas.tsx`）需按设计稿 `1105:26153`（Project Header / Search Bar）适配视觉样式。设计稿为暗色 rest 态：胶囊形、深色填充、清晰描边、灰色占位与放大镜、右侧 ⌘K。

设计稿关键值（自 Figma 变量）：
- 圆角 `radius/22 = 22`（高 40 → 胶囊）
- 填充 `background/grey-800 = #202020`
- 描边 `line/default = grey/400 = #494949`
- 占位文字 `Text/Secondary = #7b7b7b`
- Search Bar 宽 484（504 宽 Project Header 内）

## 决策（与项目令牌约束的取舍）

1. **占位文字**：设计稿 `#7b7b7b` 与 `--color-muted`（明暗两套均 `#7b7b7b`）**精确一致**，现有实现已用，无需改。
2. **填充**：`#202020` 无精确 token，dark 下 `--color-pop`(#1c1e1f) 最接近且语义为浮层面，改用之（light 自动取 #fcfcfc 白，浮动搜索条从画布底浮起，优于现状与画布同色的 surface-2）。
3. **描边**：`#494949` 比现有 `--color-line-2`(dark #323232) 明显更亮/更清晰，项目无接近 token。按项目惯例（globals.css 已有多个 Figma 源 token）**新增语义 token `--color-line-strong`**：light `#d4d4d4`（沿用 `--shadow-btn` 描边环灰）/ dark `#494949`（Figma grey/400）。
4. **宽度**：由 `276px` 加宽靠近设计稿，取 `484px` 上限并响应式收窄（窄画布不溢出）。
5. **聚焦辉光**：保留现有 `.canvas-search-bar` 旋转渐变描边 + 光晕动效（设计稿仅 rest 态，未体现，不动机制）。
6. **放大镜图标 / ⌘K**：图标保持 `figAsset.search` size 16（tone secondary = muted，与设计稿灰一致）；⌘K 胶囊保持现状（设计稿该处细节不可辨，且为既有快捷键提示，不臆改）。

## 改动点

### 1. `src/app/globals.css`

- `@theme` 新增 `--color-line-strong: #d4d4d4;`，`[data-theme="dark"]` 覆盖 `--color-line-strong: #494949;`（注明 Figma 源 grey/400）。
- `.canvas-search-bar::after`：`border-radius: 10.5px` → 胶囊（`9999px`）；`background: var(--color-surface-2)` → `var(--color-pop)`（与外层填充同步）。
- `.canvas-search-bar::before`：旋转渐变层 `width: 320px` → `520px`（加宽后对角线约 486px，须 > 对角线才能在任意旋转角铺满；更大被 `overflow:hidden` 裁切无副作用），同步更新注释。

### 2. `src/components/canvas/AssetCanvas.tsx`（`CanvasSearchBar`）

- 外层定位容器宽度：`w-[276px]` → `w-[484px] max-w-[calc(100%-32px)]`（上限 484、窄画布响应式收窄、两侧留 16px）。
- 搜索条 div：
  - `rounded-[12px]` → `rounded-full`（胶囊，与 `::after` 同步）。
  - `bg-[var(--color-surface-2)]` → `bg-[var(--color-pop)]`。
  - `border-[var(--color-line-2)]` → `border-[var(--color-line-strong)]`。

## 测试

`CanvasSearchBar` 为纯展示组件，无既有测试；className 断言脆弱且项目不鼓励为测试改生产码，故不新增测试。以全量回归（`tsc`/`lint`/`test`/`build`）守护无破坏。

## 不做（YAGNI）

- 不改聚焦辉光机制、不改 ⌘K 胶囊、不改图标。
- 不硬编码 `#202020`/`#494949`（一律走语义 token）。
- 不动搜索过滤逻辑与 ⌘K 聚焦行为。
