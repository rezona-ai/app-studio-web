# 画布虚拟化的体验修复：重挂载不再「重新加载」+ 3D 海报态显示快照

## 背景与问题

性能优化（f89556b）给画布开了 `onlyRenderVisibleElements`（视口外节点卸载）并把 3D 卡改为默认海报态。带来两个体验回归：

1. **拖动画布时资产反复「重新加载」**。根因是重挂载重播入场表现，而非真的重新下载：
   - `NodeCard` 根节点带 `anim-media-in`——离屏卸载的卡滚回视口时整卡重播 200ms 淡入；
   - `ImageNode` 的 `loaded` state 随卸载归零——重挂载先露占位色块再淡入真图；
   - Video / 3D / Audio 的媒体区各自还有一层 `anim-media-in` 同样重播。
2. **3D 卡默认海报态只有类型图标**，用户无法辨认哪张卡是目标模型。

## 目标与约束

- 保留 `onlyRenderVisibleElements`（WebGL 上下文上限约 16 个、3D 卡离屏释放 GPU 的收益仍然成立），只消除「重复加载」的视觉表现。
- 3D 海报态展示模型快照，不渲染 model-viewer；无快照时回退现图标。
- 不引入新动效语汇、不改 z-index / 令牌。

## 方案

### 1. 入场动画只播「首次出现」

模块级缓存记录「本页已出现过的 key」：

- 新增 hook `useFirstAppearance(key)`（`src/client/`）：首次挂载返回 true 并登记，之后同 key 重挂载返回 false。模块级 `Set`，刷新即清（刷新后重播入场动画是合理的）。
- `NodeCard` 根节点、Video/3D/Audio 媒体区的 `anim-media-in` 都改为按 `asset.id`（媒体区用 `${id}:media` 区分）只在首次出现时携带。
- `ImageNode`：模块级 `Set` 记录「已成功加载过的 src」（`src/lib/loaded-media.ts`，纯逻辑可单测）。`loaded` 初值 = 缓存命中；命中则重挂载直接满透明出图、不再渲染占位色块（字节由浏览器 HTTP 缓存供给）。`onLoad` 时登记。

不选的方案：
- 关掉 `onlyRenderVisibleElements`——回归 WebGL 上下文上限与大画布全量 DOM 的问题；
- 自实现带 overscan 的可见性计算——xyflow 无此配置，手写要在 onMove 每帧重算节点集，复杂度与性能都不划算。

### 2. 3D 卡只显示快照，模型只在全屏预览渲染（迭代收紧）

- PGC 契约（apifox 已核实）`CanvasItemData.thumbnail_url` 为 3D 缩略图 sidecar。映射层 `canvasItemToAsset` 把它经 `resolveAssetUrl` 归一为 `preview.poster`（`AssetPreviewData` 新增 `poster?: string`）。
- `ThreeDNode` 卡内**不再渲染 model-viewer**（首版为 hover/点击在卡内激活，迭代中删除）：媒体区恒为快照 `<img>`（无 `poster` 回退类型图标），点击打开全屏预览（MediaLightbox，已支持 model3d/rig3d），与图片卡同范式。WebGL 上下文只在 lightbox 存在期占用 1 个。全屏 model3d 在 GLB 拉取/解析期间叠加 spinner(监听 model-viewer 的 load/error 事件),rig3d 的 RiggedModelViewer 自带 loading 态。
- 顺带：`VideoNode` 的 `<video>` 加 `poster` 属性（同字段，后端对视频也可能带缩略图），重挂载时封面立即可见、不等 metadata。

## 成功标准

- 拖动画布往返，已看过的图片卡不再闪占位色块、不重播淡入；卡片外框不重播入场动画。
- 有 thumbnail_url 的 3D 资产在海报态直接显示快照；无 thumbnail_url 回退图标；激活后行为不变。
- 既有测试全绿（lint / tsc / vitest / build）。
