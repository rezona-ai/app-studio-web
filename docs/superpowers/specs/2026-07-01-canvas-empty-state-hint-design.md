# 画布空态提示对齐设计稿（Figma 1105:26155）

## 背景

画布无资产时的居中空态提示（`CanvasEmptyState` + `EmptyStateChips`）已有实现，但与最新设计稿 `1105:26155` 存在布局、文案、pill 样式上的偏差。本次按设计稿严格对齐**结构 / 文案 / 间距 / pill 样式**；颜色与图标在守住项目令牌约束的前提下贴近设计意图。

设计稿结构（自 Figma metadata）：

- 外层（723×108）垂直两行，行距 16px。
- 第一行（663×36）单行引导句：`AI-generated assets will appear here.` ＋ 内嵌 `Double-click` pill ＋ `the canvas to generate freely.`，三者水平居中、间距 10px、垂直居中。
- 第二行：五个快捷 pill `Images / Videos / Audio & Music / 3D Model / Upload Resource`，间距 10px。
- 所有 pill（含 Double-click）同一 `pill-button` 形态：高 36，内距左右 12、icon 20、icon-label 间距 8，圆角 24。

## 决策（与项目硬约束的取舍）

1. **强调色**：设计稿 primary 为青色 `#1fd4cf`（cursor 图标着色）。项目 CLAUDE.md 规定 accent 恒为蓝 `#3582ff` 且禁止硬编码色值——cursor 图标改用 `var(--color-accent)` 蓝，**不**引入青色 token。
2. **类型图标**：设计稿用 麦克风(audio)/立方体(3d)/堆叠照片(image)，与 app 现有 `figAsset` 的 waveform/planet/image 不同。沿用现有 `figAsset` 图标，保持全 app 同类型图标一致，不为单一空态新增第二套。

## 改动点

仅触及三处，不影响其它模块：

### 1. `src/components/canvas/AssetCanvas.tsx` — `CanvasEmptyState`

- 从「句子一行 / Double-click pill＋后缀另一行」的两段式，改为**设计稿的两行结构**：
  - 第一行：`<p flex flex-wrap items-center justify-center gap-2.5>`，依次 `empty` 文本、Double-click pill（`<span>`，说明性、不可点、无 hover）、`emptyDoubleClickSuffix` 文本。
  - 第二行：`<EmptyStateChips />`。
  - 外层 `flex-col items-center justify-center` 行距由 `gap-1` 改 `gap-4`（16px）。
- Double-click pill 由原 `btn-raised` 键帽样式改为与快捷 pill **统一的 pill 视觉**（surface＋line-2 边框＋圆角 24＋shadow-pill），移除随主题切换的 `keycap`/`useIsDark` 分支。
- cursor 图标 `<FigIcon src={figAsset.cursor} className="text-[var(--color-accent)]" />`（primary tone 跟随 currentColor → accent 蓝）。

### 2. `src/components/canvas/EmptyStateChips.tsx`

- 快捷 pill 文案改用空态专用键 `canvas.emptyChip.*`（`Images / Videos / Audio & Music / 3D Model / Upload Resource`），不再复用通用 `assetKind.*` 与 `addMenu.upload`。
- pill 视觉样式抽为与 Double-click 共享（保持现有 `rounded-[24px] border-line-2 bg-surface px-3 py-2 gap-2 text-[14px] font-semibold tracking-[-0.28px] shadow-pill`，已与设计稿一致）；快捷 pill 保留 `pointer-events-auto` 与 hover 上浮及点击行为（打开生成表单 / 上传），行为不变。

### 3. i18n（`src/i18n/locales/*.ts`，en 为真相源，补齐六语 en/zh/fr/ru/ja/vi）

- 改 `canvas.emptyDoubleClickSuffix` → `the canvas to generate freely.`（及对应六语）。
- 新增 `canvas.emptyChip = { image, video, audio, '3d', upload }`，en 值：`Images / Videos / Audio & Music / 3D Model / Upload Resource`，其余语言对应翻译。

## 测试

- 更新 `src/components/canvas/EmptyStateChips.test.tsx`：按钮可访问名由 `Image`→`Images`、`3D`→`3D Model`，上传 pill 名 `Upload Resource`；点击行为断言（`openGenForm` 以视口中心 spawnAt、`uploadAsset`）保持不变。

## 不做（YAGNI）

- 不引入青色 token、不新增类型图标 SVG。
- 不改通用 `assetKind.*` / `addMenu.*` 文案（其它处仍在用）。
- 不调整双击生成、上传策略等既有逻辑。
