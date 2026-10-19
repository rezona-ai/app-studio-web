# 实现计划：分组框参与拖拽边缘对齐

spec：`docs/superpowers/specs/2026-08-19-group-frame-align-snap.md`
分支：`feat/group-frame-align-snap`（新 worktree，落 `.orca/worktrees/`）

四个任务按依赖顺序；前两个是「先把不变式补齐」，第三个才打开闸门，第四个收口候选集。
每个任务失败测试先行。

## T1 框的尺寸从数据取（纯函数，spec 决策 3）

- 失败测试：`src/lib/align-guides.test.ts` 加两条 —— `visibleRects` 对「有 `data.group.w/h`、无 `measured`」的节点产出**框的真尺寸**（不是 `cardSize` 回落）；有 `measured` 时仍以 measured 为准（框在浏览器里量得到，别把契约写成「永远不看 measured」）。
- 实现：`NodeLike` 加 `data?.group?: { w: number; h: number }`，`visibleRects` 的取数改「measured → data.group → cardSize」。
- 接线：`AssetCanvas.tsx` 的 `applyDragSnap.sizeOf` 同一口径（框优先 `data.group`）。

## T2 成员与落库跟随吸附后的坐标（spec 决策 4）

- 失败测试（`AssetCanvas.groupdrag.test.tsx`）：
  1. 「本帧有吸附偏移 ⟹ 成员位移 = 框位移 + 偏移」：喂一帧 `onNodesChange`（位置变更被 `applyDragSnap` 改写过）+ `onNodeDrag`（回调给**未改写**的原始坐标），断言成员落在含偏移的位置。要让 `applyDragSnap` 真的产出偏移：夹具给一个 3px 错位的锚点候选 + 容器 rect 桩（照 `snap.test.tsx` 的做法）。
  2. 「松手落库的框位移含吸附偏移」：断言 store 里框的新坐标 = 原始坐标 + 偏移。
- 实现：`livePositions` 给回调坐标加 `lastDeltaRef.current`；`lastDeltaRef` 的清零点从 `handleNodesChange` 的松手分支移到 `endDrag`，`beginDrag` 起手复位。
- ⚠️ 这两条改动**必须先于 T3**：闸门一开而它们没到位，就是当初写下「带框整体不吸附」的那个错位现场。

## T3 打开闸门（spec 决策 1）

- 失败测试：把 `AssetCanvas.snap.test.tsx` 里那条「本次拖的就是那个框 ⟹ 候选集清空」**反转**为「拖框时候选集照旧取到」（那条对照是上一回合为终审 I2 加的，本 spec 正面推翻它的期望值，注释里点名 spec 与决策号）。
- 实现：`beginDrag` 删掉 `if (groupDragRef.current.length > 0) candidatesRef.current = [];` 分支，恒 `snapshotCandidates()`；同步改掉它上方那段「带框的拖拽整体不吸附」的注释（否则又是一处旧口径残影）。

## T4 候选集排掉被拖框的成员（spec 决策 2）

- 失败测试：`snap.test.tsx` 加一条 —— 拖框时候选集**不含**该框成员的 id（含别的框的成员）。
- 实现：`snapshotCandidates(excludeIds)`；`beginDrag` 算出被拖框的成员 id 集（`membersOf` 口径，读 store 的 assets）传进去。

## 验证

`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz`，输出贴回本文件；真机走 spec 的 6 条成功标准（Nick 复验）。

## 实现记录与偏离（2026-08-19）

- **T2 / T3 / T4 合成一个提交**，plan 原先的「T2 先于 T3」拆法在测试上走不通：T2 的用例要观测「成员是否跟随吸附后的坐标」，就必须先有**真实的吸附偏移**，而偏移的前提正是 T3 打开闸门；实测又发现闸门一开、框立刻吸在**自己的成员**上（成员卡 x=100 与框的目标位置正好同缘 ⟹ `bestOnAxis` 取到 delta 0，框一步也挪不动），所以 T4 也必须同时到位。三者是一个不可分的最小可用变更。
- T1（尺寸取数）如期独立成一个提交。
- 夹具踩坑留档：`vi.spyOn(...).mockRestore()` 放在 `afterEach` 会把 spy **永久摘掉**，同 describe 里第一条用例绿、后续用例静默拿回 jsdom 的 0×0 rect 而假红。改成逐用例建 spy、逐用例 restore。

## 验证记录（2026-08-19 本轮跑出）

- T1 改前红：`align-guides` 1 failed | 45 passed → 改后 **46 passed**。
- T2/T3/T4 改前红：`groupdrag` 2 failed（框自己没吸附：`{x:100}` vs 应为 `{x:97}`；落库 `x:100` vs 应为 `97`）、`snap` 2 failed（候选集为 `[]`；候选集含被拖框的成员 `moving`）→ 改后 `canvas` + `align-guides` **594 passed**。
- 全量：`pnpm lint` 0 errors（12 条既有 warning）· `pnpm exec tsc --noEmit` 通过 · `pnpm test` **3895 passed | 4 skipped** · `pnpm test:tz` **4 passed | 1 skipped**。

## 待办（合并前）

- 真机走 spec 的 6 条成功标准（Nick）；未复验前不合并。
