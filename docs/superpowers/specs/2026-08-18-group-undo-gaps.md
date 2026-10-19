# 分组框撤销缺格修复（拖框移动 / 成组）

- 日期：2026-08-18
- 范围：`src/store/{types,actions,index}.ts` · `src/components/canvas/AssetCanvas.tsx` · `src/i18n/*`
- 相关既有稿：`2026-08-03-canvas-undo`（撤销栈总纲）· `2026-08-05-canvas-groups`（分组框，决策 4 在此被推翻）· `2026-08-07-undo-and-overlay-guards` · `2026-08-12-canvas-ux-refinements`（乐观建框）· `2026-08-17-tidy-groups-as-boxes`（`groupGeoms` 字段来源）

## 1. 问题与根因

用户报告：**成组或拖动分组框之后按 ⌘Z，撤销不生效，且框里的卡片位置发生偏移。**

撤销逻辑本身没坏，坏的是**撤销栈里缺了这两格**：

| 操作 | 入口 | 是否入栈（修复前） |
|---|---|---|
| 拖框移动（框 + 全体成员刚性位移） | `AssetCanvas.tsx` `onNodeDragStop` 拖框分支 → `moveGroup` | ❌ 完全没有 `pushUndo` |
| 圈成一组（建框 + 成员归属） | `createGroupFromSelection` | ❌ 刻意不入栈（`2026-08-05` 决策 4） |

于是这两个操作之后按 ⌘Z，弹出的是**更早那一格**（通常是上一次拖卡）：`setAssetPositions` 把那批卡搬回旧坐标，而**框几何不动、`groupId` 也不动** —— 用户看到的就是「撤销没起作用」+「框里的卡跑偏 / 跑出框」，即容器模型里「几何是真相 vs 归属投影」当场打架。

## 2. 目的与成功标准

目的：让分组框的这两个操作各占一格撤销，⌘Z 只撤刚才那一步，框与成员几何、成员归属恒自洽。

成功标准（均为可断言用例）：

1. 拖框移动后 ⌘Z：框与全体成员一起回到拖动前坐标；框坐标 PATCH（`updateCanvasGroup` 只写 `canvas_x/canvas_y`）+ 成员坐标批量回写各发一次。
2. **空框**拖动后 ⌘Z 同样回位（`positions` 为空数组，只有 `groupGeoms`），不抛、不误报。
3. 零位移（只点了下标题条）不入栈 —— 与 `moveGroup` 既有零位移守卫同一判据。
4. 成组后 ⌘Z：框从画布消失、被圈中的卡 `groupId` 恢复成**建框前的原值**（本来属于别的框的卡回到那个框）、服务端收到 `deleteCanvasGroup`。
5. 成组 → 拖框 → ⌘Z ⌘Z：第一次回位，第二次删框。栈序不串。
6. 乐观期（真 `group_id` 尚未返回）成组后立刻 ⌘Z：DELETE 排到创建之后拿真 id 再发（复用 `withRealGroupId`），不带临时 id 发请求。
7. 框已被用户手动删掉后再 ⌘Z 到该格：安全 no-op，不抛、不谎报撤销成功。

## 3. 决策

**决策 1：拖框移动复用既有 `positions` entry，不新增类型。**
`{ type:'positions', op:'move', positions: 成员旧坐标, groupGeoms: [框旧坐标] }` —— 这正是 `2026-08-17-tidy-groups-as-boxes` 为一键整理引进 `groupGeoms` 时定下的语义（「本次操作若挪过分组框，撤销要把框搬回去，成员坐标已在 positions 里」），拖框与整理挪框在数据上同构，`undo()` 的 `positions` 分支一行都不用改。
**不带 `groups` 字段**：`moveGroup` 是刚性位移、明确不复判归属，撤销也不该碰归属。

**入栈落在 `moveGroup` 内，不在 UI 层**（实现期修正，原计划放 `onNodeDragStop`）：圈成一组后立刻拖框，手势拿到的还是**临时 group id**（拖拽期 sync effect 被 `isDraggingRef` 挡着，RF 那份节点没换成真 id），而别名表 `groupIdAlias` 只存在于 `createServerActions` 闭包里。UI 层拿 `g.gid` 去 `assets` 里筛成员会**一张也筛不到** ⟹ 撤销时成员留在新位置、只有框回去，又是一次「框内卡片偏移」。框坐标同理（`groups.find(临时 id)` 落空）。故 UI 层只管传 `delta`，解别名与入栈都在 store 里。

**决策 2：成组新增 entry 类型 `createGroup`，不复用 `deleteGroup`。**
```ts
| { type: 'createGroup'; pid: number; gid: string; members: { id: string; groupId: string | null }[] }
```
- 不复用 `deleteGroup`（延迟删除 token）：那条的撤销语义是「取消待删」，而这里要的是**真的把框删掉**；且延迟删除会再弹一条「已删除，可撤销」Toast 并再入一格栈，成了「撤销的撤销」。
- `gid` 存**入栈那一刻的 id**（乐观期即临时 id），撤销时经 `realGid` 解别名 —— 与 `moveGroup` 第一行同款处理，覆盖「成组后立刻 ⌘Z」这条最短路径。
- `members` 记建框前归属（`groupId: null` 表示当时无归属），与 `positions.groups` 字段形状一致但语义独立（那个是坐标 entry 的附挂）。

**决策 3：撤销成组 = 立即摘框 + 还原归属 + 服务端 DELETE，不走宽限窗口。**
新增 store action `undoCreateGroup(gid, members)`：本地一次 `set` 摘框 + 写回归属（一次落定，避免闪一帧「空框」，与 `createGroupFromSelection` 对称），服务端删框走 `withRealGroupId(gid, real => deleteCanvasGroup)`。服务端删框会自己把成员 `group_id` 解绑成 null（沿用 `flushPendingGroupDelete` 的既有契约），故**只对「原本属于别的框」的卡补一次 `assignGroup` 回写**，无归属的卡不发多余请求。
**期间新拖进框的卡**（`members` 里没有的）：框没了，归属只能清空 —— 几何上它们也不在任何框里，与容器模型自洽。

**决策 4：撤销成组不动卡片坐标。**
成组本身一张卡都不动（`2026-08-05` 决策 6），撤销自然也不动。反馈沿用其余 undo 分支的形状：`setSelection(原成员)` + `ensureVisible(框左上角)` + 新 Toast code `UNDO_CREATE_GROUP`（11 个 locale 全量补文案）。

## 4. 约束

- 撤销栈**存数据不存闭包**，`pid` 二次校验（沿用 `undo()` 既有防线）。
- 不做 redo：撤销成组这一格不再反向入栈。
- 框坐标回写仍只写 `canvas_x/canvas_y`（不碰尺寸）。
- 撤销拖框时框排在卡**之后**还原（`undo()` 现有注释的顺序不变）。

## 5. 已知限制（本轮不做，Minor）

- **缩放框 / 改框名仍不入栈**，同源症状仍会在这两条路径上出现（本轮范围只覆盖用户实际踩到的两个入口）。
- 由此派生：成组后先改名再 ⌘Z，会把框整个撤掉（改名一并消失）—— 标准栈语义（栈无分支），待缩放/改名补格后自然缓解。

## 6. 评审处置（干净上下文子代理，基于 `dev..HEAD` 与本稿）

评审结论：无 Critical。逐条对照代码库复核后处置如下。

**已采纳并修复：**

- **I1（Important）· 撤销成组的 DELETE 绕过该框的写队列**：`withRealGroupId` 只在 id 仍是临时 id 时排队，别名一登记就短路直发。于是「真 id 刚回来、`flushMembers` 的成员 `group_id` 批量回写还在飞 → 用户按 ⌘Z」这一窄窗里，DELETE 与那条批量并发：DELETE 先落地则成员挂上已删框的悬空 `group_id`（跨刷新存活），或后端拒绝后一条「分组未能保存」压在「已撤销：成组」上面。修法：新增 `sendGroupDelete` 作为删框请求的唯一出口，按临时 id 取 `pendingGroupTail` 挂队尾（队列已冲干则直发），延迟删框那条路径一并收口到它 —— 两处不再各写一份。
- **M1 · 撤销成组到 DELETE 落地之间缺 doomed 过滤**：这一个 round trip 内任何后台刷画布都会把服务端那个框重新列出来（框复活 + 成员归属被绑回）。修法：`deletingGroupIds` 全程登记，并入 `pendingGroupDeleteIds()` —— 延迟删框原先裸着的同一窗口顺带一起补上。
- **M2 · 归属回写缺逐卡仲裁**：本地还原是有条件的（仅 `groupId === gid`），而回写此前无条件按 `members` 发 ⟹ 给一张本地没动过的卡写回旧框（「卡在框外却仍是成员」）。可达路径是「缩小新框把某张挤出去（缩放框不入栈，栈序拦不住）后再 ⌘Z」。修法：回写只针对 `restored`（真被本次撤销动过的那批），顺带把「卡已被删」也关掉。
- **M3 · 零位移判据各写一份**：`moveGroup` 此前只拿它挡入栈、请求照发，真正拦住白发请求的是 UI 层另一份同款判据。修法：判据收成 store 一份（`moveGroup` 早返回），UI 层那份删掉。
- **M5 · 测试缺口**：补「成组 → 拖框 → ⌘Z ⌘Z」栈序用例（标准 5）、补成员坐标批量回写次数断言、把「乐观期建的框」用例名订正为「手势跨越重映射」。
- **M6**：补 `UNDO_CREATE_GROUP → canvas.undo.createGroup` 的词条守护（`ERROR_KEYS` 的值是裸字符串，写错只会弹空 Toast，tsc 管不到）。

**记录不做：**

- **M4 · 撤销拖框复用 `UNDO_MOVE` 文案**，空框拖动时「已撤销：移动卡片」名不副实。决策 1 明确复用 `positions` entry、不新增类型，文案沿用；要修得给 entry 加可辨识位，收益不抵改动面。
- 评审附带观察：乐观期 ⌘Z 之后创建才失败时，用户会先看到「已撤销：成组」再看到「成组失败」两条 Toast。两条语义都对，仅噪音。

**范围行订正**：`src/components/canvas/AssetCanvas.tsx` 因 M3 重新进入本轮改动范围（决策 1 那段「UI 层一行不改」只针对入栈落点）。

## 7. 顺带修掉的既有缺陷（范围外，独立提交）

`src/store/actions.test.ts` 的 `persistGroupPositions PATCH 失败` 用例把 mock 写成 `new Error('boom')`，而 `guard` 按设计只收 `PgcError`、其余照抛给全局（「留给它暴露 bug」）。于是那条用例人为制造了一个未捕获拒绝：用例本身全绿，但 vitest 记一条 unhandled rejection 并让整跑**退出非零** —— dev 上的 CI（run 32107700580）因此长红。改成 `PgcError('SERVER','boom',500)`（真实上游失败形状）并补一条 Toast 断言，语义不变、退出码转绿。
