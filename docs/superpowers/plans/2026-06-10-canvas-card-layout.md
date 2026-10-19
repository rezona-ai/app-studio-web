# 画布资产卡片排布规则改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除泳道 + d3-force 自动排布,改为「位置在创建那一刻确定」:双击点生成落点击位置、加号派生按树形落在父节点右侧、无坐标资产落视口中心,统一过重叠避让。

**Architecture:** 新增纯函数模块 `card-layout.ts` 承担全部落位计算,`viewport.ts` 向 actions 层暴露视口中心;生成 actions 第二参改为 `opts: { sourceItemId?, spawnAt? }`,落位与连线合并进 `placeAndLink`,沿用 `updateCanvasReference` 回写。位置归前端所有,轮询/服务端不得覆盖。最后删除 `zones.ts`/`force-layout.ts`/`Asset.pinned`/`d3-force`。

**Tech Stack:** Next.js 16 + React 19、@xyflow/react(React Flow)、Zustand、Vitest。

**设计文档:** `docs/superpowers/specs/2026-06-10-canvas-card-layout-design.md`

**约定:** 测试命令统一 `npx vitest run <file>`;每个 Task 结束提交一次,中文一句话 message。依赖安装一律带 `--legacy-peer-deps`。

---

### Task 1: 落位纯函数模块 card-layout.ts

**Files:**
- Create: `src/lib/card-layout.ts`
- Test: `src/lib/card-layout.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/card-layout.test.ts
import { describe, expect, test } from 'vitest';
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, CARD_W, CARD_H, GAP_X, GAP_Y, CASCADE_STEP } from './card-layout';

describe('childPosition 树形落位', () => {
  test('首个子节点:父右侧一卡宽+横距,y 与父对齐', () => {
    expect(childPosition({ x: 100, y: 200 }, [])).toEqual({ x: 100 + CARD_W + GAP_X, y: 200 });
  });
  test('已有兄弟:堆叠在最下方兄弟之下', () => {
    const sib = { x: 360, y: 200 };
    expect(childPosition({ x: 100, y: 200 }, [sib])).toEqual({ x: 360, y: 200 + CARD_H + GAP_Y });
  });
  test('多个兄弟:取 y 最大者向下堆叠', () => {
    const sibs = [{ x: 360, y: 500 }, { x: 360, y: 200 }];
    expect(childPosition({ x: 100, y: 200 }, sibs)).toEqual({ x: 360, y: 500 + CARD_H + GAP_Y });
  });
});

describe('spawnAtPoint 点击落位', () => {
  test('卡片中心对齐点击点(半宽半高偏移)', () => {
    expect(spawnAtPoint({ x: 500, y: 300 })).toEqual({ x: 500 - CARD_W / 2, y: 300 - CARD_H / 2 });
  });
});

describe('cascadePosition 级联落位', () => {
  test('第 i 个按固定步距对角错开', () => {
    expect(cascadePosition({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
    expect(cascadePosition({ x: 10, y: 20 }, 2)).toEqual({ x: 10 + 2 * CASCADE_STEP, y: 20 + 2 * CASCADE_STEP });
  });
});

describe('avoidOverlap 重叠避让', () => {
  test('无重叠:原样返回', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: CARD_W + GAP_X, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
  test('重叠:向下步进一格', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: CARD_H + GAP_Y });
  });
  test('连续重叠:继续向下直到空位', () => {
    const occupied = [{ x: 0, y: 0 }, { x: 0, y: CARD_H + GAP_Y }];
    expect(avoidOverlap({ x: 0, y: 0 }, occupied)).toEqual({ x: 0, y: 2 * (CARD_H + GAP_Y) });
  });
  test('达迭代上限:返回最后尝试位置(不死循环)', () => {
    const occupied = Array.from({ length: 60 }, (_, i) => ({ x: 0, y: i * (CARD_H + GAP_Y) }));
    const r = avoidOverlap({ x: 0, y: 0 }, occupied);
    expect(Number.isFinite(r.y)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/card-layout.test.ts`
Expected: FAIL,Cannot find module './card-layout'

- [ ] **Step 3: 最小实现**

```ts
// src/lib/card-layout.ts
// 画布卡片落位纯函数:位置只在创建那一刻计算一次,系统永不挪动已有卡片
export interface XY { x: number; y: number }

// 卡片估算尺寸与间距:NodeCard 宽 180;高度随类型不一,取偏大估值保证避让有效
export const CARD_W = 180;
export const CARD_H = 150;
export const GAP_X = 80;
export const GAP_Y = 40;
export const CASCADE_STEP = 40;
const MAX_AVOID_STEPS = 50;

// 树形落位:首个子节点在父右侧、y 与父对齐;后续堆叠在最下方兄弟之下
export function childPosition(parent: XY, siblings: XY[]): XY {
  const x = parent.x + CARD_W + GAP_X;
  if (siblings.length === 0) return { x, y: parent.y };
  return { x, y: Math.max(...siblings.map((s) => s.y)) + CARD_H + GAP_Y };
}

// 点击落位:卡片中心对齐点击的画布坐标
export function spawnAtPoint(point: XY): XY {
  return { x: Math.round(point.x - CARD_W / 2), y: Math.round(point.y - CARD_H / 2) };
}

// 兜底级联:从 origin 起第 i 个按固定步距对角错开
export function cascadePosition(origin: XY, index: number): XY {
  return { x: origin.x + index * CASCADE_STEP, y: origin.y + index * CASCADE_STEP };
}

// 重叠避让:目标与任一已有卡片(含间距余量)重叠时向下步进重试;超上限原样返回兜底
export function avoidOverlap(target: XY, occupied: XY[]): XY {
  let pos = target;
  for (let i = 0; i < MAX_AVOID_STEPS; i++) {
    const hit = occupied.some((o) => Math.abs(o.x - pos.x) < CARD_W + GAP_X && Math.abs(o.y - pos.y) < CARD_H + GAP_Y);
    if (!hit) return pos;
    pos = { x: pos.x, y: pos.y + CARD_H + GAP_Y };
  }
  return pos;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/card-layout.test.ts`
Expected: PASS(9 个用例)

- [ ] **Step 5: 提交**

```bash
git add src/lib/card-layout.ts src/lib/card-layout.test.ts
git commit -m "feat: 新增画布卡片落位纯函数模块 card-layout"
```

---

### Task 2: 资产类型元数据迁出 zones.ts

`ZONE_ORDER`/`ZONE_LABEL` 是类型元数据而非排布逻辑,迁到 `asset-kind.ts` 更名 `KIND_ORDER`/`KIND_LABEL`,为后续删除 zones.ts 解耦。

**Files:**
- Modify: `src/lib/asset-kind.ts`
- Modify: `src/lib/zones.ts:4-5`(删除两个导出,内部改用 KIND_ORDER)
- Modify: `src/store/index.ts:11,77`
- Modify: `src/components/canvas/KindLegend.tsx:3,12`
- Modify: `src/components/chat/MentionPopover.tsx:3,30`
- Modify: `src/lib/zones.test.ts:2`(改 import;该文件 Task 6 整体删除,此处仅保编译通过)

- [ ] **Step 1: asset-kind.ts 增加 KIND_ORDER/KIND_LABEL**

在 `KIND_META` 之后追加(注意:`lib/assets.ts` 内有同名私有常量 `KIND_LABEL` 用作新建默认英文名,职责不同、互不影响):

```ts
// 资产类型顺序与中文标签(原 zones.ts 的 ZONE_ORDER/ZONE_LABEL,与排布机制解耦后迁来)
export const KIND_ORDER: AssetKind[] = ['image', 'video', 'audio', '3d', 'doc'];
export const KIND_LABEL: Record<AssetKind, string> = { image: '图像', video: '视频', audio: '音频', '3d': '3D', doc: '文档' };
```

- [ ] **Step 2: zones.ts 删除两导出并改内部引用**

删除第 4-5 行 `ZONE_ORDER`/`ZONE_LABEL` 定义,顶部加 `import { KIND_ORDER } from '@/lib/asset-kind';`,`zoneFor` 与 `zonesMap` 中的 `ZONE_ORDER` 全部替换为 `KIND_ORDER`。

- [ ] **Step 3: 更新三个消费方 + zones.test.ts**

- `src/store/index.ts`:`import { ZONE_ORDER } from '@/lib/zones';` → `import { KIND_ORDER } from '@/lib/asset-kind';`;第 77 行 `visibleKinds: [...ZONE_ORDER]` → `[...KIND_ORDER]`
- `KindLegend.tsx`:`import { ZONE_ORDER } from '@/lib/zones';` → `import { KIND_ORDER } from '@/lib/asset-kind';`;第 12 行 `ZONE_ORDER.filter` → `KIND_ORDER.filter`
- `MentionPopover.tsx`:`import { ZONE_LABEL } from '@/lib/zones';` → `import { KIND_LABEL } from '@/lib/asset-kind';`;第 30 行 `ZONE_LABEL[...]` → `KIND_LABEL[...]`
- `zones.test.ts`:import 行去掉 `ZONE_ORDER`,改为 `import { KIND_ORDER } from '@/lib/asset-kind';`,用例内 `ZONE_ORDER` 替换为 `KIND_ORDER`

- [ ] **Step 4: 全量测试 + 编译检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 313 个用例 PASS,tsc 无错误

- [ ] **Step 5: 提交**

```bash
git add src/lib/asset-kind.ts src/lib/zones.ts src/lib/zones.test.ts src/store/index.ts src/components/canvas/KindLegend.tsx src/components/chat/MentionPopover.tsx
git commit -m "refactor: 资产类型元数据迁出 zones 至 asset-kind"
```

---

### Task 3: viewport.ts 视口中心注册

actions 层(非 React 环境)需要当前视口中心做兜底落位。

**Files:**
- Create: `src/lib/viewport.ts`
- Modify: `src/components/canvas/AssetCanvas.tsx`(Inner 注册)
- Test: `src/lib/viewport.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/viewport.test.ts
import { afterEach, expect, test } from 'vitest';
import { registerViewportCenter, getViewportCenter } from './viewport';

afterEach(() => registerViewportCenter(null));

test('未注册时返回 null', () => {
  expect(getViewportCenter()).toBeNull();
});

test('注册后返回换算结果;注销后恢复 null', () => {
  registerViewportCenter(() => ({ x: 12, y: 34 }));
  expect(getViewportCenter()).toEqual({ x: 12, y: 34 });
  registerViewportCenter(null);
  expect(getViewportCenter()).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/viewport.test.ts`
Expected: FAIL,Cannot find module './viewport'

- [ ] **Step 3: 实现 viewport.ts**

```ts
// src/lib/viewport.ts
// 画布视口中心注册:actions 层(非 React)做兜底落位时从这里取;AssetCanvas 挂载时注册、卸载时注销
import type { XY } from './card-layout';

let getCenter: (() => XY) | null = null;

export function registerViewportCenter(fn: (() => XY) | null) { getCenter = fn; }
export function getViewportCenter(): XY | null { return getCenter ? getCenter() : null; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/viewport.test.ts`
Expected: PASS(2 个用例)

- [ ] **Step 5: AssetCanvas Inner 注册**

`AssetCanvas.tsx`:
1. 顶部加 `import { registerViewportCenter } from '@/lib/viewport';`
2. `Inner` 内(`const addMenu = ...` 之后)取换算函数并加容器 ref + 注册 effect:

```tsx
const { screenToFlowPosition } = useReactFlow();
const wrapRef = useRef<HTMLDivElement>(null);

// 注册视口中心换算(容器屏幕中心 → 画布坐标),供 actions 层兜底落位
useEffect(() => {
  registerViewportCenter(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
  return () => registerViewportCenter(null);
}, [screenToFlowPosition]);
```

3. 根 div 挂 ref:`<div className="relative h-full bg-[var(--color-canvas)]" onDoubleClick={onPaneDoubleClick}>` → `<div ref={wrapRef} className=...>`

- [ ] **Step 6: 全量测试 + 编译检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/lib/viewport.ts src/lib/viewport.test.ts src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 新增画布视口中心注册模块供落位兜底"
```

---

### Task 4: 生成 actions 落位改造

核心任务:生成/上传/导入的落位与持久化全部走新规则;轮询不再覆盖本地坐标。

**Files:**
- Modify: `src/store/actions.ts`
- Modify: `src/components/canvas/GenerateForm.tsx:116-119`(call site 同步改签名,保编译)
- Test: `src/store/actions.test.ts`、`src/components/canvas/GenerateForm.test.tsx`

- [ ] **Step 1: 改写 actions.test.ts 中受影响用例(先红)**

1. 删除第 24 行 `import { LANE_STEP } from '@/lib/zones';`,顶部加:

```ts
import { CARD_W, CARD_H, GAP_X, GAP_Y } from '@/lib/card-layout';
```

2. 「generateImage 带 sourceItemId」用例(原 125 行):预置父资产,断言树形落位+连线。改为:

```ts
test('generateImage 带 sourceItemId:请求注入 source_item_id,新资产树形落位在父右侧并连线持久化', async () => {
  useStore.setState({ currentProjectId: 42, assets: [
    { id: 'src-1', key: 'src-1', label: 's', kind: 'image', source: 'generated', status: 'ready', position: { x: 100, y: 200 }, pinned: true },
  ] });
  api.genImage.mockResolvedValue({ items: [{ item_id: 'img-2', type: 'image', name: 'b', status: 'ready', url: null, reference: null }], total: 1 });
  api.updateCanvasReference.mockResolvedValue({});
  await useStore.getState().generateImage({ prompt: 'p' }, { sourceItemId: 'src-1' });
  expect(api.genImage).toHaveBeenCalledWith(42, { prompt: 'p', source_item_id: 'src-1' });
  const child = useStore.getState().assets.find((a) => a.id === 'img-2')!;
  expect(child.parentId).toBe('src-1');
  expect(child.source).toBe('derived');
  expect(child.position).toEqual({ x: 100 + CARD_W + GAP_X, y: 200 });
  expect(api.updateCanvasReference).toHaveBeenCalledWith(42, 'img-2', { parent_id: 'src-1', position: { x: 100 + CARD_W + GAP_X, y: 200 } });
});
```

3. 「generateAudio 带 sourceItemId」(原 147 行):调用改 `generateAudio(req, { sourceItemId: 'src-1' })`,断言方式同上(请求体不含 source_item_id 的断言保留)。
4. 「generateImage 无 sourceItemId」(原 137 行):调用 `generateImage(req)` 不变;补断言落位走视口兜底(测试环境未注册视口 → 原点级联):新资产 `position` 经避让后为不与已有资产重叠的坐标;若该用例 state 无既有资产则 `position` 为 `{ x: 0, y: 0 }`。
5. 新增 spawnAt 用例:

```ts
test('generateImage 带 spawnAt:卡片中心对齐点击点并回写位置', async () => {
  useStore.setState({ currentProjectId: 42, assets: [] });
  api.genImage.mockResolvedValue({ items: [{ item_id: 'img-9', type: 'image', name: 'b', status: 'ready', url: null, reference: null }], total: 1 });
  api.updateCanvasReference.mockResolvedValue({});
  await useStore.getState().generateImage({ prompt: 'p' }, { spawnAt: { x: 500, y: 300 } });
  const a = useStore.getState().assets.find((x) => x.id === 'img-9')!;
  expect(a.position).toEqual({ x: 500 - CARD_W / 2, y: 300 - CARD_H / 2 });
  expect(api.updateCanvasReference).toHaveBeenCalledWith(42, 'img-9', { position: { x: 500 - CARD_W / 2, y: 300 - CARD_H / 2 } });
});
```

6. pollGenTasks 区:「未 pin 的占位项转 ready 时采用服务端 reference.position」改为「轮询 ready 后保留本地坐标」——同样 setup,断言 `position` 等于本地原值而非服务端值;「已 pin 的项保留本地拖拽坐标」用例与新规则重复,删除。
7. importGeneratedAsset 区:「算泳道坐标传给 from-url」改为断言 `canvas_x/canvas_y` 为视口兜底坐标(未注册 → `{0,0}`,经避让);「同 kind 已有资产时向右级联坐标」(原 399 行,引用 LANE_STEP)改为避让断言:

```ts
test('已有资产占位时向下避让落位', async () => {
  useStore.setState({ currentProjectId: 42, importedByProject: {},
    assets: [{ id: 'x', key: 'x', label: 'x', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, pinned: true }] });
  api.writeCanvasItemFromUrl.mockResolvedValue({ item_id: 'n1', type: 'image', name: 'a.png', status: 'ready', url: null, reference: null });
  await useStore.getState().importGeneratedAsset('a.png', 'image', 'https://x/preview/a.png');
  expect(api.writeCanvasItemFromUrl.mock.calls[0][1].canvas_x).toBe(0);
  expect(api.writeCanvasItemFromUrl.mock.calls[0][1].canvas_y).toBe(CARD_H + GAP_Y);
});
```

8. 新增 uploadAsset 落位用例:mock `uploadCanvasItem` 返回 item,断言资产并入后 `position` 为兜底坐标且 `updateCanvasReference` 被调用回写位置。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/store/actions.test.ts`
Expected: FAIL(新签名/新落位断言未实现)

- [ ] **Step 3: 改写 actions.ts**

1. import 区:删 `import { nextLanePosition } from '@/lib/zones';`,加:

```ts
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, type XY } from '@/lib/card-layout';
import { getViewportCenter } from '@/lib/viewport';
```

2. 文件顶部(StoreSlice 类型旁)导出落位选项类型:

```ts
// 生成落位选项:sourceItemId=加号派生(树形落位+连线);spawnAt=双击点的画布坐标(点击落位)
export interface GenPlacement { sourceItemId?: string; spawnAt?: XY }
```

3. 删除 `linkParent`(130-136 行),替换为 `placeAndLink`:

```ts
// 创建落位 + 可选连线:派生→父节点右侧树形;点击→点击点;否则→视口中心级联;统一过重叠避让。
// 位置归前端所有,本地即时生效,fire-and-forget 回写 reference(失败不阻塞 UI)
const placeAndLink = (pid: number, fresh: Asset[], opts?: GenPlacement): Asset[] => {
  const existing = get().assets;
  const placed: Asset[] = [];
  for (const a of fresh) {
    const occupied = [...existing, ...placed].map((e) => e.position);
    const parent = opts?.sourceItemId ? existing.find((e) => e.id === opts.sourceItemId) : undefined;
    let target: XY;
    if (parent) {
      const siblings = [...existing.filter((e) => e.parentId === parent.id), ...placed].map((s) => s.position);
      target = childPosition(parent.position, siblings);
    } else if (opts?.spawnAt) {
      target = cascadePosition(spawnAtPoint(opts.spawnAt), placed.length);
    } else {
      target = cascadePosition(getViewportCenter() ?? { x: 0, y: 0 }, placed.length);
    }
    const linked = opts?.sourceItemId ? { parentId: opts.sourceItemId, source: 'derived' as const } : {};
    placed.push({ ...a, ...linked, position: avoidOverlap(target, occupied) });
  }
  for (const a of placed) void pgcApi.updateCanvasReference(pid, a.id, assetReference(a)).catch(() => {});
  return placed;
};
```

4. 四个生成 action 与 startAsyncGen 改签名(第二参 `opts?: GenPlacement`),body 注入与并入统一走 placeAndLink:

```ts
const generateImage = async (req: CanvasGenImageRequest, opts?: GenPlacement) => guard(set, async () => {
  const pid = get().currentProjectId; if (pid == null) return;
  const body = opts?.sourceItemId ? { ...req, source_item_id: opts.sourceItemId } : req;
  const data = await pgcApi.genImage(pid, body);
  set({ assets: [...get().assets, ...placeAndLink(pid, canvasItemsToAssets(data.items), opts)] });
});

// 音频同步生成(TTS):接口不支持 source_item_id,仅前端连线
const generateAudio = async (req: CanvasGenAudioRequest, opts?: GenPlacement) => guard(set, async () => {
  const pid = get().currentProjectId; if (pid == null) return;
  const item = await pgcApi.genAudio(pid, req);
  set({ assets: [...get().assets, ...placeAndLink(pid, [canvasItemToAsset(item)], opts)] });
});

const startAsyncGen = async (kind: 'video' | 'model3d', task: CanvasGenTask, pid: number, opts?: GenPlacement) => {
  if (!task.item) return;
  const [asset] = placeAndLink(pid, [canvasItemToAsset(task.item)], opts);
  set({ assets: [...get().assets, asset] });
  commitGenTasks([...get().genTasks, { itemId: task.item.item_id, kind, taskId: task.task_id, startedAt: Date.now(), fails: 0 } satisfies GenTask]);
};

const generateVideo = async (req: CanvasGenVideoRequest, opts?: GenPlacement) => guard(set, async () => {
  const pid = get().currentProjectId; if (pid == null) return;
  const body = opts?.sourceItemId ? { ...req, source_item_id: opts.sourceItemId } : req;
  const task = await pgcApi.genVideo(pid, body);
  await startAsyncGen('video', task, pid, opts);
});

const generateModel3d = async (req: CanvasGenModel3DRequest, opts?: GenPlacement) => guard(set, async () => {
  const pid = get().currentProjectId; if (pid == null) return;
  const body = opts?.sourceItemId ? { ...req, source_item_id: opts.sourceItemId } : req;
  const task = await pgcApi.genModel3d(pid, body);
  await startAsyncGen('model3d', task, pid, opts);
});
```

5. uploadAsset 走兜底落位 + 回写:

```ts
const uploadAsset = async (file: File) => guard(set, async () => {
  const pid = get().currentProjectId; if (pid == null) return;
  const item = await uploadCanvasItem(pid, file);
  set({ assets: [...get().assets, ...placeAndLink(pid, [canvasItemToAsset(item)])] });
});
```

6. importGeneratedAsset:替换泳道坐标两行(原 200-201 行)为:

```ts
const occupied = get().assets.map((a) => a.position);
const { x, y } = avoidOverlap(getViewportCenter() ?? { x: 0, y: 0 }, occupied);
```

(`sameKindXs` 变量删除;body 的 `canvas_x: x, canvas_y: y` 不变)

7. pollGenTasks 合并(原 240-246 行):位置改为始终保留本地:

```ts
// 位置归前端所有:创建时已落位,轮询结果不得覆盖(规避回写未完成被服务端旧坐标冲掉的竞态)
set({ assets: get().assets.map((a) => (a.id === t.itemId
  ? { ...a, ...asset,
      position: a.position,
      pinned: a.pinned,
      parentId: a.parentId ?? asset.parentId,
      source: a.parentId ? 'derived' : asset.source }
  : a)) });
```

(`pinned: a.pinned` 为过渡保留,Task 7 删字段时一并去掉)

- [ ] **Step 4: GenerateForm call site 同步改签名**

`GenerateForm.tsx` 116-119 行:

```ts
const placement = { sourceItemId: sourceId };
if (kind === 'image') await generateImage(body as CanvasGenImageRequest, placement);
else if (kind === 'audio') await generateAudio(body as CanvasGenAudioRequest, placement);
else if (kind === 'video') await generateVideo(body as CanvasGenVideoRequest, placement);
else await generateModel3d(body as CanvasGenModel3DRequest, placement);
```

`GenerateForm.test.tsx`:四处 `toHaveBeenCalledWith(..., undefined)` 改为 `toHaveBeenCalledWith(..., { sourceItemId: undefined })`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/store/actions.test.ts src/components/canvas/GenerateForm.test.tsx && npx tsc --noEmit`
Expected: 全部 PASS,tsc 无错误

- [ ] **Step 6: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 生成/上传/导入落位改为树形+点击+视口兜底规则"
```

---

### Task 5: spawnAt 点击坐标透传链路

双击空白处 → 菜单 → 生成弹窗 → action,把点击的画布坐标一路传下去。

**Files:**
- Modify: `src/store/index.ts:19-21`(AddMenuState/GenFormState 加 spawnAt)
- Modify: `src/components/canvas/AssetCanvas.tsx:202-206,249-251`
- Modify: `src/components/canvas/AddAssetMenu.tsx`
- Modify: `src/components/canvas/GenerateFormHost.tsx`
- Modify: `src/components/canvas/GenerateForm.tsx`
- Test: `src/components/canvas/GenerateForm.test.tsx`

- [ ] **Step 1: store 状态类型加 spawnAt**

```ts
// 新增资产菜单的打开态:双击空白处(带 spawnAt 画布坐标)或卡片「+」(带 sourceId)触发
export interface AddMenuState { x: number; y: number; sourceId?: string; spawnAt?: { x: number; y: number } }
// 生成弹窗的全局打开态:sourceId=引用生成源资产;spawnAt=双击点的画布坐标
export interface GenFormState { kind: 'image' | 'video' | 'audio' | '3d'; sourceId?: string; spawnAt?: { x: number; y: number } }
```

- [ ] **Step 2: AssetCanvas 双击换算画布坐标**

`onPaneDoubleClick`(Inner 已有 `screenToFlowPosition`,Task 3 引入):

```ts
// 双击空白 pane → 在光标处打开新增资产菜单,并记录点击点的画布坐标供落位
const onPaneDoubleClick = (e: React.MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('react-flow__pane')) return;
  openAddMenu({ x: e.clientX, y: e.clientY, spawnAt: screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
};
```

渲染处透传:`<AddAssetMenu x={addMenu.x} y={addMenu.y} sourceId={addMenu.sourceId} spawnAt={addMenu.spawnAt} onClose={closeAddMenu} />`

- [ ] **Step 3: AddAssetMenu / GenerateFormHost / GenerateForm 透传**

- `AddAssetMenu` props 加 `spawnAt?: { x: number; y: number }`,`openGen` 改 `openGenForm({ kind, sourceId, spawnAt });`
- `GenerateFormHost`:`<GenerateForm kind={genForm.kind} sourceId={genForm.sourceId} spawnAt={genForm.spawnAt} onClose={closeGenForm} />`
- `GenerateForm` props 加 `spawnAt?: { x: number; y: number }`,Task 4 的 `placement` 改为:

```ts
const placement = { sourceItemId: sourceId, spawnAt };
```

- [ ] **Step 4: 更新 GenerateForm.test.tsx 断言**

四处 `{ sourceItemId: undefined }` → `{ sourceItemId: undefined, spawnAt: undefined }`。

- [ ] **Step 5: 跑测试 + 编译检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/store/index.ts src/components/canvas/AssetCanvas.tsx src/components/canvas/AddAssetMenu.tsx src/components/canvas/GenerateFormHost.tsx src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 双击点击坐标透传至生成落位"
```

---

### Task 6: 删除力导向与泳道机制

此时已无业务代码依赖泳道坐标(Task 4)与类型元数据(Task 2),可安全删除。

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(删力导向 effect 与相关 import)
- Modify: `src/store/index.ts`(删 setAssetPositions)
- Delete: `src/lib/force-layout.ts`、`src/lib/force-layout.test.ts`、`src/lib/zones.ts`、`src/lib/zones.test.ts`
- Modify: `package.json`(删 d3-force)

- [ ] **Step 1: AssetCanvas 删除力导向**

1. 删 import:`runForceLayout, type LayoutNode`(18 行)、`zonesMap`(19 行)
2. 删 `seenIdsRef`(136 行)与力导向 useEffect(159-179 行)
3. 删 `const setAssetPositions = useStore((s) => s.setAssetPositions);`(126 行)

- [ ] **Step 2: store 删除 setAssetPositions**

`src/store/index.ts`:删 Actions 接口中 `setAssetPositions` 声明(42 行)与实现(123-127 行)。先 grep 确认无其他调用方:

Run: `grep -rn "setAssetPositions" src --include="*.ts" --include="*.tsx"`
Expected: 无输出(AssetCanvas 已删)

- [ ] **Step 3: 删文件与依赖**

```bash
git rm src/lib/force-layout.ts src/lib/force-layout.test.ts src/lib/zones.ts src/lib/zones.test.ts
npm uninstall d3-force @types/d3-force --legacy-peer-deps
```

- [ ] **Step 4: 确认无残留引用 + 全量测试**

Run: `grep -rn "force-layout\|lib/zones\|d3-force" src package.json`
Expected: 无输出

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: 删除泳道与 d3-force 力导向排布机制"
```

---

### Task 7: 移除 Asset.pinned + 历史资产兜底落位

pinned 唯一作用是保护卡片不被力导向重排,机制已删,字段失去意义。顺带在 mapper 给无坐标历史资产做原点级联兜底。

**Files:**
- Modify: `src/store/types.ts:15`、`src/store/index.ts:41,121-122`、`src/lib/assets.ts`、`src/lib/pgc/map.ts`、`src/store/actions.ts`(pollGenTasks 过渡行)、`src/components/canvas/AssetCanvas.tsx`(onNodeDragStop)
- Test: `src/lib/pgc/map.test.ts`、`src/lib/assets.test.ts`、`src/store/add-asset.test.ts`、`src/store/selectors.test.ts`、`src/store/actions.test.ts`

- [ ] **Step 1: 先改 map.test.ts(先红)**

1. 删除所有 `expect(a.pinned)...` 断言与 fixture 中 `pinned` 字段。
2. 「都没有时回落 (0,0) 且未 pinned」改为兜底级联用例:

```ts
import { CASCADE_STEP } from '@/lib/card-layout';

test('无任何坐标的历史资产:按列表序原点级联兜底,已有坐标者不受影响', () => {
  const items = [
    { item_id: 'a', type: 'image', name: 'a', status: 'ready', url: null, reference: null },
    { item_id: 'b', type: 'image', name: 'b', status: 'ready', url: null, reference: { position: { x: 9, y: 9 } } },
    { item_id: 'c', type: 'image', name: 'c', status: 'ready', url: null, reference: null },
  ] as CanvasItemData[];
  const [a, b, c] = canvasItemsToAssets(items);
  expect(a.position).toEqual({ x: 0, y: 0 });
  expect(b.position).toEqual({ x: 9, y: 9 });
  expect(c.position).toEqual({ x: CASCADE_STEP, y: CASCADE_STEP });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/pgc/map.test.ts`
Expected: FAIL

- [ ] **Step 3: 改 map.ts**

1. `canvasItemToAsset` 删 `pinned: hasRefPos || hasXY,` 行(`hasRefPos`/`hasXY` 改内联进 position 计算或保留供 `canvasItemsToAssets` 判断)。
2. `canvasItemsToAssets` 加兜底级联:

```ts
import { cascadePosition } from '@/lib/card-layout';

export function canvasItemsToAssets(items: CanvasItemData[]): Asset[] {
  // 无任何坐标的历史资产:按列表序在原点附近确定性级联,加载后由 fitView 保证可见;不回写服务端
  let fallbackIdx = 0;
  return items.map((it) => {
    const a = canvasItemToAsset(it);
    const ref = (it.reference ?? {}) as CanvasReference;
    const hasPos = !!ref.position || (it.canvas_x != null && it.canvas_y != null);
    return hasPos ? a : { ...a, position: cascadePosition({ x: 0, y: 0 }, fallbackIdx++) };
  });
}
```

- [ ] **Step 4: 全代码移除 pinned**

1. `src/store/types.ts`:删 `pinned: boolean;`(15 行)
2. `src/store/index.ts`:`setAssetPosition: (id, x, y)`(声明与实现都去掉 pinned 参数)
3. `src/lib/assets.ts`:删 `pinned: true,`,工厂注释改为「本地新增资产工厂:id=key」
4. `src/store/actions.ts`:pollGenTasks 删 `pinned: a.pinned,` 过渡行
5. `src/components/canvas/AssetCanvas.tsx`:`onNodeDragStop` 中 `setAssetPosition(node.id, node.position.x, node.position.y, true)` 去掉 `true`
6. 测试 fixture 清理:`assets.test.ts`(删 pinned 断言)、`add-asset.test.ts`(「追加一个指定类型的 pinned 资产」改名「追加一个指定类型的资产」,删 pinned 断言)、`selectors.test.ts`(fixture 删 `pinned: false`)、`actions.test.ts`(所有 fixture 删 `pinned` 字段)

- [ ] **Step 5: 确认无残留 + 全量测试**

Run: `grep -rn "pinned" src`
Expected: 无输出

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor: 移除 pinned 字段并为无坐标历史资产加级联兜底"
```

---

### Task 8: 最终验证

- [ ] **Step 1: 全量测试 / lint / 构建**

Run: `npx vitest run && npm run lint && npm run build`
Expected: 测试全 PASS、lint 无错误、构建成功

- [ ] **Step 2: 对照设计文档逐项核对**

核对 `docs/superpowers/specs/2026-06-10-canvas-card-layout-design.md` 的「目标」四条与「设计」八节均有对应实现;`grep -rn "force-layout\|nextLanePosition\|pinned" src` 无残留。

- [ ] **Step 3: 手工冒烟(可选,需后端)**

`npm run dev` 后验证:双击空白处生成 → 卡片落点击位置;选中卡片点「+」派生 → 新卡片出现在右侧且有连线;再派生一个 → 堆叠在第一个子卡下方;拖动卡片刷新后位置保留。

- [ ] **Step 4: 提交收尾(如有遗漏文件)**

```bash
git status --short   # 应为空;有遗漏则补提交
```
