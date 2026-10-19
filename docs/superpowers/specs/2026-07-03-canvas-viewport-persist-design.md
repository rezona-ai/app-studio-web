# 画布视口持久化 + 一键整理自动 fitView 设计稿

日期：2026-07-03
分支：`worktree-feat+canvas-viewport-persist`

## 背景与目标

当前画布（`AssetCanvas`，基于 `@xyflow/react`）的缩放/平移**完全不持久化**：

- `<ReactFlow>` 只在首次挂载靠 `fitView` prop（`fitViewOptions={{ minZoom: 1, maxZoom: 1 }}`）把内容居中并锁定 100%，之后没有任何视口记录。
- `AssetCanvas` 全程只挂载一次（`Workspace` 未按项目 `key` remount），切项目仅替换 store 里的 `assets`，视口不重置——即当前切项目会**沿用上一个项目的视口**。
- 刷新则回到默认 fitView@100%。

本需求解决两点：

1. **按项目持久化画布视口（缩放 + 坐标）到本地**，使刷新 / 切项目后该项目的画布视口保持不变。
2. **一键整理（`tidyCanvas`）后自动 fitView**，把重排后的所有卡片框入视口。

## 关键决策

- **fitView 缩放范围**：一键整理后的 fitView 采用 React Flow 默认全量缩放范围（`[0.1, 2]`），卡片少时**允许放大到 200%** 以贴合填满画布（与初始进入画布锁 100% 的策略不同，这是用户主动整理时的有意选择）。
- **切项目恢复视口**：瞬时 `setViewport`（不加动画），切换不该有位移动画感；一键整理的 fitView 才带动画。
- **存储位置**：复用现有 `taluna-v4` zustand persist 的 by-project 切片模式，新增 `viewportByProject`，与 `koubouByProject` / `genTasksByProject` 并列。

## 数据模型

在 store 的 **`ServerState`** 新增一个持久化切片，与既有 by-project 切片（`koubouByProject` / `genTasksByProject` / `importedByProject` / `agentTasksByProject`，均在 `src/store/types.ts:127-130`）并列：

```ts
import type { Viewport } from '@xyflow/react';   // Viewport = { x: number; y: number; zoom: number }

viewportByProject: Record<string, Viewport>;     // key 为 String(projectId)
```

- 初始值 `{}`，在 `createInitialServerState`（`types.ts`）里补齐。
- 加入 `partialize`（`src/store/index.ts`）与 `koubouByProject` 等并列持久化。
- **删项目时同步清理**：`deleteProject`（`actions.ts:206-208`）已解构剔除 `genTasksByProject` / `agentTasksByProject` 的对应 key，一并剔除 `viewportByProject[String(id)]`，避免残留。
- **向后兼容**：老 localStorage 无此键 → 反序列化后为 `undefined`，读取时以 `?? {}` 兜底，视为"该项目无保存视口" → 走 fitView 默认路径。无需 persist migration。
- 不影响 `src/app/layout.tsx` 的防白闪内联脚本（它只硬编码引用 `taluna-v4` 与 `theme` 字段，不碰画布切片）。

## 组件与数据流

### 新增 action：`setProjectViewport(pid, vp)`

```ts
setProjectViewport: (pid: number, vp: Viewport) =>
  set((s) => ({ viewportByProject: { ...s.viewportByProject, [String(pid)]: clampViewport(vp) } }));
```

- 一次不可变 `set` 写入；persist 中间件随后落 localStorage。
- 写入前对 `zoom` clamp 到 `[MIN_ZOOM, MAX_ZOOM]`（防脏数据 / 越界）。

### 纯逻辑下沉：`clampViewport`

放 `src/lib`（新增 `viewport-clamp.ts` 或并入既有纯逻辑文件），无副作用、易测：

```ts
export function clampViewport(vp: Viewport, min = 0.1, max = 2): Viewport {
  return { x: vp.x, y: vp.y, zoom: Math.min(max, Math.max(min, vp.zoom)) };
}
```

> 注：现有 `src/lib/viewport.ts` 是"视口工具注册表"（`registerViewportCenter` 等副作用注册），与本纯函数职责不同；为避免混淆，clamp 纯函数单独成文件或并入其它纯逻辑文件，**不放进** `viewport.ts`。

### 记录时机（写）

`AssetCanvas` 的 `<ReactFlow>` 挂 `onMoveEnd`：

```tsx
onMoveEnd={(_, vp) => {
  const pid = useStore.getState().currentProjectId;
  if (pid != null) setProjectViewport(pid, vp);
}}
```

- `onMoveEnd` 仅在平移/缩放**手势结束**时触发一次，频率低，直接落库无需防抖。
- 程序化的 `fitView({ duration })`（一键整理）带动画时也会触发 `onMoveEnd` → 整理后的新视口自然被记录。
- 恢复用的瞬时 `setViewport`（无 duration）通常**不触发** `onMoveEnd`，也无所谓——写回的就是已保存值。

### 恢复时机（读）

`AssetCanvas` 全程挂载一次，故分两处：

1. **首次挂载（刷新）——无闪烁首帧**：在 `Inner` 渲染 `<ReactFlow>` 时读取当前项目保存视口：
   - 有 → `defaultViewport={saved}` 且**不设** `fitView` prop（首帧即用保存视口，无 fitView→setViewport 的跳变闪烁）。
   - 无 → 维持现状：`fitView` + `fitViewOptions={{ minZoom: 1, maxZoom: 1 }}`（初始锁 100% 居中）。

   实现：用 `useState(() => ...)` 或 `useRef` 在首次渲染时快照读取一次保存视口（避免后续 `viewportByProject` 变化触发 ReactFlow 重建 defaultViewport）。

2. **切项目**：用 `restoredPidRef` + 监听 `currentProjectId` 的 effect，当 pid 变化：
   - 有保存视口 → `setViewport(saved)`（瞬时，无动画）。
   - 无 → `fitView()` 兜底（切到从未打开过的项目时给个合理取景）。

   `setViewport` / `fitView` 是 React Flow 命令式调用（非 React setState），**不触发**仓库禁止的 effect-setState lint（见 memory：react-hooks lint 约束）。

### 一键整理 + 自动 fitView

`Inner.onTidy` 内在 `tidyCanvas(sizeById)` 之后追加 fitView：

```tsx
const onTidy = () => {
  setTidying(true);
  // ...量测 sizeById、tidyCanvas(sizeById) 现状不变...
  tidyCanvas(sizeById);
  // 等 store set → sync effect setRfNodes → ReactFlow 拿到新 position 后再 fitView
  requestAnimationFrame(() => {
    void fitView({ duration: 400 });   // 默认全量缩放范围 [0.1,2],可到 200%
  });
  // 现有 340ms .canvas-tidying 过渡计时器保持不变,与 fitView 动画并行
};
```

- fitView 需读到重排后的新坐标：`tidyCanvas` 走 store `set` → sync effect `setRfNodes` → ReactFlow 内部拿到新 position，需等这次 commit 后再 fitView，故用 `requestAnimationFrame` 推迟到下一帧。若单帧仍偏早，退化为双 `requestAnimationFrame`（实现期以运行态验证为准）。
- tidy 不改节点尺寸（只改 position），measured 尺寸仍有效，fitView 取景准确。
- fitView 结束后 `onMoveEnd` 自动把整理后的视口写进 `viewportByProject`，无需额外手写持久化。

## 边界与错误处理

- **空项目（无 assets）**：切项目恢复时若无保存视口走 fitView，无卡时 fitView 无实际取景 → 停在 defaultViewport；一键整理在 `assets.length === 0` 时 `canTidy=false` 按钮禁用，不会触发。均无异常。
- **脏 / 越界 zoom**：`clampViewport` 在写入时 clamp 到 `[0.1, 2]`；恢复读取时按需再 clamp 一次（防手改 localStorage）。
- **项目卡片增删后视口偏移**：保存视口可能指向已删卡片的空白区域——可接受，用户可用一键整理 / fitView 快捷键（⌘1）重新取景。

## 测试策略

- **纯逻辑（TDD）**：`clampViewport` 单测——正常值透传、zoom 越下界 / 越上界的 clamp、x/y 不变。
- **store**：`setProjectViewport` 写入 `viewportByProject[String(pid)]` 并经 clamp；`partialize` 包含 `viewportByProject`（纳入 store 测试）。
- **UI 接线（轻量）**：React Flow 的 `onMoveEnd` / `setViewport` / `fitView` 接线沿用现有画布组件测试惯例做轻量覆盖，不追求对 React Flow 内部视口做端到端断言。
- 全量：`pnpm exec tsc --noEmit` + `pnpm test` + `pnpm build` 通过（CI 契约）。

## 涉及文件

- `src/store/types.ts`：`ServerState` 增 `viewportByProject`，`ServerActions` 增 `setProjectViewport`（或就近声明）。
- `src/store/index.ts`：初始值、`partialize` 增项。
- `src/store/actions.ts`：实现 `setProjectViewport`；`deleteProject` 同步剔除 `viewportByProject` 对应 key。
- `src/lib/viewport-clamp.ts`（新增）+ 同目录测试：`clampViewport`。
- `src/components/canvas/AssetCanvas.tsx`：`onMoveEnd` 记录、首帧 `defaultViewport` / 切项目 effect 恢复、`onTidy` 追加 fitView。

## 不做（YAGNI）

- 不持久化选中态 / 搜索 query / 筛选可见类型之外的其它画布态（`visibleKinds` 已持久，非本需求）。
- 不做视口写入防抖 / 节流（`onMoveEnd` 频率已足够低）。
- 不做跨设备同步（仅 localStorage 本地）。
