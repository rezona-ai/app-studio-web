# 生成资产的多引用连线 · 设计稿

日期：2026-07-04

## 背景与目标

生成弹窗（GenerateForm）已支持多引用：RefPicker 多选参考资产（图片多图合成 / 视频 omni 的 `ref_video_item_ids`）与视频尾帧 `lastFrameId`。这些 id 会下发给后端参与生成，但前端未记录到新资产上——画布上只有加号派生的 `sourceItemId` 有父子连线，其余被引用资产与新卡之间没有任何视觉关系。

目标：新资产落地时记住引用了哪些画布资产，画布为每条引用画一条连线。

## 范围

- **覆盖**：画布生成弹窗链路（同步的图像/音频 + 异步的视频/3D 轮询替换）。
- **不覆盖**：agent 对话中生成、经 `useCanvasAutoImport` 导入的资产（前端拿不到其引用信息）。
- 引用边与父子边**同款样式**（beam `FlowEdge`），不区分「主源 vs 参考」。

## 数据模型

`Asset` 新增可选字段：

```ts
refIds?: string[]   // 本次生成引用的其他画布资产 id
```

内容 = RefPicker 多选 `refIds` ∪ `lastFrameId`，去重且排除 `primarySourceId`（后者仍走 `parentId` 父子边）。

## 写入链路

1. `GenPlacement`（`src/store/actions.ts`）新增 `refItemIds?: string[]`。
2. `GenerateForm.submit` 组装 `refItemIds` 随 placement 传入 `generateImage/Audio/Video/Model3d`。
3. 生成流程中：
   - 占位卡（`pending_`）即带 `refIds`——占位期就有连线，视觉即时反馈；
   - 真实资产原位替换 / 异步轮询替换时**保留** `refIds`（同 `position` / `parentId` 的「前端拥有，不被覆盖」原则；`upsert` 合并处补 `refIds: a.refIds ?? asset.refIds`）。

## 持久化

`src/lib/pgc/map.ts` 的 reference blob 新增 `ref_item_ids: string[]`：

- 回写 reference（`toReference`）时带上；
- 读回（`toAsset`）映射为 `Asset.refIds`。

reference 是后端原样回显的自由 blob，无契约风险；刷新 / 重连后连线仍在。

## 边派生

`selectCanvasEdges`（`src/store/selectors.ts`）在现有父子边基础上追加引用边。对每个 asset 的 `refIds`，过滤：

- 引用 id 在当前画布资产集合内；
- ≠ 自身；
- ≠ 该资产的 `parentId`（避免与父子边重边）。

生成 `{ id: 'e-ref-{src}-{target}', source: src, target: id }`，type/样式与父子边完全一致。

## 不影响的部分

- **一键整理**（`card-layout.ts` flextree）仍只按 `parentId` 建树；引用边纯视觉，不参与布局。
- **删除**：被引用资产删除时，引用边随 selector 过滤自动消失；不级联删除引用它的资产（`removeAsset` 的级联语义仅限 `parentId`）。

## 测试

- `selectors.test.ts`：多引用边派生 / 引用缺失时过滤 / 与父子边去重 / 自指过滤。
- `map.test.ts`：`ref_item_ids` 读写往返。
- actions 测试：占位卡带 `refIds`；同步替换与异步轮询替换后 `refIds` 保留。
- `GenerateForm.test.tsx`：提交时组装 `refItemIds`（含尾帧合并、排除 primarySourceId）。
