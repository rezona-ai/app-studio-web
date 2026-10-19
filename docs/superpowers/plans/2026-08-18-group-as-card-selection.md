# 实现计划：分组框升格为「组卡」

spec：`docs/superpowers/specs/2026-08-18-group-as-card-selection.md`（已批准）
分支：`feat/group-as-card-selection`（worktree 落 `.orca/worktrees/`）
日期：2026-08-18

## 推进策略

机制替换按「**并存加新 → 原子切换 → 删旧**」三段走：

- **阶段 A（并存加新）**：新纯函数、新 store 字段、新 action 全部就位并单测通过，但**画布行为一字不变** —— 组卡此刻仍 `selectable: false`，新入口无调用方。每个任务可独立评审、独立回滚。
- **阶段 B（原子切换）**：一次性把组卡变成可选节点，随后逐个操作面切到新入口。B1 是不可分割的切换点（选区语义在这一步翻转），B2–B6 各自独立可测。
- **阶段 C（删旧）**：删掉被新机制取代的绕行代码与死字段，不留 dead code。

每个任务遵铁律 1：**先写失败测试再写实现**。任务粒度 = 一个最小逻辑变更 = 一个提交。

验证命令（每个任务至少跑前三条，阶段收尾跑全套）：

```bash
pnpm exec vitest run <本任务测试文件>
pnpm exec tsc --noEmit
pnpm lint
pnpm test && pnpm test:tz && pnpm build
```

## 前置调查（不产出代码，结论进 plan 附录）

**T0：后端删组语义验真**（spec 风险 2）
删一个含成员的组后重新 `listCanvasItems`，看成员的 `group_id` 是被后端清空还是留悬空值。做法：本地开发接 dev 上游，控制台走 `pgcApi.deleteCanvasGroup` → `pgcApi.listCanvasItems` 对比。
- 若后端已清空：T5 的 flush 只需删 item + 删 group。
- 若留悬空：T5 需要在删 group 前先把成员 `group_id` 显式清掉（或确认删 item 先行已让问题消失）。
结论回写本文件附录，**T5 开工前必须有结论**。

---

## 阶段 A：并存加新

### T1：纯函数模块 `src/lib/canvas-selection.ts`

新建，全部无副作用、不 import store：

- `normalizeSelection(nodeIds, assets, groups) → { assetIds, groupIds }`：按节点 id 分流成卡 / 组；**某卡所属框也在选区里时该卡被剔除**（spec 决策 1 的正确性核心）；gid 查不到框时容忍（乐观建框的临时 id，spec 风险 3）。
- `selectAllTargets(assets, groups, visibleKinds) → { assetIds, groupIds }`：全部组 + 未被类型筛选隐藏且不属于任何**存在的**框的散卡（spec 决策 3 + 7）。
- `deleteTargetsFor({ assetIds, groupIds }, assets, groups) → { assetIds, groupIds, memberIds }`：把组展开成「框 + 全体成员（含被筛隐藏的）」，与散卡去重后给出最终删除集（spec 决策 2 + 7）。

测试 `canvas-selection.test.ts` 覆盖：成员被框吸收 · 组内卡单独选中时不被吸收（框没在选区里）· 未知 gid 容忍 · 类型筛选只挡散卡 · 展开去重（散卡同时是某选中组的成员时只出现一次）。

### T2：store 选区字段扩容（`selectedGroupId` → `selectedGroupIds`）

- `ServerState`/`UIState` 字段改 `selectedGroupIds: string[]`；**取消与 `selectedIds` 的互斥**（`selectAsset` / `setSelection` / `selectGroup` / `clearSelection` 四处的互相清空全删）。
- 新增统一入口 `setCanvasSelection({ assetIds, groupIds })`；`selectGroup(id)` 保留为「单选一个组」的包装（点选路径用），`selectGroup(null)` = 清组选区。
- 旧读点过渡：导出 selector `selectSelectedGroupId(s) = s.selectedGroupIds[0] ?? null`，让 `GroupNode` / `canvas-keys` / `AssetCanvas` 的 12 处旧读点在阶段 A 内保持行为不变（阶段 C 删掉这个 selector）。
- **`src/store/group-selection.test.ts` 整体重写**：该文件今天守的正是被推翻的「两向互斥」，改成守「共存 + 归一化」的反向锁 —— 选组不清卡选区、选卡不清组选区、空选区不抹组选中（这条保留：点框体仍先经 RF 的空选区回报）。

### T3：`ungroupGroup` —— 「解散分组」入口（旧 `deleteGroup` 改名）

- `actions.ts` 的 `deleteGroup` 更名 `ungroupGroup`（**行为一字不改**：拆框留卡 + 延迟删除 + `deleteGroup` 撤销条目 + 现有 Toast）。`UndoEntry` 的 `type: 'deleteGroup'` 与 `pendingGroupDeletes` 沿用旧名（它们描述的是「延迟删框」这件事本身，不是菜单项）。
- `GroupContextMenu` 加第三项「解散分组」→ `ungroupGroup`；「删除框」文案改「删除分组」，此刻**仍指向 `ungroupGroup`**（真正改语义在 T6，避免这一步就悄悄变成有损操作）。
- i18n：11 语言补 `canvas.group.ungroup`，改 `canvas.group.delete` 文案。`src/i18n/i18n.test.ts` 的 key 对齐守护必须绿。
- 测试：`GroupContextMenu.test.tsx` 断言三项与各自回调；`Workspace.test.tsx:453` 现有断言同步。

### T4：合并删除入口 `deleteSelection` + 合并撤销条目

- `UndoEntry` 加 `{ type: 'deleteSelection'; pid: number; token: string }`（spec 决策 6：**不复用** `delete` / `deleteGroup`）。
- actions 加闭包注册表 `pendingSelectionDeletes: Map<token, { pid, assets, groups, members(含坐标), genTasks, timer }>`，与现有两套并列。
- `deleteSelection({ assetIds, groupIds })`：走 `deleteTargetsFor` 展开 → 一次 `set` 内摘卡 + 摘框 + 摘在途 genTasks + 入一条撤销条目 + 一条 Toast（`UNDO_DELETE_SELECTION_PENDING`，`durationMs = DELETE_GRACE_MS`）；占位卡沿用「即时移除、不进窗口」的既有取舍。
- `flushPendingSelectionDelete(token)`：**先逐个删 item，再删 group**（反序会让成员 `group_id` 悬空）；逐个 DELETE 按 `chunk()` 分片节流（`canvas-batch.ts` 现成），关页兜底沿用 `keepalive`。
- `cancelPendingSelectionDelete(token)`：框、成员归属、卡片坐标、genTasks 一次性还原；`undo()` 加 `deleteSelection` 分支（`ensureVisible` 取还原集包围盒左上角，`UNDO_DELETE_SELECTION` 成功 Toast）。
- i18n：`errors.ts` 登记两个新 code + 11 语言文案（含「N 张卡片和 K 个分组」插值）。
- 测试新建 `store/delete-selection.test.ts`：混合目标展开正确（含被筛隐藏成员）· 一次删除只入一条撤销条目 · 窗口内 ⌘Z 全量还原（框 + 成员 + 归属 + genTasks）· 窗口过后 flush 的调用顺序是 item 先 group 后 · 切项目后按 pid 二次校验不误撤。
- **此刻无调用方**，画布行为不变。

---

## 阶段 B：原子切换

### T5：组卡成为一等可选节点（不可分割的切换点）

- `rf-nodes.ts`：`selectable: false` → `true`（连同那段注释重写，指向本 spec）。`zIndex: -1` 与 `pointerEvents: 'none'` 保持 —— 框仍在卡之下、框内空白仍能拉橡皮筋。
- `GroupNode`：选中态改读 RF 的 `selected` prop，不再读 store；视觉复用「描边转 `--color-primary` + 柔光外晕」，与 drop / leave 高亮三态可辨。
- `AssetCanvas.onSelectionChange`：节点 id 先过 `normalizeSelection`，再 `setCanvasSelection`。
- `onNodeContextMenu` 的框分流保持（框仍走 `openGroupMenu`）。
- 测试：`AssetCanvas.test.tsx` 加「橡皮筋框选扫过分组 → 选中组、成员不进 `selectedIds`」「⌘点击混选组与散卡」；`GroupNode` 选中态快照。
- **风险点**：此步之后 ⌘A / 删除 / 拖拽 / 微调会短暂处于「组能被选中但各操作面还没适配」的中间态。T6–T9 必须在同一回合内完成，**中间态不推 dev**。

### T6：删除键与删除语义切换

- `canvas-keys.ts`：`shouldTriggerCanvasDelete` 与 `shouldTriggerGroupDelete` 合并为一条 `shouldTriggerDelete(key, hasSelection, activeEl, overlayOpen)`（`hasSelection` = 卡或组非空）；`overlayOpen` 仍必填。
- `AssetCanvas`：两个删除监听合成一个 → `deleteSelection({ assetIds, groupIds })`；**去掉多选弹确认弹窗那一支**（spec 决策 6）。
- `GroupContextMenu` 的「删除分组」改指 `deleteSelection({ groupIds: [gid] })`（此刻语义才变成删框 + 成员）；「解散分组」仍指 `ungroupGroup`。
- 测试：`canvas-keys.test.ts` 合并判定用例（含输入框 / 浮层让位的既有反向锁）；`AssetCanvas.test.tsx` 断言「多选 Delete 不再开弹窗、直接走 `deleteSelection`」。

### T7：⌘A 真全选

- `selectAllIds` 从 `offscreen.ts` 迁入 `canvas-selection.ts` 并换成 `selectAllTargets`（视口数学整块退役，`offscreen.ts` 只留 `offscreenIds`）。
- `AssetCanvas` 的 ⌘A effect 不再读容器尺寸 / viewport，直接 `setCanvasSelection(selectAllTargets(...))`。
- 测试：`canvas-selection.test.ts` 已覆盖取数；`AssetCanvas.test.tsx` 加「视口外的卡与组也进选区」「筛掉某类型后散卡不进、含该类型成员的组仍整体进」。

### T8：混合选区拖拽

- `onSelectionDragStart/Drag/Stop`：把今天单拖框的「成员按 delta 实时跟随（只改 RF 那份节点）」推广到选区里的每个组；松手按节点 type 分流 —— 组走 `moveGroup(gid, delta)`，散卡走 `persistDraggedNodes`，合成**一条** `positions` 撤销条目（框坐标进既有 `groupGeoms`，`positions` 只记变位的卡）。
- 单拖一个组卡的 `groupDragRef` 路径保持不变。
- 沿用「不重判归属」：拖组不吞散卡、散卡拖动仍按中心点入 / 出组。
- `isDraggingRef` 的「复位与补跑成对」在混合路径上重新验证一遍（spec 风险 4：一次松手同时有 `moveGroup` 同步写与批量回写，补跑只覆盖一半会让框的 `data.group` 留陈旧坐标并在下次缩放时被落库）。
- 测试：`AssetCanvas.dragstop.test.tsx` 加混合拖拽 —— 成员不脱框 · 一条撤销条目 · 撤销后框与卡同回原位；框坐标回写走 `updateCanvasGroup`、卡走批量端点。

### T9：混合选区方向键微调

- 微调收口扩成混合：`nudgedPositions` 仍管卡，组走 `moveGroup(gid, delta)`（delta 从 RF 节点位移取），成员坐标随之平移；与拖拽共用同一条落库路径与撤销形状。
- 沿用「微调不重判归属」的反向锁（`AssetCanvas.nudge.test.tsx` 现有用例不许放宽）。
- 测试：`AssetCanvas.nudge.test.tsx` 加「组卡在选区里 → 方向键挪框且成员跟随 → 停手 500ms 一次落库、一条撤销条目」。

### T10：混合选区右键菜单

- `onSelectionContextMenu` 先过归一化再分流（今天把全部节点 id 原样塞进卡片批量菜单）。
- 含组卡时：**隐藏「圈成一组」**（不做嵌套分组）；「删除 N 项」文案换 `canvas.context.deleteMixed`（N 张卡片 + K 个分组）并走 `deleteSelection`；「用作参考 / 批量下载 / 批量重试」作用域 = 散卡 + 被选组的全体成员展开。
- 测试：`ContextMenu.test.tsx` 加混合选区三条断言（无成组项 · 删除文案与目标 · 无损动作的展开作用域）。

---

## 阶段 C：删旧

### T11：退役被取代的绕行与死字段

- 删 `shouldSelectFocusedGroup` / `groupIdFromFocus`（`selectable: true` 后 RF 自己的 Enter/Space 选中即生效，这两个是为「框不可选」补的绕行）及其用例与 `AssetCanvas` 里的对应 effect。
- 删 T2 的过渡 selector `selectSelectedGroupId`，12 处旧读点确认已全迁。
- 删 `offscreen.ts` 里 `selectAllIds` 的残留导出与视口参数类型。
- `grep -rn "selectedGroupId\b" src` 应零命中（除历史 spec 文档）。

### T12：`DeleteAssetModal` 去留收口（spec 细则 8）

按「口径统一」取消右键「删除 N 项」的确认弹窗 → `openDeleteModal` / `deleteTarget` / `DeleteAssetModal` 全链路若无其它引用则整块删除（含 `DeleteAssetModal.test.tsx`）；仍有引用则只删键盘那一支并在本文件记因由。**动手前向 Nick 确认一句**。

---

## 收尾

1. 全套验证在**合并结果**上重跑：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build`。
2. 真机走 spec 的九条成功标准（`pnpm dev`，重点 1 / 4 / 7 三条：混合拖拽不脱框、删组连成员含隐藏项、真全选与筛选的交叉）。
3. 合并前派干净上下文子代理按 commit 范围评审（只给 spec + diff）；Critical / Important 修完才继续，Minor 记回 spec。
4. `--no-ff` 合并成一个回合分组，合并后跑 `/walkthrough` 更新 `docs/FEATURE-MAP.md`。
5. 后续需求另立 spec：⌘C/⌘V 复制卡片与整组（spec 决策 5）· 画布 item 批量删除端点（spec 风险 1，需后端）· 组卡进列表视图 / 搜索 / 批量计数口径。

## 附录：实现记录与偏离

### T0（后端删组语义）—— 无需真机验，结论已在代码里

`actions.ts` 的 `flushPendingGroupDelete` 注释明写：**「服务端删框会自己把成员 group_id 解绑成 null，前端不必再逐张回写」**。故 `deleteSelection` 的 flush 只需「先逐个删 item、再删 group」，不必额外清成员归属。

### 与 plan 的偏离（逐条，均为实现期发现的更优做法）

1. **T3 与 T4 换序**：先做合并删除入口（T4），再接右键菜单（T3）。按原序，菜单的「删除分组」会先接一个 T6 才改对的临时指向，而那要写一条随后必然推翻的测试断言。
2. **T2 不做过渡 selector**：`selectSelectedGroupId` 只会活两个提交就被 T11 删掉，纯 churn。两个旧读点（GroupNode / 删框监听）直接按新字段读，语义不变。
3. **T4 不新增 `deleteSelection` 撤销条目类型**：复用既有 `type: 'delete'` —— 它描述的就是「一次删除操作」，而 `deleteSelection` 成了删除的唯一入口（`requestDeleteAssets` 退化为无组的包装）。新增类型只会在 undo 里多一条一模一样的分支。
4. **T8 把 `moveGroup` 整体升格为 `moveDragged(cards, groups)`** 而非新增并列 action：混合拖拽必须合成一条撤销条目，并列两个 action 做不到，而留着 `moveGroup` 只会成为 dead code。
5. **`deleteTargetsFor` 改名 `expandGroupTargets`**：T10 的无损动作也要「组 → 全体成员」这份展开，名字不该绑在删除上。
6. **T11 顺带确认了 RF 的键盘选中**：`@xyflow/system` 0.0.77 的 `elementSelectionKeys = ['Enter', ' ', 'Escape']` 对 `selectable` 节点生效，故绕行可删。
7. **T12 已确认（Nick，2026-08-18）：整块删除**确认弹窗 —— 组件 / 两个 store action / Workspace 挂载 / `canvasOverlayOpen` 里那条永假判据 / 11 语言 4 条孤立词条。
8. **微调那条刻意没走 `moveDragged` 的散卡分支**：`moveDragged` 会按几何复判散卡归属，而「方向键不重判归属」是 2026-08-13 决策 2 的反向锁。故散卡仍走 `setAssetPositions`，只有框那侧借 `moveDragged` 的「框 + 成员一起搬」。

### 变异检查（本回合实际做过的）

- `buildGroupNodes` 的 `selectable: true` 刷回 `false` → `rf-nodes.test.ts` 红 1 条。
- `selectAllTargets` 的 `groupIds` 置空 → `canvas-selection.test.ts` 红 3 条 + `AssetCanvas.test.tsx` 红 1 条。

### 验证输出（分支上最后一次全量，合并前）

```
pnpm test              → Test Files 298 passed, Tests 3866 passed | 4 skipped
pnpm test:tz           → 1 passed | 4 skipped
pnpm exec tsc --noEmit → exit 0
pnpm lint              → 0 errors, 12 warnings（全为既有 `_` 前缀未用变量）
pnpm build             → 成功
```

### 真机验收发现并修掉的三条（2026-08-19，dev server on :3002）

1. **选中的框被 RF 抬到卡片之上**（`elevateNodesOnSelect` +1000）→ 卡片点不到、拖不动。
   改 `zIndexMode="manual"`，z 显式给（框 -1 / 卡 0 / 选中的卡 1）。提交 `565e8d37`。
2. **`moveDragged` 把 `groups: null` 写成 `[]`** → 「分组功能未开」被翻成「已开」。同上提交。
3. **选区自持回环**（Nick 报的 `Maximum update depth exceeded`；复现：拖框内成员卡后点空白）——
   节点重建回灌 store 选区 vs RF 自己改选区，两个写入方在竞态下互相回报。收敛成单一通道 +
   来源判据 + 写入幂等，见 spec 的「追加约束」。提交 `89420d7e`。
   真机复验：那一下点击的选区写入 35 → 1 次，无报错，末态一致。
   **过程留档**（三次尝试，前两次为何不成）：
   - 只给写入加幂等守卫 → 单卡路径好了，⌘A 路径仍震荡（守掉的是一个种子，不是那一类）。
   - 改用 RF 命令式 API（`addSelectedNodes`）→ 更糟：它不写节点数组，下一次 `adoptUserNodes`
     会把命令式选中抹掉，末态 store 与 RF 直接对不上。
   - 最终：节点数组是唯一通道，store 侧只在「非 RF 发起」时落进去。

### 未做的收尾

- **真机验收（spec 九条成功标准）尚未跑**：需要 `pnpm dev` + dev 上游 cookie。
- **子代理独立评审尚未派**。
