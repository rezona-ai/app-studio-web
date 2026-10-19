# 实现计划：组卡选区真机验收修正 + 分组框视觉换稿

spec：`docs/superpowers/specs/2026-08-19-group-card-selection-polish.md`
分支：`feat/group-as-card-selection`（同回合续做，worktree `.orca/worktrees/group-as-card-selection`）

五个任务各自独立可测、可独立评审；顺序按「先功能后视觉」，每个任务一条提交。

## T1 拉选不再让成员卡亮选中态（spec 问题 1）

- 失败测试先行：`AssetCanvas.contextmenu.test.tsx` 新增一条 ——
  先 `setCanvasSelection({assetIds:['m1']})` 把成员节点写成 selected（模拟 RF 已选中它），
  再喂 `onSelectionChange({nodes:[g1, m1, loose]})`，断言 `captured.nodes` 里 `m1.selected` 假、
  `g1`/`loose` 真。改前必红（来源判据恒等 ⟹ effect 提前 return，m1 停在 true）。
- 实现：`onSelectionChange` 里 `reportedRef.current` 改记 **RF 回报的原始 id**（`nodes.map(n => n.id)`），
  归一化结论只交给 store。注释改写「来源判据比的是 RF 的原话，归一化是程序性收窄，必须回落」。
- 回归对照：既有「RF 回报的选区不回灌节点」与「程序性选区落到节点」两条必须仍绿。

## T2 包围框门槛把组卡算进去（spec 问题 2）

- 失败测试先行：新增一条断言 `canvas-single-select` 判据 —— 选区为「1 张散卡 + 1 个框」时
  容器 class **不含** `canvas-single-select`；正向对照：只选 1 张卡时仍含。
  （夹具的 ReactFlow 是桩，但容器 div 是 AssetCanvas 自己渲染的，class 断言有效。）
- 实现：`selectedIds.length < 2` → `selectedIds.length + selectedGroupIds.length < 2`。

## T3 拖框时成员与框同帧（spec 问题 3）

- 失败测试先行：新建 `AssetCanvas.groupdrag.test.tsx`（同款 props 桩夹具，`getNodes` 故意返回
  **上一帧**的框坐标）：
  1. `onNodeDragStart(evt, 框节点@0,0)` → `onNodeDrag(evt, 框@50,20, [框@50,20])`
     ⟹ `captured.nodes` 里成员卡位移 = (+50,+20)。改前必红（步长算成 0）。
  2. `onNodeDragStop(evt, 框@50,20, [框@50,20])` ⟹ 框坐标落库（`updateCanvasGroup` 被调、
     撤销栈入一条）。改前必红（delta 算成 0 ⟹ 判零位移不落库）。
- 实现：`followMembers` / `endDrag` 里的 `live` 改为**先铺回调坐标**（`dragged` + `grabbed`），
  `getNodes()` 只填补回调里没有的节点。注释写清「受控模式下 getNodes 落后一帧」这条根因。
- 不碰 `persistDragged` 里散卡那份 `getNodes()`（对齐改写要它）。

## T4 分组框换视觉（spec 问题 4）

- 失败测试先行：`GroupNode.test.tsx` 加两条 —— 常态框体**不含**品牌橙 borderColor、
  选中态存在 `.node-beam` 元素且描边走 primary 24%。
- 实现：`GroupNode.tsx` 的 `FILL` 改半透明灰、去掉常态描边；选中态改 1.5px primary-24% 描边 +
  卡片同款落影 + `<span className="node-beam" />`；`drop` / `leave` 三态高亮原样保留。
  常量注释更新（点名推翻 `2026-08-12` 决策 1 的「常态借用强调色」那一句，内核仍在）。

## T5 框选矩形与包围框样式（spec 问题 5）

- `globals.css`：`.react-flow__selection` 与 `--xy-selection-border` 的实线改虚线；
  `.react-flow__nodesselection-rect::before` 内边距 -24px / 圆角 26px / 补品牌橙 12% 底色
  （**最终值 -36px / 38px**，见文末「三次微调」）。
- 无单测（纯样式，无判据可锁）；靠 T2 那条 class 用例守住「什么时候出包围框」这一半。

## 验证

`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz`，输出贴进本文件末尾的「验证记录」。
真机（`pnpm dev`）逐条走五个现象，由 Nick 复验。

## 验证记录（2026-08-19 本轮跑出）

提交序：`e1ea2a71`(docs) → `6e1054c9`(T1+T2) → `a8508f91`(T3) → `b8fc1cd9`(T4) → `2b8bd3f0`(T5)

- T1/T2 改前红：`AssetCanvas.contextmenu` 2 failed | 19 passed（`m1.selected` 期望 falsy 得 true；
  className 期望不含 `canvas-single-select` 得含）→ 改后 **21 passed**。
- T3 改前红：`AssetCanvas.groupdrag` 2 failed | 1 passed（成员位移得 (0,0)；框落库 x/y 仍 0）
  → 改后 **3 passed**。零位移对照始终绿。
- T4 改前红：`GroupNode` 5 failed | 36 passed → 改后 **41 passed**。
- 全量：`pnpm lint` 0 errors（12 条既有 warning，未新增）· `pnpm exec tsc --noEmit` 通过 ·
  `pnpm test` **299 files / 3886 passed | 4 skipped** · `pnpm test:tz` **4 passed | 1 skipped**。

## 待办（合并前）

- 真机复验五条现象（Nick）；未复验前不合并、不清理 worktree。

## 二次真机验收（2026-08-19，Nick 复验）

- 2 / 3 / 4 通过。
- **1 未通过**：修法漏了橡皮筋连续帧（store 选区不变 ⟹ effect 不跑），重修为「就地摘掉被吸收的成员」，
  见 spec 的「修正记录」；新增 `AssetCanvas.contextmenu.test.tsx` 的「橡皮筋连续帧」用例，改前红。
  验证：contextmenu 22 passed · canvas+store+lib 2672 passed | 4 skipped · `tsc --noEmit` 通过 · lint 0 errors。
- **5 未通过，但不是代码问题**：worktree 的 dev server（:3002）在吐**改动前的 CSS chunk**
  （实测 `inset:-14px` / `radius:18px` / 无底色 / `--xy-selection-border: 1px solid`，`touch` 也不重建）。
  用 Next 同一条 Tailwind v4 PostCSS 管道单独编译 `globals.css`，产物是 `-24px` / `26px` /
  `color-mix(... 12% ...)` / `dashed` —— 源码与工具链无误。诱因：该 worktree 里同时跑着 3 个 dev server
  （11:25–11:27 起的 PID 12289/13565/15590）共用一个 `.next`。
  处置（Nick 同意）：杀掉 3 个重复实例 + `rm -rf .next`，重起一台 `PORT=3002 pnpm dev`；
  重启后拉 chunk 复验，四项新值全部就位。**chunk 文件名未变，浏览器需硬刷新**。

## 三次微调（2026-08-19，Nick 实机）

包围框内边距 24px 仍嫌紧 → **36px**（圆角 38px）。重启后的 dev server HMR 正常，拉 chunk 复验
`inset:-36px` / `border-radius:38px` 已就位。
