# 资产派生约束 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布资产卡片「+号」派生按源资产类型限制可生成的目标类型，并把源资产喂到后端接口正确的入参字段。

**Architecture:** 新增一个纯函数 `derivableKinds(source)` 作为「源类型→可派生目标类型」的唯一真相源，由 `AddAssetMenu`（过滤菜单项）和 `NodeCard`（无可派生项则不浮出 +号）共用；`GenerateForm` 依据「`source_item_id` 恒为图片」的事实，把图片源走 `source_item_id`、视频源改预选为多选参考（经 `ref_video_item_ids` 下发）。`buildGenBody` 与 store actions 不改。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / zustand / @xyflow/react / Vitest + @testing-library/react（jsdom）。

## Global Constraints

- 代码注释 / commit message 一律用**中文**；commit 一句话总结变更。
- 测试与源码**同目录**（`*.test.ts(x)`）；Vitest 用 jsdom + globals，i18n 在测试环境解析为**英文**。
- 颜色 / 动效 / 图标走既有令牌与基础组件，不引入硬编码；本计划**不新增任何 UI 文案 / i18n key**。
- 不臆测后端字段、不改后端契约；不改 `buildGenBody`、不改 `src/store/actions.ts` 的生成注入逻辑。
- 派生矩阵（依据 apifox PGC 文档，逐字）：`image → [image, video, 3d]`；`video → [video]`；`audio / 3d / doc → []`。

---

### Task 1: `derivableKinds` 派生矩阵纯函数

**Files:**
- Modify: `src/components/canvas/gen-params.ts`（在 `REF_LIMITS` 定义后新增）
- Test: `src/components/canvas/gen-params.test.ts`

**Interfaces:**
- Consumes: 现有 `GenKind`（`Extract<AssetKind,'image'|'video'|'audio'|'3d'>`）与 `import type { AssetKind } from '@/lib/asset-kind'`（文件首行已导入）。
- Produces: `export const derivableKinds = (source: AssetKind): GenKind[]` —— 返回该源类型可派生的目标生成类型数组（Task 2、Task 3 消费）。

- [ ] **Step 1: 写失败测试**

在 `src/components/canvas/gen-params.test.ts` 顶部 import 行加入 `derivableKinds`：

```ts
import { buildGenBody, derivableKinds, GEN_FIELDS, REF_LIMITS, type RefSelection } from './gen-params';
```

在文件末尾追加：

```ts
// ---- 派生矩阵(严格派生:仅源能作为输入喂给目标接口) ----
test('derivableKinds:图片源可派生 图片/视频/3D', () => {
  expect(derivableKinds('image')).toEqual(['image', 'video', '3d']);
});

test('derivableKinds:视频源仅可派生 视频', () => {
  expect(derivableKinds('video')).toEqual(['video']);
});

test('derivableKinds:音频/3D/文档源无可派生类型', () => {
  expect(derivableKinds('audio')).toEqual([]);
  expect(derivableKinds('3d')).toEqual([]);
  expect(derivableKinds('doc')).toEqual([]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/gen-params.test.ts`
Expected: FAIL —— `derivableKinds is not a function` / 导入不存在。

- [ ] **Step 3: 实现最小代码**

在 `src/components/canvas/gen-params.ts` 的 `REF_LIMITS`（`export const REF_LIMITS = {...} as const;`）那行之后新增：

```ts
// 按源资产类型可派生的目标生成类型(严格派生:仅当源能作为输入喂给目标接口)。
// 依据 apifox:source_item_id 三处语义统一=图片;视频仅经 ref_video_item_ids;
// 音频/3D/文档不被任何生成接口接受为输入。
const DERIVE_MATRIX: Record<AssetKind, GenKind[]> = {
  image: ['image', 'video', '3d'],
  video: ['video'],
  audio: [],
  '3d': [],
  doc: [],
};
export const derivableKinds = (source: AssetKind): GenKind[] => DERIVE_MATRIX[source];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/gen-params.test.ts`
Expected: PASS（含原有全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/canvas/gen-params.ts src/components/canvas/gen-params.test.ts
git commit -m "feat: 新增 derivableKinds 派生矩阵纯函数(源类型→可派生目标类型)"
```

---

### Task 2: `AddAssetMenu` 派生模式按源类型过滤

**Files:**
- Modify: `src/components/canvas/AddAssetMenu.tsx`
- Test: `src/components/canvas/AddAssetMenu.test.tsx`

**Interfaces:**
- Consumes: `derivableKinds`（Task 1）；store 的 `assets`（`useStore((s) => s.assets)`）。
- Produces: 无新导出；行为变更——有 `sourceId` 时菜单生成项按源 kind 过滤，无 `sourceId` 时维持全部 4 项 + 上传组。

- [ ] **Step 1: 写失败测试**

在 `src/components/canvas/AddAssetMenu.test.tsx` 调整 import（加 `screen` 与 `Asset` 类型）：

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import AddAssetMenu from './AddAssetMenu';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState, type Asset } from '@/store/types';
```

在 `beforeEach` 之后、`describe` 之前加一个 asset 工厂：

```ts
const asset = (a: Partial<Asset>): Asset => ({
  id: 'a1', key: 'k1', label: 'A', kind: 'image', source: 'generated',
  status: 'ready', position: { x: 0, y: 0 }, ...a,
});
```

在 `describe('AddAssetMenu', () => {` 内追加三条用例：

```ts
  // 派生模式(有 sourceId):按源资产 kind 过滤可生成类型
  test('派生模式:图片源提供 Image/Video/3D,不含 Audio', () => {
    useStore.setState({ assets: [asset({ id: 'img-1', kind: 'image' })] } as never);
    render(<AddAssetMenu x={10} y={10} sourceId="img-1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3D' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Audio' })).toBeNull();
  });

  test('派生模式:视频源仅提供 Video', () => {
    useStore.setState({ assets: [asset({ id: 'vid-1', kind: 'video' })] } as never);
    render(<AddAssetMenu x={10} y={10} sourceId="vid-1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Audio' })).toBeNull();
    expect(screen.queryByRole('button', { name: '3D' })).toBeNull();
  });

  test('无源(画布新建):提供全部 4 种', () => {
    render(<AddAssetMenu x={10} y={10} onClose={vi.fn()} />);
    for (const name of ['Image', 'Video', 'Audio', '3D']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/AddAssetMenu.test.tsx`
Expected: FAIL —— 视频源用例里 `Image`/`Audio`/`3D` 仍可查到（现状不过滤）。

- [ ] **Step 3: 实现最小代码**

在 `src/components/canvas/AddAssetMenu.tsx`：

import 区加入 `derivableKinds`（与既有 `'./gen-params'` 无导入则新增一行）：

```ts
import { derivableKinds } from './gen-params';
```

组件内，在 `const openGenForm = useStore((s) => s.openGenForm);` 之后新增读取 assets：

```ts
  const assets = useStore((s) => s.assets);
  // 派生模式(有 sourceId)按源资产类型过滤可生成类型;无源(画布新建)不限制
  const sourceKind = sourceId ? assets.find((a) => a.id === sourceId)?.kind : undefined;
  const items = sourceKind ? ITEMS.filter((it) => derivableKinds(sourceKind).includes(it.kind)) : ITEMS;
```

把渲染里的 `{ITEMS.map(({ kind, icon }) => (` 改为 `{items.map(({ kind, icon }) => (`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/AddAssetMenu.test.tsx`
Expected: PASS（含原有 3 条用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/canvas/AddAssetMenu.tsx src/components/canvas/AddAssetMenu.test.tsx
git commit -m "feat: 派生菜单按源资产类型过滤可生成类型(无源新建仍全开)"
```

---

### Task 3: `NodeCard` 无可派生项不浮出 +号

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`

**Interfaces:**
- Consumes: `derivableKinds`（Task 1）；组件已有 `kind: AssetKind` prop。
- Produces: 行为变更——仅当 `derivableKinds(kind).length > 0` 时才在选中态浮出「+号」按钮。

**测试说明:** 仓库内画布节点组件无单测先例（节点依赖 `@xyflow/react` 的 ReactFlow context，单测需额外 Provider 脚手架，与现有约定不符）。本改动是「已被 Task 1 单测覆盖的纯函数」上的一行布尔守卫，故不新增节点单测，正确性由 `derivableKinds` 单测 + Task 5 的 tsc/lint/全量回归保证。

- [ ] **Step 1: 实现守卫**

在 `src/components/canvas/nodes/NodeCard.tsx`：

import 区新增（NodeCard 在 `nodes/` 子目录，gen-params 在上一级）：

```ts
import { derivableKinds } from '../gen-params';
```

把渲染末尾的 `{selected && (` 那段「+号」按钮的条件改为：

```tsx
      {selected && derivableKinds(kind).length > 0 && (
        <Tooltip transparent>
```

（其余 JSX 不变。）

- [ ] **Step 2: 类型检查 + 全量测试无回归**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS（无类型错误，既有测试全绿）。

- [ ] **Step 3: 提交**

```bash
git add src/components/canvas/nodes/NodeCard.tsx
git commit -m "feat: 无可派生类型的资产卡片(音频/3D/文档)选中时不再浮出 +号"
```

---

### Task 4: `GenerateForm` 按源类型把源喂到正确入参

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx`
- Test: `src/components/canvas/GenerateForm.test.tsx`

**Interfaces:**
- Consumes: 现有 `generateImage`/`generateVideo` action（测试已 mock）；`buildGenBody` 现有 video omni 分支（`ref_video_item_ids`）。
- Produces: 行为变更——`source_item_id` 仅用于图片源；视频源派生视频时源被预选为多选参考，经 `ref_video_item_ids` 下发，`placement.sourceItemId` 为 `undefined`。

- [ ] **Step 1: 写失败测试**

在 `src/components/canvas/GenerateForm.test.tsx` 末尾追加两条用例：

```ts
test('video:视频源派生 → 源视频预选为参考,提交进 ref_video_item_ids 且无 source_item_id', async () => {
  useStore.setState({ assets: [asset({ id: 'vid-1', kind: 'video', label: '视频A', key: 'kv' })] } as never);
  render(<GenerateForm kind="video" sourceId="vid-1" onClose={() => {}} />);
  // 源是视频 → 非首帧模式,提供多选参考入口
  expect(screen.getByRole('button', { name: 'Add reference' })).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/Describe the video/), { target: { value: '运镜' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genVideo).toHaveBeenCalled());
  expect(genVideo).toHaveBeenCalledWith(
    { prompt: '运镜', ref_video_item_ids: ['vid-1'] },
    { sourceItemId: undefined, spawnAt: undefined },
  );
});

test('image:图片源派生 → 源经 placement.sourceItemId 下发(source_item_id)', async () => {
  useStore.setState({ assets: [asset({ id: 'img-1', kind: 'image' })] } as never);
  render(<GenerateForm kind="image" sourceId="img-1" onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Describe the image/), { target: { value: '主角立绘' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genImage).toHaveBeenCalled());
  expect(genImage).toHaveBeenCalledWith(
    { prompt: '主角立绘' },
    { sourceItemId: 'img-1', spawnAt: undefined },
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: FAIL —— 视频源用例现状把 `vid-1` 当首帧塞进 `placement.sourceItemId`、且不显示「Add reference」，断言不符。

- [ ] **Step 3: 实现源类型路由**

在 `src/components/canvas/GenerateForm.tsx`：

(a) 在 `const source = sourceId ? assets.find((a) => a.id === sourceId) : undefined;` 之后新增：

```ts
  // source_item_id 恒为图片(图生图/视频首帧/图生3D):仅图片源走该入参;
  // 非图片源(视频→视频)改预选进多选参考,经 ref_video_item_ids 下发(见 buildGenBody video omni 分支)
  const primarySourceId = source?.kind === 'image' ? sourceId : undefined;
  const primarySource = primarySourceId ? source : undefined;
```

(b) 把 `refIds` 的初始化改为「非图片源预选源资产」：

```ts
  const [refIds, setRefIds] = useState<string[]>(
    () => (sourceId && source && source.kind !== 'image' ? [sourceId] : []),
  );
```

(c) 以下各处把 `sourceId` 改为 `primarySourceId`（语义=「源作为 source_item_id」）：

- `const refSel: RefSelection = { sourceId: primarySourceId, refs: ..., lastFrameId };`
- `const canMultiRef = kind === 'image' || (kind === 'video' && !primarySourceId);`
- `refLimits` 的 image 分支：`{ image: REF_LIMITS.image - (primarySourceId ? 1 : 0) }`
- `const placement = { sourceItemId: primarySourceId, spawnAt };`
- 引用行外层条件 `{(source || canMultiRef) && (` → `{(primarySource || canMultiRef) && (`
- 只读源 chip `{source && <RefChip a={source} />}` → `{primarySource && <RefChip a={primarySource} />}`
- 多选 `RefPicker` 的 `exclude={sourceId ? [sourceId] : undefined}` → `exclude={primarySourceId ? [primarySourceId] : undefined}`
- 视频尾帧 `extra` 的条件 `kind === 'video' && sourceId ? (` → `kind === 'video' && primarySourceId ? (`
- 该尾帧块内 `RefPicker` 的 `exclude={sourceId ? [sourceId] : undefined}` → `exclude={primarySourceId ? [primarySourceId] : undefined}`

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: PASS（含原有全部用例——其中「video 首尾帧模式(有 sourceId)不显示多选参考」用的是 `src-1` 为图片资产，`primarySourceId` 仍等于 `sourceId`，行为不变）。

- [ ] **Step 5: 提交**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 派生表单按源类型路由(图片源走 source_item_id,视频源转 ref_video_item_ids)"
```

---

### Task 5: 全量验证（对齐 CI）

**Files:** 无（仅运行检查）。

- [ ] **Step 1: lint**

Run: `pnpm lint`
Expected: 无 error。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 全量测试**

Run: `pnpm test`
Expected: 全绿（含 gen-params / AddAssetMenu / GenerateForm 新增用例）。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 5: 收尾**

无新增改动则无需提交。进入 `superpowers:finishing-a-development-branch` 决定合并/PR。

---

## Self-Review

**Spec coverage（逐条对照设计稿）:**
- 约束依据矩阵 → Global Constraints + Task 1 的 `DERIVE_MATRIX`（逐字一致）。✅
- §1 `derivableKinds` 纯函数 → Task 1。✅
- §2 NodeCard 隐藏 +号 → Task 3。✅
- §3 AddAssetMenu 派生模式过滤 / 无源不限制 → Task 2。✅
- §4 GenerateForm `primarySourceId` 路由 + 视频源预选 ref → Task 4。✅
- §5 错误处理（不新增错误路径）→ 不改 guard/actions，无对应任务（符合预期）。✅
- 测试三处（gen-params / AddAssetMenu / GenerateForm）→ Task 1 / 2 / 4。✅

**Placeholder scan:** 无 TBD/TODO；每个改码步骤均含完整代码或逐行改动清单。✅

**Type consistency:** `derivableKinds(source: AssetKind): GenKind[]` 在 Task 1 定义，Task 2 以 `derivableKinds(sourceKind).includes(it.kind)`、Task 3 以 `derivableKinds(kind).length > 0` 调用，签名一致；`primarySourceId`/`primarySource` 在 Task 4 内自洽。✅
