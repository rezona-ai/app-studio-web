# 组卡选区的真机验收修正 + 分组框视觉换稿

日期：2026-08-19
状态：已批准（2026-08-19 Nick 实机验收后提出五条，框底灰阶一档由 Nick 拍板）
前置：`2026-08-18-group-as-card-selection`（组卡升格与选区模型统一，本 spec 是它的同回合验收修正，不新开机制）

## 目的

`feat/group-as-card-selection` 真机实测后 Nick 报出三条功能问题 + 两条视觉换稿。三条功能问题都是**同一回合刚落地的机制留下的缝**，不是新需求；两条视觉是把「组卡就是一张卡」这个抽象在外观上补齐 —— 今天框还长着一圈品牌橙描边，读起来像「被选中的东西」，而真正选中时反倒和卡片不是一套语言。

## 三条功能问题与根因（均已定位到行）

### 1. 拉选命中分组框时，框内成员卡也亮着选中态

- 现象：橡皮筋扫过一个分组，框亮了，框内四张卡也各自亮着选中环。
- 根因：`AssetCanvas.tsx` 的「来源判据」比较的是**归一化后的结论**而不是 **RF 的原话**。`onSelectionChange` 里 `reportedRef.current` 记的是 `normalizeSelection` 的产出（成员卡已被框吸收），而 store 收到的也正是这一份 —— 两者恒等，于是 store→节点 那个 effect 每次都判为「这是 RF 自己改的，不用回落」提前 return。**RF 内部那批成员节点的 `selected` 从来没人去清**，而卡面选中态是从 RF 的 `selected` prop 渲染的（`NodeCard`）。
- 判据修正：**来源判据要比 RF 的原话**。归一化本身就是一次**程序性收窄**（把成员卡从选区里摘掉），凡收窄就必须回落到节点数组。故 `reportedRef` 改记 RF 回报的**原始节点 id**：
  - 无吸收（原话 == 归一化结论）→ 与今天一样不回落，回环防线原样有效；
  - 有吸收（原话 ⊋ 结论）→ 回落一次，把成员节点的 `selected` 清掉。之后 RF 就着新数组再回报一次，此时原话 == 结论 → 收敛，不再有下一轮。
- 这是对 `2026-08-18` spec「追加约束：选中态只有一个写入通道」第 2 条的**细化**，不是推翻：单通道仍是 `rfNodes`，只是「哪些变更算程序性」这一句说得更准。

#### 修正记录（2026-08-19 二次真机验收：上面这个修法不够）

第一版把「清掉被吸收的成员」交给 store→节点那个 effect，Nick 复验仍见成员亮着。**漏掉的帧序**：橡皮筋每长一点，RF 就把命中集**整批**重标一次 `selected`（`getSelectionChanges`），而归一化结论仍是同一个框 ⟹ **store 选区一字不变** ⟹ effect 的 deps 不变、压根不再跑，后进框的成员从此永远亮着。

定案：**清除就地发生在 `onSelectionChange` 里**，挂在「RF 每次回报」这个事件上，与 store 变不变无关 —— `absorbed = RF 原话 \ 归一化结论`，把这几个节点的 `selected` 摘掉（值没变就交回原数组）。`reportedRef` 回到记归一化结论（吸收已就地收口，不必再借 effect 走一遍）。

这仍**不是**第二条写入通道：写的是同一份 `rfNodes`，且只做「减」——把 RF 刚标上而选区不认的那几个摘掉，不给回环留燃料。锁：`AssetCanvas.contextmenu.test.tsx` 的「橡皮筋连续帧」用例（用 `onNodesChange` 喂 RF 的 select 变更，走真机那条路）。

### 2. 一张散卡 + 一个分组框时不出多选包围框

- 现象：两张散卡 + 一个框 → 出虚线包围框；一张散卡 + 一个框 → 不出。
- 根因：`AssetCanvas.tsx:1185` 的 `canvas-single-select` 判据是 `selectedIds.length < 2` —— 只数**卡**，组卡整个不算。组卡升格后这条判据漏了 `selectedGroupIds`。
- 修正：判据改为 `selectedIds.length + selectedGroupIds.length < 2`。口径复述一遍：**包围框的门槛是「选区里有两个及以上目标」，组卡按一个目标数**（选中单个组卡 = 单选，靠它自己的选中态表达，不套包围框）。

### 3. 拖动分组框时框内卡片抖动

- 现象：拖框时成员卡跟不上框，拖得越快掉队越远，停手才追上 —— 读起来是抖动 / 掉帧。
- 根因：**成员的位移比框慢整整一帧**。RF 的 `XYDrag.updateNodes` 每帧先 `updateNodePositions(dragItems)`（经我们的 `handleNodesChange` → `setRfNodes`，React state，**异步**），紧接着同步调 `onNodeDrag`。而 `followMembers` 里 `live` 是从 `getNodes()` 取的 —— 受控模式下 RF store 的 `nodes` 就是我们上一次 commit 的那份数组，本帧那次 `setRfNodes` 还没提交，故读到的是**上一帧**的框坐标；`grabbed`（回调给的权威坐标）只在 `!live.has(grabbed.id)` 时才用，而框恒在 `live` 里，那行兜底**永远不生效**。于是成员本帧按「上一帧的步长」平移，与框差一帧。60fps 下快拖一帧就是十几像素。
- 修正：本帧的框坐标**一律取回调参数**（`dragged` 数组 + `grabbed`），`getNodes()` 只作兜底。成员位移于是与框的同一帧坐标同批写进同一次 `setRfNodes`，框与成员在**同一个 commit** 里一起动。
- 顺带同一处：`endDrag` 算各框总位移用的也是 `getNodes()`，同样落后一帧（松手帧通常无位移故真机上多半看不出）。一并改成优先取回调坐标 —— 带框的拖拽 `beginDrag` 已清空对齐候选（不吸附），回调坐标就是最终渲染坐标，取它更准。
- **不动**的：散卡落库仍走 `persistDragged` 里那份 `getNodes()`（那是为了拿到我们在 `onNodesChange` 里做的对齐改写，见该处注释），本 spec 不碰。

## 两条视觉换稿

### 4. 分组框：品牌橙描边 → 半透明灰底；选中态改用卡片那套流光边框

- 常态：**去掉品牌橙描边**，底色改 `color-mix(in srgb, var(--color-fill) 55%, transparent)`（Nick 拍板的一档）。深色稿实际呈现 ≈#1b1b1b，略暗于卡片 #202020 —— 卡片浮在框上，层级正确；浅色稿 ≈#f4f4f4，比画布底 #f8f7f7 淡淡地深一档。**不加描边**，边界靠灰阶差表达。
- 选中态：与卡片**同一套** —— `border-[1.5px]` + `color-mix(--color-primary 24%, transparent)` 描边 + 同款落影 + `.node-beam` 流光环。`.node-beam` 的几何（`inset:-1.5px` / `radius:17.5px`）本就是按「16px 圆角 + 1.5px 边框」调的，框体正是 `rounded-[16px]`，直接复用，不新造样式、不新增 keyframes。原先那圈 `shadow-[0_0_0_3px_var(--color-primary-soft)]` 退役。
- **拖入 / 移出高亮保持品牌橙**（`drop` 加粗实线 + `--color-primary-soft` 底、`leave` 橙虚线 + 减淡）：那是**瞬态**手势反馈，与「选中」不同轴，本回合不改。常态无描边而高亮有 2px 描边仍不动几何 —— 框体是 `absolute inset-0` + `border-box`，边框向内生长。
- 推翻的旧口径：`2026-08-12-canvas-group-theming-and-menu` 决策 1 的「框色恒品牌橙描边」。**其内核不变**（框色不由数据驱动、不按资产类型五色轮换、`GROUP_COLORS` 不复活）；变的只是「框的常态不再借用强调色」—— 强调色专用于选中 / 高亮，框的常态是容器，不是强调。

### 5. 框选矩形与多选包围框

- 拉选预览矩形（`.react-flow__selection`）：边框 **实线 → 虚线**，底色照旧（品牌橙 12%）。
- 多选包围框（`.react-flow__nodesselection-rect::before`）：
  - 内边距 `-14px` → **`-36px`**（分组框自带 16px 圆角与成员卡的间距，贴太紧会让框与包围框两条圆角线几乎并在一起；24px 实机仍嫌紧，Nick 第二轮拍到 36px）；圆角随之 18px → 38px。36px 顺带让框的标题条（在框上沿外 32px）整条落进包围框内，不再被虚线横穿；
  - **补上底色**：与拉选矩形同一份品牌橙 12%（Nick：选框应保留拉选状态时的背景颜色），两个状态因此是同一块面的延续。
  - `pointer-events` 与 `.canvas-single-select` 下的隐藏逻辑原样。底色画在 `::before`（外扩层）上、`rect` 本体仍透明无边框 —— 不改 rect 尺寸，拖拽命中区不变。

## 约束

- 只在既有令牌 / 既有动效类里选，不新增色值、不新增 keyframes、不新增 `.anim-*`；`.node-beam` 已在 `prefers-reduced-motion` 的退化列表里，复用即继承。
- 选区模型（两个数组、成员卡被框吸收、删除展开）与容器模型（几何是真相）**一个字不改**。
- 「选中态只有一个写入通道」仍是约束；本 spec 只细化其来源判据（见问题 1）。
- 位置归前端所有、坐标回写路径、撤销栈条目形状不动。

## 成功标准

1. 橡皮筋扫过分组：只有框亮选中态，框内成员卡一张都不亮（单测锁「回报里含成员卡 ⟹ 成员节点被清成未选中」）。
2. 一张散卡 + 一个框：出虚线包围框（单测锁 `canvas-single-select` 判据含组数）。
3. 拖框：成员与框同帧位移（单测锁「本帧成员位移 = 回调给的框位移」，getNodes 故意返回上一帧坐标）。
4. 分组框常态无橙描边、有灰底；选中时挂 `.node-beam` 且描边取 primary 24%（组件单测锁类名与 beam 存在）。
5. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` 全绿。

## 终审留档（2026-08-19，两名干净上下文子代理独立评审）

0 Critical。**已修**（都是「防止后人按旧口径修回来」的文字防线 + 一处真重复）：

- `GroupNode.tsx` 三处注释仍在陈述被本回合推翻的旧规则（「描边恒取品牌橙」/「三态同为品牌橙」/「识别度由框体描边与柔光底保住」）—— 已按现状重写。
- `2026-08-12-canvas-group-theming-and-menu` 决策 1 没有指路：已补「口径两次收窄」一段并给三态表的「常态」行画删除线（沿用该文件 §遗留债 既有的 `~~删除线~~` + 指路惯例）；内核（框色不由数据驱动、`GROUP_COLORS` 不复活）明写仍有效。
- 选中落影字面量 `0 4px 14px -6px …` 与 `NodeCard.tsx` 逐字节重复（CLAUDE.md 明禁手写 box-shadow）：收成 `:root` 令牌 **`--shadow-node-selected`**，两处改走 `shadow-[var(--shadow-node-selected)]`，单测断言随之改。
- `globals.css` 焦点环那条依据句引的对照物（柔光外晕）已退役 —— 改述为「焦点环恒在外沿 2px、静止；选中是贴边 1.5px + 会转的 beam」。

**已决定不改，记为取舍：**

- **浅色稿框的外沿几乎不可见**（框底 ≈`#f4f4f4` vs 画布底 `#f8f7f7`，差 4/255；深色稿差 20/255）。框体是可拖可点的交互目标，评审按 WCAG 1.4.11（非文字对比 3:1）提出可补 1px `--color-line-2` 中性发丝边。**Nick 2026-08-19 拍板保持现状（无描边）** —— 浅色稿的边界靠灰阶差与标题条表达。后人若要动这条，先看这一段再动。
- 包围框 `::before` 那层品牌橙 12% **刻意盖在选中的卡片之上**（RF 给 `.react-flow__nodesselection` 的 z 是 3，而本画布 manual z 只有 -1/0/1）：这正是「选框保留拉选状态的底色」的要求，文字对比度不受影响（已在 `globals.css` 就地留注，别当 bug 修掉）。
- 包围框圆角 38px 不在圆角阶梯（10/12/16/24）上：它占的是既有 18px 那个槽位，且是浮层几何而非控件 / 卡片，不算新增档位。
- 提交边界：`6e1054c9` 一条落了 plan 的 T1 + T2 两个任务；`6130a914` 是对它的返工，两条 `docs:` 是纯验证留档。未推送，按惯例本可 `--soft` 折叠，但返工那条记录的帧序教训有留存价值，最终靠 `--no-ff` 分组合并成一个回合。下回 T1/T2 分开提。

### 正确性 / 竞态角度的终审（第二名评审）

0 Critical。库码断言我逐条自查过（`getDragItems` 的条件是 `node.selected || node.id === nodeId`；`addSelectedNodes` 在 multiSelection 路径**只发变更、不同步抹** `nodeLookup`，非 ⌘ 路径才 `getSelectionChanges(…, mutateItem=true)` 同步改），两条 Important 都成立、**已修**：

- **I1 · 成员卡自己也在 dragItems 里时叠两次位移**（精确 2× 跟手 + 松手弹回）。触发：点框体选中分组 → **按住 ⌘** 拖框内一张成员卡。⌘ 路径下框仍算选中 ⟹ RF 自己按指针挪那张成员卡，`followMembers` 又按 `groupId` 叠一次框的 step。落库侧早有 `moveDragged` 的 `memberIds` 双保险（「叠两次位移是这条路上最贵的 bug」），**渲染侧缺同一道守卫** —— 已补：`moving = dragged ∪ {grabbed}` 的节点不再叠 step。锁：`AssetCanvas.groupdrag.test.tsx`「框与其成员同在一次拖拽里」（改前实测 200/140 vs 应为 150/120）。
- **I2 · `beginDrag` 的判据读 `getNodes()`，与本回合刚立的「回调参数才是权威」自相矛盾**。触发：选中着一个框 → 拖一张**无关散卡**。RF 在 `startDrag` 里已同步把框从 `nodeLookup` 的选区抹掉（`dragItems` 只有那张卡），而我们的数组要等下一次 commit ⟹ 误判「本次拖了框」⟹ **这一次拖拽的边缘对齐被静默关掉**。已改成只认回调给的 dragItems（`onNodeDragStart`/`onSelectionDragStart` 把第三参接进来），`grabbed` 那条兜底随之退役（被抓的那个恒在 dragItems 里）。锁：`AssetCanvas.snap.test.tsx` 新增「候选集取数」两条（正例 + 反例；jsdom 无布局，用容器 rect 桩把候选集喂真，改前实测候选集为空）。
- **M1 · 点一下框会闪一道墨色发丝边**：常态不写 border-color 时回落 `currentColor`(≈`--color-ink`)，宽度瞬间 0→1.5px 而颜色要 150ms 才淡到 primary-24%。已给常态 `border-transparent`（确定的透明 = 干净淡入），并加断言锁住。
- **顺带**：`livePositions` 当初插在 `beginDrag` 的文档块与函数体之间，把那段 JSDoc 悬空挂到了别人头上 —— 已重排。
- **夹具修真**：`dragstop` / `snap` / `groupdrag` 三处此前给 `onNodeDragStart` 喂 `[]` 或把目的地当起点，与 RF 实际语义不符（RF 的 dragStart 给的是**起点**，第三参恒含被抓的那个）。已全部改真 —— 否则 I2 的修法一动就会假红。

**Minor 只记录、本回合不改：**

- 选中 + leave 叠加时 `.node-beam` 被 `opacity-50` 一起减淡，且 2px 边框下 beam 外沿内移 0.5px（叠加态观感，几何不跳、指针不受影响）。
- `onPaneClick` 里落框选中走 `selectGroup(gid)`（叠加语义），与框体点选的 `setCanvasSelection`（独占语义）口径不一：先点一张散卡 → 按住 ⌥ 点框内空白，末态是「卡 + 框」同选。会收敛、不震荡，属上一回合的口径债；修法是把那处也换成 `setCanvasSelection({ assetIds: [], groupIds: gid ? [gid] : [] })`。
- 橡皮筋期每有**新成员**进框会闪一帧选中环（清除挂在 passive effect 上，跑在 paint 之后；频率是「每新进一个成员一次」而非每个 pointermove）。彻底无闪要把归一化提前到 `handleNodesChange` 里改写 select 变更，侵入面远大于收益。
