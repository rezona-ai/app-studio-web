# 实现计划：右边栏可拖拽调宽 + 预览完全自适应

对应 spec：`docs/superpowers/specs/2026-07-23-preview-resizable-width.md`

## 任务 1：精简 `lib/preview-width.ts` 为拖拽常量 + clamp（TDD）

- 重写 `src/lib/preview-width.test.ts`：只测 `clampPreviewW`（下限 330 / 上限 800 / 区间内原样）。
- `src/lib/preview-width.ts` 改为 `PREVIEW_WIDTH_MIN/MAX/DEFAULT + clampPreviewW`，删除 `GAME_RATIO`、`computePreviewWidth`、`computePreviewBlockHeight` 及版本区分高常量。
- 验证：`pnpm exec vitest run src/lib/preview-width.test.ts`

## 任务 2：删除 store `previewWidth` 机制

- `src/store/index.ts`：删 `previewWidth` 字段、`setPreviewWidth` action 及初始值。
- 删 `src/store/preview-width-state.test.ts`。
- `src/components/preview/GameFrame.tsx`：删测高 ResizeObserver 上报。
- `src/components/preview/PreviewPanel.tsx`：删可用高测量与 `computePreviewBlockHeight` 分支，预览块回 `flex-[7]`。
- 验证：`pnpm exec tsc --noEmit && pnpm test`

## 任务 3：Workspace 加预览列拖拽分隔条

- `previewW` 本地 state + `localStorage('workspace.previewWidth')` 恢复（同 chatW 模式）。
- 画布与 spacer 间加 `role="separator"` 分隔条，向左拖增宽，`clampPreviewW` 夹取；拖拽期间沿用现有全屏遮罩与关过渡逻辑。
- spacer / overlay / `GenerateFormHost` / `Toast` 的 `rightInset` 改用 `previewW`。
- i18n：新增 `workspace.resizePreview` 11 语。
- 验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
