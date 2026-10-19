# 实现计划：分组卡的选区升格 + 成组守卫 + 撤销 Toast 时长

spec：`docs/superpowers/specs/2026-08-20-group-selection-guard-and-undo-toast-window.md`
分支：`fix/group-marquee-selection-and-undo-toast`（worktree `.orca/worktrees/fix-selection-undo`）

三个独立可测、可独立评审的任务组，各自一个 commit。任务内先写失败测试再实现。

## T1 · 橡皮筋框选升格（spec 决策 1）

1. `src/lib/canvas-selection.test.ts` 补失败用例：
   - `absorbMembers` 开启时，只报成员卡 id → `{ assetIds: [], groupIds: ['g1'] }`；
   - 混合（成员 + 散卡）→ 散卡留在 `assetIds`，框追加在 `groupIds` 末尾；
   - 同框多个成员只升格出**一个**框 id（去重）；
   - 悬空归属（框已不存在）仍按散卡；
   - 入参已含该框时不重复追加；
   - **不开** `absorbMembers` 时行为一字不变（回归锁，守「点选组内单卡」那条既有决策）。
2. `src/lib/canvas-selection.ts`：`normalizeSelection` 加第四参 `opts?: { absorbMembers?: boolean }`。
3. `src/components/canvas/AssetCanvas.contextmenu.test.tsx` 补失败用例：先 `onSelectionStart` 再 `onSelectionChange([m1])` → store 选区是 `{ assetIds: [], groupIds: ['g1'] }`；不经 `onSelectionStart` 的同一次回报 → 仍是 `{ assetIds: ['m1'], groupIds: [] }`。
4. `AssetCanvas.tsx`：加 `marqueeRef`（`onSelectionStart` 置位，`onSelectionEnd` 延一拍复位，与 `isDraggingRef` 并列**不复用**），`onSelectionChange` 按它传 `absorbMembers`。

验证：`pnpm exec vitest run src/lib/canvas-selection.test.ts src/components/canvas/AssetCanvas.contextmenu.test.tsx`

## T2 · 成组守卫（spec 决策 2）

1. `src/lib/canvas-selection.test.ts`（判据与选区同源，放同一文件）补失败用例：`hasGroupedCard(assetIds, assets, groups)` —— 全散卡 false / 含现存框成员 true / 悬空归属 false / `groups` 为 null false。
2. `src/lib/canvas-selection.ts` 导出该纯函数。
3. `src/components/canvas/ContextMenu.*.test.tsx` 补失败用例：选区含组内卡时「圈成一组」`disabled`；全散卡时可点。
4. `ContextMenu.tsx`：`disabled` 条件并入该判据（保留既有「全是占位卡」那半）。
5. `src/store/group-selection.test.ts` 补失败用例：`createGroupFromSelection` 收到含组内卡的选区 → 不建框、不发 `createCanvasGroup`、不入撤销栈。
6. `actions.ts`：`createGroupFromSelection` 加同口径守卫（整体拒绝）。

验证：`pnpm exec vitest run src/lib/canvas-selection.test.ts src/store/group-selection.test.ts src/components/canvas/ContextMenu.*.test.tsx`

## T3 · 撤销 Toast 时长（spec 决策 3 + 4）

1. `src/components/ui/Toast.test.tsx` 补失败用例：
   - 带 `action` 的 toast，`durationMs: 6000`，中途 hover 进出若干次后推进到 6000ms → `clearToast` 已被调用（当前实现会因 hover 重置而**没有**调用）；
   - 无 `action` 的 toast，hover 期不消失、移出后重新计满一轮（既有行为回归锁）；
   - 退场期（`closing`）撤销按钮 `disabled`。
2. `Toast.tsx`：拆成两个 effect（不可暂停那条 deps 不含 `hovering`）；撤销按钮 `disabled={closing}`。

验证：`pnpm exec vitest run src/components/ui/Toast.test.tsx`

## 收口

1. 全量：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`。
2. 派干净上下文子代理按 commit 范围独立评审（只给 spec + diff）；Critical / Important 修完再合，Minor 记回 spec。
3. `--no-ff` 合并回 dev，在合并结果上重跑全量验证。
