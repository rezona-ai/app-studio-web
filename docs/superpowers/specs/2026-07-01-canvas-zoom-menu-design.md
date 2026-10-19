# 画布缩放菜单设计稿

- 日期:2026-07-01
- 设计稿:Figma node `396:18921`(TALUNA DEVELOPER SITE / “Zoom - Views Dropdown”)
- 范围:重做画布底部浮条的缩放交互,用一个向上弹出的浮层菜单替换现有的 `+/−/fit` 三个按钮与三档预设下拉,并把缩放区间扩到 10%–200%。

## 背景与现状

`src/components/canvas/AssetCanvas.tsx` 里的 `ZoomBar`(底部居中浮条)当前结构:

```
[整理 tidy] | [小地图 minimap] | [+] [−] [fit] | [100% ▼ 预设]
```

- `100% ▼` 点开只有 50% / 100% / 200% 三档预设下拉。
- 缩放常量 `MIN_ZOOM = 0.5`、`MAX_ZOOM = 2`;步进按钮用 `stepZoom(±5 百分点)`(`src/lib/zoom.ts`)。
- `<ReactFlow>` **未显式设 `minZoom`**,走 React Flow 默认下限 `0.5`;`fitViewOptions={{ minZoom: 1, maxZoom: 1 }}` 仅用于初始挂载锁定 100%。

## 目标

1. 按设计稿实现一个缩放浮层菜单(顶部可编辑百分比输入 + 五个操作项 + 快捷键提示),替换 `+/−/fit` 按钮与旧预设下拉。
2. 菜单里的 Zoom in / Zoom out / Zoom to fit **复用原按钮的逻辑**(`stepZoom` / `fitView`),不另起一套。
3. 缩放区间调整为**最小 10%、最大 200%**。
4. 绑定全局键盘快捷键 `⌘+ / ⌘− / ⌘0 / ⌘2 / ⌘1`。
5. 保留底部浮条的「整理」与「小地图」按钮,仅移除 `+/−/fit`。

非目标:不改画布拖拽/落位/框选逻辑;不改小地图与整理功能;不做移动端断点。

## 设计

### 1. 缩放区间:10%–200%

- `MIN_ZOOM = 0.1`、`MAX_ZOOM = 2`。
- **关键修复**:给 `<ReactFlow>` 补 `minZoom={0.1} maxZoom={2}`。否则 React Flow 默认下限 0.5 会把 `zoomTo(0.1)` 夹回 0.5,10% 无法生效。
- 初始锁定 100% 的 `fitViewOptions={{ minZoom: 1, maxZoom: 1 }}` **保持不变**(仅作用于初始 `fitView` prop)。
- 「Zoom to fit」调用无参 `fitView()`,在新的 0.1–2 区间内自适应,可缩到 10% 展示全部内容。

### 2. `ZoomMenu` 浮层组件(对齐 node 396:18921)

新增自包含组件 `ZoomMenu`(canvas 模块内),从 `100% ▼` 药丸向上弹出。

- **定位/动效**:`origin-bottom-right` + `.anim-pop-in`(复用既有动画类);宽 `w-[204px]`(取设计稿 width=204)。
- **外观**(深色稿映射为语义变量,自动适配明暗,不硬编码色值):
  - 容器:`bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]` + `rounded-[16px]`。
  - 快捷键 chip:复用搜索栏那套 —— `rounded-[6px] bg-[var(--color-fill)] px-1.5 py-0.5 text-[11px] tracking-[-0.11px] text-[var(--color-muted)] shadow-[var(--shadow-shortcut)]`。
- **结构**(自上而下):
  1. **可编辑输入框**:取景框图标(复用 `figAsset.frame`)+ `<input>` 显示当前百分比。控件圆角 `rounded-[8px]`,边框 `--color-line`;聚焦走既有「边框转 accent + 柔光环」聚焦态。
     - 回车 / 失焦时用 `parseZoomInput` 解析并 clamp 到 10–200% 后 `zoomTo(value, { duration: 200 })`;非法输入回退到当前缩放值。
  2. **Zoom in `⌘+`** / **Zoom out `⌘−`**:复用旧 `+/−` 按钮逻辑 `zoomTo(stepZoom(zoom, ±5, MIN, MAX))`;到边界(≥200% / ≤10%)行置灰不可点。
  3. **Zoom to 100% `⌘0`** / **Zoom to 200% `⌘2`**:`zoomTo(1)` / `zoomTo(2)`;当前缩放命中该档(`round(zoom*100)` 相等)时行首显示 ✓。
  4. **Zoom to fit `⌘1`**:复用旧 fit 按钮逻辑 `fitView({ duration: 200 })`。
- **菜单项样式**:`flex items-center justify-between`,悬停 `bg-[var(--color-fill)]`;行首预留勾选位。
- **关闭**:外层加透明遮罩,`onClick` / `onWheel` 关闭菜单(沿用仓库「遮罩 onWheel 即关闭以放行画布缩放」约定)。z 阶梯:菜单 `z-[56]`、遮罩 `z-[55]`(沿用既有阶梯,不插新值)。
- **开合态**:局部 `useState`(与当前 `ZoomBar` 内预设下拉一致,不进 store)。

### 3. 全局键盘快捷键

- 新增薄 hook `useZoomShortcuts`(canvas 模块内,`ReactFlowProvider` 作用域下),`window.addEventListener('keydown')` 监听。
- 匹配规则用**纯函数** `matchZoomShortcut(e)`(可测):`e.metaKey || e.ctrlKey` 且:
  - `+` / `=` → `'in'`
  - `-` → `'out'`
  - `0` → `'reset'`(100%)
  - `2` → `'double'`(200%)
  - `1` → `'fit'`
- 命中即 `preventDefault()`(拦截浏览器缩放 / 切标签页默认行为)。
- **焦点在输入类元素(`input` / `textarea` / `contenteditable`)时不触发**,避免与 Composer / 搜索栏冲突。
- 副作用(监听、`zoomTo`/`fitView` 调用)留在 hook 内;不在 effect 里 `setState`(遵守仓库禁 effect-setState 约束)。

### 4. 底部浮条与 i18n

- `ZoomBar` 结构变为:`[整理] | [小地图] | [100% ▼ 菜单]`。删除 `+/−/fit` 三个 `IconButton` 与旧三档预设下拉。
- `100% ▼` 药丸文案继续显示 `round(zoom*100)%`,点击开合 `ZoomMenu`。
- i18n 六语(en/zh/fr/ru/ja/vi,en 为真相源)新增:`zoomTo100` / `zoomTo200` / `zoomToFit` / `zoomValue`(输入框 aria-label);复用现有 `zoomIn` / `zoomOut` / `zoomPresets`。

### 5. 纯逻辑与测试(`src/lib/zoom.ts` + `zoom.test.ts`)

- 保留 `stepZoom`。
- 新增 `parseZoomInput(raw: string, min: number, max: number): number | null`:解析 `"150%"` / `"150"` / `" 150 "` → `1.5` 并 clamp;非法(空 / NaN)返回 `null`。
- 新增 `matchZoomShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): ZoomShortcut | null`(`ZoomShortcut = 'in' | 'out' | 'reset' | 'double' | 'fit'`)。
- 补测:新区间 clamp、各快捷键映射、输入解析边界。

## 自决点(brainstorm 时已与 Nick 确认)

1. 快捷键 chip **恒显示 `⌘`**(设计稿即 `⌘`)。为规避 hydration mismatch(会连累主题回退)+ 仓库禁 effect-setState,不做 Win/Mac 动态切 `Ctrl`;keydown 处理仍认 `Ctrl`,Windows 功能可用、仅 chip 文案是 `⌘`。
2. 菜单开合用局部 `useState`,不进 store。
3. 浮层圆角 `rounded-[16px]`,输入框 / chip 用 8px / 6px 控件圆角。

## 验证

- `pnpm exec vitest run src/lib/zoom.test.ts`:纯逻辑单测通过。
- `pnpm exec tsc --noEmit` / `pnpm lint`:类型与 lint 通过。
- 手动:菜单弹出对齐设计稿;输入 150 回车缩到 150%;`⌘+/−/0/2/1` 生效且在 Composer 输入时不误触;缩放能到 10% 与 200% 两端;当前档打勾正确。
