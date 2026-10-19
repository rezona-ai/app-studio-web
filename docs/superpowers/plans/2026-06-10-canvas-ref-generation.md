# 画布卡片引用生成 + 连线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让资产卡片聚焦时浮出「+」，从卡片直接派生生成新资产，新资产与源资产连线并持久化。

**Architecture:** 连线复用既有 `Asset.parentId`（`selectCanvasEdges` 已据此连边）。生成时本地即时置 `parentId`+`derived` 出连线，并 fire-and-forget 把 `parent_id` 写进 canvas item 的 `reference` 持久化；mapper 读回 `parent_id`。生成菜单/弹窗的打开态提升到 store，使双击空白与卡片「+」共用一套渲染。

**Tech Stack:** Next.js 16 + React 19 + `@xyflow/react`（React Flow）+ Zustand + Vitest + Tailwind v4。

> 设计依据：`docs/superpowers/specs/2026-06-10-canvas-ref-generation-design.md`
> 约定：测试中文描述；commit message 中文一句话；分支已在 `feat/canvas-ref-generation`。每个 `git add` 只加本步涉及的文件（避免带入已暂存的 `.npmrc` 删除）。

---

## 任务依赖顺序

Task 1（map 数据层）→ Task 2（actions，依赖 `assetReference`）→ Task 3（store 类型/state）→ Task 4（AssetCanvas）→ Task 5（NodeCard+节点）→ Task 6（AddAssetMenu）→ Task 7（GenerateForm）→ Task 8（回归）。Task 4/5/6 依赖 Task 3 的 `openAddMenu`/`GenFormState.sourceId`。

---

### Task 1: map.ts — 读回 parent_id + assetReference 构造器

**Files:**
- Modify: `src/lib/pgc/map.ts`
- Test: `src/lib/pgc/map.test.ts`

- [ ] **Step 1: 改测试 import 并加 Asset 类型导入**

把 `src/lib/pgc/map.test.ts` 顶部第 2-3 行：

```ts
import { canvasItemToAsset, positionReference, versionToVersion } from './map';
import type { CanvasItemData, VersionData } from './types';
```

改为：

```ts
import { canvasItemToAsset, assetReference, versionToVersion } from './map';
import type { CanvasItemData, VersionData } from './types';
import type { Asset } from '@/store/types';
```

- [ ] **Step 2: 替换 positionReference 测试块为引用连线 + assetReference 测试**

把 `map.test.ts` 中这一整段 `describe('positionReference', ...)`（约 45-50 行）：

```ts
describe('positionReference', () => {
  test('合并既有 reference,覆盖 position', () => {
    expect(positionReference({ note: 'x' }, { x: 1, y: 2 })).toEqual({ note: 'x', position: { x: 1, y: 2 } });
    expect(positionReference(null, { x: 1, y: 2 })).toEqual({ position: { x: 1, y: 2 } });
  });
});
```

替换为：

```ts
describe('canvasItemToAsset 引用连线', () => {
  const base: CanvasItemData = { id: 1, item_id: 'i1', type: 'image', status: 'ready' };
  test('reference.parent_id → parentId 且 source=derived', () => {
    const a = canvasItemToAsset({ ...base, reference: { parent_id: 'p1' } });
    expect(a.parentId).toBe('p1');
    expect(a.source).toBe('derived');
  });
  test('无 parent_id → parentId undefined 且 source=generated', () => {
    const a = canvasItemToAsset({ ...base });
    expect(a.parentId).toBeUndefined();
    expect(a.source).toBe('generated');
  });
});

describe('assetReference', () => {
  test('合并 position + parent_id + source_filename', () => {
    const a: Asset = { id: 'c1', key: 'c1', label: 'x', kind: 'image', source: 'derived', status: 'ready', position: { x: 1, y: 2 }, pinned: true, parentId: 'p1', sourceFilename: 'hero.png' };
    expect(assetReference(a)).toEqual({ position: { x: 1, y: 2 }, parent_id: 'p1', source_filename: 'hero.png' });
  });
  test('无 parent_id/source_filename 时只含 position', () => {
    const a: Asset = { id: 'c2', key: 'c2', label: 'x', kind: 'image', source: 'generated', status: 'ready', position: { x: 3, y: 4 }, pinned: false };
    expect(assetReference(a)).toEqual({ position: { x: 3, y: 4 } });
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test -- src/lib/pgc/map.test.ts`
Expected: FAIL —— `assetReference` 未导出 / `parentId` 为 undefined（map.ts 尚未实现）。

- [ ] **Step 4: 实现 map.ts**

在 `src/lib/pgc/map.ts`：

(a) 扩展 `CanvasReference` 已知字段（约 14-17 行）：

```ts
export interface CanvasReference {
  position?: { x: number; y: number };
  parent_id?: string;        // 引用生成:连线到源资产 id(前端连线 + 持久化)
  source_filename?: string;  // 自动导入溯源
  [k: string]: unknown;
}
```

(b) `canvasItemToAsset` 读 `parent_id`、按是否有父标记 source（替换函数体 19-37 行）：

```ts
export function canvasItemToAsset(it: CanvasItemData): Asset {
  const ref = (it.reference ?? {}) as CanvasReference;
  const hasRefPos = !!ref.position;
  const hasXY = it.canvas_x != null && it.canvas_y != null;
  const position = ref.position ?? (hasXY ? { x: it.canvas_x!, y: it.canvas_y! } : { x: 0, y: 0 });
  const src = resolveAssetUrl(it.url);
  return {
    id: it.item_id,
    key: it.item_id,
    label: it.name ?? it.item_id,
    kind: TYPE_TO_KIND[it.type] ?? 'image',
    source: ref.parent_id ? 'derived' : 'generated',
    parentId: ref.parent_id,
    status: statusOf(it.status),
    position,
    pinned: hasRefPos || hasXY,
    preview: src ? { src } : undefined,
    sourceFilename: ref.source_filename,
  };
}
```

(c) 删除 `positionReference` 函数（约 43-47 行），新增 `assetReference`：

```ts
// 从 Asset 已知字段重建完整 reference,避免回写坐标时覆盖 parent_id / source_filename
export function assetReference(a: Asset): CanvasReference {
  const ref: CanvasReference = { position: a.position };
  if (a.parentId) ref.parent_id = a.parentId;
  if (a.sourceFilename) ref.source_filename = a.sourceFilename;
  return ref;
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test -- src/lib/pgc/map.test.ts`
Expected: PASS（含原有 canvasItemToAsset / versionToVersion 用例）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/pgc/map.ts src/lib/pgc/map.test.ts
git commit -m "feat: mapper 读回 reference.parent_id 并新增 assetReference 构造器"
```

---

### Task 2: actions.ts — linkParent + generate* 接 source + 修复 reference 覆盖

**Files:**
- Modify: `src/store/actions.ts`
- Test: `src/store/actions.test.ts`

- [ ] **Step 1: 给测试 mock 补 updateCanvasReference**

在 `src/store/actions.test.ts` 的 `vi.mock` 工厂里，`pgcApi` 对象中（第 8-14 行）补一行 `updateCanvasReference: vi.fn(),`。改后为：

```ts
    pgcApi: {
      listProjects: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
      listCanvasItems: vi.fn(), deleteCanvasItem: vi.fn(), genImage: vi.fn(), genAudio: vi.fn(),
      pollVideo: vi.fn(), pollModel3d: vi.fn(), updateCanvasReference: vi.fn(),
      listVersions: vi.fn(), createVersion: vi.fn(),
      writeCanvasItemFromUrl: vi.fn(),
    },
```

- [ ] **Step 2: 写失败测试（引用生成连线 + 轮询保留连线）**

在 `actions.test.ts` 的 `describe('画布 actions', ...)` 块内，`generateAudio` 用例之后追加三个测试：

```ts
  test('generateImage 带 sourceItemId:请求注入 source_item_id,新资产连线 parentId 并持久化', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.genImage.mockResolvedValue({ items: [{ id: 1, item_id: 'img-9', type: 'image', status: 'ready', url: '/p/a.png' }], total: 1 });
    api.updateCanvasReference.mockResolvedValue({ id: 1, item_id: 'img-9', type: 'image', status: 'ready' });
    await useStore.getState().generateImage({ prompt: '衍生立绘' }, 'src-1');
    expect(api.genImage).toHaveBeenCalledWith(42, expect.objectContaining({ prompt: '衍生立绘', source_item_id: 'src-1' }));
    const a = useStore.getState().assets.find((x) => x.id === 'img-9')!;
    expect(a.parentId).toBe('src-1');
    expect(a.source).toBe('derived');
    expect(api.updateCanvasReference).toHaveBeenCalledWith(42, 'img-9', expect.objectContaining({ parent_id: 'src-1' }));
  });

  test('generateImage 无 sourceItemId:不注入 source_item_id 也不连线', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.genImage.mockResolvedValue({ items: [{ id: 1, item_id: 'img-8', type: 'image', status: 'ready', url: '/p/a.png' }], total: 1 });
    await useStore.getState().generateImage({ prompt: '独立立绘' });
    expect(api.genImage).toHaveBeenCalledWith(42, { prompt: '独立立绘' });
    const a = useStore.getState().assets.find((x) => x.id === 'img-8')!;
    expect(a.parentId).toBeUndefined();
    expect(api.updateCanvasReference).not.toHaveBeenCalled();
  });

  test('generateAudio 带 sourceItemId:请求不含 source_item_id 但仍连线', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.genAudio.mockResolvedValue({ id: 1, item_id: 'aud-9', type: 'audio', status: 'ready', url: '/p/a.mp3' });
    api.updateCanvasReference.mockResolvedValue({ id: 1, item_id: 'aud-9', type: 'audio', status: 'ready' });
    await useStore.getState().generateAudio({ prompt: '台词' }, 'src-2');
    expect(api.genAudio).toHaveBeenCalledWith(42, { prompt: '台词' });
    const a = useStore.getState().assets.find((x) => x.id === 'aud-9')!;
    expect(a.parentId).toBe('src-2');
    expect(a.source).toBe('derived');
    expect(api.updateCanvasReference).toHaveBeenCalledWith(42, 'aud-9', expect.objectContaining({ parent_id: 'src-2' }));
  });
```

并在 `describe('画布轮询 pollGenTasks', ...)` 块内追加：

```ts
  test('占位项带本地 parentId 时,轮询 ready 后保留连线', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'derived', status: 'generating', position: { x: 0, y: 0 }, pinned: false, parentId: 'src-1' }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1' }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'ready', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4', reference: { position: { x: 30, y: 40 } } } });
    await useStore.getState().pollGenTasks();
    const a = useStore.getState().assets.find((x) => x.id === 'vid-1')!;
    expect(a.parentId).toBe('src-1');
    expect(a.source).toBe('derived');
  });
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test -- src/store/actions.test.ts`
Expected: FAIL —— `generateImage` 不接受第二参 / `parentId` 未设置 / `updateCanvasReference` 未被调用。

- [ ] **Step 4: 实现 actions.ts**

(a) 顶部 import：把 `positionReference` 换成 `assetReference`，并补 `Asset` 类型。

第 2 行 `import { canvasItemsToAssets, canvasItemToAsset, positionReference, versionsToVersions, versionToVersion } from '@/lib/pgc/map';`
→ `import { canvasItemsToAssets, canvasItemToAsset, assetReference, versionsToVersions, versionToVersion } from '@/lib/pgc/map';`

第 8 行 `import type { GenTask, Version, KoubouState, ServerState } from './types';`
→ `import type { Asset, GenTask, Version, KoubouState, ServerState } from './types';`

(b) 在 `createServerActions` 内、`// ---- 画布 ----` 注释下方、`generateImage` 之前，新增 helper：

```ts
  // 引用生成:为新资产建立到源资产的连线。本地即时置 parentId + derived(立即出现连线),
  // 并 fire-and-forget 把 parent_id 持久化进 reference(失败不阻塞 UI)。
  const linkParent = (pid: number, assets: Asset[], parentId: string): Asset[] => {
    const linked = assets.map((a) => ({ ...a, parentId, source: 'derived' as const }));
    for (const a of linked) {
      void pgcApi.updateCanvasReference(pid, a.id, { parent_id: parentId, position: a.position }).catch(() => {});
    }
    return linked;
  };
```

(c) `generateImage` 加 `sourceItemId` 参数（替换 91-96 行）：

```ts
  const generateImage = async (req: CanvasGenImageRequest, sourceItemId?: string) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const body = sourceItemId ? { ...req, source_item_id: sourceItemId } : req;
    const data = await pgcApi.genImage(pid, body);
    let fresh = canvasItemsToAssets(data.items);
    if (sourceItemId) fresh = linkParent(pid, fresh, sourceItemId);
    set({ assets: [...get().assets, ...fresh] });
  });
```

(d) `generateAudio` 加 `sourceItemId`（不注入请求体）（替换 99-103 行）：

```ts
  // 音频同步生成(TTS):返回单条 item。接口不支持 source_item_id,故仅在前端连线。
  const generateAudio = async (req: CanvasGenAudioRequest, sourceItemId?: string) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const item = await pgcApi.genAudio(pid, req);
    let asset = canvasItemToAsset(item);
    if (sourceItemId) [asset] = linkParent(pid, [asset], sourceItemId);
    set({ assets: [...get().assets, asset] });
  });
```

(e) `startAsyncGen` 加 `pid` + `sourceItemId`（替换 105-112 行）：

```ts
  const startAsyncGen = async (kind: 'video' | 'model3d', task: CanvasGenTask, pid: number, sourceItemId?: string) => {
    if (!task.item) return;
    let asset = canvasItemToAsset(task.item);
    if (sourceItemId) [asset] = linkParent(pid, [asset], sourceItemId);
    set({
      assets: [...get().assets, asset],
      genTasks: [...get().genTasks, { itemId: task.item.item_id, kind, taskId: task.task_id } satisfies GenTask],
    });
  };
```

(f) `generateVideo` / `generateModel3d` 加 `sourceItemId`、注入请求体、透传给 startAsyncGen（替换 114-124 行）：

```ts
  const generateVideo = async (req: CanvasGenVideoRequest, sourceItemId?: string) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const body = sourceItemId ? { ...req, source_item_id: sourceItemId } : req;
    const task = await pgcApi.genVideo(pid, body);
    await startAsyncGen('video', task, pid, sourceItemId);
  });

  const generateModel3d = async (req: CanvasGenModel3DRequest, sourceItemId?: string) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const body = sourceItemId ? { ...req, source_item_id: sourceItemId } : req;
    const task = await pgcApi.genModel3d(pid, body);
    await startAsyncGen('model3d', task, pid, sourceItemId);
  });
```

(g) `persistAssetPosition`：用 `assetReference(a)` 重建完整 reference（替换 165-172 行的 body）：

```ts
  const persistAssetPosition = async (itemId: string) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const a = get().assets.find((x) => x.id === itemId); if (!a) return;
    try {
      const item = await pgcApi.updateCanvasReference(pid, itemId, assetReference(a));
      void item;
    } catch { /* 坐标回写失败不阻塞 UI */ }
  };
```

(h) `pollGenTasks` 合并时保留本地 parent（替换 183-185 行的 `set({...})`）：

```ts
        set({ assets: get().assets.map((a) => (a.id === t.itemId
          ? { ...a, ...asset,
              position: a.pinned ? a.position : asset.position,
              pinned: a.pinned || asset.pinned,
              parentId: a.parentId ?? asset.parentId,
              source: a.parentId ? 'derived' : asset.source }
          : a)) });
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test -- src/store/actions.test.ts`
Expected: PASS（含原有用例）。

- [ ] **Step 6: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 生成动作支持引用源资产,连线并持久化 parent_id,修复坐标回写覆盖 reference"
```

---

### Task 3: store/index.ts — GenFormState.sourceId + addMenu 状态/动作

**Files:**
- Modify: `src/store/index.ts`

> 说明:这些是与既有 `selectAsset`/`openContextMenu` 同类的简单 setter,仓库惯例不为其单测;以类型检查 + 后续 UI 验证保证。

- [ ] **Step 1: 扩展 GenFormState 与新增 AddMenuState**

把 `src/store/index.ts` 第 16-19 行：

```ts
export interface ContextMenuState { id: string; x: number; y: number; }
export interface ComposerState { draft: string; refs: string[]; attachments: { name: string; mime: string; dataUrl: string }[]; }
// 生成弹窗的全局打开态:由 AddAssetMenu 以 { kind } 打开
export interface GenFormState { kind: 'image' | 'video' | 'audio' | '3d'; }
```

改为：

```ts
export interface ContextMenuState { id: string; x: number; y: number; }
export interface ComposerState { draft: string; refs: string[]; attachments: { name: string; mime: string; dataUrl: string }[]; }
// 新增资产菜单的打开态:双击空白处(无 sourceId)或卡片「+」(带 sourceId)触发
export interface AddMenuState { x: number; y: number; sourceId?: string; }
// 生成弹窗的全局打开态:由 AddAssetMenu 以 { kind, sourceId? } 打开;sourceId 为引用生成的源资产 id
export interface GenFormState { kind: 'image' | 'video' | 'audio' | '3d'; sourceId?: string; }
```

- [ ] **Step 2: UIState 加 addMenu 字段**

在 `interface UIState { ... }` 中、`contextMenu` 行下方加一行：

```ts
  addMenu: AddMenuState | null;
```

- [ ] **Step 3: Actions 接口加 openAddMenu/closeAddMenu**

在 `interface Actions { ... }` 中、`openContextMenu` 行下方加：

```ts
  openAddMenu: (m: AddMenuState) => void;
  closeAddMenu: () => void;
```

- [ ] **Step 4: 初始 state + 实现**

在 store 初值里、`contextMenu: null,` 下方加：

```ts
      addMenu: null,
```

在实现区、`openContextMenu: (contextMenu) => set({ contextMenu }),` 下方加：

```ts
      openAddMenu: (addMenu) => set({ addMenu }),
      closeAddMenu: () => set({ addMenu: null }),
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 仅可能因 Task 4-7 尚未改的调用点报错（AssetCanvas/AddAssetMenu/GenerateForm 仍用旧签名）。本步只确认 index.ts 自身无类型错误；若仅剩下游文件报错可继续。

- [ ] **Step 6: 提交**

```bash
git add src/store/index.ts
git commit -m "feat: store 新增 addMenu 打开态与 openAddMenu/closeAddMenu,GenFormState 增加 sourceId"
```

---

### Task 4: AssetCanvas.tsx — 菜单打开态改用 store

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`

- [ ] **Step 1: Inner 改用 store 的 addMenu**

在 `function Inner()` 顶部 store 取值区(约 121-128 行),把
`const openContextMenu = useStore((s) => s.openContextMenu);` 下方补:

```ts
  const openAddMenu = useStore((s) => s.openAddMenu);
  const closeAddMenu = useStore((s) => s.closeAddMenu);
  const addMenu = useStore((s) => s.addMenu);
```

删除 `const { screenToFlowPosition } = useReactFlow();`（Inner 内已无其他用途）。

删除局部 state 行：`const [addMenu, setAddMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number } } | null>(null);`

- [ ] **Step 2: 双击空白改用 openAddMenu**

把 `onPaneDoubleClick`（约 199-207 行）替换为：

```ts
  // 双击空白 pane → 在光标处打开新增资产菜单(无 sourceId,保留 Add source)
  const onPaneDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) return;
    openAddMenu({ x: e.clientX, y: e.clientY });
  };
```

- [ ] **Step 3: 渲染处改用 store 状态**

把底部（约 249-251 行）：

```tsx
      {addMenu && (
        <AddAssetMenu x={addMenu.x} y={addMenu.y} flowPos={addMenu.flowPos} onClose={() => setAddMenu(null)} />
      )}
```

替换为：

```tsx
      {addMenu && (
        <AddAssetMenu x={addMenu.x} y={addMenu.y} sourceId={addMenu.sourceId} onClose={closeAddMenu} />
      )}
```

> 注:此时 `AddAssetMenu` 仍是旧签名(带必填 `flowPos`),TS 会报错,Task 6 修复;故本任务的类型检查留到 Task 6 后统一过。`useState` 若已无其他使用,从第 2 行 import 移除(若仍被其它逻辑使用则保留)。

- [ ] **Step 4: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 画布新增菜单打开态改用 store(双击空白复用 openAddMenu)"
```

---

### Task 5: NodeCard.tsx + 五个节点组件 — 聚焦浮出「+」

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`
- Modify: `src/components/canvas/nodes/ImageNode.tsx`
- Modify: `src/components/canvas/nodes/VideoNode.tsx`
- Modify: `src/components/canvas/nodes/AudioNode.tsx`
- Modify: `src/components/canvas/nodes/ThreeDNode.tsx`
- Modify: `src/components/canvas/nodes/DocNode.tsx`

- [ ] **Step 1: 重写 NodeCard.tsx**

把 `src/components/canvas/nodes/NodeCard.tsx` 全文替换为：

```tsx
'use client';
import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { KIND_META } from '@/lib/asset-kind';
import type { AssetKind } from '@/lib/asset-kind';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';

// 类型徽章:彩点 + 类型名(画布卡片右上角)
export function NodeBadge({ kind }: { kind: AssetKind }) {
  const meta = KIND_META[kind];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-fill)] px-2 py-[3px] text-[11px] font-medium tracking-[-0.11px] text-[var(--color-ink)]">
      <span className="size-1.5 rounded-full" style={{ background: meta.colorVar }} />
      {meta.badge}
    </span>
  );
}

// 画布资产卡片统一外框:标题 + 徽章 header,媒体体由各节点传入;选中态加深描边并在右侧浮出「+」
export default function NodeCard({
  kind,
  title,
  selected,
  assetId,
  width = 180,
  children,
}: {
  kind: AssetKind;
  title: string;
  selected?: boolean;
  assetId: string;
  width?: number;
  children: ReactNode;
}) {
  const openAddMenu = useStore((s) => s.openAddMenu);
  return (
    <div
      style={{ width }}
      className={`relative rounded-[16px] border bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-card)] transition-[border-color] ${
        selected ? 'border-[var(--color-ink)]' : 'border-[var(--color-line-2)]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-[var(--color-line-2)] !opacity-0" />
      <div className="flex items-center justify-between gap-2 px-1.5 py-1.5">
        <span className="truncate text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{title}</span>
        <NodeBadge kind={kind} />
      </div>
      {children}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-[var(--color-line-2)] !opacity-0" />
      {/* 聚焦:右侧浮出「+」→ 打开「从此资产生成」菜单。nodrag + stopPropagation 防止触发拖拽/取消选中 */}
      {selected && (
        <button
          type="button"
          aria-label="Generate from this asset"
          className="nodrag absolute right-0 top-1/2 grid size-7 -translate-y-1/2 translate-x-[calc(100%+8px)] place-items-center rounded-full border border-[var(--color-line-2)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-fill)]"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            openAddMenu({ x: r.right + 8, y: r.top, sourceId: assetId });
          }}
        >
          <FigIcon src={figAsset.plus} size={16} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 五个节点组件传 assetId**

各文件把 `<NodeCard ...>` 调用补上 `assetId={a.id}`：

- `ImageNode.tsx`：`<NodeCard kind="image" title={a.label} selected={selected} width={180}>`
  → `<NodeCard kind="image" title={a.label} selected={selected} assetId={a.id} width={180}>`
- `VideoNode.tsx`：`<NodeCard kind="video" title={a.label} selected={selected} width={200}>`
  → `<NodeCard kind="video" title={a.label} selected={selected} assetId={a.id} width={200}>`
- `AudioNode.tsx`：`<NodeCard kind="audio" title={a.label} selected={selected} width={210}>`
  → `<NodeCard kind="audio" title={a.label} selected={selected} assetId={a.id} width={210}>`
- `ThreeDNode.tsx`：`<NodeCard kind="3d" title={a.label} selected={selected} width={180}>`
  → `<NodeCard kind="3d" title={a.label} selected={selected} assetId={a.id} width={180}>`
- `DocNode.tsx`：`<NodeCard kind="doc" title={a.label} selected={selected} width={210}>`
  → `<NodeCard kind="doc" title={a.label} selected={selected} assetId={a.id} width={210}>`

- [ ] **Step 3: 提交**

```bash
git add src/components/canvas/nodes/NodeCard.tsx src/components/canvas/nodes/ImageNode.tsx src/components/canvas/nodes/VideoNode.tsx src/components/canvas/nodes/AudioNode.tsx src/components/canvas/nodes/ThreeDNode.tsx src/components/canvas/nodes/DocNode.tsx
git commit -m "feat: 资产卡片聚焦时右侧浮出「+」,点击打开从此资产生成的菜单"
```

---

### Task 6: AddAssetMenu.tsx — sourceId 变体(隐藏 Add source)

**Files:**
- Modify: `src/components/canvas/AddAssetMenu.tsx`

- [ ] **Step 1: props 去 flowPos、加 sourceId;生成项透传 sourceId**

把 `src/components/canvas/AddAssetMenu.tsx` 的组件签名(约 21-30 行)：

```tsx
export default function AddAssetMenu({
  x,
  y,
  onClose,
}: {
  x: number;
  y: number;
  flowPos: { x: number; y: number };
  onClose: () => void;
}) {
```

替换为：

```tsx
export default function AddAssetMenu({
  x,
  y,
  sourceId,
  onClose,
}: {
  x: number;
  y: number;
  sourceId?: string;
  onClose: () => void;
}) {
```

把 `openGen`（约 42-45 行）：

```tsx
  const openGen = (kind: GenKind) => {
    openGenForm({ kind });
    onClose();
  };
```

替换为：

```tsx
  const openGen = (kind: GenKind) => {
    openGenForm({ kind, sourceId });
    onClose();
  };
```

- [ ] **Step 2: 有 sourceId 时隐藏 Add source 段**

把「Add source」整段（约 60-69 行）：

```tsx
        <div className="flex flex-col gap-1">
          <p className={groupLabel}>Add source</p>
          <button className={row} onClick={() => fileRef.current?.click()}>
            <span className={symbol}><FigIcon src={figAsset.upload} size={16} /></span>
            <span className="flex flex-col leading-4">
              <span className={label}>Upload</span>
              <span className="text-[10px] tracking-[-0.1px] text-[var(--color-muted)]">Image/ Video/ Audio</span>
            </span>
          </button>
        </div>
```

用条件包裹（仅无 sourceId 时显示）：

```tsx
        {!sourceId && (
          <div className="flex flex-col gap-1">
            <p className={groupLabel}>Add source</p>
            <button className={row} onClick={() => fileRef.current?.click()}>
              <span className={symbol}><FigIcon src={figAsset.upload} size={16} /></span>
              <span className="flex flex-col leading-4">
                <span className={label}>Upload</span>
                <span className="text-[10px] tracking-[-0.1px] text-[var(--color-muted)]">Image/ Video/ Audio</span>
              </span>
            </button>
          </div>
        )}
```

> `fileRef` / `uploadAsset` / `onFile` / 隐藏 `input` 保持原样（无 sourceId 时仍使用）；有 sourceId 时它们闲置但不影响。

- [ ] **Step 3: 类型检查（此时 AssetCanvas↔AddAssetMenu 签名应已对齐）**

Run: `npx tsc --noEmit`
Expected: AssetCanvas 与 AddAssetMenu 间不再报错；可能仅剩 GenerateForm/Host（Task 7）相关报错。

- [ ] **Step 4: 提交**

```bash
git add src/components/canvas/AddAssetMenu.tsx
git commit -m "feat: 生成菜单支持 sourceId 变体,有源资产时隐藏 Add source 段"
```

---

### Task 7: GenerateForm + Host — 引用行 + 透传 sourceId

**Files:**
- Modify: `src/components/canvas/GenerateFormHost.tsx`
- Modify: `src/components/canvas/GenerateForm.tsx`

- [ ] **Step 1: Host 透传 sourceId**

把 `src/components/canvas/GenerateFormHost.tsx` 的 return（第 10 行）：

```tsx
  return <GenerateForm kind={genForm.kind} onClose={closeGenForm} />;
```

替换为：

```tsx
  return <GenerateForm kind={genForm.kind} sourceId={genForm.sourceId} onClose={closeGenForm} />;
```

- [ ] **Step 2: GenerateForm 引入 KIND_META 与 store assets**

在 `src/components/canvas/GenerateForm.tsx`：

第 7 行 `import type { AssetKind } from '@/lib/asset-kind';`
→ `import { KIND_META, type AssetKind } from '@/lib/asset-kind';`

把组件签名（约 28-34 行）：

```tsx
export default function GenerateForm({
  kind,
  onClose,
}: {
  kind: GenKind;
  onClose: () => void;
}) {
```

替换为：

```tsx
export default function GenerateForm({
  kind,
  sourceId,
  onClose,
}: {
  kind: GenKind;
  sourceId?: string;
  onClose: () => void;
}) {
```

在 store 取值区（`generateModel3d` 那几行之后，约第 38 行后）补：

```tsx
  const assets = useStore((s) => s.assets);
  const source = sourceId ? assets.find((a) => a.id === sourceId) : undefined;
  const thumb = source?.preview?.dataUrl || source?.preview?.src;
```

- [ ] **Step 3: submit 透传 sourceId**

把 `submit`（约 48-60 行）的 try 体替换为：

```tsx
    try {
      if (kind === 'image') await generateImage({ prompt, n: 1 }, sourceId);
      else if (kind === 'audio') await generateAudio({ prompt }, sourceId);
      else if (kind === 'video') await generateVideo({ prompt }, sourceId);
      else await generateModel3d({ prompt }, sourceId);
      onClose();
    } finally {
      setBusy(false);
    }
```

- [ ] **Step 4: 渲染引用行 chip**

把弹窗内的 `<textarea ... />`（约 77-90 行）用一个分组 div 包住，并在其上方放引用 chip。即把：

```tsx
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={PLACEHOLDER[kind]}
          className="w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] outline-none placeholder:text-[var(--color-muted)]"
        />
```

替换为：

```tsx
        <div className="flex flex-col gap-3">
          {source && (
            <div className="flex items-center px-1">
              {/* 引用行:源资产缩略图 chip(只读;对齐设计稿 219-3890) */}
              <span className="flex items-center gap-2 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-fill)] py-1 pl-1 pr-2.5">
                <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[var(--color-surface-2)]">
                  {thumb ? (
                    <img src={thumb} alt="" draggable={false} className="size-full object-cover" />
                  ) : (
                    <span className="size-2 rounded-full" style={{ background: KIND_META[source.kind].colorVar }} />
                  )}
                </span>
                <span className="max-w-[160px] truncate text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)]">{source.label}</span>
              </span>
            </div>
          )}
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={PLACEHOLDER[kind]}
            className="w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] outline-none placeholder:text-[var(--color-muted)]"
          />
        </div>
```

- [ ] **Step 5: 类型检查 + lint 通过**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 均无错误（Task 3-7 的调用链此时完整闭合）。

- [ ] **Step 6: 提交**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateFormHost.tsx
git commit -m "feat: 生成弹窗顶部展示源资产引用 chip,并把 sourceId 透传给生成动作"
```

---

### Task 8: 全量回归 + 手动验证

**Files:** 无（验证）

- [ ] **Step 1: 跑全部单测**

Run: `pnpm test`
Expected: 全绿（含 map / actions / selectors）。

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 无错误、无未用导入（确认 `positionReference` 已无残留引用、AssetCanvas 的 `useState`/`screenToFlowPosition` 若移除则无遗留）。

辅助核查残留：

```bash
grep -rn "positionReference" src || echo "无 positionReference 残留(预期)"
```

- [ ] **Step 3: 手动验证（启动应用）**

Run: `pnpm dev`，浏览器打开应用，选中一个有项目/资产的画布：

1. 单击任一资产卡片 → 卡片高亮(深色描边),右侧浮出「+」。
2. 点「+」→ 弹出菜单,**无「Add source」段**,仅 4 个生成项。
3. 点 Image/Video/3D → 弹窗顶部出现**源资产缩略图 chip**;输入 prompt → 提交后新资产出现并与源资产之间**有连线**。
4. 点 Audio → 同样能生成并连线(请求体不带 source_item_id)。
5. 拖动派生资产后**连线仍在**;刷新页面后(重新 loadCanvas)**连线仍恢复**(验证 reference.parent_id 持久化与坐标回写不再覆盖)。
6. 双击空白处 → 菜单**仍带「Add source」**(回归未破坏原路径)。

- [ ] **Step 4: 收尾提交（如手动验证发现微调）**

如无改动则跳过；若有小修：

```bash
git add -p
git commit -m "fix: 引用生成手动验证后的样式/交互微调"
```

---

## 自检对照(Spec Coverage)

- Spec Part A(数据层连线+持久化)→ Task 1(map 读 parent_id + assetReference)、Task 2(linkParent + persistAssetPosition 修复 + pollGenTasks 保留)。
- Spec Part B(菜单状态提升 + 卡片「+」)→ Task 3(store addMenu)、Task 4(AssetCanvas)、Task 5(NodeCard「+」)。
- Spec Part C(菜单 source 变体 + 弹窗引用行)→ Task 6(AddAssetMenu)、Task 7(GenerateForm + Host)。
- Spec 四项功能:聚焦高亮+「+」(Task 5)、菜单去 Add source(Task 6)、弹窗引用 chip(Task 7)、连线+持久化(Task 1/2)。
- Spec 测试:map 单测(Task 1)、actions 单测(Task 2)、selectors 连线用例(已存在,Task 8 回归)、`pnpm test`+`pnpm lint`(Task 8)。
- 类型一致性:`assetReference`/`linkParent`/`AddMenuState`/`openAddMenu`/`GenFormState.sourceId`/`NodeCard.assetId` 跨任务命名一致。
