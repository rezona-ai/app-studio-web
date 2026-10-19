# 游戏预览设备切换（移动端 / 桌面端）设计

日期：2026-07-03

## 需求

游戏预览支持切换设备类型显示：移动端与桌面端。默认移动端（现状竖屏 282:519）；点击桌面端后预览面板整体加宽，以 16:9 横屏展示游戏。

## 方案选型

- **A（采用）：桌面端复用「展开覆盖」机制**——面板宽走 compare / Files 同一条路（`calc(100% - chatW)` 覆盖画布，已有 300ms 宽度过渡），舞台内游戏框改为 16:9 contain 适配。零新布局机制、桌面预览尺寸最大化。
- B（否决）：按 16:9 反推有界面板宽——16:9 反推宽轻易超视口一半，必被 MAX 压住留黑边，还需新增一套宽度常量。
- C（否决，用户已排除）：面板不加宽、框内小横屏。

## 状态

- store UIState 新增 `previewDevice: 'mobile' | 'desktop'`，默认 `'mobile'`，**不持久化**（每次进入回默认移动端）；action `setPreviewDevice`。
- 切项目不需特殊处理（非持久化瞬态，保持当前值即可；如切项目重置成本为零也可顺手重置，实现时从简）。

## UI

- **切换控件**：位于 PreviewPanel tab 行右侧按钮组（下载 / 刷新旁），两个图标按钮组成的分段控件，样式语汇与 `PreviewTabs` 同款（浅底容器 + 选中态 `--color-line-strong` 底）：手机图标 = 移动端、显示器图标 = 桌面端。
- 重写现有无引用的遗留 `DeviceToggle.tsx`（原生 `<select>`，违反 UI 规范）为该分段控件并接入；沿用六语 i18n key `preview.deviceMobile` / `preview.deviceDesktop`（去掉文案中的 emoji）。
- 图标：优先用 `figAsset` 已有相近图标；没有则新增 SVG 到 `public/figma/icons/` 并登记。
- 无障碍：每个按钮带 `aria-label` + `aria-pressed`，外包 `Tooltip`。

## 布局

- `Workspace.tsx`：面板展开条件由 `compareOn || filesTab` 扩为 `compareOn || filesTab || previewDevice === 'desktop'`。
- `PreviewPanel.tsx`：`adaptiveStage`（短屏增高舞台逻辑）仅移动端生效；桌面端回落 flex 7:3。

## GameFrame

- 接 `device` prop：
  - 移动端：现状不变（282:519，`min(100%, calc(100cqh * 282 / 519))`）。
  - 桌面端：`width: min(100%, calc(100cqh * 16 / 9))` + `aspectRatio: '16 / 9'`。
- `setPreviewWidth` 上报仅移动端进行（桌面端面板宽不由比例反推）；切回移动端时恢复上报。
- 切换设备**不重建 iframe**（父级 key 不含 device），游戏运行态保活，仅框尺寸变化。

## 边界

- **对比模式**：隐藏设备切换控件（对比已全宽、双框自有布局）；进对比不强制改 device，退出后按当前 device 恢复。
- **Files tab**：设备切换与下载钮同规则——仅 preview tab 显示。
- **空态（无游戏）**：切换控件禁用。

## 测试

- store：`setPreviewDevice` action 单测（默认值 / 切换）。
- `PreviewPanel`：切换控件渲染、点击后 store 值变化、compare / files / 空态下的显隐与禁用。
- `GameFrame`：按 device 断言框尺寸样式；桌面端不上报 `setPreviewWidth`。
- `Workspace`：桌面端时面板宽为展开值（如现有测试结构允许）。
