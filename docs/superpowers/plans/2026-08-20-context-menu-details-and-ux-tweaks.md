# 卡片详情二级面板 + 三处 UI 收敛 — 实现计划

设计稿：`docs/superpowers/specs/2026-08-20-context-menu-details-and-ux-tweaks.md`
分支：`feat/ui-tweaks-details-submenu`（worktree `.orca/worktrees/ui-tweaks`）

四个任务互相独立，可分别评审。任务 4 内部按「并存加新 → 原子切换 → 删旧」推进。

---

## 任务 1 — Export as ZIP 迁入分享菜单

**改**：`src/components/preview/FileMenu.tsx` · `src/components/preview/PreviewPanel.tsx` · `src/i18n/locales/*.ts`

1. 先写失败测试（`FileMenu.test.tsx`）：菜单里有 `Export as ZIP`，位于分隔线之下、`Export as APK` 之上；点击调用 `onExportZip`；`exporting` 为 true 时该项禁用且有 `aria-busy`。
2. `FileMenu` 加 `onExportZip: () => void` 与 `exporting: boolean` 两个 prop；该项 `onClick` **不调 `onClose`**（在飞期菜单要留着显示进度）。
3. `PreviewPanel`：删掉工具条那枚下载 IconButton（含 `downloading` spinner 分支）；把既有 `handleDownload` 接给 `FileMenu`，拉完在 `finally` 里 `setFileMenuOpen(false)`。
4. i18n 11 语：新增 `preview.fileMenu.exportZip`；删 `preview.downloadZip`、`preview.downloading`（确认无其他引用后删）。
5. `PreviewPanel.test.tsx` 里四处 `Download ZIP` 断言改成「工具条上没有下载按钮」+「分享菜单里有 Export as ZIP」。

**验证**：`pnpm exec vitest run src/components/preview/FileMenu.test.tsx src/components/preview/PreviewPanel.test.tsx`

---

## 任务 2 — 撤掉预览侧折叠把手

**改**：`src/components/workspace/Workspace.tsx`

1. 先写失败测试（`Workspace.test.tsx`）：渲染后 `workspace.previewFullWidth` 名字的可访问元素**只有一个**（即 PreviewPanel 里那枚常驻按钮），把手不再贡献第二个。
2. 删预览 overlay 内那一处 `<EdgeHandle side="right" …>`（连带其上方注释）。`EdgeHandle` 组件本体、`lib/edge-handle.ts`、镜像单测**全部保留**给对话栏侧。
3. 检查 `previewFull` / `togglePreviewFull` 是否还有 Workspace 内的其他读点（派生渲染宽、写盘 effect）——有，保留。

**验证**：`pnpm exec vitest run src/components/workspace/Workspace.test.tsx`

---

## 任务 3 — lightbox 去翻页 + 动作条不透明底

**改**：`src/components/canvas/MediaLightbox.tsx` · `src/components/canvas/AssetCanvas.tsx` · 删 `src/lib/lightbox-nav.ts` 与 `src/lib/lightbox-nav.test.ts` · `src/i18n/locales/*.ts`

1. 先改测试为失败态（`MediaLightbox.test.tsx`）：无 `canvas.lightboxPrev/Next` 按钮、无 `lightbox-position`、按 `←/→` 不换 `lightbox.assetId`、按 Delete 后 `openLightbox(null)`。
2. `MediaLightbox`：删 `navList` prop、`nav`/`prevId`/`nextId`/`canNavigate`/`position`、两枚箭头按钮、位置指示、`←/→` 分支；`deleteCurrent` 改为「删卡 + `setLightbox(null)`」。
3. 遮罩 `pb-24` 与那条「箭头 top 偏移」注释：翻页删了，注释里关于 `top-[calc(50%-32px)]` 的告诫随之失效，一并删；`pb-24` 留着给动作条。
4. 动作条改**两层**：外层 `inset-x-0` 透明定位容器（全宽，**不挂** `stopPropagation` —— 挂了会把左右上千像素的透明区一并吞掉，那片看上去就是遮罩黑底）；内层 `w-fit` 不透明 pill（`rounded-[16px] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]`），`stopPropagation` 挂在 **pill** 上 —— 它的边界正是用户看得见的工具条边界，按钮之间那点缝也一并受保护，按钮因此不必各挂一份。这正是旧用例注释里 Q1 预留的改进，故「点空白关窗」那条用例的口径要跟着改成「点**透明区**关窗」，并补一条「点 pill 的缝不关窗」。按钮改 `hover:bg-[var(--color-fill)]`、图标 `tone="primary"`。
5. `AssetCanvas.tsx`：`<MediaLightbox navList={visibleAssets} />` → `<MediaLightbox />`；确认 `visibleAssets` 仍有其他用处（有）。
6. 删 `lib/lightbox-nav.ts` + 测试；i18n 11 语删 `canvas.lightboxPrev/lightboxNext/lightboxPosition`。

**验证**：`pnpm exec vitest run src/components/canvas/MediaLightbox.test.tsx`

---

## 任务 4 — 单选右键菜单 + Details 二级面板

### 4a 并存加新：壳支持子面板 + 单选菜单构造（不接线）

**改**：`src/components/canvas/ContextMenuShell.tsx` · 新 `src/components/canvas/AssetDetailSubmenu.tsx` · `src/components/canvas/ContextMenu.tsx` · 新 `public/figma/icons/info.svg` + `figAsset.info` · i18n `canvas.context.details`

1. 新图标 `info.svg`：`viewBox 0 0 20 20` · `fill="none"` · `stroke-width="1.5"` · round caps（与 `panel-left` 等同规格），登记 `figAsset.info`，**不**登记 `ICON_TONE`。
2. `MenuItem` 加可选 `submenu?: React.ReactNode`。带 `submenu` 的项：右端出 `chevronRight`、`aria-haspopup="dialog"` + `aria-expanded`；行外层包一个 `div`，`onPointerEnter` 立即开、`onPointerLeave` 延迟 200ms 关（timer 存 ref，卸载清理）；子面板作为该 `div` 的 **DOM 子节点**渲染（故指针进面板不触发 leave）。
3. 子面板落位：壳把菜单盒 rect 传给子面板，子面板用 `placeBesideRect` + 自身 `ResizeObserver` 实测高度算 `left/top`（复用 `AssetDetailPopover` 的量法后即可删除该文件）。
   ⚠️ **面板必须渲染在菜单盒之外**（见 spec 修正）：盒子 `overflow-hidden` + 动画期 `transform` 会把 `fixed` 子节点裁掉。于是第 2 步里「面板作为行的 DOM 子节点」不成立，`onPointerEnter` / `onPointerLeave` 要显式交给面板；延迟收起用 `leaving` state + effect，不用定时器 ref（渲染期传读 ref 的函数会被 `reactCompiler` 的 lint 拦）。行按钮宽度靠 `w-full` 自己撑，不靠父级 `align-items: stretch`。
4. 新 `AssetDetailSubmenu.tsx`：只负责外壳（`fixed` 定位 + `anim-pop-in` + pop 面 + `max-h` 内滚 + `role="dialog"`），正文 `<SingleAsset asset onClose />`。
5. `AssetDetailBody.tsx` 的 `SingleAsset` 加必填 `onClose: () => void`，替掉内部的 `openAssetDetail(null)`。
6. `ContextMenu.tsx` 加单选分支：`ids.length === 1 && gids.length === 0` → `[Details(submenu), ...singleAssetActions(asset) 映射]`，动作分派复用 `useAssetActionRunner`；选区分支原样不动。
7. 测试（`ContextMenu.test.tsx` 扩、新 `AssetDetailSubmenu.test.tsx`）：单选时首项是 Details 且带 chevron；hover 后面板出现并含提示词；`pointerLeave` + 计时器推进后面板消失；面板内 Edit and retry 调 `retryGeneration` 且关掉菜单；多选时无 Details。

### 4b 原子切换：两个入口改接新菜单

**改**：`src/components/canvas/AssetCanvas.tsx` · `src/components/canvas/AssetListDrawer.tsx`

1. `onNodeContextMenu` 单选分支：`selectAsset(id)` + `openContextMenu({ ids: [id], x, y })`。
2. `AssetListDrawer` 行右键：`openAssetDetail({...})` → `openContextMenu({ ids: [asset.id], x, y })`。
3. 更新 `AssetCanvas.contextmenu.test.tsx` / `AssetListDrawer.test.tsx` 的断言。

### 4c 删旧

**改**：删 `AssetDetailPopover.tsx` + `AssetDetailPopover.test.tsx` · `src/store/index.ts` · `src/store/types.ts`（若 `AssetDetailTarget` 在此） · `src/lib/canvas-keys.ts`(+测试) · `src/components/canvas/AssetCanvas.tsx`

1. 删 store 的 `assetDetail` 字段、`openAssetDetail` action、`AssetDetailTarget` 类型；`openContextMenu` / `openGroupMenu` 里那两处 `assetDetail: null` 一并去掉。
2. `canvas-keys.ts` 的 `canvasOverlayOpen` 去掉 `assetDetail` 入参与判定（`contextMenu` 已覆盖该路径），同步改其测试。
3. `AssetCanvas.tsx` 删 `<AssetDetailPopover />`、`openAssetDetail` 订阅与 `onPaneClick` 里那一行。
4. 全仓 `grep -rn "assetDetail\|openAssetDetail\|AssetDetailPopover" src` 归零。

**验证**：`pnpm exec vitest run src/components/canvas src/lib/canvas-keys.test.ts src/store`

---

## 收尾

1. 全量：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`。
2. 干净上下文子代理按 commit 范围独立评审（只给 spec + diff）。
3. Critical / Important 修完后 `--no-ff` 合回 dev，在合并结果上重跑完整验证。
