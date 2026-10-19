# 实现计划：成组后选区升格为分组框 + 选框形变过渡

spec：`docs/superpowers/specs/2026-08-20-group-create-selection-morph.md`

任务按「纯状态 → 视觉 → 异常路径」推进，每个任务可独立测试、独立评审。

## 任务 1：成组落地即升格选区（store，含重映射与失败回滚）

**文件**：`src/store/actions.ts`（`createGroupFromSelection`）、`src/store/actions.test.ts`

先写失败测试：
1. 成组后 `selectedIds === []`、`selectedGroupIds === [新框 id]`（乐观期是临时 id）。
2. 重映射落地后 `selectedGroupIds === [realId]`（临时 id 不残留）。
3. 建框请求失败回滚后 `selectedIds` 恢复成入参那批卡、`selectedGroupIds === []`。
4. 守卫早退（`hasGroupedCard` 命中 / `groups == null` / 空选区）时选区**一字不动**。
5. 乐观期用户已改选区（另点了一张卡）→ 重映射不该把选区抢回框上（按 id 精确替换，非无条件覆盖）。

实现：三次既有 `set` 各加选区字段；重映射那次按 `gid === tempId` 做**精确替换**而非整体写死。

## 任务 2：`groupMorphGid` 瞬态信号

**文件**：`src/store/index.ts`（`UIState` 字段 + `clearGroupMorph` action）、`src/store/actions.ts`、测试同上

先写失败测试：
1. 成组后 `groupMorphGid === 新框 id`，重映射后跟着换成 realId。
2. `clearGroupMorph()` 置 null；失败回滚后为 null。
3. ~~不在 persist 白名单里的锁~~ —— **跳过**：`partializeAppState` 是显式白名单，新字段不加即不落盘，加一条断言只是重复既有结构性保证。

## 任务 3：形变层（CSS + GroupNode）

**文件**：`src/app/globals.css`、`src/components/canvas/nodes/GroupNode.tsx`、`GroupNode.test.tsx`

先写失败测试：
1. `groupMorphGid === group.id` 时渲染形变层（按 `data-group-morph` 定位），否则不渲染。
2. `animationend` 触发 `clearGroupMorph`。
3. 另一个框（id 不匹配）不渲染该层。

CSS：`.anim-group-morph` keyframes（inset −12→0、圆角 38→16、底色橙纱→透明）+ 进 `prefers-reduced-motion` 禁用列表。

> `border-style` 不可插值：形变层承担「虚线 + 橙纱」的淡出与几何收拢，实线选中描边由框体自身的选中态承担（两者叠放交叉）。测试只锁「层在 / 层不在 / 结束即清」，不锁具体帧值。

**实现落点与计划的两处差异**（理由见 spec）：① 收尾改用 `GROUP_MORPH_MS` 定时器，不用 `animationend`（jsdom 与「降低动态」下它都不触发）；② 缓动改 `260ms ease-out` + 55% 只压色的中间帧 —— 真机实测统一进场缓动让 12px 收拢在 ~35ms 内结束，等于没有过渡。

## 任务 4：⌘Z 撤销成组清两侧选区

**文件**：`src/store/index.ts`（`undo` 的 `createGroup` 分支）、对应既有测试
先写失败测试：撤销成组后 `selectedGroupIds === []` 且 `selectedIds` 是成员卡。改法：`setSelection` → `setCanvasSelection({ assetIds, groupIds: [] })`。

## 任务 5：全量验证 + 真机

`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test`、`pnpm test:tz`，随后 dev server 真机：框选 3 张散卡 → 圈成一组 → 看形变与选中态 → Delete 删的是框 → ⌘Z 回到卡选区。
