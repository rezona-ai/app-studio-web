# 设计文档：画布卡片引用生成 + 连线

- 日期：2026-06-10
- 设计稿：Figma `219-3824`（卡片基线 v0）、`219-3844`（聚焦态：高亮 + 右侧「+」）、`219-3885`（「+」按钮）、`219-3890`（生成弹窗新增引用行）
- 接口：复用既有 `POST /canvas/items/generate/{image,video,audio,model3d}` 与 `PATCH /canvas/items/{item_id}`（`updateCanvasReference`）

## 一、背景与目标

画布资产卡片当前只能通过「双击空白处」打开生成菜单，生成的资产彼此孤立、无关联。本次按设计稿增强为「**从某个资产卡片直接派生生成**」的交互链路：

1. 资产卡片**聚焦时**高亮，并在右侧浮出一个「+」图标。
2. 点击「+」打开生成菜单，**去掉「Add source」段**，只保留 4 个生成项（Image / Video / Audio / 3D）。
3. 点击具体生成项打开生成弹窗，弹窗在原有基础上**新增对当前资产的引用**（顶部只读缩略图 chip）。
4. 通过此方式生成的资产，与被引用资产之间**连一条线**，且连线关系**持久化**（刷新页面 / 切换项目后仍在）。

展示层已就位：`selectCanvasEdges` 已根据 `Asset.parentId` 生成连线、`NodeCard` 已有 `selected` 高亮描边、生成弹窗 / 菜单 / 四类节点组件均存在。缺的是「`parentId` 的写入与持久化」「卡片上的『+』触发」「菜单的 source 变体」「弹窗的引用行」。

## 二、数据与接口约定

### 连线来源
连线由 `selectCanvasEdges(assets)` 依据 `Asset.parentId` 生成（`source: parentId → target: child`）。当前 mapper `canvasItemToAsset` 从不写 `parentId`、本地工厂也不写，故画布无连线。本次让「引用生成」的新资产带上 `parentId = 源资产 id`。

### 持久化方案（reference 往返）
`reference` 是后端原样存取的自由对象（既有 `position`、`source_filename` 都靠它往返）。本次把 `parent_id` 也存入 `reference`：

- 生成后前端 fire-and-forget `PATCH /canvas/items/{item_id}`，body `{ reference: { parent_id, position } }`。
- mapper 读回 `reference.parent_id` → `Asset.parentId`，并据此把 `source` 标为 `'derived'`。

`source_item_id`（请求体字段，仅 image/video/model3d 有）是「**生成条件**」用途（后端以源资产为条件生成）；`reference.parent_id` 是「**连线关系**」用途（前端连线 + 持久化）。两者并存：image/video/3d 同时传 `source_item_id` 并写 `parent_id`；audio 接口无 `source_item_id`，**只**写 `parent_id`。

### ⚠️ 顺带修复的隐患
`persistAssetPosition`（拖拽后回写坐标）现调用 `updateCanvasReference(pid, id, positionReference(undefined, a.position))`，即把整个 `reference` 覆盖为 `{ position }`，会**丢掉 `parent_id`（连线消失）与 `source_filename`（溯源丢失）**。本次改为用 `assetReference(a)` 从 Asset 字段重建完整 reference，根除覆盖问题。

## 三、改动清单

### Part A — 数据层：连线写入 + 持久化

1. **`src/lib/pgc/map.ts`**
   - `CanvasReference` 扩展已知字段类型：`parent_id?: string`（接口本身是开放对象，仅为类型可读）。
   - `canvasItemToAsset`：读 `ref.parent_id`；
     - `parentId: ref.parent_id`
     - `source: ref.parent_id ? 'derived' : 'generated'`
   - 新增构造器（替换 `positionReference` 的职责，并保留兼容）：
     ```ts
     // 从 Asset 已知字段重建完整 reference，避免回写时覆盖 parent_id / source_filename
     export function assetReference(a: Asset): CanvasReference {
       const ref: CanvasReference = { position: a.position };
       if (a.parentId) ref.parent_id = a.parentId;
       if (a.sourceFilename) ref.source_filename = a.sourceFilename;
       return ref;
     }
     ```
   - `positionReference` 不再被使用，删除（其唯一调用点在 actions，见改动 2）。

2. **`src/store/actions.ts`**
   - 顶部 import：`canvasItemToAsset` 已在列表；把 `positionReference` 换成 `assetReference`。
   - 新增私有 helper（闭包内，紧邻 `generateImage`）：
     ```ts
     // 给新生成的资产建立到源资产的连线:本地即时置 parentId+derived,并把 parent_id 持久化进 reference(失败不阻塞 UI)
     const linkParent = (pid: number, assets: Asset[], parentId: string): Asset[] => {
       const linked = assets.map((a) => ({ ...a, parentId, source: 'derived' as const }));
       for (const a of linked) {
         void pgcApi.updateCanvasReference(pid, a.id, { parent_id: parentId, position: a.position }).catch(() => {});
       }
       return linked;
     };
     ```
   - `generateImage(req, sourceItemId?: string)`：
     - body = `sourceItemId ? { ...req, source_item_id: sourceItemId } : req`
     - `let fresh = canvasItemsToAssets(data.items); if (sourceItemId) fresh = linkParent(pid, fresh, sourceItemId);`
   - `generateVideo` / `generateModel3d` 同理在请求体注入 `source_item_id`，并对 `startAsyncGen` 产出的占位资产 link。为此把 `startAsyncGen(kind, task, sourceItemId?)` 加参，内部：
     ```ts
     let asset = canvasItemToAsset(task.item);
     if (sourceItemId) [asset] = linkParent(pid, [asset], sourceItemId);   // pid 由调用方闭包传入
     ```
     （`startAsyncGen` 当前无 `pid`，改为接收 `pid` 或在调用处先 link 后 set；实现时择一，保持 `pid != null` 守卫。）
   - `generateAudio(req, sourceItemId?: string)`：**不**注入 `source_item_id`；`let asset = canvasItemToAsset(item); if (sourceItemId) [asset] = linkParent(pid, [asset], sourceItemId);`
   - `persistAssetPosition`：`updateCanvasReference(pid, itemId, assetReference(a))`（替换 `positionReference(undefined, a.position)`）。
   - `pollGenTasks` 合并时保留本地 parent：把 `{ ...a, ...asset, ... }` 改为显式保留 `parentId: a.parentId ?? asset.parentId` 与 `source: a.parentId ? 'derived' : asset.source`，避免轮询结果覆盖连线。

3. **`src/lib/pgc/types.ts`**
   - 无需新增请求字段（`source_item_id` 已在 image/video/model3d 请求体）。仅在需要时补注释说明 `audio` 不支持 `source_item_id`。

### Part B — 交互：菜单状态提升 + 卡片「+」

4. **`src/store/index.ts`**
   - `UIState` 新增 `addMenu: AddMenuState | null`，类型 `export interface AddMenuState { x: number; y: number; sourceId?: string }`。
   - `Actions` 新增 `openAddMenu(m: AddMenuState): void` / `closeAddMenu(): void`，初值 `addMenu: null`，实现 `set({ addMenu })` / `set({ addMenu: null })`。
   - `GenFormState` 扩展为 `{ kind: 'image' | 'video' | 'audio' | '3d'; sourceId?: string }`。

5. **`src/components/canvas/AssetCanvas.tsx`**
   - 移除局部 `addMenu` state，改用 store 的 `addMenu` / `openAddMenu` / `closeAddMenu`。
   - 双击空白处：`openAddMenu({ x: e.clientX, y: e.clientY })`（不带 sourceId，保留 Add source）。删除现已无用的 `flowPos` 计算与传参。
   - 底部渲染：`{addMenu && <AddAssetMenu x={addMenu.x} y={addMenu.y} sourceId={addMenu.sourceId} onClose={closeAddMenu} />}`。

6. **`src/components/canvas/nodes/NodeCard.tsx`**
   - 新增入参 `assetId: string`。
   - `selected` 时，在卡片右侧中部浮出「+」按钮（绝对定位、`translate-x` 到卡片外右侧、垂直居中）：
     - 用 `figAsset.plus`，带 `nodrag` 类（防 React Flow 拖拽）。
     - `onClick`：`e.stopPropagation();` 取 `e.currentTarget.getBoundingClientRect()`，`openAddMenu({ x: rect.right + 8, y: rect.top, sourceId: assetId })`。
   - 复用现有 `selected` 描边作为「高亮」，不引入新配色。

7. **五个节点组件**（`ImageNode/VideoNode/AudioNode/ThreeDNode/DocNode`）
   - 各自 `<NodeCard ... assetId={a.id}>`。

### Part C — 菜单 source 变体 + 弹窗引用行

8. **`src/components/canvas/AddAssetMenu.tsx`**
   - props：移除未用的 `flowPos`，新增 `sourceId?: string`。
   - 生成项点击：`openGenForm({ kind, sourceId })`。
   - **有 `sourceId` 时隐藏「Add source」整段**（Upload）；无 sourceId（双击空白）时维持现状。

9. **`src/components/canvas/GenerateFormHost.tsx`**
   - 透传 `sourceId={genForm.sourceId}` 给 `GenerateForm`。

10. **`src/components/canvas/GenerateForm.tsx`**
    - props 新增 `sourceId?: string`；从 store `assets` 按 id 查源资产 `source`。
    - 有源资产时，在 textarea 上方渲染**只读引用行**（对齐 219-3890）：圆角缩略图（`source.preview?.dataUrl || .src`，无图回退占位）+ 资产 label。省略左侧选择工具图标与「添加更多引用」+ 按钮。
    - `submit`：把 `sourceId` 透传给生成动作：
      - `generateImage({ prompt, n: 1 }, sourceId)`
      - `generateVideo({ prompt }, sourceId)`
      - `generateModel3d({ prompt }, sourceId)`
      - `generateAudio({ prompt }, sourceId)`

## 四、数据流

```
聚焦卡片(onNodeClick→selectAsset) → NodeCard 显示「+」
点「+」 → openAddMenu({x,y,sourceId})
→ AssetCanvas 渲染 AddAssetMenu(sourceId) (隐藏 Add source)
点某生成项 → openGenForm({kind, sourceId})
→ GenerateFormHost → GenerateForm(kind, sourceId) (顶部显示源资产引用 chip)
输入 prompt → submit → generate*(req, sourceId)
  · image/video/3d: 请求体注入 source_item_id (后端按源条件生成)
  · audio:           不注入 (接口不支持)
→ 新资产本地置 parentId+derived (即时连线)
→ fire-and-forget PATCH reference {parent_id, position} (持久化)
→ selectCanvasEdges 据 parentId 连线

刷新/切项目 → loadCanvas → mapper 读 reference.parent_id → parentId → 连线恢复
拖拽节点 → persistAssetPosition → assetReference(a) 重建完整 reference (保住 parent_id/source_filename)
```

## 五、已知边界（YAGNI，本次不做）

- **多引用**：`Asset.parentId` 为单值，弹窗引用行只展示单个源资产；省略「添加更多引用」+ 按钮与选择工具图标。
- **连线样式**：沿用现有默认灰线（`var(--color-line-2)`，非 animated）。
- **派生资产摆位**：不强制摆到源资产旁，交给现有力导向 / 后端坐标。
- **聚焦高亮配色**：复用现有 `selected` 描边，不照搬设计稿中的蓝色选中色与连接点圆点。
- **audio 真实条件生成**：接口无 `source_item_id`，audio 仅连线、不以源资产为条件。

## 六、测试

- **`map` 单测**
  - `canvasItemToAsset({ reference: { parent_id: 'p1' } })` → `parentId === 'p1'` 且 `source === 'derived'`；无 parent_id → `source === 'generated'`、`parentId === undefined`。
  - `assetReference(asset)` 合并 `position` + `parent_id` + `source_filename`（守护覆盖隐患）。
- **`actions` 单测**
  - `generateImage({prompt}, 'p1')`：`pgcApi.genImage` 收到的 body 含 `source_item_id: 'p1'`；结果资产 `parentId==='p1'`、`source==='derived'`；`updateCanvasReference` 以 `{ parent_id:'p1', position }` 调用。
  - `generateAudio({prompt}, 'p1')`：`genAudio` body **不含** `source_item_id`；资产仍 `parentId==='p1'`、并触发 `updateCanvasReference`。
- **`selectors` 单测**（已存在连线用例则回归即可）：带 `parentId` 的资产产出对应 edge。
- **回归**：`pnpm test` + `pnpm lint`，确保移除 `positionReference` 后无未用导入 / 类型错误。
