# 成组后选区升格为分组框 + 选框形变过渡

日期：2026-08-20
状态：待批准
前置：`2026-08-18-group-as-card-selection`（组卡升格与选区模型）、`2026-08-19-group-card-selection-polish`（选中语言与卡片对齐）、`2026-08-20-group-selection-guard-and-undo-toast-window`（橡皮筋升格 / 成组守卫）、`2026-08-12-canvas-group-theming-and-menu`（乐观建框）

## 目的

框选一批卡 → 右键「圈成一组」→ 框出来了，但**选区一动不动**：那批卡仍是选中态（RF 的 `.react-flow__nodesselection-rect::before` 那圈虚线橙框 + 12% 橙纱还挂在卡的包围盒上），新框不在 `selectedGroupIds` 里、没有选中描边。

用户刚做的动作是「把这几张卡变成一个框」，操作对象已经从「几张卡」变成「一个框」——选区却停在旧对象上。后果不止观感：紧接着按 Delete 删的是那批卡（而不是框）、拖动拖的是散卡选区、右键出的是卡片批量菜单。而屏幕上明明有个新框刚出现。

成功标准：① 成组落地的同一帧，选区就是「新框」而非那批卡；② 从虚线选框到框选中态在视觉上是**同一块面的延续**（不是「虚线消失 + 描边凭空出现」两件事）；③ 异常路径（建框请求失败 / ⌘Z 撤销成组）上选区回到那批卡，不留悬空组选区。

## 现状（读码结论）

- `createGroupFromSelection`（`actions.ts:1347`）建框那次 `set` 写 `groups` / `assets.groupId` / `undoStack`，**不碰选区**。
- 选区 → RF 节点的投递已现成：`AssetCanvas.tsx:736` 的 apply effect 把 `[...selectedIds, ...selectedGroupIds]` 落到 `rfNodes.selected`，其 `reportedRef` 来源判据只放行**程序性**选区。成组正属这一类（store 变更不是 RF 回报的），故**无需在 `AssetCanvas` 额外接线**——这条与 `2026-08-20` 那次 I1 的处境不同（那次是橡皮筋，RF 正在回报）。
- 几何：框 = 包围盒 + `GROUP_PADDING`(24)；虚线选框 = 同一个包围盒 + `inset:-36px`、`border-radius:38px`。**两者每边差 12px**，框体自身圆角 16px。
- ⌘Z 撤销成组（`index.ts:1000`）已经 `setSelection(live)` 回落到成员卡，但 `setSelection` **只动 `selectedIds`**——本回合让新框进 `selectedGroupIds` 之后，这里就会留下一个指向已删框的悬空组选区。

## 决策 1：成组落地的同一次 `set` 里完成选区升格

`selectedIds: []` + `selectedGroupIds: [tempId]`，与 `groups` / `assets` / `undoStack` 同一次 `set` —— 分两次会闪一帧「框已出现、选区还在卡上」，正是要消掉的那个中间态。

- 写的是**临时 id**（乐观期框还没有真 id）。故**重映射那次 `set` 必须同步换**（`tempId → realId`）：不换，选中态在重映射那一帧凭空丢失（框描边闪一下没了），且 `selectedGroupIds` 变悬空 —— 拖动 / Delete / ⌘A 的作用域跟着错。
- 守卫早退（`groups == null` / 命中 `hasGroupedCard` / 选中为空）一律**不动选区**：什么都没发生，选区就该原样留着。
- **分层：给 `StoreSlice` 开一道窄口**。`actions.ts` 的 `set`/`get` 在类型上被窄化成 `KoubouState & ServerState`，选区属 `UIState` —— 而「同一次 `set`」的不变式与失败回滚 / 重映射的选区回落都在本层内部，UI 层接不上。故把 `StoreSlice` 改成 `… & Pick<UIState, 'selectedIds' | 'selectedGroupIds' | 'groupMorphGid'>`：只 Pick 这三个（拉整个 `UIState` 等于取消分层），也不搬字段 —— `undoStack` / `toast` / `creditModalOpen` 当年靠「归进 `ServerState`」解决同一问题，但选区已被全仓当 `UIState` 引用，搬迁面远大于这道窄口。`UIState` 是纯接口、不引用 `ServerActions`，`Pick` 它不成类型环（`Pick<AppStore, …>` 会）。

## 决策 2：形变过渡由框节点自己播一层入场元素

`.react-flow__nodesselection-rect` 是 RF 内部渲染的，选区一空它当帧卸载，**挂不上退场动画**；要留住它就得自绘 overlay 层，而那层还得自己跟随 viewport 的 pan/zoom。改为在 `GroupNode` 内部放一层入场元素，从「虚线选框的几何与样式」形变到「框选中态」：

| | 起始（≡ 虚线选框） | 终态（≡ 框选中态） |
|---|---|---|
| inset | `-12px`（36 − 24，正是选框外扩比框多出的量） | `0` |
| 圆角 | 38px | 16px |
| 描边 | 1px dashed `--color-primary` | 1.5px solid `FRAME_SELECTED` |
| 底色 | 12% 橙纱 | 透明（交给框体自己的 `FILL`） |

新增 `.anim-group-morph` 类进 `globals.css`，并**补进 `prefers-reduced-motion` 的禁用列表**（退化 = 不播，直接是终态 —— 静态样式刻意写成终态，故 `animation: none` 就够，不必为它开 `display: none` 的特例）。

**缓动刻意不用进场那条 `cubic-bezier(0.22, 1, 0.36, 1)`**（这是对「进场统一缓动」的一次有据偏离）：它是为「弹层从触发点缩放」的大位移设计的强 ease-out，前 15% 时间就走完 85% 距离。真机实测（见下）12px 收拢在 **~35ms** 内结束，屏幕上只剩虚线闪一下，成功标准 ② 压根不成立。改用 `260ms ease-out`（与 `.anim-collapse-in` 同档，仍在既有语汇内），并加一个 **55% 关键帧只压色、不碰几何** —— 不留这帧，虚线与橙纱会在收拢完成前淡透，观感依旧是「闪一下」而不是「收进去」。改后实测中间态分布在 0–150ms（-12 → -4.8 → -2.8 → -1.6 → 0），肉眼可辨。

**收尾用定时器而非 `animationend`**：全仓退场收尾一律定时器驱动（`useExitTransition` / `useRequestClose`，`globals-reduced-motion.test.ts` 顶注写明「无一处依赖 animationend」），且「降低动态」下动画被关掉、`animationend` 永不到来 —— 信号会永久卡住（jsdom 里同样不触发，探针已验）。时长常量 `GROUP_MORPH_MS` 落在 `canvas-group.ts`，**与 CSS 同值，改一处必须同步另一处**。

- 视觉上等价于「虚线框收拢 12px、圆角收紧、虚线转实线、橙纱褪去」，成功标准 ② 由此成立，且不引入 overlay 与坐标系跟随。
- 触发信号：store 瞬态 `groupMorphGid: string | null`（**不进 persist 白名单** —— 一次性动画，刷新后重播是噪音）。`createGroupFromSelection` 设、重映射时随 id 一起换、动画结束 / 下一次成组 / 切项目清。
- `GroupNode` 只在 `groupMorphGid === group.id` 时渲染该层，`onAnimationEnd` 调 action 清掉 —— 不清会在框重挂载（`loadCanvas` / 过滤切换）时重播。

## 决策 3：异常路径回到那批卡，且不留悬空组选区

- **建框请求失败**（现有回滚那次 `set`）：`selectedIds` 回原 ids、`selectedGroupIds: []`、`groupMorphGid: null`。用户手里还持着那批卡，能直接再试一次（Nick 拍板）。
- **⌘Z 撤销成组**：`setSelection(live)` 换成 `setCanvasSelection({ assetIds: live, groupIds: [] })`，一次写清两侧。无反向形变（Nick 拍板：直接切）。
- 两条都**不复用**「原选区」的快照变量：`before`（`Map<id, groupId>`）的键就是那批卡的 id，直接取用，不新增状态。

## 不做

- 不做反向形变（撤销 / 失败时框收拢回虚线选框）。
- 不改 `GROUP_PADDING` 或选框的 `inset:-36px` 去让两者几何完全重合 —— 12px 差正是形变要表达的东西。
- 不给「新建空框」等其他建框路径加升格（目前没有别的路径；有了再按同一口径接）。
- 不动 RF 的 `selectionMode`、不碰 `normalizeSelection` 的橡皮筋升格口径（那是选区**进来**的口径，本回合改的是选区**在成组后**的归属）。

## 真机验收（2026-08-20，worktree dev server :3200 + 真实项目画布 pid 1613）

橡皮筋框选 3 张散卡 → 右键「Group selection」，按动画时间轴采样：

| 时点 | `selectedIds` | `selectedGroupIds` | `groupMorphGid` | 形变层 inset / 描边 alpha |
|---|---|---|---|---|
| 点击当帧 | `[]` | `[pendinggrp_…]` | `pendinggrp_…` | −12px / 1.0 |
| +33ms | `[]` | 同上 | 同上 | −4.8px / 0.40 |
| +50ms | `[]` | 同上 | 同上 | −2.8px / 0.235 |
| +67ms | `[]` | 同上 | 同上 | −1.6px / 0.133 |
| +149ms | `[]` | 同上 | 同上 | 0 / 0.004 |
| 真 id 到位 | `[]` | `[grp-df7c1368d871]` | 随之换 | 层已卸载、信号已清 |

- 虚线选框（`.react-flow__nodesselection-rect`）的 `::before` 由既有 `.canvas-single-select` 类当帧隐掉、`pointer-events: none`，与形变层不叠影、不吃指针（实测 `display: none` / `pointer-events: none`）。
- ⌘Z 撤销成组：框消失、`selectedIds` 回到那 3 张卡、`selectedGroupIds === []`、Toast `UNDO_CREATE_GROUP`。
- 验收在真实项目上进行，造出的框已用 `Ungroup`（拆框留卡）与 ⌘Z 逐一还原 —— 收尾状态与开始一致（13 卡 / 2 框 / 3 散卡）。
- 全量：`tsc --noEmit` 干净、`pnpm lint` 0 error、`pnpm test` 300 文件 3989 通过、`pnpm test:tz` 4 通过、`pnpm build` 成功。

## 评审处置（2026-08-20）

两个干净上下文的子代理（正确性 / 范式两个维度）只回了 idle、始终没产出报告，故本轮评审由我按同样的两份材料（spec + `bcdf63a9^1..bcdf63a9` 的 diff）与 CLAUDE.md 逐条自核。抓到 2 Important + 2 Minor，全部处置：

### I1（修）· 重映射无条件换 `selectedGroupIds` 的数组引用

`selectedGroupIds: get().selectedGroupIds.map(…)` —— `.map()` 恒返回新数组。乐观期用户点了别处（组选区为空）时，真 id 到位仍会写一个**同值新数组**，而选区数组进了 `AssetCanvas` 两个 effect 的依赖 ⟹ 白跑一次全节点重建，那次重建会把可能已过时的选区回灌进 RF、招来一次「又选中了」的回报 —— 正是 CLAUDE.md 与 `index.ts` 三个选区入口注释点名的自持震荡燃料（2026-08-19 实发）。改为「含临时 id 才写」。锁：`actions.test.ts`「乐观期用户改了选区:重映射不换 selectedGroupIds 的数组引用」（断言 `toBe` 同一引用）。

### I2（修）· 撤销成组时清组选区挂在了「还有成员卡活着」的条件里

`undo` 的 `createGroup` 分支里 `setCanvasSelection({…, groupIds: []})` 写在 `if (live.length > 0)` 内部。**成组 → 删掉那批卡 → ⌘Z 撤到成组这一格**时 `live` 为空、`if` 不进，`selectedGroupIds` 就留着刚被 `undoCreateGroup` 删掉的框 id：紧接着按 Delete 会发一个打向不存在框的 DELETE（报错 Toast），⌘A 与拖拽的作用域也跟着错。这个洞是本回合的升格引入的（原实现不动选区，故不存在）。改为组选区**一律**清空、卡那一侧没卡可选时回落现值（幂等守卫会跳过、不换引用）。锁：`actions.test.ts`「撤销成组时成员卡已全不在:组选区仍要清掉,不留悬空 id」。

### M1（修）· 「降低动态」下清信号仍等满 260ms

CSS 动画在 reduce 下被关掉，定时器却照等一段 —— 层挂在 DOM 上却压根不动。按 `useExitTransition.ts:17-20` / `useRequestClose` 的先例把延时视为 0。锁：`GroupNode.test.tsx`「降低动态:不等动画时长,信号立刻清」。

### M2（修）· `GROUP_MORPH_MS` 与 CSS `260ms` 两处硬编码无守护

漂移后果是静默的（常量偏小则动画被截断，偏大则层多挂一段），tsc / 测试全绿。补契约测试读 `globals.css` 断言两者同值（读 CSS 文本的先例见 `globals-reduced-motion.test.ts`）。锁：`canvas-group.test.ts`「.anim-group-morph 的动画时长 === GROUP_MORPH_MS」。

### 已核实无问题（避免重复排查）

- 收尾**不复用** `useExitTransition`：那是「随 `open` 变化 → `closing` → 延时卸载」的退场状态机，本例是「进场播完自清一个 store 信号」，语义不同，套用会把 `mounted` 与信号两套状态耦在一起。
- 切项目、建框失败、乐观期删框三条路径的 `pid` 校验与选区清理都在既有位置成立；`groupMorphGid` 已进 `switchProjectSession` 的清空清单。
- 程序性选区落到 RF 节点无需在 `AssetCanvas` 额外接线：`reportedRef` 的来源判据只挡「RF 刚回报的那批」，成组不属此类（真机已验框节点 `selected: true`）。
