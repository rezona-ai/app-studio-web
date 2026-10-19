# 实现计划：分组框上边距对齐四边（删掉几何里的标题条让白）

分支：`fix/group-frame-top-padding`（worktree `.orca/worktrees/fix-group-top-padding`）

## 问题与根因

框的硬下限（也就是新建框的几何）上边距 56px，其余三边 24px。

- `src/lib/canvas-group.ts:188` `boundingBoxOf()` 算原点：`y = floor(top - padding - GROUP_TITLE_H)`，
  而宽高按 `right/bottom + padding` —— 上边比另三边多出 `GROUP_TITLE_H`(32)。
- 但标题条从首版落地（`64576df4`）起就渲染在框**外**：`GroupNode.tsx:325` 是
  `absolute -top-8 left-0 h-8`，框体是 `absolute inset-0`（:297），内部**没有**任何
  `padding-top` 承接标题。框内让出的这 32px 谁都不用。
- `resizeFloor()` 委托 `boundingBoxOf`（:113），故这 32px 在缩放下限里也收不掉，成了永久不对称。

成因：plan `2026-08-05-canvas-groups.md:18` 的原设计是标题条占框内顶部一条，落地时标题挪到框外，
「参与包围盒」这条口径留了下来，一路没对齐。

## 决策（Nick 2026-08-20）

1. **只改新口径，不迁移存量**：改动只影响新建框与缩放下限；已落库的框几何不动，
   上边距仍是 56px，用户手动往上收一格即贴到新下限（下限已放宽 32px，收得动）。
   不做加载期自动复算 —— 那会吞掉用户刻意撑大的框，属「没动手就改几何」。
2. **删掉 `GROUP_TITLE_H` 常量**：不参与几何后它没有生产调用点（标题条渲染用 Tailwind
   `-top-8` / `h-8`）。按仓库既有先例（框体 16px 圆角 / 内缩 8 / 弧 16 / 命中 24 这四个耦合数），
   靠注释 + 单测把 `-top-8` 与 `h-8` 钉在一起，不留 dead code。

**不变式（不许被这次改动破坏）**：
- 取整方向仍是 floor/ceil 外扩，整数框恒包含浮点框；
- 「刚建出来的框一点也收不动」（下限与自身几何重合）；
- 标题条相对卡片的**屏幕位置不变** —— 框顶下移 32、标题在框外上方 32，两者相抵，
  故不引入新的「标题压上方卡片」风险。

## T1 · 几何口径对齐（单个 commit，先红后绿）

1. `src/lib/canvas-group.test.ts` 改断言至「四边对称」（此时应红）：
   - :37 用例名与 :43 → `expect(box.canvas_y).toBe(200 - GROUP_PADDING)`；
   - :53 → `expect(wide.height).toBe(CARD_SIZE.audio.h)`（padding 传 0）；
   - :91 → `expect(box.canvas_y).toBeLessThanOrEqual(pos.a.y - GROUP_PADDING)`；
   - `resizeFloor` 的 :238 用例名与 `top` → `200 - GROUP_PADDING`；
   - **新增**用例「四边内边距相等」：单卡建框，断言
     `canvas_x`/`canvas_y`/右缘/下缘到卡四边的距离全 = `GROUP_PADDING`
     —— 本 bug 的最小复现，也是防回归的正面锁。
2. `src/components/canvas/nodes/GroupNode.test.tsx` 在「硬下限(决策 3.5)」describe 里
   **新增北边下限用例**（组件级复现，此时应红）：成员 `position.y = 200`、框 `{x:0,y:0,w:600,h:400}`，
   `dragEdge('n', 0, 500)` → 框停在 `y = 176`（改前会停在 144），且 y 轴不画辅助线。
   与既有西边用例同构。
3. `src/lib/canvas-group.ts`：
   - 删 `GROUP_TITLE_H` 及其导出；
   - `boundingBoxOf` 的 `y` 去掉 `- GROUP_TITLE_H`；
   - 改注释：函数头「顶部再让出标题条」一句删掉，改为一句「标题条在框**外**渲染，故不占框内几何」；
   - `resizeFloor` 的注释同步（它只是委托，措辞里也提了标题条）。
4. `src/components/canvas/nodes/GroupNode.tsx:318` 标题条注释补一句耦合说明：
   `-top-8` 与 `h-8` 是同一个 32px 的两半，改一处必须同步另一处；且它**不进框几何**
   （历史上进过，导致框内顶部空 32px）。
5. 文档修正（同一 commit，`docs:` 与 `fix:` 各一 commit 亦可，按提交边界拆）：
   - `docs/superpowers/specs/2026-08-19-group-resize-snap-ui.md:42` 删「+ 顶部再让出 `GROUP_TITLE_H`」；
   - `docs/superpowers/plans/2026-08-19-group-resize-snap-ui.md:11` 同上；
   - `docs/superpowers/plans/2026-08-05-canvas-groups.md:18` 的 `GROUP_TITLE_H` 一行标注已废止
     并指向本文件。

验证：
```
pnpm exec vitest run src/lib/canvas-group.test.ts src/components/canvas/nodes/GroupNode.test.tsx src/store/actions.test.ts
```
（`actions.test.ts:4278` 是自反断言 `toMatchObject(boundingBoxOf(...))`，不会红，但要跑一遍确认建框链路无副作用。）

## 收口

1. 全量：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`。
2. 真机验证：新建一个框，四边留白目视等宽；把框收到最紧，上边距不再多出一截。
3. 派干净上下文子代理按 commit 范围独立评审（只给本 plan + diff）；Critical / Important 修完再合，Minor 记回本文件。
4. `--no-ff` 合并回 dev，在合并结果上重跑全量验证。
