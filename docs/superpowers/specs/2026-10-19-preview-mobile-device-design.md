# 预览支持移动端（设备切换）设计稿

- 日期：2026-10-19
- 前置：`2026-10-19-remove-asset-canvas-design.md`（两栏工作台，预览列吃满剩余宽度、舞台内 16:9 信箱化）
- 先例：rezonalab-game-web 的 `2026-07-03-preview-device-toggle-design.md`（三栏时代做过「移动 / 桌面」切换，`13fdefeb` 改成全屏按钮时整体移除）

## 1. 目的

预览舞台现在只按桌面横屏展示（宽度封顶舞台高 × 16/9）。agent 生成的游戏常同时适配触屏，用户需要在工作台里直接看竖屏手机尺寸下的效果。
在预览 tab 行加「桌面 / 移动」切换，移动档把游戏框收成手机竖屏比例居中显示。

## 2. 现状与为何旧方案不能照搬

- 旧方案的「桌面」档要把面板展开覆盖画布，「移动」档靠 `setPreviewWidth` 反推面板宽——两者都建立在「预览列宽可变」上。
  两栏后预览列恒吃满剩余宽度，**设备切换只需改舞台内的框尺寸**，不碰任何列宽 / 布局状态。
- 旧图标 `device-mobile.svg` / `device-desktop.svg`、旧 i18n key `preview.deviceMobile` / `preview.deviceDesktop` 可从历史原样取回。

## 3. 决定

| # | 问题 | 结论 |
|---|---|---|
| 1 | 入口 | tab 行右侧按钮组最前（全屏 / 刷新之前），两个图标按钮的分段控件，样式与 `PreviewTabs` 同款（浅底容器 + 选中态 `--color-line-strong` 底），各自 `aria-label` + `aria-pressed` + `Tooltip` |
| 2 | 默认档 | **桌面**（=现状，零行为变化） |
| 3 | 是否持久化 | **持久化**，进 `rezonalab-v4` 的 `partialize` 白名单（`previewDevice`）。调移动端适配往往要反复刷新，每次回落桌面很烦；全局一份，不按项目分 |
| 4 | 移动档比例 | 沿用设计稿竖屏比例 **282:519**（≈ 9:16.6，旧移动预览框同款），不新造常量档位 |
| 5 | 移动档外观 | 框宽 `min(100%, 100cqh × 282/519)` + `aspect-ratio: 282/519`，圆角框（复用 `FRAME`），舞台加 `p-3` 留呼吸；底色仍是舞台 `--color-canvas` |
| 6 | 切换是否重载游戏 | **不重载**：iframe 节点位置不变，只改外层框的 class / style；父级 key 不含设备 |
| 7 | 显隐 | 与全屏按钮同条件：对比模式、Files tab 下不渲染；无游戏时禁用 |
| 8 | 全屏页 `/full`、分享页、对比视图 | 不受影响（本稿只改工作台预览舞台） |

## 4. 限制（明确不做）

- 只模拟**视口尺寸**，不改 User-Agent、不模拟触摸事件 / DPR。依赖 UA 或 `ontouchstart` 判定移动端的游戏在移动档下仍走桌面分支——要验证这类逻辑请扫码真机或用浏览器设备模拟。
- 不做机型列表 / 横竖屏旋转。

## 5. 改动

- `public/figma/icons/device-{mobile,desktop}.svg` 取回，`figAsset.deviceMobile` / `deviceDesktop` 登记（tone 默认 primary，选中态由使用处传 tone，同 `PreviewTabs`）。
- i18n：11 个语言补 `preview.deviceMobile` / `preview.deviceDesktop`（`i18n.test.ts` 守护键对齐）。
- store：`UIState.previewDevice: 'desktop' | 'mobile'`（默认 `'desktop'`）+ `setPreviewDevice`；加进 `partializeAppState`。
- `components/preview/DeviceToggle.tsx`：分段控件。
- `PreviewPanel.tsx`：tab 行接入；把 `previewDevice` 传给 `GameFrame`。
- `GameFrame.tsx`：`device` prop 决定框 class / style 与舞台内边距。

## 6. 测试

- store：默认 `'desktop'`、`setPreviewDevice` 切换、进入持久化切片。
- `DeviceToggle`：两按钮、`aria-pressed` 随状态、点击写 store、`disabled` 透传。
- `PreviewPanel`：preview tab 下渲染；compare / Files 下不渲染；无游戏时禁用。
- `GameFrame`：桌面档保持 16:9 封顶断言；移动档框带 282/519 比例与圆角、舞台带内边距；切换设备 iframe 不重建（同一 DOM 节点）。
