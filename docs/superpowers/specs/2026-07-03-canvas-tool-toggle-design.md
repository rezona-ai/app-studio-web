# 画布工具切换（选中 / 移动）设计稿

日期：2026-07-03

## 背景

画布当前固定为「左键框选、中键平移、滚轮平移」。用户需要一个显式的工具切换：在**选中**与**移动画布**两种模式间切换，默认为选中。

## 交互

- 在底部浮动工具条 `ZoomBar` 的**最右侧**新增一组两个 `IconButton`：**选中**（cursor 图标）与**移动**（hand 图标），与前面的 minimap 按钮之间加一条分割竖线（沿用 `h-6 w-px bg-[var(--color-line)]`）。
- 激活项用 `raised-active` variant，非激活为 `ghost`，与 minimap 按钮同款式；各自包 `Tooltip`，带 `aria-label` 与 `aria-pressed`。
- **选中模式**（默认）：维持现状——空白处左键拖拽为框选（`selectionOnDrag`），中键拖拽平移。
- **移动模式**：空白处左键拖拽平移画布（`panOnDrag=[0,1]`，关闭 `selectionOnDrag`）；**节点仍可正常点选、拖动、右键**；中键平移不变。
- 不加键盘快捷键。

## 状态

- 工具模式是瞬态 UI 态，与 `minimapOpen` 同法：`Inner` 内 `useState<'select' | 'pan'>('select')`，向下传给 `ZoomBar`（渲染切换按钮）与 `ReactFlow`（切 `selectionOnDrag` / `panOnDrag`）。
- 不进 store、不持久化；切项目 / 刷新回到默认「选中」。

## 其他

- 图标：`cursor.svg` 已在 `figAsset` 注册；新增 `hand.svg` 至 `public/figma/icons/` 并登记 `figAsset.hand`（tone 走默认 primary，随 currentColor 翻转主题）。
- i18n：六语（en/zh/fr/ru/ja/vi）新增 `canvas.toolSelect` / `canvas.toolPan` 文案。
- 测试：`AssetCanvas` 相关组件测试断言默认「选中」为激活态，点击「移动」后 `aria-pressed` 翻转、ReactFlow 收到的拖拽配置随之切换。

## 不做

- 快捷键（V/H）。
- 完全抓手模式（移动模式下禁用节点交互）。
- 模式持久化。
