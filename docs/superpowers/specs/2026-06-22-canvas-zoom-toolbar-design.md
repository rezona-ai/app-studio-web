# 画布底部缩放工具条重做 — 设计稿

- 日期：2026-06-22
- 范围：`src/components/canvas/AssetCanvas.tsx` 的 `ZoomBar`，新增 `src/lib/zoom.ts` 与 3 个图标
- 参考图：底部工具条「地图 | + − Fit | 缩放菜单」。**参考图仅表达需求结构，色彩与布局一律沿用当前页面令牌 / 组件，不采用参考图的青色与具体配色。**

## 背景

当前底部居中的 `ZoomBar`（`AssetCanvas.tsx:82`）只有一个「百分比 + 下拉预设」按钮（下拉含 Fit view / 50% / 100% / 200%）。需要扩成一条带分隔的工具条，新增 minimap 全景弹窗、`+`/`−` 步进、独立 Fit view 按钮，并保留缩放百分比下拉。

## 目标

1. 可显隐的 **minimap 弹窗**：预览画布全景。
2. **复用现有缩放菜单**（百分比下拉），并新增 `+`/`−` 步进按钮，步进单位为 5（个百分点）。
3. 独立 **Fit view 按钮**：重置视窗以展示全部画布卡片。

## 非目标

- 不改画布本身的缩放范围 / 交互（沿用 React Flow 默认 `[0.5, 2]`，即 50%–200%）。
- 不引入移动端断点 / 新的设计令牌 / 新按钮变体 / 一次性 keyframes。
- 不持久化 minimap 开关（瞬态本地态）。

## 组件结构

重写 `ZoomBar`。把 `minimapOpen` 开关**上提到 `Inner`**（本地 `useState`，瞬态不落盘）：`<MiniMap>` 必须作为 `<ReactFlow>` 的子节点才能读到画布 store，而切换按钮在工具条内，二者需共享同一开关。`Inner` 把 `minimapOpen` / `setMinimapOpen` 以 props 传给 `<ZoomBar>`，并据此条件渲染 `<MiniMap>`。这是父子 props，不属于跨栏协调，无需进 zustand store。

## 工具条布局

单条容器沿用现有 `ZoomBar` 外壳：`rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-toolbar)]`，`flex items-center gap-2`。用竖分隔条 `w-px h-6 bg-[var(--color-line)]` 分三组（对齐参考图从左到右）：

| 组 | 内容 | 行为 |
|---|---|---|
| ① | **Minimap 切换**：`IconButton`，`map` 图标 | 点击 `setMinimapOpen(v=>!v)`；**active = `raised-active` 变体**，inactive = `ghost` |
| — | 分隔条 `w-px h-6 bg-[var(--color-line)]` | |
| ② | **`+`**（复用 `plus`）·**`−`**（新 `minus`）·**Fit view**（新 `frame`），均为 `IconButton ghost` | `+/−`：`zoomTo(stepZoom(...), {duration:200})`；Fit：`fitView({ duration:200 })` |
| — | 分隔条 | |
| ③ | **`100%▾` 百分比下拉**（沿用现有按钮 + 下拉） | 显示 `Math.round(zoom*100)%`；点开预设 50% / 100% / 200% |

按钮尺寸 / 圆角沿用现有：图标钮 `size-10 rounded-[12px]`；百分比钮沿用现有 `h-10 ... rounded-[12px]`。所有交互元素配 `aria-label`（或 `Tooltip`）。

### 缩放菜单下拉调整

- 下拉里**移除「Fit view」预设**（已有独立按钮，避免重复 / dead code），只留 50% / 100% / 200%。
- 百分比按钮现位于工具条最右，下拉框由原 `origin-bottom-left` / `left-0` 改为**锚定该按钮右对齐**（`origin-bottom-right` / `right-0`），沿用 `.anim-pop-in` 与现有浮层皮肤。

## 缩放步进（纯逻辑，下沉 + TDD）

新增 `src/lib/zoom.ts`：

```ts
// 按百分点步进并 clamp 到 [min, max]。deltaPercent 为正负的「百分点」(如 +5/-5)。
export function stepZoom(current: number, deltaPercent: number, min: number, max: number): number
```

- `+` → `stepZoom(zoom, +5, minZoom, maxZoom)`；`−` → `stepZoom(zoom, -5, ...)`。内部以 `deltaPercent/100` 调整后 clamp。
- `minZoom/maxZoom` 取 React Flow 默认（`0.5`/`2`）。到边界时对应按钮 `disabled`（`IconButton` 自带 `disabled:opacity-30`）：`+` 在 `zoom>=max` 禁用，`−` 在 `zoom<=min` 禁用。
- 同目录 `src/lib/zoom.test.ts` 单测：正常步进、上/下边界 clamp、连续步进不越界、浮点容差。

## MiniMap 弹窗

`<ReactFlow>` 内条件渲染 `@xyflow/react` 的 `<MiniMap>`（仅 `minimapOpen`）：

- **定位**：工具条正上方居中。用 `position="bottom-center"` + `style` 上移（`marginBottom` 让出工具条高度 + 间距），或外层定位容器；以实际对齐为准。
- **进退场**：`anim-pop-in`（`origin-bottom`）；`prefers-reduced-motion` 下沿用 `globals.css` 既有禁用，不新增 keyframes。
- **皮肤（只用项目令牌，无青色）**：圆角卡（`rounded-[16px]`）+ `bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + 描边 `--color-line`；`nodeColor` 按资产类型色（`--color-{image,video,audio,3d,doc}`），视口遮罩用淡色（如 `--color-fill`）、视口区用 accent 作描边/提示。开启 `pannable zoomable`。
- 需要的少量微调用 **scoped CSS**（`globals.css` 内 `.react-flow__minimap*`，仅引用既有令牌），与项目对 react-flow 的既有覆盖方式一致。

## 图标

新增 3 个单色 SVG 到 `public/figma/icons/`，沿用 `plus.svg` 规范（`viewBox 0 0 20 20`、`stroke var(--stroke-0,#121212)` width `1.5`、round cap/join），以保证 `FigIcon` 的 mask 重着色与主题翻转可用；并登记进 `figAsset`（`src/components/ui/figma.tsx`）：

- `map.svg`：minimap 切换。
- `minus.svg`：减号（与 `plus.svg` 同框，仅一横）。
- `frame.svg`：Fit view 的「四角框选」图标。

新图标默认 `tone: primary`（随 `currentColor` 翻转），无需登记进 `ICON_TONE`。

## 数据流与不变式

- 缩放 / 视口操作仍走 React Flow（`useReactFlow` / `useViewport`），不经 zustand store；与现有 `ZoomBar` 一致。
- `minimapOpen` 为 `Inner` 本地态，瞬态、不入 persist。
- 不触碰「前端拥有坐标」「占位卡替换」「sequence 去重」等既有不变式。

## 测试

- `src/lib/zoom.test.ts`：`stepZoom` 步进 + clamp + 边界 + 浮点容差（纯函数 TDD，先红后绿）。
- UI 接线依赖 ReactFlow context + DOM 测量，jsdom 难以可靠覆盖，沿用现状不强测（与现有无测试的 `ZoomBar` 一致）。

## 验收

1. 底部工具条三组按既有令牌渲染：minimap 切换 | `+ − Fit` | `100%▾`，分隔条清晰。
2. 点 minimap 钮在工具条上方弹出全景，再点收起；active 态为 `raised-active`。
3. `+/−` 以 5 个百分点步进，百分比实时更新，到 50% / 200% 边界对应按钮禁用。
4. Fit view 把全部卡片纳入视窗。
5. 百分比下拉仍可选 50/100/200%，右对齐弹出。
6. 浅 / 深主题均自动适配，无硬编码色值；`lint` / `tsc` / `test` 通过。
