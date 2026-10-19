# 实现计划：撤销删框回滚成员坐标

对应 spec：`docs/superpowers/specs/2026-08-18-group-delete-undo-member-positions.md`

每个任务都最小可独立测试、可独立评审；先红后绿。

## 任务 1：失败用例（复现）

`src/store/actions.test.ts` 的 `deleteGroup(延迟删除 + 撤销)` describe 内补：

- **「删框 → 整理 → Toast 撤销：成员坐标一并回到删框前」**：seed 一个 (2000,2000) 的框带 2 张成员卡 + 1 张远处散卡（散卡当锚点，保证整理必挪框内那两张）→ `deleteGroup` → `tidyCanvas()` → 断言成员确实被挪走 → `undo(entry.token)` → 断言 ①框回旧坐标 ②`groupId` 全回来 ③**成员坐标 === 删框前**。

跑一次确认它红在第 ③ 条（前两条本来就绿）。

## 任务 2：快照增记成员坐标 + 撤销时放回（本地）

- `src/store/pending-delete.ts`：`PendingGroupDelete.memberIds: string[]` → `members: { id: string; position: { x: number; y: number } }[]`，注释同步改。
- `src/store/actions.ts`：
  - `deleteGroup` 建快照时记 `members`（`membersOf(...)` 已经拿到整张 asset，直接取 `position`）。
  - `cancelPendingGroupDelete`：同一次 `set` 里除归属外一并写回 `position`；卡已不在 `assets` 里则天然跳过（`assets.map` 语义）。
  - 乐观期建框那条 `assignGroup(pending.memberIds, ...)` 改读 `members.map(m => m.id)`。

任务 1 的用例转绿；既有「撤销：框与全体成员归属全回来」等用例不得回归。

## 任务 3：变位卡的坐标回写

- `cancelPendingGroupDelete` 内逐卡比对快照与当前坐标，收集**真的变位**的 id，非空才 `void persistAssetPositions(ids)`。
- 补两条用例：
  - 「整理后撤销 → 变位的成员走一次批量回写」（断言 `batchUpdateCanvasItems` 被调用且含成员 id）；
  - 「删框后直接撤销 → 一个坐标回写请求都不发」。

## 任务 4：边界用例

- 空框删除后撤销：不抛、不发回写。
- 窗口内某成员卡被删掉：其余卡照常回位，请求里不含幽灵 id。
- ⌘Z 栈路径（撤整理 → 撤删框）：第二步无变位、不重复回写。

## 任务 5：全量验证

`pnpm test` → `pnpm test:tz` → `pnpm exec tsc --noEmit` → `pnpm lint`（build 交给 CI），输出贴回。
