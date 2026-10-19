# 分组卡的选区升格 + 成组守卫 + 撤销 Toast 时长

日期：2026-08-20
状态：已批准（2026-08-20 Nick 实机报出两个 bug，四条决策逐个拍板）
前置：`2026-08-18-group-as-card-selection`（组卡升格与选区模型）、`2026-08-19-group-card-selection-polish`（橡皮筋吸收成员的帧序修正）、`2026-08-03-canvas-undo`（延迟删除窗口）

## 目的

Nick 实机报出两个 bug，都是既有机制留下的缝，不是新需求：

1. **已进分组的卡在框选后还能继续成组** —— 成组出来的新框与原分组在几何上互相嵌套，而「不做嵌套分组」是既有决策。
2. **删除卡片后间隔较长时间点 undo 没反应** —— 撤销按钮还在屏幕上，点了却什么都不发生。

成功标准：① 任何路径下都拿不到「把已属某个框的卡再圈进新框」这个操作；② 撤销 Toast 在屏幕上的时长与延迟删除窗口严格一致 —— 按钮在 ⟺ 真的还能撤销。

## Bug 1：已分组的卡还能再成组

### 根因（两条独立路径，此前只堵了半条）

`normalizeSelection`（`src/lib/canvas-selection.ts`）的「成员卡被其框吸收」**以框 id 也在选区里为前提**。而 RF 的框选默认 `SelectionMode.Full`（节点须完整落在选区矩形内才上报，`AssetCanvas.tsx` 没改这个默认），所以橡皮筋只圈住框内**部分成员**时，框节点自己没被命中 → 吸收不生效 → 成员以散卡身份进 `assetIds`。

`ContextMenu.tsx` 的「圈成一组」只在 `gids.length === 0`（选区不含**组卡**）时隐藏，**没看卡自己的 `groupId`**。于是：

- 路径 A（橡皮筋）：框选组内部分成员 → 选区是一堆散卡 → 菜单项照出 → 成组。
- 路径 B（点选 / ⌘⇧ 加选）：直接点组内卡，或 ⌘ 加选「1 张散卡 + 1 张组内卡」→ 同样成组。

后果一致：新框套在原框内部，被圈中的卡 `groupId` 改指新框，而几何上它们仍在原框范围内 —— 容器模型「几何是真相，`groupId` 是它的投影」被撕开，下一次几何复判会把它们判回原框。

### 决策 1：橡皮筋框选命中组内成员 → 升格为选中它所属的框

这不是新口径，是把 `AssetCanvas.tsx:759` 那句既有注释（「橡皮筋扫过一个分组时，选中的是组卡而不是它内部的卡片」）实现补齐 —— 此前只在「框恰好被完整圈住」时成立。

- 纯逻辑：`normalizeSelection` 加一个显式口径开关（`absorbMembers`）。开时：成员卡不进 `assetIds`，其所属框（**须在 `groups` 里**）进 `groupIds`；悬空归属仍按散卡处理（既有语义不变）。
- 顺序：升格出来的框按「首次遇到其成员」的顺序追加在入参已有框之后 —— 选区顺序对用户可见（批量菜单的计数与首项）。
- **作用范围只限橡皮筋**（Nick 拍板）：点选 / ⌘⇧ 加选**保持**能单选组内卡 —— 那是组内卡改名 / @ 引用 / 详情的唯一入口，`canvas-selection.test.ts` 有专门用例守着，不推翻。
- 接线：`AssetCanvas` 加一个**专用** ref（`onSelectionStart` 置位、`onSelectionEnd` 延一拍复位，与 `isDraggingRef` 同款做法但**不复用它** —— 那个 ref 还兼管节点拖拽，混用会让「拖一张卡」也走升格口径）。
- 既有的「被吸收的成员就地清 selected」那段（2026-08-19 的帧序修正）自动覆盖升格出来的成员：它算的是 `RF 原话 \ 归一化结论`，升格只会让这个差集更大。

### 决策 2：成组入口按「选区里有没有已分组的卡」置灰

选区含任何一张 `groupId` 指向**现存框**的卡时，「圈成一组」整项 `disabled`（Nick 拍板：置灰而非整格消失 —— 用户主动点选了卡、预期看到这一项，整格消失会让人以为菜单坏了；沿用「全是占位卡则整项置灰」那条先例）。

- 判据是**纯函数**，`ContextMenu` 与 store 两处共用一份 —— 重试判据那次教训（四个入口各判一次，卡面与属性面板口径相反）不重演。
- **悬空归属不算**：`groupId` 指着已不存在的框 = 几何上不在任何框内，按散卡处理，与 `normalizeSelection` 同口径。
- `createGroupFromSelection`（`actions.ts`）加同口径守卫：命中就整体拒绝、不建框、不发请求。选区来路不止右键菜单一条（撤销回填、程序性选中），UI 层置灰只是第一道。
- 「含组卡时整格不出现」（不做嵌套分组）原样保留，两条判据并存互不影响。

## Bug 2：撤销 Toast 活过了撤销窗口

### 根因

`Toast.tsx` 的自动消失 effect 把 `hovering` 放进了 deps：

```ts
useEffect(() => {
  if (!error || (hovering && pausable)) return;
  const id = setTimeout(() => clearToast(), error.durationMs ?? 4000);
  return () => clearTimeout(id);
}, [error, hovering, pausable, clearToast]);
```

带 action 的 Toast 虽然「不暂停」（`pausable === false`，不 return），但 hover 变化**仍会让 effect 重跑** → `clearTimeout` 旧的 + **重新计满 `durationMs`**。而用户要点撤销按钮，鼠标必然先移到 Toast 上 —— 于是 Toast 每被 hover 一次就续命 6s，反复进出可无限延长；`pendingDeletes` 的定时器照旧 6s 到点真删并摘掉撤销入口。用户随后点的是个**已失效的假按钮**：`cancelPendingDelete` 找不到 token 返回 null，静默 no-op。

这恰好破了该 effect 注释里自己写的不变式（「宁可让它按时消失，保住『按钮在 ⟺ 真能撤销』」）—— 意图对，deps 写漏了。

### 决策 3：带 action 的 Toast 计时只认 Toast 本身，hover 既不暂停也不重置

拆成两个 effect：不可暂停那条的 deps 里**没有 `hovering`**，一次调度到底；可暂停那条保持「hover 暂停、移出重新计满一轮」的既有行为（阅读期不被吞掉）。`DELETE_GRACE_MS` 数值不动（Nick 选的是「让时长一致」，不是延长窗口）。

### 决策 4（顺带加固）：退场动画期禁用撤销按钮

Toast 退场有 200ms（`useExitTransition(…, 200)`），期间卡片仍渲染且 `pointer-events-auto` —— 加上 Toast 的 `setTimeout` 比 store 的窗口定时器晚一个 commit 起算，末尾有约 200ms 的假按钮。`closing` 时给按钮 `disabled`，把这条尾巴一并封掉。同一个不变式，一行。

## 不做

- 不延长 `DELETE_GRACE_MS`、不做 redo、不给「已无可撤销」加新 Toast 文案（Nick 选的修法是「时长一致」，超窗后按钮已不在屏幕上，无需再解释）。
- 不改 RF 的 `selectionMode`（改成 `Partial` 会让橡皮筋擦边就选中，是另一套手感，且不解决路径 B）。
- 不做嵌套分组、不做「新框接管归属」（与容器模型相悖，见决策 2 讨论）。

## 独立评审处置（2026-08-20，干净上下文子代理按 commit 范围评审）

Critical 无。Important 两条、Minor 五条，逐条对照代码验证后的处置如下。

### I1（采纳）· 升格出的框没落进 RF 的节点选中态

亲验探针输出（`onSelectionStart` → `onSelectionChange([m1, loose])` → `onSelectionEnd` → 推进定时器）：

```
store  selectedIds = [ 'loose' ]  selectedGroupIds = [ 'g1' ]
rfNodes selected  = [ ['g1', false], ['m1', false], ['loose', false] ]
```

`onSelectionChange` 里那段吸收只做**减法**（`absorbed = RF 原话 \ 归一化结论`），而升格第一次让结论 ⊃ 原话 —— 多出来的框没有通道进 `rfNodes`：apply effect 一道被 `isDraggingRef` 早退、一道被 `reportedRef`（记归一化结论，与 want 恒等）早退。后果：store 认框、RF 不认 ⟹ 拖不动整组（`beginDrag` 拿到的 `dragged` 里没有框）、右键选区菜单（读 RF nodes）与 Delete（读 store）作用域打架、下一次 ⌘ 加选把框静默丢掉。

修法：在 `onSelectionEnd` 延一拍那个 `setTimeout` 里（复位之后）把 `selectedGroupIds` 对应的框节点补标 `selected` —— 同一条写入通道（`rfNodes`），只做「加」。**只能在收尾做**：框不在橡皮筋矩形内，框选进行中标 selected 会被 RF 下一帧的 `getSelectionChanges` 反标回 false，成逐帧对打。RF 收到后回报一次，那时 `marqueeRef` 已复位、归一化结论与 store 现值相同（框在选区 ⟹ 成员被吸收），幂等收敛。锁：`AssetCanvas.contextmenu.test.tsx`「橡皮筋收尾：升格出的框在 RF 节点里也是 selected」。

### I2（采纳）· 「Toast 展示时长 ≡ 撤销窗口」只在渲染侧成立

决策 3 把 hover 续命堵掉了，但 Toast 的 `setTimeout` 要等 React commit 后的 effect 才起算，比 `pendingDeletes` 的窗口定时器晚一个 commit（⌘A 后删几百张卡是几十到几百 ms）。那段时间里卡已真删、栈条目已摘，按钮还在且 `closing` 尚未置位 —— 点了仍是静默 no-op。

修法：把不变式钉在**权威侧** —— `flushPendingDelete` / `flushPendingGroupDelete` 摘 `undoStack` 条目的**同一次 `set`** 里，若 `toast.action.token === token` 就一并清掉 Toast（按 token 比对，不误清期间被顶掉的新 Toast）。Toast 自己的计时退成兜底，决策 3 / 4 原样保留。锁：`pending-delete.test.ts` 两条（到点清掉 + 被顶掉的无关 Toast 不受影响）。

### M1（采纳）· `undoCreateGroup` 的归属回写在守卫落地后必然失败

守卫保证进成组的卡的原归属只可能是「无」或「悬空」，于是 `byOld` 里的 `oldGid` 恒不在 `groups` 里 —— `assignGroup` 打出一个注定被 `failed[]` 拒回的请求，外加一条「分组未能保存」Toast 误导用户「⌘Z 没成功」。整段回写删除（连带那个只为它服务的 `restored`）：服务端删框本就会把成员 `group_id` 解绑成 null，本地已按 `prev` 还原，下一次 `loadCanvas` 以服务端为准收敛。两条改写用例的断言随之翻成「一个回写都不发」。

### M2（记录，待定）· 置灰与「整格消失」在框选路径上撞车

升格之后，「框选到某组 1 张成员 + 3 张散卡」的选区里出现组卡 ⟹ 「圈成一组」走的是**整格消失**（既有决策 2026-08-18「含组卡不做嵌套分组」那条），而 ⌘ 加选同一张成员卡走的是置灰。两套观感并存。本回合**不动**：整格消失那条是既有决策，改它超出本次范围，留给 Nick 拍板是否统一成置灰。

### M3（采纳）· `marqueeRef` 卡在 true 会让组内单卡永久点不中

RF 的 Pane 在右键（`button !== 0`）时 `onPointerUp` 直接 return、`pointercancel` 压根不调 `onSelectionEnd`，框选被这类路径中断后 `marqueeRef` 永久为 true ⟹ 点选也走升格口径，组内单卡再也点不中（改名 / @ 引用 / 详情的唯一入口）。修法：容器上 `onPointerDownCapture` 幂等复位 —— pointerdown 早于 mousedown，且容器 capture 阶段早于 RF 在 pane 上的冒泡监听，故「先复位、紧随其后 `onSelectionStart` 置位」顺序稳定。

### M4（采纳）· 判据从「属性」改成「属性 ∪ 几何」

容器模型里几何才是真相，`groupId` 只是投影。只看属性会漏掉「几何上明明躺在框里、却没有归属」的卡 —— 归属回写失败被 `assignGroup` 回滚过的、以及从不写归属的占位卡；这两类再成组就是真嵌套，正是成功标准 ① 要挡的后果。判据因此迁到 `src/lib/canvas-group.ts`（几何是它的地盘）：`hasGroupedCard(cards, groups)` = `groupId` 指向现存框 **或** 卡中心点命中任何框。悬空归属 + 几何在框外仍放行。

### M5（采纳）· 两个调用点入参口径统一

菜单侧与 store 侧都传「选区内的卡对象」（store 侧不再先滤占位卡 —— 占位卡几何上也可能正躺在框里）。「判据只写一份」的收益不被入参各写一份吃掉。

## 二次真机验收（2026-08-20，Nick 实测「只能框选整个分组框才会选中，否则都不会选中」）

上面 I1 的修法（在 `onSelectionEnd` 收尾补标框节点）**不够** —— 它治的是症状的后半段，根因在前面一帧。

### 根因

RF 的 `SelectionListener` 是**从 `nodes` 里筛 `selected`** 回报 `onSelectionChange` 的。升格路径下：

1. RF 把橡皮筋命中的成员标 `selected`，回报 `[m1]`；
2. 我们升格（store 得到框）并**就地把成员清成 `selected: false`**（2026-08-19 的既有机制）；
3. 此刻 RF 手里一个选中节点都不剩 ⟹ 它紧接着回报一次**空选区**；
4. 空数组归一化就是空选区 —— 刚升格出来的框被自己的清理动作当场冲掉。

框自己又不在 RF 的命中集里（`SelectionMode.Full`，框没被完整圈住就不上报），于是**只有整框被圈住时选中才留得下**，正是 Nick 看到的现象。`onSelectionEnd` 那次补标救不回来：store 早在拖动中就被空回报清空了。

### 定案：加减在同一次就地写入里做完

`onSelectionChange` 的就地写入既做「减」（清被吸收的成员）也做「加」（标升格出的框）。RF 就着新数组再回报一次，这次筛出的是框与散卡，归一化结论与 store 现值相同 ⟹ 一步收敛，不给回环留燃料。仍是同一条写入通道（`rfNodes`），`onSelectionEnd` 那份补标随之删除（同一件事不做两遍）。

原先「不能每帧做，会被 RF 下一帧 `getSelectionChanges` 反标」的顾虑不成立到需要绕开的程度：RF 只在**命中集变化**时才 `triggerNodeChanges`（`areSetsEqual` 守卫），命中集不变的帧不会反标；命中集变化的那一帧会有一次 `false → true` 的往复，与既有「减法」侧同款、每帧一次，不构成自持震荡。

### 真机验收（worktree dev server，真实项目画布）

橡皮筋只圈住组内一张音频卡（框远大于选区矩形）：

| 时点 | 框 `grp-b3af32aa616d` | 被选中的卡 |
|---|---|---|
| 拖之前 | `selected: false` | — |
| 拖动中 | `selected: true` | 无 |
| 松手后 | `selected: true` | 无（多选包围层出现） |

点选组内单卡：只有那张卡 `selected`、框未选中（决策 1 的边界成立）。

延迟删除 + 撤销：删卡 → Toast「Deleted / Undo」出现 → hover 进出两次 → t=2.8s 点撤销 → 卡回到画布、Toast 变「Delete undone」，服务端 DELETE 从未发出。

锁：`AssetCanvas.contextmenu.test.tsx`「橡皮筋真机帧序：升格的同一帧就把框标进 RF，不留空回报的缝」—— 判别力落在「帧 1 之后 `g1` 在 `rfNodes` 里是 `selected`」，旧实现是 `false`（那正是空回报的来路）。
