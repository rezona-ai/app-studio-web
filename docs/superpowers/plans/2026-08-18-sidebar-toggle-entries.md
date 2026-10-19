# 两侧边栏的常驻开关入口 — 实现计划

设计稿：`docs/superpowers/specs/2026-08-18-sidebar-toggle-entries.md`
分支：`feat/edge-handle-liquid-follow`（worktree `.orca/worktrees/edge-handle-liquid`）

## 任务 1：三个图标 + 注册

- 新建 `public/figma/icons/{panel-left,expand-corners,collapse-corners}.svg`，规格见 spec。
- `src/components/ui/figma.tsx` 的 `figAsset` 登记 `panelLeft` / `expandCorners` / `collapseCorners`，各带一行用途注释。**不**登记 `ICON_TONE`（默认 primary 即所需）。

**验证**：`grep` 确认三个 key 已登记；`pnpm exec tsc --noEmit`。

## 任务 2：`previewFull` 进 store（供画布工具列读取）

- `src/store/types.ts`：`UIState` 加 `previewFull: boolean`；`Actions` 加 `togglePreviewFull: () => void`。
- `src/store/index.ts`：初值 `false`；action 只翻状态（**不写 localStorage**，写盘归 Workspace）；**不**进 `partializeAppState`（持久化仍走独立 key）。
- `Workspace.tsx`：删掉局部 `previewFull` state，改读 store；水合时把 localStorage 的值 set 进 store；用 effect 订阅 store 的 `previewFull` → 写 localStorage + `applyLayout`。
  - ⚠️ 注意保持既有不变式：`previewW` 恒是用户拖出来的常态宽，渲染宽由全宽态派生（`renderedPreviewW`）；不得让全宽宽度冒充常态宽（CLAUDE.md 已踩两次）。

**先写的失败测试**（`src/store/index.test.ts` 或就近）：
1. `togglePreviewFull` 翻转状态且**不写 localStorage**（写盘是 Workspace 的责任，两处都写必然漂移）。
2. `previewFull` 不在持久化切片里（`partializeAppState` 的返回值不含它）。

**验证**：`pnpm exec vitest run src/store`；Workspace 既有的全宽相关测试（「全宽是状态而非宽度到顶」等）保持绿。

## 任务 3：对话栏顶部的常驻按钮

- `ChatPanel` 加两个 prop：`collapsed: boolean` / `onToggleCollapsed: () => void`。
- 顶栏 `justify-between` 的右位放 `IconButton`（ghost）+ `Tooltip`，图标 `panelLeft`，`aria-label={t('workspace.chatCollapse')}`、`aria-expanded={!collapsed}`。
- `Workspace.tsx` 渲染 ChatPanel 时传入现有的 `chatCollapsed` / `toggleChatCollapsed`。

**先写的失败测试**（`ChatPanel.test.tsx`）：点击该按钮调用 `onToggleCollapsed`；按钮带正确的 `aria-expanded`。

## 任务 4：画布工具列的常驻按钮

- 工具列组件加一档：`IconButton`，`variant={previewFull ? 'raised-active' : 'ghost'}`、`aria-pressed={previewFull}`、`className="size-10"`，图标按状态在 `collapseCorners` / `expandCorners` 间切换，`aria-label` 取 `workspace.previewRestore` / `workspace.previewFullWidth`。
- 值与 action 由 `Inner` 从 store 取，按现有兄弟开关的写法透传。
- 位置：紧跟 minimap / 列表那一组之后（同属「视图开关」语义），不插到「新增资产」或「工具切换」那两档里。

**先写的失败测试**（`AssetCanvas.test.tsx`）：点击后 store 的 `previewFull` 翻转；全宽态下按钮 `aria-pressed=true` 且用 `collapse-corners` 图标。

## 任务 5：全量验证

`pnpm lint` / `tsc` / `pnpm test` / `pnpm build`；起 dev server 目视两个按钮在深浅两稿下的观感，并验「任一入口翻转后另一入口同步」。

## 提交划分

1. `feat:` 图标 + 注册（任务 1）
2. `refactor:` previewFull 进 store（任务 2）
3. `feat:` 两个常驻按钮（任务 3、4）
