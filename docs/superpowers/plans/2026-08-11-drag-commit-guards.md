# 实现计划：拖拽收口的三道门（终审整改 C 批）

> 设计稿：`docs/superpowers/specs/2026-08-11-drag-commit-guards.md`
> 分支：`fix/drag-commit-guards`（worktree 建在 `.orca/worktrees/`，**从 B 批合并后的 dev 切**）

三条互相独立，可各自评审。带上 A/B 两批攒下的教训：

- **先提交再变异**；撤变异用反向替换，不用 `git checkout`（A 批为此丢过两次未提交实现）。
- **每写一条测试就问「不加这个修复它会不会照样绿」**，并**实跑变异确认**——
  B 批 T4 的第一版两条测试全是假锁（stub 掉的正好是被测的接线），变异全存活。
- 断言别按了又按回原处、别不推时钟、别缺前置条件（A 批三处假绿的成因）。

## T1 · `applyDragSnap` 回报 handled（纯函数，先立地基）

`src/lib/align-guides.ts`：返回值加 `handled: boolean`。三条出口分别是
`bypass → handled: true`、`dragged.length === 0 → handled: false`、其余 → `true`。

测试 `align-guides.test.ts`：
- 无拖拽变更（全是 `dragging: false` 或非 position 变更）→ `handled === false`。
- 有拖拽变更但没命中任何线 → `handled === true, dx === 0, dy === 0`。**这条是关键**：
  它与上一条的返回值此前**完全同形**，正是缺陷的根。
- `bypass: true` → `handled === true`。

## T2 · 松手帧不再承接失效偏移（成功标准 1、1′、3）

`AssetCanvas.tsx:654` 改用 `r.handled`。

测试（`AssetCanvas` 组件层，`handleNodesChange` 经 RF 触发不好造，改为直接测该回调的行为）：
- 【复现 #1】先发一帧命中吸附的 position 变更（dragging=true，位置贴近邻卡）→
  再发一帧不命中的（拖到空白）→ 再发松手帧（dragging=false）→
  断言最终写入的坐标**等于松手帧原始坐标**（无额外偏移）。**先红**。
- 【复现 #1′】命中帧 → `altBypass` 帧 → 松手帧 → 同上。**先红**。
- 【不回归】命中帧 → 直接松手帧 → 坐标**带上**该偏移（吸附仍然生效）。

> 夹具提示：这条依赖 `isDraggingRef` 为真才走松手分支，需先发一帧 `dragging: true`。
> 若组件层造不出来，退而求其次把「delta 承接」抽成纯函数（`carryDropOffset(handled, delta)`）
> 并单测 —— 但**必须同时**留一条组件层用例锁住接线，否则又是 B 批 T4 那种两段各自绿。

## T3 · 归属重判收进 moved 门（成功标准 4、5）

`AssetCanvas.tsx`：`groupChanges` 的本地应用 + `persistAssetPositions` + `setAssetPositions`
一并挪进 `if (moved)`。

测试（沿用 `AssetCanvas.test.tsx` 既有 `keyDeleteFixture` 那套夹具风格）：
- 【复现 #2】零位移 `onNodeDragStop`（before 与 after 坐标相同）+ 卡的几何落在某框内 →
  断言 `persistAssetPositions` 未调用、`assets[0].groupId` 不变、`undoStack` 长度不变。**先红**。
- 【不回归】真位移且跨进框 → `groupId` 改、`persistAssetPositions` 收到 groupChanges、入栈一格。

## T4 · tidy 空栈条目（成功标准 6、7）

`actions.ts` `tidyCanvas`：先算 layout 与 moved，`moved.length > 0` 才入栈。

测试：
- 连续两次 `tidyCanvas()` → 第二次不增长 `undoStack`、不发批量请求。**先红**。
- 首次 `tidyCanvas()` 照旧入栈一格（不回归）。

## T5 · 收尾

- 五步全绿（贴完整输出与退出码）。
- 变异逐条：`handled` 三条出口各改一处、`moved` 门去掉、tidy 守卫去掉 —— 各自确认红。
- 真机复看四条：吸附后拖离松手看落点、Alt 逃出、点一下框上的卡看成员数、连点两次整理。
- 派干净上下文子代理增量评审，重点仍是「替我找假锁」。

## 已知取舍

- **`bypass` 也算 handled**：语义是「这帧是拖拽帧，只是我们选择不吸」——所以要把 delta 清成 `{0,0}`。
  若将来 Alt 改成「保持上一次吸附结果」，这条要一起改。
- **零位移点击不再重判归属**：若用户真的想「把框拖过去吞并散卡」，那是 `2026-08-05-canvas-groups.md`
  「明确不做」里的拖框吞并，本轮不因为这个缺陷顺手实现它。
