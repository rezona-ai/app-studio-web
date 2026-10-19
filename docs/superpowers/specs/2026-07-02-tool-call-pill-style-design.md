# 工具调用块 pill 化 + thinking 统一设计

对照 Figma `TALUNA DEVELOPER SITE` 节点 `647-23435`（Project Info / 左侧对话栏，工具调用块在设计里命名为 `status-pill`），把当前工具调用折叠块的**容器样式**与**状态图标**对齐设计稿；thinking 块从"另一套实现"统一成同款 pill。

## 范围约束（Nick 明确）

**只在当前基础上叠加设计稿的「容器样式 + 状态图标」，其余保持现状。**

- **文案不变**：工具名、文件名、`+N/-M` 差异数、"用户已编辑"徽章的**内容、字体、位置**都不动（不切等宽字体，仍是现有 Inter 13px medium）。
- **折叠行为不变**：进行中/失败自动展开、完成自动收起、手动切换、`anim-collapse-in` 正文（DiffView / 参数）逻辑全不变。折叠箭头**位置**按设计稿移到右侧（见下）。
- 不引入设计稿的等宽字体、不改文案结构、不动折叠触发逻辑。

## 设计稿规格（从 Figma 提取）

工具调用 pill（`status-pill`）三种状态：

| 元素 | 规格 |
|---|---|
| 容器 | `border 1px rgba(255,255,255,.1)`（=`--color-line`）、**无填充**、`rounded-[30px]`、`px-16 py-10` |
| 左侧状态图标 14px | 进行中=amber 转圈 `#ffab00`；成功=teal 勾 `check-circle` `#14b8a6`；失败=红橙 `warning-sign` `#ff5630` |
| 文案 | 设计为 IBM Plex Mono 12px（**本次不采用**，保持现有字体） |
| 右侧折叠箭头 12px | `arrow-down`，仅可折叠（有正文）时出现；进行中无箭头 |

## 改动方案

### 1. ToolCard 容器 → pill 样式

- 圆角：收起（无可见正文）→ `rounded-[30px]` 全圆胶囊；展开有正文 → `rounded-[16px]`（长正文用胶囊角会怪，降一档到卡片角）。
- 去掉 `bg-[var(--color-surface)]` 填充 → 仅 `border border-[var(--color-line)]`。
- padding：`p-2` → `px-4 py-2.5`（对应设计 16/10）。

### 2. 左侧状态图标（新增，取代原右侧转圈/状态字）

原来右侧的「进行中转圈 / `{part.status}` 状态字」整体移除，改为**左侧彩色状态图标**：

| 状态 | 图标 | 颜色 token |
|---|---|---|
| 进行中 `generating` | CSS 转圈（复用现有 spinner，移到左侧、改 amber） | `--color-warning`（新增 `#ffab00`） |
| 成功 `done` | `check-circle`（新导出） | `--color-teal`（现有 `#1fd4cf`，近设计 `#14b8a6`） |
| 失败 `error` | `warning-sign`（新导出） | `--color-danger`（现有） |

- 颜色注入：图标走 `FigIcon` mask（`tone='primary'`，取 `currentColor`），外层容器 `text-[var(--color-*)]` 决定色；spinner 直接用 `--color-warning` 描边。
- 新增 token：`globals.css` `@theme` 加 `--color-warning: #ffab00`（明/暗同色，amber 两主题皆可读）。`--color-teal` / `--color-danger` 已存在，复用。

### 3. 折叠箭头 → 右侧（对齐设计稿）

- 原左侧文字 `▸/▾` 移除，改为右侧 `arrow-down` 图标（新导出，`ml-auto` 推到最右）。
- 旋转表达开合：收起（可展开）朝下，展开时 180° 朝上；`prefers-reduced-motion` 下去掉过渡。
- 仅 `hasBody` 时渲染（进行中若无正文则不显，符合设计"进行中无箭头"）。

### 4. 图标资产

新导出并登记进 `src/components/ui/figma.tsx` 的 `figAsset`：`check-circle` / `warning-sign` / `arrow-down`（来自设计节点，14/14/12px 取景）。

- `check-circle` / `warning-sign`：`tone` 由容器 `text-[var(--color-*)]` 决定（primary → currentColor）。
- `arrow-down`：登记为 `secondary`（恒 `--color-muted` 灰），与折叠指示语义一致。
- 清理临时导出目录 `public/figma/_tmp_toolcall/`。

### 5. thinking 块 → 统一成同款 pill

`ThinkingBlock` 从"无边框固定高滚动框、不可折叠"改为与 ToolCard 同款：

- 同款 pill 容器（描边、无填充、圆角随开合、同 padding）。
- 左侧状态图标：流式中 = amber 转圈；完成 = `sparkle` ✦（现有 `figAsset.sparkle`，`--color-muted` 中性色 —— thinking 非成功/失败语义）。
- "Thinking" 标签（现有文案/字体）。
- 右侧同款 `arrow-down` 折叠箭头。
- 折叠行为对齐工具：**流式中自动展开**显示思考文字（沿用 `max-h-40` 滚动区 + 跟随滚动到底），**完成后自动收起**成一行 pill，用户可手动展开。

## 单元边界

- `ToolCard.tsx`：容器 + 头部布局 + 状态图标 + 右侧箭头；折叠正文与媒体预览逻辑不动。
- `ThinkingBlock.tsx`：改为受控折叠 + 同款 pill 头；保留流式自动滚动 effect。
- `figma.tsx`：`figAsset` 增三图标 + `ICON_TONE` 登记 `arrow-down` 为 secondary。
- `globals.css`：新增 `--color-warning`。
- 状态图标（icon + 色映射）在 ToolCard 与 ThinkingBlock 间重复出现 → 抽一个小的 `<ToolStatusIcon status=... />`（或行内 helper）复用，避免两处漂移。

## 测试

同目录 `*.test.tsx`，沿用现有断言风格：

- `ToolCard.test.tsx`：
  - 补充：`done` 渲染 `check-circle` 且容器带 `--color-teal`；`error` 渲染 `warning-sign` 带 `--color-danger`；`generating` 渲染 amber 转圈且无 `arrow-down`。
  - 保持：折叠开合、DiffView / 参数正文、媒体预览、文案（文件名/`+N/-M`/徽章）现有断言不回归。
  - 右侧 `arrow-down` 仅 `hasBody` 时出现；点击切换 `aria-expanded`。
- `ThinkingBlock.test.tsx`：
  - 流式中展开显示文字 + amber 转圈；完成后收起（正文不在 DOM 或 `aria-expanded=false`）。
  - 保留：文本渲染、`aria` 可访问性。

## 验收（对齐设计稿）

按 [[verify-design-alignment-before-claiming]]：取设计稿三态精确 px，渲染本地 mock 逐项比对（容器圆角/边框/padding、左图标色、右箭头位置），列对照表，不肉眼估。
