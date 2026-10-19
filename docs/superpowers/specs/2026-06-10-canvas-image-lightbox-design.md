# 画布资产卡片全屏预览优化 — 设计文档

> 日期:2026-06-10
> 范围:画布(AssetCanvas)资产卡片的全屏预览

## 背景与目标

画布上的资产卡片目前预览能力不一致:

- `VideoNode` / `ThreeDNode`:右上角有放大按钮,点击通过 `store.openLightbox` 打开 `MediaLightbox` 全屏预览。
- `ImageNode`:**没有任何放大入口**,图片只能看缩略图。

同时,现有 `MediaLightbox` 用 `fixed inset-0`(覆盖整个视口),放大时会遮住左侧 Chat 面板和右侧 Preview 面板,与"画布预览"的语义不符。

本次优化要达成两点:

1. **图片支持全屏预览**:点击图片卡片即可放大查看。
2. **预览限定在画布区域**:图片、video、3d 三类预览统一只覆盖中间画布区域,不遮挡 Chat / Preview 面板。

## 已确认的决策

- **触发方式**:图片采用「点击整图即放大」(不加放大按钮);video/3d 保持现有右上角按钮触发。
- **范围约束**:图片、video、3d 全部统一限定在画布区域。
- **预览能力**:仅放大展示,不做缩放(zoom)/平移(pan)。

## 架构方案

核心思路:把 `MediaLightbox` 从 `Workspace` 顶层**下沉到画布容器内**,并让它**支持图片类型**。组件职责不变(由 `store.lightbox` 驱动、按 `assetId` 取资产、资产删除/状态变化时自动失效关闭),只改两点:**渲染位置**与**支持的资产类型**。

```
Workspace                          AssetCanvas > Inner (relative h-full)
├─ ChatPanel                       ├─ ReactFlow (nodes...)
├─ AssetCanvas ──────────┐         ├─ CanvasSearchBar (z-10)
├─ PreviewPanel(overlay) │  迁入   ├─ ZoomBar (z-10)
├─ MediaLightbox ────────┘         └─ MediaLightbox (absolute inset-0, z-30) ← 新位置
```

`Inner` 已经是 `relative h-full` 的定位上下文,在三栏布局中正好占据中间画布区域(左侧 Chat 518px、右侧 Preview spacer 都不在它范围内)。因此遮罩用 `absolute inset-0` 就天然被裁在画布里,不会遮住 Chat 和 Preview —— 这正是"限定在画布中"。`z-30` 盖过画布内的搜索框 / 缩放条(z-10)。

### 备选方案(未采纳)

- **方案 B:保留在 Workspace 顶层,运行时测量画布 DOM 矩形定位**。需监听 resize / 布局变化重新测量,边界易抖动,明显更脆弱。
- **方案 C:用 Portal 把遮罩渲染进画布容器节点**。相比方案 A 无实际收益,多一层 Portal 复杂度。

## 组件改动

改动集中在 4 个文件,store 完全不动(复用 `lightbox` 状态与 `openLightbox` action)。

### 1. `src/components/canvas/nodes/ImageNode.tsx` — 新增点击放大入口

- 仅在 `status === 'ready'` 且有 `src` 时,图片容器可点击 → `openLightbox(a.id)`。
- 生成中(遮罩转圈)、无图占位态不响应点击。
- 防冲突(画布是 React Flow,节点点击会触发选中 / 拖拽):容器加 `nodrag` class + `onMouseDown` 阻止冒泡,对齐 `VideoNode > ReadyBody` 既有模式。
- 加 `cursor-zoom-in` 提示可放大。
- 依赖:`useStore` 的 `openLightbox`(已存在)。接口不变,纯内部增强。

### 2. `src/components/canvas/MediaLightbox.tsx` — 支持图片 + 改定位单位

- 移除"仅 video/3d"的类型限制(现第 28 行),新增 `image` 分支:`<img>` 用 `object-contain` 等比放大居中,`stopPropagation` 防误关。
- 遮罩定位:`fixed inset-0 z-[60]` → `absolute inset-0 z-30`。
- 内容尺寸单位:从视口单位 `vh/vw` 改为相对画布容器的百分比(`max-h-[85%] max-w-[90%]` 等),否则大图仍可能溢出画布。video / 3d 分支同步改为百分比。
- 关闭方式三种全部保留:点遮罩、Esc 键、右上角关闭按钮。
- 输入输出契约不变(仍由 `store.lightbox` 驱动)。

### 3. `src/components/workspace/Workspace.tsx` — 移除 lightbox 渲染

- 移除 `<MediaLightbox />` 及其 import。

### 4. `src/components/canvas/AssetCanvas.tsx` — 挂载 lightbox

- 在 `Inner` 末尾(`addMenu` 渲染之后)挂 `<MediaLightbox />`,新增 import。

## 数据流

无新增状态。三类卡片的放大入口都调用既有 `openLightbox(assetId)` 写入 `store.lightbox`;`MediaLightbox` 订阅 `lightbox` 与 `assets`,按 `assetId` 解析当前资产并按 `kind` 渲染对应分支。资产被删除或状态非 `ready` 时,组件内既有的失效判断会自动返回 `null`(关闭预览)。

## 错误与边界处理

- 资产不存在 / 非 `ready` / 无 `src`:`MediaLightbox` 返回 `null`,不渲染。
- 图片生成中 / 失败:`ImageNode` 不挂点击放大,沿用现有占位与遮罩。
- 窗口缩放、面板宽度变化:遮罩用 `absolute inset-0` 跟随画布容器自适应,无需额外监听。

## 测试与验证

- 这几个组件目前无专门测试(`MediaLightbox` 无 test 文件),本次不新建测试框架,与现有约定一致。
- 验证方式:
  - `npm run build`(TS 编译 + lint)通过。
  - 手动 dev 验证:图片点击放大、video/3d 放大、三者都限定在画布内(不遮 Chat / Preview)、三种关闭方式(点遮罩 / Esc / 关闭按钮)均生效。

## YAGNI 边界

- 不做缩放 / 平移(仅放大展示)。
- 图片不加放大按钮(整图点击),与 video/3d 的按钮触发并存 —— 各自符合媒体的自然交互。
- 不抽新组件、不改 store。
