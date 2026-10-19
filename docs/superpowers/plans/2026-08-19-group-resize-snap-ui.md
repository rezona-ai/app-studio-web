# 实现计划：分组框缩放的把手 UI + 边缘对齐 + 硬下限

spec：`docs/superpowers/specs/2026-08-19-group-resize-snap-ui.md`
分支：`feat/group-resize-snap-ui`（worktree `.orca/worktrees/group-resize-snap-ui`）

五个任务，前三个是纯函数（可独立测、无 UI 依赖），后两个接线。每个任务失败测试先行。

## T1 成员包围盒与逐边硬夹取（纯函数，spec 决策 3.5）

- 抽 `cardsExtent(assets)`（成员卡包围盒，按 `cardSize(kind)`）到 `canvas-group.ts`，让 `boundingBoxOf` 改用它 —— 两处各写一遍那段 min/max 迟早漂，而漂出来的是「audio 卡被切掉」。
- 新增 `resizeFloor(members)`：`cardsExtent` + 四周 `GROUP_PADDING`，无成员返回 null。（原文为「+ 顶部让出 `GROUP_TITLE_H`」，2026-08-20 已改为四边等宽，见 plan `2026-08-20-group-frame-top-padding`。）
- 新增 `applyResize(from, dir, d, floor)` → `{ rect, d }`：先夹位移（保住「西/北拖过最小尺寸时框不整体滑走」这条已修的坑）、再夹下限盒，返回**生效后的位移**（调用方据此判断某轴有没有被夹住）。
- 失败测试：逐边四条（西/东/南/北各夹住）· 空框只受 MIN 约束 · audio 成员按 210 宽算 · 存量成员露在框外时不强行撑大 · 最小尺寸与下限取较大者。

## T2 缩放的吸附（纯函数，spec 决策 2 + 3）

- 新增 `snapResizeDelta(from, dir, d, candidates, threshold, grid, bypass)` → `{ d, guides }`：**在位移空间**吸附（被拖的边落到候选边缘上；未命中则该边落 grid），只处理 `dir` 含的边，对边不动；`bypass` 为真时原样返回。
- 失败测试：单边命中 · 角把手两轴各命中 · 未命中落网格 · bypass 直通 · 阈值外不吸 · 对边不动。
- 顺序锁：`applyResize` 的夹取**赢过**吸附 —— 吸附后若某轴被夹住，该轴的辅助线要丢掉（否则画一条没吸上的线）。这条在 T4 接线处锁。

## T3 候选集取数收成一份（spec 决策 5）

- 抽 `candidateRects(nodes, viewport, size, exclude)` 到 `align-guides.ts`；`AssetCanvas.snapshotCandidates` 改用它。
- 失败测试：排除集生效 · 视口过滤仍生效（复用既有 `visibleRects` 用例的口径）。

## T4 辅助线通道换到 store（spec 决策 4，机制替换）

- `UIState` 加 `alignGuides: Guide[]` + action `setAlignGuides`（值没变保持同引用）；不进 persist 白名单。
- `AlignGuides` 改为自己订阅 store（不再收 prop）；`AssetCanvas` 的 `setGuides` 全部改调 action，删掉局部 state。
- 失败测试：`AlignGuides` 不传 prop 也能按 store 画线 · `setAlignGuides` 幂等 · 拖拽路径的既有辅助线用例改为断言 store（正向对照：拖拽仍出线）。

## T5 把手 UI + 缩放接线（spec 决策 1 + 2 + 3.5）

- `GroupNode`：四角把手加视觉（6px 方块 + `--color-surface` 填充 + 1.5px 品牌橙描边 + 2px 圆角），`selected` 才显示；八个命中区不变；把手 `aria-hidden`（纯鼠标 affordance，键盘缩放另立项）。
- `startResize` 接线：mousedown 时快照候选集（`candidateRects`，排掉本框 + 本框成员）与下限盒；每帧 `raw d → snapResizeDelta → applyResize → setGroupGeometry + setAlignGuides`；松手 `setAlignGuides([])` 并照旧 `updateGroupGeometry`。
- 候选集与视口从 RF store 取（`s.width` / `s.height` / `s.transform`）—— 不新增 prop、不往 `node.data` 塞函数。⚠️ `GroupNode.test.tsx` 现在把 `@xyflow/react` 桩成只有 `useStore`，要补 `useReactFlow`（夹具修真，不是放宽断言）。
- 失败测试：选中才出四角把手 · 命中区仍 8 个 · 缩放期写 store 辅助线、松手清空 · 被夹住的轴不画线 · 关掉对齐开关 / 按住 ⌥ 不吸。

## 验证

`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz`，输出贴回本文件；真机走 spec 的 10 条成功标准（Nick 复验）。

## 实现记录与偏离（2026-08-19）

- **T2 与 T3 合成一个提交**：`candidateRects` 只有几行，跟 `snapResizeDelta` 同在 `align-guides.ts`，拆两个提交只是把同一处改动切两半。
- 把手视觉**直接给命中区上色**，不再套一层内嵌 div：命中区 10px、视觉要 6px，用 `padding: 2 + backgroundClip: content-box` 内缩，比 `scale` 干净（`scale` 会把 cursor 热区一起缩）。
- **⌥ 读的是本帧事件的 `ev.altKey`**，不是起手时捕获一次的 `useAltBypass()`：后者会让「拖到一半按住 ⌥」不生效。缩放这条路因此不用那个 hook（框体吃不吃指针那条仍在用）。
- 顺手修掉一个手滑：替换 `HANDLES` 时把西边把手的定位写成了 `left-1/2`（应为 `left-0`），当帧发现并改回。
- 夹具踩坑留档（两个都属「第一条绿、后面假红」）：
  1. `GroupNode.test.tsx` 里既有缩放用例把 `setGroupGeometry` / `updateGroupGeometry` 换成 `vi.fn()` 且不还原，我的新用例继承了桩 —— **几何一动不动而辅助线照常写出**，看起来像吸附算错了。已在 `beforeEach` 里还原真 action（与 `dragstop.test.tsx` 同一手法）。
  2. 上一回合那条：`vi.spyOn(...).mockRestore()` 放 `afterEach` 会把 spy 永久摘掉。

## 验证记录（2026-08-19 本轮跑出）

- T1 改前红：`canvas-group` 整文件红（`resizeFloor is not a function`）→ 改后 **37 passed**。
- T2/T3 改前红：`align-guides` 7 failed → 改后 **55 passed**。
- T4 改前红：`canvas-view` 2 failed（`setAlignGuides is not a function`）→ 改后 **13 passed**；切换后 `canvas` **548 passed**。
- T5 改前红：`GroupNode` 6 failed（四角把手 0 个 / 把手无 aria-hidden / 三条缩放几何）→ 改后 **50 passed**。
- 全量：`pnpm lint` 0 errors（12 条既有 warning）· `pnpm exec tsc --noEmit` 通过 · `pnpm test` **3937 passed | 4 skipped** · `pnpm test:tz` **4 passed | 1 skipped**。

## 待办（合并前）

- 真机走 spec 的 10 条成功标准（Nick）；未复验前不合并。
