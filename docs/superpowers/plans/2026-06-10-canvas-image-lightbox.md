# 画布资产卡片全屏预览优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图片卡片支持点击全屏预览,并把图片/video/3d 三类预览统一限定在画布区域内(不遮挡 Chat / Preview 面板)。

**Architecture:** 把 `MediaLightbox` 从 `Workspace` 顶层下沉到画布容器 `AssetCanvas > Inner`(已是 `relative h-full` 定位上下文),遮罩由 `fixed inset-0` 改为 `absolute inset-0`,自然裁在画布区域内。同时扩展 `MediaLightbox` 支持 `image` 类型,`ImageNode` 新增整图点击放大入口。store 不动,复用 `lightbox` 状态与 `openLightbox` action。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Zustand / @xyflow/react(React Flow)/ Tailwind。构建 `next build`,测试 `vitest run`。

---

## 说明:验证策略

这几个组件(`ImageNode`、`MediaLightbox`、`Workspace`、`AssetCanvas`)目前均无单元测试,且 React Flow 节点交互 / 全屏浮层属于视觉行为,单元测试价值低。本计划遵循项目现有约定:不新建测试框架,验证依赖 `npm run build`(TS 编译 + lint)与手动 dev 验证。每个 Task 末尾提交。

---

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/components/canvas/MediaLightbox.tsx` | 全屏预览浮层,按 kind 渲染 image/video/3d | 支持 image + 定位改 absolute + 尺寸改百分比 |
| `src/components/canvas/nodes/ImageNode.tsx` | 图片资产卡片 | ready 态整图点击 → openLightbox |
| `src/components/workspace/Workspace.tsx` | 三栏工作区布局 | 移除 MediaLightbox 渲染与 import |
| `src/components/canvas/AssetCanvas.tsx` | 画布容器 | Inner 内挂载 MediaLightbox + import |

---

## Task 1:MediaLightbox 支持图片 + 定位限定画布

**Files:**
- Modify: `src/components/canvas/MediaLightbox.tsx`

当前文件第 28 行 `if (asset.kind !== 'video' && asset.kind !== '3d') return null;` 排除了图片;遮罩用 `fixed inset-0 z-[60]`;内容用 `vh/vw` 单位。本 Task 三处一起改。

- [ ] **Step 1:放开图片类型限制**

把第 28 行的类型判断从「排除非 video/3d」改为「排除画布不预览的类型」。当前支持 image/video/3d,其余(如 doc/audio)不在此浮层预览:

```tsx
if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== '3d') return null;
```

- [ ] **Step 2:遮罩定位改为限定画布**

把 return 的最外层 `<div>` 的 className 从:

```tsx
className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-8"
```

改为(`absolute` 跟随画布容器,`z-30` 盖过画布内 z-10 的搜索框/缩放条):

```tsx
className="absolute inset-0 z-30 grid place-items-center bg-black/75 p-8"
```

- [ ] **Step 3:新增 image 分支并把尺寸单位改为百分比**

把内容本体的三元渲染(当前 `asset.kind === 'video' ? (...) : mvReady ? (...) : (...)`)整体替换为先判断 image,再 video,再 3d。同时 video 的 `max-h-[85vh] max-w-[90vw]` 改为 `max-h-[85%] max-w-[90%]`、3d 的 `width:'85vw',height:'85vh'` 改为 `width:'100%',height:'100%'`(让其填充居中容器,因容器已被画布裁切):

```tsx
{asset.kind === 'image' ? (
  <img
    src={src}
    alt={asset.label}
    onClick={(e) => e.stopPropagation()}
    className="max-h-[90%] max-w-[90%] rounded-lg object-contain shadow-2xl"
  />
) : asset.kind === 'video' ? (
  <video
    src={src}
    controls
    autoPlay
    playsInline
    onClick={(e) => e.stopPropagation()}
    className="max-h-[85%] max-w-[90%] rounded-lg shadow-2xl"
  />
) : mvReady ? (
  <model-viewer
    src={src}
    alt={asset.label}
    camera-controls
    auto-rotate
    interaction-prompt="none"
    onClick={(e) => e.stopPropagation()}
    style={{ width: '100%', height: '100%', background: 'transparent' }}
  />
) : (
  <span
    className="size-9 animate-spin rounded-full border-2 border-white/30 border-t-white"
    role="status"
    aria-label="Loading 3D"
  />
)}
```

- [ ] **Step 4:更新组件顶部注释**

把第 6 行注释从「支持 video(就地播放)与 3d」更新为包含图片:

```tsx
// 媒体全屏放大浮层:支持 image(等比放大)、video(就地播放)与 3d(可旋转查看)。
// 限定在画布容器内(absolute inset-0),不遮挡 Chat / Preview 面板。
// 由 store.lightbox 驱动,按 assetId 取资产(删除/状态变化自动失效)。
```

- [ ] **Step 5:提交**

```bash
git add src/components/canvas/MediaLightbox.tsx
git commit -m "feat: MediaLightbox 支持图片预览并限定画布区域"
```

---

## Task 2:ImageNode 整图点击放大

**Files:**
- Modify: `src/components/canvas/nodes/ImageNode.tsx`

当前 `ImageNode` 无放大入口。对齐 `VideoNode > ReadyBody` 的防冲突模式(`nodrag` + `onMouseDown` stopPropagation),给 ready 态图片加点击放大。

- [ ] **Step 1:引入 useStore 并取 openLightbox**

在 import 区(当前第 1-4 行)加入 store 引用:

```tsx
'use client';
import { type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
import { useStore } from '@/store';
import NodeCard from './NodeCard';
```

- [ ] **Step 2:组件内取 openLightbox 并判断 ready**

在 `export default function ImageNode` 函数体内,`const a = data.asset;` 之后加入:

```tsx
const a = data.asset;
const src = a.preview?.dataUrl || a.preview?.src;
const generating = a.status === 'generating';
const openLightbox = useStore((s) => s.openLightbox);
const canExpand = a.status === 'ready' && !!src;
```

- [ ] **Step 3:给图片容器加点击放大**

把当前媒体容器(第 12 行 `<div className="relative overflow-hidden rounded-[11px]">`)改为:ready 态时加 `nodrag` / `cursor-zoom-in` / 点击与 `onMouseDown` 处理。整段媒体体替换为:

```tsx
<div
  className={`relative overflow-hidden rounded-[11px] ${canExpand ? 'nodrag cursor-zoom-in' : ''}`}
  onMouseDown={canExpand ? (e) => e.stopPropagation() : undefined}
  onClick={
    canExpand
      ? (e) => {
          e.stopPropagation();
          openLightbox(a.id);
        }
      : undefined
  }
>
  {src ? (
    <img src={src} alt={a.label} draggable={false} className="block h-[150px] w-full object-cover" />
  ) : (
    <div
      className="grid h-[150px] place-items-center px-2 text-center text-[13px] font-semibold text-white"
      style={{ background: a.preview?.color ?? 'var(--color-image)' }}
    >
      {a.preview?.title ?? ''}
    </div>
  )}
  {/* 生成中(含重新生成)遮罩 + 转圈 */}
  {generating && (
    <div className="absolute inset-0 grid place-items-center bg-black/35 backdrop-blur-[1px]">
      <span className="size-7 animate-spin rounded-full border-2 border-white/40 border-t-white" role="status" aria-label="Generating" />
    </div>
  )}
</div>
```

- [ ] **Step 4:提交**

```bash
git add src/components/canvas/nodes/ImageNode.tsx
git commit -m "feat: ImageNode 支持整图点击全屏预览"
```

---

## Task 3:迁移 MediaLightbox 渲染位置到画布容器

**Files:**
- Modify: `src/components/workspace/Workspace.tsx`
- Modify: `src/components/canvas/AssetCanvas.tsx`

把 `MediaLightbox` 从 `Workspace` 顶层移到 `AssetCanvas > Inner` 末尾,使其 `absolute inset-0` 落在画布定位上下文内。

- [ ] **Step 1:Workspace 移除 MediaLightbox import**

删除 `src/components/workspace/Workspace.tsx` 第 11 行:

```tsx
import MediaLightbox from '@/components/canvas/MediaLightbox';
```

- [ ] **Step 2:Workspace 移除 MediaLightbox 渲染**

删除 `src/components/workspace/Workspace.tsx` 第 52 行 `<MediaLightbox />`(在 `<ContextMenu />` 与 `<GenerateFormHost />` 之间)。

- [ ] **Step 3:AssetCanvas 新增 MediaLightbox import**

在 `src/components/canvas/AssetCanvas.tsx` 的 import 区(`import KindLegend from './KindLegend';` 之后)加入:

```tsx
import MediaLightbox from './MediaLightbox';
```

- [ ] **Step 4:AssetCanvas 的 Inner 内挂载 MediaLightbox**

在 `Inner` 函数 return 的最外层 `<div>` 内、`addMenu` 渲染块之后(当前第 249-251 行那段 `{addMenu && (...)}` 之后、`</div>` 之前)加入:

```tsx
      {addMenu && (
        <AddAssetMenu x={addMenu.x} y={addMenu.y} sourceId={addMenu.sourceId} onClose={closeAddMenu} />
      )}
      <MediaLightbox />
    </div>
```

- [ ] **Step 5:提交**

```bash
git add src/components/workspace/Workspace.tsx src/components/canvas/AssetCanvas.tsx
git commit -m "refactor: MediaLightbox 渲染下沉到画布容器以限定预览范围"
```

---

## Task 4:构建验证与手动验证

**Files:** 无改动(验证 Task)

- [ ] **Step 1:跑构建**

Run: `npm run build`
Expected: 编译通过,无 TS / lint 报错。

- [ ] **Step 2:跑现有测试(确保无回归)**

Run: `npm run test`
Expected: 全部通过(本次未改动被测模块,应保持绿)。

- [ ] **Step 3:手动 dev 验证清单**

Run: `npm run dev`,在画布上验证:
- 图片卡片(ready 态)点击 → 弹出全屏预览,图片等比居中显示。
- 图片生成中点击 → 不弹预览(保持转圈遮罩)。
- video 卡片右上角放大按钮 → 弹出预览并可播放。
- 3d 卡片右上角放大按钮 → 弹出预览并可旋转。
- 三类预览的遮罩都**只覆盖中间画布区域**,左侧 Chat、右侧 Preview 面板不被遮住。
- 三种关闭方式均生效:点遮罩空白处、按 Esc、点右上角关闭按钮。
- 拖动图片卡片不会误触发预览(nodrag + onMouseDown 生效)。

- [ ] **Step 4:确认无需提交**(纯验证,无文件改动)

---

## Self-Review

**Spec 覆盖检查:**
- 图片支持全屏预览 → Task 1 Step 3(image 分支)+ Task 2(触发入口)✓
- 预览限定画布 → Task 1 Step 2(absolute inset-0)+ Task 3(迁移渲染位置)✓
- 触发方式:图片整图点击 / video·3d 保持按钮 → Task 2(整图点击)、video/3d 未动 ✓
- 范围:image/video/3d 全部限定 → Task 1 Step 2 改的是公共遮罩,三类共享 ✓
- 仅放大展示(无缩放/平移)→ Task 1 仅 object-contain 等比,未加 zoom/pan ✓

**占位符扫描:** 无 TBD/TODO,每个代码步骤含完整代码。

**类型一致性:** 复用既有 `openLightbox(assetId: string | null)`、`store.lightbox`,签名与现状一致;`canExpand` 在 Task 2 内定义并使用,无跨任务命名漂移。

---

## Execution Handoff

计划已保存。两种执行方式可选。
