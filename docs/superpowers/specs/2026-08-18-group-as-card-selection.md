# 分组框升格为「组卡」：画布选区模型统一

日期：2026-08-18
状态：已批准（2026-08-18 Nick 确认，含「我按惯例拍的细则」八条）
前置：`2026-08-05-canvas-groups`（分组本体 / 容器模型）、`2026-08-04-canvas-keyboard`（⌘A 与删除键）、`2026-08-13-group-title-and-key-delete`（框的选中态与 Backspace 删框）、`2026-08-13-group-a11y-and-menu-debts`（键盘让位与微调不重判归属）、`2026-08-17-tidy-groups-as-boxes-design`（整理把框当固定节点）

## 目的

Nick 的实机诉求两句话：

1. **成组之后，这个分组本身在画布上就是一张独立的卡片，所有操作与其他卡片一致** —— 因此框选 / 全选命中的是**分组**，而不是分组内部的卡片。今天恰恰相反：⌘A 与橡皮筋框选选中的是框内成员卡，一拖就把成员全甩出框外，框自己留在原地。
2. **右键菜单要把「解散分组」与「删除分组」分开**：解散 = 拆框留卡（今天「删除框」的行为），删除 = 框与内部所有卡片一起删。

外加一条：**⌘A 从「只选视口内可见」改成事实上的全选**。

这不是补丁级修正，而是选区模型的机制替换：分组从「画布上一个不可选的容器装饰」升格为**一等可选节点（组卡）**。三条既有约束因此被正面推翻，本 spec 逐条点名接管。

## 被推翻的既有约束（勿再按旧口径「修回来」）

1. `src/lib/rf-nodes.ts:132` 的 `selectable: false` —— 原注释「否则 ⌘A / 框选会把框也选上，Delete 键语义立刻歧义」。**歧义由本 spec 的决策 2 正面消解**（Delete 对组卡 = 删整组），故约束解除。
2. store 的 `selectedGroupId: string | null`（单框）与 `selectedIds` **互斥** —— 见 `src/store/index.ts` 的 `selectAsset` / `setSelection` / `selectGroup` / `clearSelection` 四处互相清空。改为 `selectedGroupIds: string[]` 且**允许与 `selectedIds` 共存**。
3. `2026-08-04-canvas-keyboard` 约束 4「⌘A 只选视口内可见且未被类型筛选隐藏的卡」的**视口那一半**（`src/lib/offscreen.ts` 的 `selectAllIds`）。类型筛选那一半保留，见决策 7。

被推翻的直接后果：键盘层不再能靠「两个选区互斥」来裁决 Backspace 删卡还是删框（`shouldTriggerCanvasDelete` / `shouldTriggerGroupDelete` 当初刻意并列的理由随之失效），两条判定合并为一条混合判定。

## 约束

- **容器模型不动**：几何是真相、`Asset.groupId` 是它的持久化投影；`canvas-group.ts` 的包围盒与「中心点命中最内层框」判据、`group_id` 在 canvas item 顶层而非 `reference` 里，全部原样。
- **位置归前端所有**不动：轮询 / 重连不得覆盖已有 position；坐标回写走批量端点 + 框坐标逐个 `updateCanvasGroup`。
- **纯逻辑下沉**：选区归一化、全选取数、删除目标展开一律是无副作用纯函数（新文件 `src/lib/canvas-selection.ts`），单测覆盖；组件只接线。
- **撤销栈存数据不存闭包**，每条带 `pid`；不做 redo。
- **不引入嵌套分组**：组卡不能再被圈进另一个框（见细则 5）。
- 不动 UI 令牌 / 动效语汇：组卡选中态复用既有「描边转 primary + 柔光外晕」，不新造样式或 keyframes。
- i18n 沿用既有做法（不引入复数机制，`{{count}} 张卡` / `card(s)`），11 个语言包同步补词条，`src/i18n/i18n.test.ts` 的 key 对齐守护必须绿。

## 追加约束：选中态只有**一个**写入通道（2026-08-19 真机 bug 定案）

组卡进 RF 选中集之后，「谁拥有选中态」必须仲裁清楚，否则会绕出自持回环。真机复现路径两条：
**拖动分组框内的卡片后点画布空白**、**⌘A 后拖完选区再点空白** —— React 报
`Maximum update depth exceeded`，栈落在 RF 的 `StoreUpdater → setNodes`。探针实测：一次点击引发
**35 次**选区写入，被 React 的嵌套更新上限打断，末态 store 与 RF 还对不上（store 说选中 4 张、RF 说没有）。

根因：节点重建按 store 回灌 `selected`，而 RF 自己的交互也写同一份节点状态。点空白那一下，
RF 的「清空」与我们回灌的「仍选中」凑成一对矛盾事件，此后每一轮各自再生一次，永不收敛。

故本回合起，以下三条是**约束**：

1. **节点重建不携带选区意图**：`buildRfNodes` / `buildGroupNodes` 只沿用节点里已有的 `selected`，
   仅当 RF 没见过该节点（首帧 / 新增卡）才回落 store。
2. **store → 节点 单独一个 effect，且带来源判据**：RF 刚回报过的那批选区**不再回落**（那是它自己改的），
   只有程序性选区（⌘A / 撤销回填 / 点框体 / 右键分流）才写进节点数组。
3. **选区写入一律幂等**：`selectAsset` / `selectGroup` / `clearSelection` / `setCanvasSelection`
   值没变就保持同一引用 —— 选区数组进了节点同步 effect 的依赖，无条件写新数组等于每次调用都白跑一次
   节点重建（`onPaneClick` 每点一下空白都会调 `selectGroup(null)`），那是回环的燃料。

反向锁：`lib/rf-nodes.test.ts`（重建不改写已有 selected）、`AssetCanvas.contextmenu.test.tsx`
（RF 回报不回灌 / 程序性选区要落到节点）、`store/group-selection.test.ts`（写入幂等）。

## 追加修复：框恒在卡之下（RF 的选中抬升）

RF 的 `elevateNodesOnSelect` 默认给**选中**节点 +1000（`SELECTED_NODE_Z`），组卡一被选中就从
`z:-1` 蹿到 999、框体盖住自己的成员——卡片点不到也拖不动（Playwright 命中日志直接写着
frame body intercepts pointer events）。画布因此改用 `zIndexMode="manual"`，z 全部显式给：
**框 -1 / 卡 0 / 选中的卡 1**。

## 决策

### 决策 1：混合选区 —— 组卡整体 + 组外散卡，成员卡不进选区

选区从此是两个集合：`selectedIds`（卡 id）+ `selectedGroupIds`（组 id），**不再互斥**。

- 组卡进 RF 选中集（`selectable: true`），点选 / ⌘⇧加选 / 橡皮筋框选 / ⌘A 与卡片一视同仁。
- **成员卡被其框吸收**：某张卡所属的框也在选区里时，该卡**不**进 `selectedIds`。这不只是显示口径，更是正确性要求 —— 否则拖拽会给成员叠两次位移（框整体带它走 + 它自己作为选中节点走）。归一化是纯函数 `normalizeSelection(nodeIds, assets, groups)`，RF 回报的混合 id 一律先过它。
- **为什么不把组 id 混进 `selectedIds`**：全仓大量代码假定 `selectedIds` 里都是资产 id（`nudgedPositions`、`requestDeleteAssets`、批量重试、`offscreenIds` 角标、列表联动、`contextTargetFor`…）。混进组 id 会在这些地方静默查空 —— `onNodeContextMenu` 的注释就记着一次同类事故（「group id 已经进了 selectedIds，污染后续 ⌘A / 批量动作的选区口径」）。两个数组是**防止同类事故复发的类型边界**。
- 框内单卡**仍可单独点选**（今天行为不变）：不然组内单卡再也无法查看 / 重试 / 改名。⌘加选允许组卡与散卡混选。

### 决策 2：「删除分组」= 删框 + 内部所有卡片；「解散分组」= 拆框留卡

口径**统一到组卡这个抽象**：不论单击一个组卡按 Delete、混合选区按 Delete，还是右键「删除分组」，语义都是「删掉这张组卡」= 框 + 全体成员。

- 今天 `deleteGroup`（拆框留卡 + 5 秒撤销）**语义不变但改名为「解散分组」**（`ungroupGroup`），入口降为右键菜单新增项 `canvas.group.ungroup`。
- 右键菜单于是三项：重命名 / 解散分组 / 删除分组。原「删除框」文案改为「删除分组」（11 语言）。
- **代价明写**：这推翻 `2026-08-13-group-title-and-key-delete` 决策 2 的「删框无损（卡一张不少）」。旧习惯用户按 Backspace 删框会连卡一起删，靠延迟删除窗口 + ⌘Z 兜。

### 决策 3：⌘A 改为事实全选

⌘A = **全部组卡** + **所有未被类型筛选隐藏的散卡**，与视口无关。

- `selectAllIds` 从 `src/lib/offscreen.ts` 迁到 `canvas-selection.ts` 并改签名：不再需要 RF 节点、viewport、容器尺寸（视口数学整块退役），只吃 `assets` / `groups` / `visibleKinds`，返回 `{ assetIds, groupIds }`。`offscreen.ts` 只留角标用的 `offscreenIds`。
- 原「只看视口」的理由（选到屏外的卡与直觉不符）由 Nick 直接推翻：真全选就是真全选。

### 决策 4：本回合的操作面

覆盖：**选中**（点选 / 加选 / 橡皮筋 / ⌘A）· **拖拽** · **方向键微调** · **删除** · **右键菜单**。

不覆盖（另立需求）：⌘C/⌘V 复制、列表视图里出现组行、批量重试 / 下载把组当一项计数、搜索命中组名、新资产角标。

### 决策 5：⌘C/⌘V 复制整组另立回合

盘问中查明：**卡片今天根本没有复制粘贴** —— 画布上的 ⌘V 是「粘贴剪贴板文件 → 上传成新卡」（`filesFromClipboard`），全仓无 duplicate 实现。所以「复制整组」不是对齐既有能力，而要新造一整套：内部剪贴板态、⌘V 与文件粘贴的优先级判据、粘贴落位、组复制时成员副本与归属重建、粘贴的撤销条目。后端有现成落点（`writeCanvasItemFromUrl` = `POST /canvas/items/import`，服务端按 `source_url` 重拉一份，不花生成费用；text 卡走 `createTextCanvasItem`），但与本回合零依赖，故拆到下一回合。

### 决策 6：删除一律不弹窗，延迟删除 + **一条合并撤销**

- 取消「多选 Delete 弹确认弹窗」这条既有防误删（`AssetCanvas.tsx:783`）。不论单张 / 多张 / 含组，Delete 一律就地删 + 一条 Toast（窗口内整体撤销）+ 一条撤销栈条目。
- 新增 `UndoEntry` 类型 `{ type: 'deleteSelection'; pid: number; token: string }`，一次 ⌘Z 把框、成员归属、卡片与在途生成任务一起搬回来。**不复用** `delete` / `deleteGroup` 两条：那两条各自只管一半，混合删除拆成两条会让 ⌘Z 要按两次（且两条 Toast 抢同一个位置）。
- 合并的待删注册表 `pendingSelectionDeletes` 存 `{ pid, assets, groups, members(含坐标), genTasks, timer }`，仍在 actions 闭包里（定时器不可序列化，不进 store）；关页兜底沿用 `keepalive`。
- Flush 顺序：**先逐个删 item，再删 group** —— 反过来会在删卡请求还在飞时先让框消失，成员的 `group_id` 悬空。
- **代价明写**：真全选 + Delete 是一下清空整个项目画布的操作，几秒窗口一过即不可逆（撤销栈条目仍在，但服务端已真删）。Nick 明确取「手感优先」。

### 决策 7：类型筛选只作用于散卡，组卡当一张卡看

- ⌘A：散卡排除被筛隐藏的；组卡一律选中，**不看内部成员是否被筛隐藏**。
- 删除组卡：连被筛隐藏的成员一起删，Toast 文案报**真实数量**。
- **代价明写**：筛掉音频后删一个组，组内隐藏的音频也没了（可一次 ⌘Z 恢复）。这是「分组是一张卡」抽象的必然结论 —— 让筛选穿透到组内会把抽象撕开，且删完会凭空冒出几张不在组里的卡。

## 我按既有惯例拍的细则（有异议现在提，进实现即成约束）

1. **组卡的键盘可达性**：`selectable: true` 后 RF 自己的 Enter/Space 选中即生效，`shouldSelectFocusedGroup`（Enter/Space 把聚焦框变选中，`2026-08-13-group-a11y-and-menu-debts` 决策 3）随之退役 —— 那是为「框不可选」补的绕行。`groupIdFromFocus` 若无他处引用一并删，不留 dead code。
2. **拖拽**：单拖一个组卡沿用今天的 `groupDragRef` + `moveGroup(gid, delta)`（拖动期成员只在 RF 那份节点里按 delta 跟随，松手一次性落定）。混合选区拖动走 RF 的 `onSelectionDrag*` 路径，把同一套「成员跟随」推广到选区里的每个组：松手时按节点 type 分流 —— 组走 `moveGroup`，散卡走 `persistDraggedNodes`，同一次操作合成**一条** `positions` 撤销条目（复用既有 `groupGeoms` 字段记框坐标，`positions` 只记变位的卡）。
3. **不重判归属**：拖组卡不吞并路过的散卡（`2026-08-05` 的有意例外，`moveGroup` 不做入组判定）；方向键微调同样不重判（`2026-08-13-group-a11y-and-menu-debts` 决策 2 的反向锁）。散卡拖动仍按中心点入 / 出组。
4. **方向键微调**：组卡进选区后方向键要能挪它 —— RF 的 `moveSelectedNodes` 会挪组节点本身，但成员不是选中节点、不会跟着动。故微调收口（`nudgedPositions` → 落库）扩成混合：组走 `moveGroup(gid, delta)`，成员坐标随之平移，与拖拽走同一条落库路径。
5. **混合选区的右键菜单**：含组卡时**隐藏「圈成一组」**（本回合不做嵌套分组）；「删除 N 项」文案与作用域按混合语义（`canvas.context.deleteMixed`：N 张卡片 + K 个分组）；「用作参考 / 批量下载 / 批量重试」的作用域 = 散卡 + 被选组的全体成员展开（这些动作无损，用户直觉是「对我选中的东西都做」）。`onSelectionContextMenu` 今天把全部节点 id 原样塞进卡片批量菜单，必须先过归一化分流。
6. **组卡选中视觉**：复用卡片那套（描边转 `--color-primary` + 柔光外晕），`GroupNode` 从 RF 的 `selected` prop 取态，不再读 `selectedGroupId`。drop / leave 高亮与选中三态必须互相可辨（沿用 `2026-08-13` 的「加粗已被 drop 占用」结论）。
7. **`selectedGroupId` 的读点**（`AssetCanvas.tsx` / `GroupNode.tsx` / `canvas-keys.ts` / `store/index.ts`，共 12 处）全部迁到 `selectedGroupIds`；`selectGroup(id)` 保留为「单选一个组」的便捷包装（点选路径用），新增统一入口 `setCanvasSelection({ assetIds, groupIds })` 供 `onSelectionChange` / ⌘A 使用。
8. **`DeleteAssetModal` 的去留**：键盘删除不再用它；右键菜单「删除 N 项」是否仍走确认弹窗，在实现时按「口径统一」原则一并取消（倾向取消，弹窗组件若无他处引用则整块删除，不留 dead code）—— 这一条实现前会再确认一次。

## 成功标准

1. 画布上有 2 个分组 + 3 张散卡时按 ⌘A：两个组卡显示选中态、3 张散卡选中，**框内成员卡不显示选中**；此时拖动任一处 → 两个框连同成员、3 张散卡整体平移，松手后**没有任何成员跑出框外**，刷新后位置一致。
2. 同上选区按方向键：框与散卡同步微调，成员跟着框走；停手 500ms 后一次落库、一条撤销条目，⌘Z 全部回到原位。
3. 橡皮筋框选扫过一个分组：选中的是组卡，不是它的成员。⌘点击可把组卡与散卡混选。
4. 单击组卡按 Delete：框与**全体成员**消失，一条 Toast 给撤销窗口，⌘Z 一次把框、成员、归属、在途生成任务全部还原（含被类型筛选隐藏的成员）。
5. 混合选区按 Delete：**不弹确认弹窗**，一条 Toast、一条撤销条目，⌘Z 一次复原。
6. 分组右键菜单三项：重命名 / 解散分组 / 删除分组。「解散分组」= 框消失、卡一张不少留原位（旧 `deleteGroup` 行为）；「删除分组」= 与 4 同。
7. ⌘A 与视口无关：把视口平移到远处空白区按 ⌘A，屏外的卡与组全部进选区；类型筛选隐藏音频后 ⌘A，隐藏的散卡不进选区，但含音频成员的组仍整体选中。
8. 焦点在输入类元素（含框标题条的改名输入框）时，⌘A / Delete / 方向键照常归输入框；任何 store 级浮层打开时四条画布快捷键一律让位（`canvasOverlayOpen` 口径不变）。
9. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` / `pnpm build` 全绿。

## 明确不做

- 嵌套分组（组卡再进组）。
- ⌘C/⌘V 复制卡片 / 复制整组（决策 5，下一回合）。
- 组卡进列表视图 / 搜索命中集 / 新资产角标 / 批量重试与下载的计数口径。
- redo（沿用「不做 redo」）。
- 删除的批量后端端点（见风险 1，只记待办）。
- 组卡参与拖拽对齐吸附（`align-guides` 今天刻意不含框，本回合不扩）。

## 风险与待办

1. **没有批量删除端点**：`deleteCanvasItem` 是逐个 DELETE（`src/lib/pgc/client.ts:153`），全仓也没有批量删除。真全选后一下 Delete 会打出 N 个请求（几百张卡就是几百个），`keepalive` 兜底也是逐个。本回合按逐个发 + 分片节流实现（参照 `canvas-batch.ts` 的分片思路），并向后端提「画布 item 批量删除端点」的需求。
2. **删框的后端成员语义待验证**：现有「解散分组」说明删 group 不会删成员，但成员的 `group_id` 是被后端清空还是留悬空未在文档中确认。实现时先验一次（删组后重新 `listCanvasItems` 看成员 `group_id`），结论写进 plan。
3. **乐观建框期的临时 id**：组卡进选区后，「圈成一组 → 立刻 ⌘A → 拖 / 删」这条路径会让临时 id 出现在 `selectedGroupIds` 里。所有按 gid 找框的地方必须先过 `realGid` 解别名（既有约定），归一化纯函数也要容忍「gid 在 `groups` 里查不到」。
4. **成员数与选区的联动**：`isDraggingRef` 挡 sync effect 那套（`2026-08-11-drag-commit-guards` + `2026-08-13` 决策 3 的「复位与补跑成对」）在混合拖拽下要重新走一遍真机验证 —— 混合选区松手时同时有 `moveGroup`（同步写 store）与 `persistDraggedNodes`（批量回写），补跑时机若只覆盖一半，框的 `data.group` 会留陈旧坐标并在下一次缩放时被落库。
