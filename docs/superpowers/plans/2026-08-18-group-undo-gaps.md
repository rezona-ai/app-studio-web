# 实现计划：分组框撤销缺格修复

spec：`docs/superpowers/specs/2026-08-18-group-undo-gaps.md`

每个任务最小可独立测试、可独立评审；一律先写失败测试再写实现（铁律 1）。

## T1 · 类型与文案（无行为）
- `src/store/types.ts`：`UndoEntry` 增 `createGroup` 分支（含注释说明为何不复用 `deleteGroup`）。
- `src/i18n/errors.ts`：`UNDO_CREATE_GROUP: 'canvas.undo.createGroup'`。
- 11 个 locale 补 `canvas.undo.createGroup`。
- 验证：`pnpm exec vitest run src/i18n` + `tsc --noEmit`。

## T2 · store action `undoCreateGroup`
- `src/store/actions.ts`：新增 `undoCreateGroup(rawGid, members)`；解别名 → 本地一次 `set` 摘框 + 写回归属 → `withRealGroupId` DELETE → 对「原本属于别的框」的卡补 `assignGroup`。框不存在 → no-op 返回 false（供 `undo()` 判断是否报成功）。
- 测试（`src/store/actions.test.ts`）：
  - 摘框 + 归属还原（含「原本属别的框」的卡）；
  - 发出 `deleteCanvasGroup`（真 id）；
  - 乐观期临时 id：DELETE 排在创建之后、参数是真 id；
  - 框已不存在 → 不发请求、返回 false。

## T3 · 成组入栈
- `src/store/actions.ts` `createGroupFromSelection`：乐观落框的同一次 `set` 里 `pushUndoEntry({ type:'createGroup', pid, gid: tempId, members })`；创建失败回滚时把这条 entry 摘掉（框已不存在，留着就是假撤销入口，与 `flushPendingGroupDelete` 同一不变式）。
- 测试：成组后栈顶是 `createGroup` 且 `members` 为建框前归属；创建失败后栈里没有这条。

## T4 · `undo()` 分派
- `src/store/index.ts`：`case 'createGroup'` → 调 `undoCreateGroup`，成功才 `setSelection` + `ensureVisible` + `setSuccess('UNDO_CREATE_GROUP')`。
- 测试：成组 → `undo()` → 框消失 / 归属还原 / Toast code 正确；no-op 时不报成功。

## T5 · 拖框移动入栈
**落点修正**：原计划放 UI 层 `onNodeDragStop`，实现时改到 store 的 `moveGroup` 内 —— 乐观期手势带的是临时 group id，别名表只在 actions 闭包里，UI 层筛不到成员也找不到框（详见 spec 决策 1 的补充段）。UI 层一行不改。
- `src/store/actions.ts` `moveGroup`：平移那次 `set` 里按 `delta` 非零入栈 `{ type:'positions', op:'move', positions: 成员平移前坐标, groupGeoms: [{ id: 真 gid, x, y }] }`。
- 测试（`src/store/actions.test.ts` `moveGroup` describe）：拖框后 ⌘Z 框与成员一起回位 + 框坐标只回写两个字段；空框（`positions: []`）不出错；零位移不入栈；乐观期临时 id 拖框后撤销仍解得开别名。

## T6 · 合并前全量验证
`pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test` · `pnpm test:tz` · `pnpm build`，然后派干净上下文子代理按 commit 范围评审（只给 spec + diff）。
