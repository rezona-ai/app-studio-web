# 窗口缩放时的左右边栏碰撞消解 — 实现计划

日期：2026-07-25
设计稿：`docs/superpowers/specs/2026-07-25-sidebar-collision-on-resize-design.md`

## 任务 1：几何纯函数 `src/lib/sidebar-fit.ts`（TDD）

新建 `src/lib/sidebar-fit.ts`，把 Chat 列常量从 `Workspace.tsx` 上移并加入碰撞消解：

- `CHAT_WIDTH_DEFAULT / MIN / MAX`、`SEPARATOR_TOTAL_W = 2`、`clampChatWidth()`；
- `minPageWidth(viewportH)` = `CHAT_WIDTH_MIN + minPreviewWidth(viewportH) + SEPARATOR_TOTAL_W`；
- `fitSidebars({ chatW, previewW }, viewportW, viewportH)` 按设计稿式子返回实际宽。

先写 `src/lib/sidebar-fit.test.ts`：无碰撞原样返回 / 先压右栏到下限 / 右栏到下限后压左栏 / 双方到底原样返回（页面滚动）/ 期望宽超 `CHAT_WIDTH_MAX` 与低于 `MIN` 的夹取 / 期望预览超 16:9 上限的夹取 / `minPageWidth` 随视口高变大。

验证：`pnpm exec vitest run src/lib/sidebar-fit.test.ts`

## 任务 2：`Workspace` 接入碰撞消解与滚动兜底（TDD）

先在 `src/components/workspace/Workspace.test.tsx` 补用例（`fireEvent(window, new Event('resize'))` 驱动）：

1. 缩小视口宽 → 预览列先到下限、Chat 列随后收窄，且两栏合计 ≤ 视口；
2. 视口窄于最小页宽 → 两栏停在下限，内容行 `min-width` 等于 `minPageWidth`；
3. 自动消解不改写 `localStorage` 的两个宽度键；
4. 视口放大回去 → 两栏回到用户期望宽（先落盘一个宽度再缩放-放大）。

再改 `Workspace.tsx`：

- 常量改为从 `sidebar-fit` 引入；新增 `desiredChatW` / `desiredPreviewW` ref 与 `persistWidth()`；
- `viewport` state（`null` 表示 SSR 未测量）+ 挂载测量 + `resize` 监听（统一走 `fitSidebars`）；
- 渲染期派生值（`maxPreviewW` / `minPreviewW` / `previewFull` / `minPageW`）改读 `viewport` 而非 `window`；
- 拖拽落手、一键全宽、恢复三处写入改走 `persistWidth`；
- 外层加横向滚动容器，内容行加 `minWidth`，弹窗 / Toast 留在滚动容器外。

验证：`pnpm exec vitest run src/components/workspace/Workspace.test.tsx`

## 任务 3：全量校验与运行态复核

- `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test`；
- 起 dev/prod 用 Playwright 逐档改视口（1440 → 800 → 600 → 1440）截图核对：预览先窄、Chat 后窄、窄档出横向滚动、放大复原。
