# 实现计划：分组框标题量纲 + 成员数即时更新 + Backspace 删框

spec：`docs/superpowers/specs/2026-08-13-group-title-and-key-delete.md`
分支：`feat/canvas-group-title-and-key-delete`（worktree `.orca/worktrees/feat+canvas-group-title-and-key-delete`）

拆三个任务，各自可独立测试、独立评审、独立提交。顺序有讲究：任务 2（bug）**先做**，它的测试要断言「松手即见新数量」，而任务 1 改的正是显示数量那段 —— 反过来做会让 bug 的测试建在将被改写的 DOM 结构上。

---

## 任务 1（先做）：成员数松手即更新

**目标**：拖卡入框 / 出框、拖框覆盖卡后，松手那一刻框上的数量就对。

**改动点**

`src/components/canvas/AssetCanvas.tsx`：`persistDraggedNodes` 末尾那个 `setTimeout(0)` 里，复位 `isDraggingRef` 之后补跑一次 sync。落法：加一个 `resyncTick` state（或 `useReducer` 的 bump），把它列进 sync effect 的 deps，在复位标记的同一个 tick 里 `+1`。**不要**动 `setTimeout(0)` 本身（它保 `onNodesChange` 最后一帧先落定，见 `2026-08-11-drag-commit-guards`）。

同一个 `setTimeout` 里复位 + bump，保证「放行」与「补跑」成对，日后谁改其中一半都会被下面的测试抓住。

**测试**（`src/components/canvas/AssetCanvas.dragstop.test.tsx` 已有 ReactFlow 桩夹具，捕获 props 后手工喂松手帧）

- 拖卡落进框 → 手工触发 `onNodeDragStop` → 用假计时器推进 → 断言 `ReactFlow` 收到的 `nodes` 里那个 group 节点的 `data.memberCount` 已是新值。夹具已捕获 `nodes` prop（既有用例用它断言落点），复用同一断言口。
- 变异确认：删掉 bump（只留复位）→ 该用例必须红。

**验证**：`pnpm exec vitest run src/components/canvas/AssetCanvas.dragstop.test.tsx` + `tsc --noEmit`。

**提交**：`fix(canvas): 拖拽落定后补跑一次同步,成员数不再滞后一次点击`

---

## 任务 2：标题条改「框名 · N 张卡」

**改动点**

1. `src/components/canvas/nodes/GroupNode.tsx`：标题条内两段结构改为
   - 框名 `<span className="truncate">`（可截断）
   - 分隔中点 + 计数 `<span className="shrink-0">`（恒完整；`font-mono` 留给数字，量词跟着走）
   - 改名态只替换框名那一段，计数保持渲染。
2. i18n 11 个 locale 新增 `canvas.group.memberCount`：zh `{{count}} 张卡` / en `{{count}} card(s)` / 其余按各语言的兼容写法（不引入复数机制，见 spec 约束）。

**测试**（`GroupNode.test.tsx`）

- 断言标题条同时含框名与「3 张卡」文案（测试环境 i18n 是 en，故断言 `3 card(s)`），且两者不在同一个 span 里。
- 计数为 0 时照常显示。
- 改名态下计数仍在（现有用例只断言输入框出现，补这条）。
- 长框名：断言框名那段带 `truncate`、计数那段带 `shrink-0`（钉住「只截名字」这条契约）。

**验证**：`pnpm exec vitest run src/components/canvas/nodes/GroupNode.test.tsx` + `pnpm exec tsc --noEmit`（`Messages` 以 en 推导，少一个 locale 键就红）。

**提交**：`feat(canvas): 分组标题改「框名 · N 张卡」,量纲不再糊在名字里`

---

## 任务 3：框的选中态与 Backspace 删除

**改动点**

1. `src/store/index.ts`：
   - `selectedGroupId: string | null`（UIState，瞬态，**不进 persist 白名单**）。
   - action `selectGroup(gid: string | null)`：置框选中的同一次 `set` 里清 `selectedIds`（互斥）。
   - 反向互斥：`selectAsset` / `setSelection` 置非空选区时清 `selectedGroupId`；`clearSelection` 一并清。
   - 切项目清瞬态那一处加 `selectedGroupId: null`（与 `groupMenu` / `groupRenameId` 同批）。
2. `src/lib/canvas-keys.ts`：新增纯函数 `shouldTriggerGroupDelete(key, hasSelectedGroup, activeEl, lightboxOpen)` —— 形参口径与 `shouldTriggerCanvasDelete` 对齐（`lightboxOpen` 同样必填，理由同那条）。
3. `src/components/canvas/nodes/GroupNode.tsx`：
   - 框体 `onClick` → `selectGroup(group.id)`。**必须挡住「拖完的那一下 click」**：RF 拖拽结束也会派发 click，用「本次 mousedown 到 click 之间指针有没有移动」判定（阈值 3px，与既有拖拽判定口径一致即可），移动过就不算点选。
   - 选中态视觉：`shadow-[0_0_0_3px_var(--color-teal-soft)]`，与 drop（`border-2` + 浓底）、leave（虚线 + 减淡）三态互不重叠。
   - 选中态数据从 store 读（`selectedGroupId === group.id`），不进 node.data —— 免得每次选中都要重建节点。
4. `src/components/canvas/AssetCanvas.tsx`：
   - 新增一个 keydown effect：`shouldTriggerGroupDelete` 命中 → `preventDefault` + `deleteGroup(selectedGroupId)`。与卡片那条**分开注册**，靠两个选区互斥保证同一次按键只命中一条。
   - `onPaneClick` 里 `selectGroup(null)`。

**测试**

- `src/lib/canvas-keys.test.ts`：`shouldTriggerGroupDelete` 表驱动 —— 键名（Backspace/Delete/其他）× 有无选中框 × 焦点在输入框 × lightbox 开关。
- `src/store/overlay-exclusivity.test.ts`（或新建 `group-selection.test.ts`）：选框清卡选区、选卡清框选中、`clearSelection` 一并清、切项目清掉。
- `GroupNode.test.tsx`：点框体 → `selectedGroupId` 被置；**拖过之后的那一下 click 不选中**（先 mousedown → mousemove 超阈值 → click）；`selectedGroupId` 指向本框时框体带外晕类名，指向别的框时没有。
- `AssetCanvas.contextmenu.test.tsx` 或新建 `AssetCanvas.keys.test.tsx`：选中框 + 按 Backspace → `deleteGroup` 被调用且参数是该 gid；**卡片选区非空时按 Backspace 不删框**（正向对照）；焦点在输入框时两条都不触发。

**验证**：上述文件 + `pnpm lint` + `pnpm exec tsc --noEmit` + `pnpm test` 全量 + `pnpm build`。

**提交**：`feat(canvas): 框可点选并支持 Backspace 删除,与卡片选区互斥`

---

## 每个任务后

派干净上下文子代理按 commit 范围评审（只给 spec + diff）；Critical / Important 修完才继续，Minor 记录留终审。三个任务做完 → 终审全分支 → `--no-ff` 合回 dev → 合并结果上重跑完整验证 → `/walkthrough`。

## 已知风险

- **「拖完的 click」误判成点选**：这是任务 3 唯一的真风险，也是唯一需要真机确认的点（jsdom 里 RF 的拖拽驱动不出来，单测只能验判据本身）。真机要过三条：框内空白拖整组松手后**不**选中框、原地点一下**选中**、点完再按 Backspace 删掉。
- **两个选区互斥要成对写**：只写一半（选框清卡、但选卡不清框）会留下「两个选区同时非空」的中间态，键盘层就得裁决优先级 —— 那是本 spec 刻意用互斥回避掉的复杂度。测试必须两向都断言。
