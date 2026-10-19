# Koubou 对话生成资产自动导入画布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Koubou 对话里 agent 生成的资产（`media.generated`）自动调用 import 接口落到画布，按 kind 泳道算好坐标并持久化，全程去重。

**Architecture:** 核心逻辑抽成纯函数（kind 映射、basename、泳道坐标、待导入筛选），由 store action `importGeneratedAsset` 编排「算坐标 → import → 并入 assets + 记去重」，再由薄 hook `useCanvasAutoImport` 串行驱动；mapper 位置优先级 `reference.position > canvas_x/canvas_y > (0,0)`；历史重建时预填已导入集。

**Tech Stack:** TypeScript、React 19、zustand 5(persist)、vitest 4、@testing-library/react 16。

**测试命令约定：** `pnpm test <文件路径片段>`（= `vitest run <filter>`）。

**Spec：** `docs/superpowers/specs/2026-06-09-koubou-canvas-auto-import-design.md`

---

### Task 1: import 接口封装（types + client）

**Files:**
- Modify: `src/lib/pgc/types.ts`（新增 `CanvasImportRequest`）
- Modify: `src/lib/pgc/client.ts`（新增 `pgcApi.importCanvasItem`）
- Test: `src/lib/pgc/client.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/pgc/client.test.ts` 的 `describe('pgcApi 信封拆解', ...)` 块内追加：

```ts
test('importCanvasItem POST 命中 import 端点并带 body', async () => {
  const f = fetch as ReturnType<typeof vi.fn>;
  f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, item_id: 'imp-1', type: 'image', status: 'ready', url: '/p/h.png', canvas_x: 100, canvas_y: 110 } }));
  const d = await pgcApi.importCanvasItem(42, { source_filename: 'hero.png', type: 'image', canvas_x: 100, canvas_y: 110, reference: { source_filename: 'hero.png' } });
  expect(d.item_id).toBe('imp-1');
  expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/items/import', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ source_filename: 'hero.png', type: 'image', canvas_x: 100, canvas_y: 110, reference: { source_filename: 'hero.png' } }),
  }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/pgc/client.test.ts`
Expected: FAIL（`pgcApi.importCanvasItem is not a function`）

- [ ] **Step 3: 加类型**

在 `src/lib/pgc/types.ts` 末尾（`CanvasUpdateRequest` 之后）追加：

```ts
export interface CanvasImportRequest {
  source_filename: string;
  type?: 'image' | 'video' | 'audio' | 'model3d' | null;
  name?: string | null;
  reference?: unknown | null;
  canvas_x?: number | null;
  canvas_y?: number | null;
}
```

- [ ] **Step 4: 加 client 方法**

在 `src/lib/pgc/client.ts` 的 import 类型列表里加入 `CanvasImportRequest`：

```ts
import type {
  ApiResponse, ProjectData, ProjectListData, CanvasItemData, CanvasItemListData,
  CanvasGenTask, VersionData, VersionListData, CreateVersionData,
  UpdateProjectRequest, CanvasGenImageRequest, CanvasGenVideoRequest, CanvasGenModel3DRequest,
  CanvasUpdateRequest, CanvasImportRequest,
} from './types';
```

在 `pgcApi` 对象的「画布」段，`uploadCanvasItem` 不在此对象（它是独立导出）——把方法加在 `genModel3d`/`pollModel3d` 之后、版本段之前：

```ts
  importCanvasItem: (pid: number, body: CanvasImportRequest) =>
    pgc<CanvasItemData>('POST', `/api/projects/${pid}/canvas/items/import`, body),
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test src/lib/pgc/client.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: pgc 客户端封装 canvas import 接口"
```

---

### Task 2: mapper 位置优先级 + sourceFilename

**Files:**
- Modify: `src/store/types.ts`（`Asset` 加 `sourceFilename?`）
- Modify: `src/lib/pgc/map.ts`（`canvasItemToAsset` 位置优先级 + 读 sourceFilename）
- Test: `src/lib/pgc/map.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `src/lib/pgc/map.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { canvasItemToAsset } from './map';
import type { CanvasItemData } from './types';

const base: CanvasItemData = { id: 1, item_id: 'i1', type: 'image', status: 'ready' };

describe('canvasItemToAsset 位置优先级', () => {
  test('reference.position 优先(拖拽权威),即使有 canvas_x/y', () => {
    const a = canvasItemToAsset({ ...base, canvas_x: 5, canvas_y: 6, reference: { position: { x: 30, y: 40 } } });
    expect(a.position).toEqual({ x: 30, y: 40 });
    expect(a.pinned).toBe(true);
  });
  test('无 reference.position 时退到 canvas_x/canvas_y', () => {
    const a = canvasItemToAsset({ ...base, canvas_x: 100, canvas_y: 110 });
    expect(a.position).toEqual({ x: 100, y: 110 });
    expect(a.pinned).toBe(true);
  });
  test('都没有时回退 (0,0) 且未 pinned', () => {
    const a = canvasItemToAsset({ ...base });
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.pinned).toBe(false);
  });
  test('读出 reference.source_filename 到 sourceFilename', () => {
    const a = canvasItemToAsset({ ...base, reference: { source_filename: 'hero.png' } });
    expect(a.sourceFilename).toBe('hero.png');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/pgc/map.test.ts`
Expected: FAIL（canvas_x/canvas_y 未参与 position；`sourceFilename` 不存在）

- [ ] **Step 3: Asset 加字段**

在 `src/store/types.ts` 的 `Asset` 接口里加 `sourceFilename?`（放在 `prompt?` 旁）：

```ts
export interface Asset {
  id: string; key: string; label: string;
  kind: AssetKind; source: AssetSource;
  parentId?: string;
  status: Status;
  position: { x: number; y: number };
  pinned: boolean;
  preview?: AssetPreviewData;
  prompt?: string;
  sourceFilename?: string;   // 来源 agent 资产文件名(import 经 reference 回显),用于去重
}
```

- [ ] **Step 4: 改 mapper**

把 `src/lib/pgc/map.ts` 的 `canvasItemToAsset` 整体替换为：

```ts
export function canvasItemToAsset(it: CanvasItemData): Asset {
  const ref = (it.reference ?? {}) as CanvasReference & { source_filename?: string };
  const hasRefPos = !!ref.position;
  const hasXY = it.canvas_x != null && it.canvas_y != null;
  const position = ref.position ?? (hasXY ? { x: it.canvas_x!, y: it.canvas_y! } : { x: 0, y: 0 });
  const src = resolveAssetUrl(it.url);
  return {
    id: it.item_id,
    key: it.item_id,
    label: it.name ?? it.item_id,
    kind: TYPE_TO_KIND[it.type] ?? 'image',
    source: 'generated',
    status: statusOf(it.status),
    position,
    pinned: hasRefPos || hasXY,
    preview: src ? { src } : undefined,
    sourceFilename: ref.source_filename,
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test src/lib/pgc/map.test.ts`
Expected: PASS

- [ ] **Step 6: 回归 store action 测试（pollGenTasks 依赖 reference.position 优先）**

Run: `pnpm test src/store/actions.test.ts`
Expected: PASS（「未 pin 占位项转 ready 采用服务端 reference.position」「已 pin 保留本地坐标」仍通过）

- [ ] **Step 7: 提交**

```bash
git add src/store/types.ts src/lib/pgc/map.ts src/lib/pgc/map.test.ts
git commit -m "feat: canvas mapper 位置优先级(reference.position>canvas_x/y)+读 sourceFilename"
```

---

### Task 3: 泳道级联坐标 `nextLanePosition`

**Files:**
- Modify: `src/lib/zones.ts`（新增 `LANE_MARGIN`/`LANE_STEP`/`nextLanePosition`）
- Test: `src/lib/zones.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `src/lib/zones.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { nextLanePosition, zoneFor, zoneCenter, LANE_MARGIN, LANE_STEP } from './zones';

describe('nextLanePosition 泳道级联', () => {
  test('空泳道:zone.x + MARGIN,y 为泳道中心', () => {
    const z = zoneFor('image');
    const p = nextLanePosition('image', []);
    expect(p.x).toBe(z.x + LANE_MARGIN);
    expect(p.y).toBe(Math.round(zoneCenter(z).y));
  });
  test('非空:max(x) + STEP', () => {
    const p = nextLanePosition('video', [120, 300, 80]);
    expect(p.x).toBe(300 + LANE_STEP);
  });
  test('不同 kind 落各自泳道中心 y', () => {
    expect(nextLanePosition('audio', []).y).toBe(Math.round(zoneCenter(zoneFor('audio')).y));
    expect(nextLanePosition('3d', []).y).toBe(Math.round(zoneCenter(zoneFor('3d')).y));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/zones.test.ts`
Expected: FAIL（`nextLanePosition`/`LANE_MARGIN`/`LANE_STEP` 未导出）

- [ ] **Step 3: 实现**

在 `src/lib/zones.ts` 末尾追加：

```ts
// 导入资产落点:同 kind 泳道内向右级联,纵向取泳道中心
export const LANE_MARGIN = 100, LANE_STEP = 200;
export function nextLanePosition(kind: AssetKind, sameKindXs: number[]): { x: number; y: number } {
  const z = zoneFor(kind);
  const x = sameKindXs.length === 0 ? z.x + LANE_MARGIN : Math.max(...sameKindXs) + LANE_STEP;
  return { x: Math.round(x), y: Math.round(zoneCenter(z).y) };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/lib/zones.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/zones.ts src/lib/zones.test.ts
git commit -m "feat: 泳道级联落点 nextLanePosition"
```

---

### Task 4: media 导入辅助纯函数

**Files:**
- Create: `src/lib/media-import.ts`
- Test: `src/lib/media-import.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/lib/media-import.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { basename, mediaKindToAssetKind, kindToImportType, collectReadyMedia, pendingImports } from './media-import';
import type { Message, Status } from '@/store/types';

function toolMsg(parts: Array<{ status: Status; media?: { kind: string; path: string } }>): Message {
  return {
    id: 'm', role: 'assistant', status: 'ready',
    parts: parts.map((p, i) => ({
      type: 'tool' as const, id: `t${i}`, name: 'gen', input: {}, status: p.status,
      media: p.media ? { type: 'media.generated' as const, kind: p.media.kind, path: p.media.path, preview_url: null } : undefined,
    })),
  };
}

describe('basename', () => {
  test('纯文件名原样', () => expect(basename('hero.png')).toBe('hero.png'));
  test('带目录取末段', () => expect(basename('assets/hero.png')).toBe('hero.png'));
  test('多级目录', () => expect(basename('/a/b/c.mp4')).toBe('c.mp4'));
});

describe('kind 映射', () => {
  test('media.kind→AssetKind:model3d/3d→3d,未知→image', () => {
    expect(mediaKindToAssetKind('model3d')).toBe('3d');
    expect(mediaKindToAssetKind('3d')).toBe('3d');
    expect(mediaKindToAssetKind('image')).toBe('image');
    expect(mediaKindToAssetKind('???')).toBe('image');
  });
  test('AssetKind→import type:3d→model3d,doc→undefined', () => {
    expect(kindToImportType('3d')).toBe('model3d');
    expect(kindToImportType('image')).toBe('image');
    expect(kindToImportType('doc')).toBeUndefined();
  });
});

describe('collectReadyMedia', () => {
  test('仅取 ready 且带 media 的工具结果,做 basename + kind 映射', () => {
    const msgs: Message[] = [toolMsg([
      { status: 'ready', media: { kind: 'image', path: 'assets/hero.png' } },
      { status: 'generating', media: { kind: 'image', path: 'assets/wip.png' } },
      { status: 'ready' },
    ])];
    expect(collectReadyMedia(msgs)).toEqual([{ filename: 'hero.png', kind: 'image' }]);
  });
});

describe('pendingImports', () => {
  test('排除已导入/处理中,并按文件名去重', () => {
    const msgs: Message[] = [toolMsg([
      { status: 'ready', media: { kind: 'image', path: 'assets/a.png' } },
      { status: 'ready', media: { kind: 'video', path: 'assets/b.mp4' } },
      { status: 'ready', media: { kind: 'image', path: 'a.png' } }, // 同名重复
    ])];
    const out = pendingImports(msgs, new Set(['b.mp4']), new Set());
    expect(out).toEqual([{ filename: 'a.png', kind: 'image' }]);
  });
  test('in-flight 中的跳过', () => {
    const msgs: Message[] = [toolMsg([{ status: 'ready', media: { kind: 'image', path: 'a.png' } }])];
    expect(pendingImports(msgs, new Set(), new Set(['a.png']))).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/media-import.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `src/lib/media-import.ts`：

```ts
import type { AssetKind } from '@/lib/asset-kind';
import type { Message } from '@/store/types';

// 取路径纯文件名(兼容纯文件名 / 带目录)
export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

// media.generated.kind → 画布 AssetKind
export function mediaKindToAssetKind(kind: string): AssetKind {
  switch (kind) {
    case 'video': return 'video';
    case 'audio': return 'audio';
    case '3d': case 'model3d': return '3d';
    case 'image': return 'image';
    default: return 'image';
  }
}

// 画布 AssetKind → import type(无法映射返回 undefined,由后端按扩展名推断)
export function kindToImportType(kind: AssetKind): 'image' | 'video' | 'audio' | 'model3d' | undefined {
  switch (kind) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case '3d': return 'model3d';
    default: return undefined; // doc 等
  }
}

export interface ReadyMedia { filename: string; kind: AssetKind }

// 扫描消息里 ready 且带 media 的工具结果,产出候选(已 basename + kind 映射)
export function collectReadyMedia(messages: Message[]): ReadyMedia[] {
  const out: ReadyMedia[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool' && p.status === 'ready' && p.media) {
        out.push({ filename: basename(p.media.path), kind: mediaKindToAssetKind(p.media.kind) });
      }
    }
  }
  return out;
}

// 过滤掉已导入 / 处理中的,得到本次应导入项(按文件名去重)
export function pendingImports(messages: Message[], imported: Set<string>, inFlight: Set<string>): ReadyMedia[] {
  const seen = new Set<string>();
  const out: ReadyMedia[] = [];
  for (const r of collectReadyMedia(messages)) {
    if (imported.has(r.filename) || inFlight.has(r.filename) || seen.has(r.filename)) continue;
    seen.add(r.filename);
    out.push(r);
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/lib/media-import.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/media-import.ts src/lib/media-import.test.ts
git commit -m "feat: media 导入辅助(basename/kind 映射/待导入筛选)"
```

---

### Task 5: store 去重状态 + `importGeneratedAsset` action

**Files:**
- Modify: `src/store/types.ts`（`ServerState.importedByProject` + 初始化）
- Modify: `src/store/actions.ts`（新增 `importGeneratedAsset`）
- Modify: `src/store/index.ts`（`partialize` 持久化 `importedByProject`）
- Test: `src/store/actions.test.ts`

- [ ] **Step 1: 写失败测试**

先在 `src/store/actions.test.ts` 顶部 `vi.mock` 的 `pgcApi` 对象里加入 `importCanvasItem: vi.fn(),`（与其它方法并列）。然后从 zones 引入 `LANE_STEP`：在文件 import 区追加 `import { LANE_STEP } from '@/lib/zones';`。最后追加测试块：

```ts
describe('importGeneratedAsset 自动导入', () => {
  test('算泳道坐标传给 import,成功后并入 assets 与 importedByProject', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {} });
    api.importCanvasItem.mockResolvedValue({ id: 1, item_id: 'imp-1', type: 'image', status: 'ready', url: '/p/h.png', reference: { source_filename: 'hero.png' }, canvas_x: 100, canvas_y: 110 });
    await useStore.getState().importGeneratedAsset('hero.png', 'image');
    expect(api.importCanvasItem).toHaveBeenCalledWith(42, expect.objectContaining({
      source_filename: 'hero.png', type: 'image', reference: { source_filename: 'hero.png' },
    }));
    expect(useStore.getState().assets.find((a) => a.id === 'imp-1')).toBeTruthy();
    expect(useStore.getState().importedByProject['42']).toContain('hero.png');
  });

  test('已导入文件名跳过,不再调 import', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: { '42': ['hero.png'] } });
    await useStore.getState().importGeneratedAsset('hero.png', 'image');
    expect(api.importCanvasItem).not.toHaveBeenCalled();
  });

  test('import 抛 PgcError 写 lastError,不记入 importedByProject', async () => {
    useStore.setState({ currentProjectId: 42, assets: [], importedByProject: {} });
    api.importCanvasItem.mockRejectedValue(new PgcError('SOURCE_NOT_FOUND', '源不存在', 404));
    await useStore.getState().importGeneratedAsset('missing.png', 'image');
    expect(useStore.getState().lastError?.code).toBe('SOURCE_NOT_FOUND');
    expect(useStore.getState().importedByProject['42'] ?? []).not.toContain('missing.png');
  });

  test('同 kind 已有资产时向右级联坐标', async () => {
    useStore.setState({ currentProjectId: 42, importedByProject: {},
      assets: [{ id: 'x', key: 'x', label: 'x', kind: 'image', source: 'generated', status: 'ready', position: { x: 500, y: 110 }, pinned: true }] });
    api.importCanvasItem.mockResolvedValue({ id: 2, item_id: 'imp-2', type: 'image', status: 'ready', url: null });
    await useStore.getState().importGeneratedAsset('next.png', 'image');
    expect(api.importCanvasItem.mock.calls[0][1].canvas_x).toBe(500 + LANE_STEP);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/store/actions.test.ts`
Expected: FAIL（`importGeneratedAsset is not a function` / `importedByProject` 未定义）

- [ ] **Step 3: 加 ServerState 字段**

在 `src/store/types.ts` 的 `ServerState` 接口加一行（放在 `koubouByProject` 旁）：

```ts
  importedByProject: Record<string, string[]>;   // 已导入画布的 agent 资产文件名(按项目),去重用
```

并在 `createInitialServerState` 的返回对象里加 `importedByProject: {},`：

```ts
export function createInitialServerState(): ServerState {
  return { projects: [], currentProjectId: null, assets: [], versions: [], activeVersionId: null, genTasks: [], pendingVersionId: null, buildingVersion: null, lastError: null, koubouByProject: {}, importedByProject: {} };
}
```

- [ ] **Step 4: 加 action**

在 `src/store/actions.ts` 顶部 import 区补充：

```ts
import { nextLanePosition } from '@/lib/zones';
import { kindToImportType } from '@/lib/media-import';
import type { AssetKind } from '@/lib/asset-kind';
import type { CanvasImportRequest, CanvasGenImageRequest, CanvasGenVideoRequest, CanvasGenModel3DRequest, CanvasGenTask } from '@/lib/pgc/types';
```

（把原本的 `import type { CanvasGenImageRequest, ... } from '@/lib/pgc/types';` 这行合并为上面带 `CanvasImportRequest` 的版本，避免重复导入。）

在 `createServerActions` 内、`// ---- 画布 ----` 段落里（`generateImage` 之前或之后均可）新增：

```ts
  // agent 生成资产自动导入画布:算泳道坐标 → import 落库 → 并入 assets + 记去重
  const importGeneratedAsset = async (filename: string, kind: AssetKind) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const key = String(pid);
    if ((get().importedByProject[key] ?? []).includes(filename)) return;
    const sameKindXs = get().assets.filter((a) => a.kind === kind).map((a) => a.position.x);
    const { x, y } = nextLanePosition(kind, sameKindXs);
    const body: CanvasImportRequest = { source_filename: filename, type: kindToImportType(kind), canvas_x: x, canvas_y: y, reference: { source_filename: filename } };
    const item = await pgcApi.importCanvasItem(pid, body);
    set({
      assets: [...get().assets, canvasItemToAsset(item)],
      importedByProject: { ...get().importedByProject, [key]: [...(get().importedByProject[key] ?? []), filename] },
    });
  });
```

在 `createServerActions` 的 `return { ... }` 里加入 `importGeneratedAsset`：

```ts
  return {
    loadProjects, selectProject, createProject, renameProject, deleteProject,
    loadCanvas, loadVersions, generateImage, generateVideo, generateModel3d,
    uploadAsset, deleteCanvasItem, persistAssetPosition, pollGenTasks,
    publishVersion, pollVersions, previewActiveVersion, downloadActiveVersion,
    importGeneratedAsset,
  };
```

- [ ] **Step 5: 持久化去重集**

在 `src/store/index.ts` 的 `partialize` 里加一行 `importedByProject: s.importedByProject,`：

```ts
      partialize: (s) => ({
        visibleKinds: s.visibleKinds,
        currentProjectId: s.currentProjectId,
        koubouByProject: s.koubouByProject,
        importedByProject: s.importedByProject,
        composer: { draft: s.composer.draft, refs: s.composer.refs, attachments: [] },
      }),
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm test src/store/actions.test.ts`
Expected: PASS（含新 4 条）

- [ ] **Step 7: 提交**

```bash
git add src/store/types.ts src/store/actions.ts src/store/index.ts src/store/actions.test.ts
git commit -m "feat: importGeneratedAsset 自动导入 action + importedByProject 去重持久化"
```

---

### Task 6: 历史重建预填去重集（`ingestKoubou`）

**Files:**
- Modify: `src/store/index.ts`（`ingestKoubou` 在从空重建历史时预填 `importedByProject`）
- Test: `src/store/koubou-seed.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `src/store/koubou-seed.test.ts`：

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';
import { createInitialKoubouState, createInitialServerState } from './types';
import type { ServerEvent } from '@/koubou/protocol';

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState(), currentProjectId: 42 }));

function readyEvent(): ServerEvent {
  return {
    type: 'session.ready', project_id: '42', session_id: 's1',
    payload: {
      session_id: 's1',
      visible_state: { messages: [
        { uuid: 'a1', role: 'assistant', content: { content: [{ type: 'tool_use', id: 'tu1', name: 'gen', input: {} }] } },
        { uuid: 'u1', role: 'user', content: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: JSON.stringify({ type: 'media.generated', kind: 'image', path: 'assets/hero.png', preview_url: null }) }] } },
      ] },
    },
  };
}

describe('ingestKoubou 历史预填 importedByProject', () => {
  test('从服务器重建历史时,出现过的 media 文件名预填为已导入', () => {
    useStore.getState().ingestKoubou(readyEvent());
    expect(useStore.getState().importedByProject['42']).toContain('hero.png');
  });

  test('已有本地消息(非空)时不重建、不预填', () => {
    useStore.setState({ messages: [{ id: 'm0', role: 'user', parts: [{ type: 'text', text: 'hi' }], status: 'ready' }] });
    useStore.getState().ingestKoubou(readyEvent());
    expect(useStore.getState().importedByProject['42'] ?? []).not.toContain('hero.png');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/store/koubou-seed.test.ts`
Expected: FAIL（首条断言失败：未预填）

- [ ] **Step 3: 实现**

在 `src/store/index.ts` 顶部 import 区追加：

```ts
import { collectReadyMedia } from '@/lib/media-import';
```

把 `ingestKoubou` 整体替换为：

```ts
      ingestKoubou: (e) =>
        set((s) => {
          const wasEmpty = s.messages.length === 0;
          const koubou = applyKoubou(s, e);
          const extra: Partial<ServerState> = {};
          // error 事件的 message 写入 lastError(ServerState)
          if (e.type === 'error') {
            const msg = (e.payload as { message?: string }).message ?? 'agent error';
            extra.lastError = { code: 'AGENT', message: msg };
          }
          // 历史预填:从服务器重建历史(空→非空)时,把出现过的 media 文件名视为已导入,避免重复刷上画布
          if (e.type === 'session.ready' && wasEmpty && koubou.messages.length > 0 && s.currentProjectId != null) {
            const key = String(s.currentProjectId);
            const names = collectReadyMedia(koubou.messages).map((r) => r.filename);
            if (names.length) {
              const prev = s.importedByProject[key] ?? [];
              extra.importedByProject = { ...s.importedByProject, [key]: [...new Set([...prev, ...names])] };
            }
          }
          return { ...koubou, ...extra };
        }),
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/store/koubou-seed.test.ts`
Expected: PASS

- [ ] **Step 5: 回归 koubou reducer 测试**

Run: `pnpm test src/koubou/apply-koubou.test.ts`
Expected: PASS（重建历史 + foldResults 行为未变）

- [ ] **Step 6: 提交**

```bash
git add src/store/index.ts src/store/koubou-seed.test.ts
git commit -m "feat: 历史重建时预填 importedByProject,只导 live 新资产"
```

---

### Task 7: `useCanvasAutoImport` hook + 装配

**Files:**
- Create: `src/client/useCanvasAutoImport.ts`
- Modify: `src/components/workspace/Workspace.tsx`（挂载 hook）
- Test: `src/client/useCanvasAutoImport.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `src/client/useCanvasAutoImport.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasAutoImport } from './useCanvasAutoImport';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState, type Message, type Status } from '@/store/types';

function mediaMsg(path: string, kind = 'image', status: Status = 'ready'): Message {
  return { id: 'm1', role: 'assistant', status: 'ready', parts: [
    { type: 'tool', id: 't1', name: 'gen', input: {}, status, media: { type: 'media.generated', kind, path, preview_url: null } },
  ] };
}

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() }));
afterEach(() => vi.restoreAllMocks());

describe('useCanvasAutoImport', () => {
  test('出现 ready media 时调用 importGeneratedAsset(basename, kind) 一次', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, importGeneratedAsset: spy as never, messages: [mediaMsg('assets/hero.png', 'image')] });
    renderHook(() => useCanvasAutoImport());
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('hero.png', 'image'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('已在 importedByProject 中的不导入', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, importGeneratedAsset: spy as never, importedByProject: { '42': ['hero.png'] }, messages: [mediaMsg('assets/hero.png')] });
    renderHook(() => useCanvasAutoImport());
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  test('generating 状态不导入', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, importGeneratedAsset: spy as never, messages: [mediaMsg('assets/x.png', 'image', 'generating')] });
    renderHook(() => useCanvasAutoImport());
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/client/useCanvasAutoImport.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hook**

新建 `src/client/useCanvasAutoImport.ts`：

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { pendingImports } from '@/lib/media-import';

// 对话出现 ready 的 media → 顺序导入画布(去重:importedByProject + 本会话 attempted;串行保证级联坐标)
export function useCanvasAutoImport() {
  const messages = useStore((s) => s.messages);
  const pid = useStore((s) => s.currentProjectId);
  const importedByProject = useStore((s) => s.importedByProject);
  const importGeneratedAsset = useStore((s) => s.importGeneratedAsset);

  const attemptedRef = useRef<Set<string>>(new Set());
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // 切项目:重置去重与串行队列
  useEffect(() => {
    attemptedRef.current = new Set();
    chainRef.current = Promise.resolve();
  }, [pid]);

  useEffect(() => {
    if (pid == null) return;
    const imported = new Set(importedByProject[String(pid)] ?? []);
    const pend = pendingImports(messages, imported, attemptedRef.current);
    for (const { filename, kind } of pend) {
      attemptedRef.current.add(filename); // 立即标记,后续 render 不重复入队
      chainRef.current = chainRef.current
        .then(() => importGeneratedAsset(filename, kind)) // 串行:下一条能看到上一条已落库的坐标
        .catch(() => {}); // 单条失败不阻断队列(PgcError 已在 action 内转 lastError)
    }
  }, [messages, pid, importedByProject, importGeneratedAsset]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/client/useCanvasAutoImport.test.tsx`
Expected: PASS

- [ ] **Step 5: 在 Workspace 挂载**

`src/components/workspace/Workspace.tsx`：在 import 区加 `import { useCanvasAutoImport } from '@/client/useCanvasAutoImport';`，并在组件体内 `useCanvasPolling();` 之后调用 `useCanvasAutoImport();`：

```tsx
export default function Workspace() {
  const client = useKoubouConnection();
  useProjectBootstrap();
  useCanvasPolling();
  useCanvasAutoImport();
  return (
```

- [ ] **Step 6: 全量回归 + 类型检查**

Run: `pnpm test`
Expected: 全绿。

Run: `pnpm lint`
Expected: 无错误（hook 的依赖数组已含 `messages, pid, importedByProject, importGeneratedAsset`）。

- [ ] **Step 7: 提交**

```bash
git add src/client/useCanvasAutoImport.ts src/client/useCanvasAutoImport.test.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: useCanvasAutoImport 串行驱动生成资产自动导入画布"
```

---

## 自查（计划 vs spec）

- **接口封装**（spec 6.3）→ Task 1 ✓
- **mapper 位置优先级 + sourceFilename**（spec 6.4）→ Task 2 ✓
- **泳道级联坐标**（spec 6.1）→ Task 3 ✓
- **kind 双向映射 + basename + 待导入筛选**（spec 6.2、6.6）→ Task 4 ✓
- **去重状态 + importGeneratedAsset + 持久化 + 错误处理**（spec 6.5、6.7、3）→ Task 5 ✓
- **历史预填**（spec 4、6.5）→ Task 6 ✓
- **自动触发 hook + 装配**（spec 6.6、2）→ Task 7 ✓
- **顺序处理保证级联**（spec 6.1、6.6）→ Task 7 串行 chain ✓

类型一致性核对：`importGeneratedAsset(filename: string, kind: AssetKind)`、`pendingImports(messages, imported: Set, inFlight: Set)`、`nextLanePosition(kind, sameKindXs)`、`collectReadyMedia(messages)`、`LANE_STEP/LANE_MARGIN`、`Asset.sourceFilename`、`ServerState.importedByProject` 在各 Task 间签名/字段名一致。

## 已知限制（spec 9，沿用）

- 同名重生成会被去重跳过（画布保留首次字节）。
- 失败的 import 本会话不重试，刷新/重连可重试。
- 未做泳道换行、手动撤销导入、导入进度指示。
