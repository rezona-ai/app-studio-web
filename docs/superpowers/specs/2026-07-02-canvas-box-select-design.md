# 画布框选 + 整体删除/移动 设计稿

> 日期:2026-07-02 · 分支:`feat/canvas-box-select`

## 需求

画布新增**左键拖动框选多个资产**的能力,并支持对选区的**整体删除**与**整体移动**。

## 背景与现状

- 画布用 `@xyflow/react`(见 `src/components/canvas/AssetCanvas.tsx`),当前**左键拖动 = 平移画布**(ReactFlow 默认 `panOnDrag`)。
- 选中是**单选**模型:store 里 `selectedAssetId: string | null`,`selectCanvasNodes` 据此给节点打 `selected` 标记,RF 经 node prop 把 `selected` 传给各节点组件 → `NodeCard`。
- 删除:`ContextMenu → DeleteAssetModal → deleteCanvasItem(id)`,一次一个,悲观删除 + `deletingIds` 删除中态。
- 移动:`onNodeDragStop → setAssetPosition + persistAssetPosition`(单个;位置归前端所有,回写 reference 为 fire-and-forget)。
- ReactFlow 目前**未设置任何 selection 相关 prop**,全默认。
- `selectedAssetId / selectAsset` 全仓仅 3 处使用(`AssetCanvas.tsx` / `store/index.ts` / `selectors.ts`),改造面小。

## 交互决策(已与 Nick 确认)

1. **纯左键拖 = 框选**;平移只用**中键 / 触控板**(不做空格拖)。
2. 整体删除触发:**右键菜单 + Delete/Backspace 键**,均复用现有二次确认弹窗(不直删)。

## 方案选型

选中态的所有权有两条路:让 ReactFlow 内部拥有选中态(A),或让 store 作为单一真相源、RF 只作输入(B)。本项目铁律是「store 是唯一真相源,UI 只订阅/调 action」,故选 **B**:store 持有 `selectedIds`,RF 的框选/点击/加选经 `onSelectionChange` 单向镜像进 store,sync effect 再据 `selectedIds` 回画 `selected`。因 store 与 RF 选中始终一致,重建节点不会 clobber 选中;`setSelection` 做幂等去重防回环。

## 详细设计

### 1. 交互模型(ReactFlow 配置)

在 `<ReactFlow>` 上新增/调整:

- `selectionOnDrag`:空白 pane 左键拖 = 框选矩形。
- `panOnDrag={[1]}`:中键(button 1)拖平移。**不含右键(2)**,避免与节点右键菜单语义打架。
- `panOnScroll`:触控板双指滚动平移;捏合(pinch, ctrl+wheel)仍走 `zoomOnPinch` 缩放。
- `deleteKeyCode={null}`:禁用 RF 原生删除键(否则会绕过二次确认弹窗与 PGC 删除),改由本项目自接键盘。
- `selectionMode`:保留默认(`SelectionMode.Full`,完全框住才选中)。
- `multiSelectionKeyCode`:保留默认(Shift/⌘ 加选),让 Shift+点击追加选择开箱可用。
- 节点左键拖仍移动节点(`selectionOnDrag` 只作用于 pane,不影响节点自身拖拽);多选状态下拖动其中一张 = 整体移动(RF 原生)。

> ⚠️ **显式权衡点(spec review 请确认)**:开 `panOnScroll` 后,**鼠标滚轮从「缩放」变为「平移」**(滚轮事件无法可靠区分鼠标与触控板)。缩放改走:捏合手势 / 底部缩放条 / `⌘ +/−/0` 快捷键。这是满足「触控板平移」诉求的必然代价。若更看重滚轮缩放,则须放弃触控板滚动平移(退回:仅中键平移 + 保留 `zoomOnScroll`)——二选一,已按「触控板平移」诉求默认选前者。

### 2. 选中态模型(store 单一真相源)

- `UIState`:`selectedAssetId: string | null` → **`selectedIds: string[]`**(单选=长度 1,空选=`[]`;瞬态,不持久化,沿用现状)。
- Actions:
  - `selectAsset(id: string | null)`:单选,置 `[id]` 或 `[]`(点击/右键单卡用)。
  - `setSelection(ids: string[])`:批量置(框选/`onSelectionChange` 用)。**幂等**:与当前集合相等则 no-op,阻断「store→node.selected→RF→onSelectionChange→store」回环并省重渲染。
  - `clearSelection()`:置 `[]`(pane 点击 / 删除后 / 切项目)。
- `switchProjectSession` 切项目时一并清 `selectedIds: []`(与现有清 `deletingIds/deleteTarget` 同批,维持「选区恒属于当前项目」不变式)。
- `selectors.selectCanvasNodes(assets, selectedIds: string[])`:签名由单 id 改数组,内部用 `Set` 做 `selected: set.has(asset.id)`。
- `AssetCanvas`:
  - sync effect 依赖 `selectedAssetId` → `selectedIds`,传给 `selectCanvasNodes`。
  - `<ReactFlow onSelectionChange={({ nodes }) => setSelection(nodes.map(n => n.id))}>` 作为 RF 选中 → store 的**唯一入口**。
  - 移除手写 `onNodeClick={(_, n) => selectAsset(n.id)}`(RF 点击选中已由 `onSelectionChange` 回流)。
  - `onPaneClick` 保留 `openContextMenu(null)`(关右键菜单);选区清空交给 RF 的 pane 点击→`onSelectionChange([])`。

### 3. 整体移动

- 新增 store bulk action `setAssetPositions(list: { id: string; x: number; y: number }[])`:一次 `set` 更新多张卡的 `position`(避免逐个 set 造成 N 次重渲),沿用「不可变更新」。
- `AssetCanvas`:`onNodeDragStop(e, node, nodes)` 与 `onSelectionDragStop(e, nodes)` 共用一个 `persistDraggedNodes(nodes)`:
  1. `setAssetPositions(nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y })))`;
  2. 对每个非 `pending_` 的 id `void persistAssetPosition(id)`(fire-and-forget,失败不阻塞;沿用 `tidyCanvas` 的落库模式)。
- `isDraggingRef` 维持不变(拖动期间 sync effect 跳过,防中途 clobber 坐标)。
- 单卡拖动是本 handler 的 `nodes.length === 1` 特例,逻辑统一(替换现有单卡分支)。

### 4. 整体删除

- `ContextMenuState`:`{ id, x, y }` → **`{ ids: string[]; x: number; y: number }`**。
- `AssetCanvas.onNodeContextMenu(e, n)`:
  - 若 `n.id ∈ selectedIds && selectedIds.length > 1` → **不塌陷选区**,`openContextMenu({ ids: selectedIds, x, y })`。
  - 否则 → `selectAsset(n.id)`(单选该卡),`openContextMenu({ ids: [n.id], x, y })`。
- `ContextMenu.tsx`:
  - `ids.length === 1` → 现有全菜单(Use as reference / Rename / Delete),作用于该资产(与现状一致)。
  - `ids.length > 1` → 仅一项「删除 N 项」(`canvas.context.deleteN`,count=ids.length)。Use-as-ref/Rename/生成 对多选无意义,不展示。
  - Delete 项 `onClick` 统一 `openDeleteModal(ids)`。
- `deleteTarget`:`{ id } | null` → **`{ ids: string[] } | null`**。
- `openDeleteModal(ids: string[])`:改签名收数组(ContextMenu 与键盘均传数组)。
- `DeleteAssetModal.tsx`:
  - `ids.length === 1`:沿用现有 `deleteConfirmTitle` + `deleteConfirmBody`(`{{name}}` 取该资产 label)。
  - `ids.length > 1`:`deleteConfirmTitleN`(count) + `deleteConfirmBodyN`(count)。
  - 确认 → `deleteSelected(ids)`;仍不绑全局 Enter,autoFocus 落 Cancel(安全默认,与现状一致)。
- 新增 store action `deleteSelected(ids: string[])`:
  1. 拆分 `pending_` 占位 id 与真实 id;占位 id 直接本地移除(含其 `genTasks`),复用 `deleteCanvasItem` 对 pending 的处理语义。
  2. 真实 id 一次性入 `deletingIds`(卡片压暗 + spinner)。
  3. `await Promise.all(realIds.map(id => guard(...pgcApi.deleteCanvasItem...)))`:每个 `await` 后校验 `currentProjectId` 未变才移除该卡;失败保留卡 + Toast(guard 负责)。
  4. 末尾无论成败清掉这些 id 的 `deletingIds`,并 `clearSelection()`。
- 键盘删除:`AssetCanvas` 加 `keydown` 监听:`Delete` 或 `Backspace`,且 `selectedIds` 非空,且焦点不在 `INPUT/TEXTAREA/contentEditable`(沿用 `useZoomShortcuts` 的焦点判定)→ `e.preventDefault()` + `openDeleteModal(selectedIds)`(**只开确认弹窗,不直删**)。判定逻辑抽成纯函数便于单测。

### 5. 节点卡收敛(单选专属操作)

- `NodeCard`:新增 `soleSelected = useStore(s => s.selectedIds.length === 1 && s.selectedIds[0] === assetId)`(返回布尔,仅本卡 soleSelected 翻转时重渲)。
  - **右侧「+」(从此资产生成)** 与 **左侧连接点蓝点**:由 `selected` 改为按 `soleSelected` 显示(多选时不在每张卡冒出「+」/连接点)。
  - 蓝色描边 + 流光 `.node-beam`:仍按 `selected`(所有框选卡都高亮)。

### 6. i18n(六语,en 为真相源)

新增 key(en 值示意,zh/fr/ru/ja/vi 补齐):

- `canvas.context.deleteN`:`'Delete {{count}} items'`
- `canvas.deleteConfirmTitleN`:`'Delete {{count}} assets?'`
- `canvas.deleteConfirmBodyN`:`'{{count}} assets will be permanently removed from the canvas.'`

采用 `{{count}}` 插值单一形式(中/日/越无复数;英/法/俄用单一形式亦通顺),不引入 i18next 复数分形,保持与现有 `deleteConfirmBody` 风格一致。

### 7. 视觉(复用令牌,禁硬编码)

- 框选矩形:RF 默认 `.react-flow__selection` 偏灰。在 `globals.css` 覆盖为设计语汇:边框 `--color-accent` + 底色 `--color-accent-soft`(半透明),对齐画布选中态的蓝色系。纯静态样式,无需 `prefers-reduced-motion` 处理。
- 多选高亮 / 删除中态:复用现有 `NodeCard` 的 selected 描边 + beam + deleting 覆盖层,零新增。

## 组件/文件改动清单

| 文件 | 改动 |
|---|---|
| `src/store/index.ts` | `selectedAssetId`→`selectedIds`;新增 `setSelection/clearSelection/setAssetPositions/deleteSelected`;`openDeleteModal(ids)`;`contextMenu/deleteTarget` 改数组;`switchProjectSession` 清 `selectedIds` |
| `src/store/actions.ts` | `deleteSelected` 实现(复用 `deleteCanvasItem`/`guard` 流);`setAssetPositions` |
| `src/store/selectors.ts` | `selectCanvasNodes(assets, selectedIds[])` |
| `src/components/canvas/AssetCanvas.tsx` | RF selection props;`onSelectionChange`;拖停整体落位;键盘删除;右键多选;移除 `onNodeClick` |
| `src/components/canvas/ContextMenu.tsx` | `ids` 数组;单/多模式 |
| `src/components/canvas/DeleteAssetModal.tsx` | `ids` 数组;单/多计数文案;确认调 `deleteSelected` |
| `src/components/canvas/nodes/NodeCard.tsx` | `soleSelected` 收敛「+」/连接点 |
| `src/app/globals.css` | `.react-flow__selection` 令牌化样式 |
| `src/i18n/locales/*.ts`(六个) | 三条新 key |

## 测试(TDD,同目录 `*.test.ts(x)`)

- `selectors.test`:`selectCanvasNodes` 多 id 选中标记。
- store 层(`index`/`actions` 测试):`setSelection` 幂等、`setAssetPositions` 批量落位、`deleteSelected`(混 pending_ + 真实 id)、`openDeleteModal(数组)`。
- `ContextMenu.test`:更新 seed 为 `{ ids }`;补多选模式仅「删除 N 项」且点击置 `deleteTarget = { ids }`。
- `DeleteAssetModal.test`:更新为 `{ ids }`;补多选计数文案 + 确认调 `deleteSelected`。
- 键盘删除判定纯函数单测(焦点在输入框时不触发;选区空不触发)。

## 反模式核对(勿引入)

- 不臆测后端字段:删除/落位沿用既有 `pgcApi.deleteCanvasItem` / `updateCanvasReference`,不新增别名。
- 不覆盖前端拥有的坐标:整体移动仍前端落位、fire-and-forget 回写。
- 不持久化瞬态:`selectedIds` 不进 `partialize`。
- 不吞未知错误:`deleteSelected` 复用 `guard`,非 `PgcError` 照抛。
- 复用 UI 令牌/动效:框选矩形、多选高亮、弹窗均复用既有令牌与 `DeleteAssetModal` 模态语汇,不造新组件/新 keyframes。

## 开放点(留待 review)

1. `panOnScroll` 导致的**滚轮缩放→平移**取舍(见 §1 权衡点)。
2. Delete/Backspace 只「开确认弹窗」而非直删——安全优先,与现有 `DeleteAssetModal` 不绑 Enter 一致。
