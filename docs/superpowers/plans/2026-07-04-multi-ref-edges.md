# 生成资产多引用连线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成弹窗提交时把多引用资产 id（RefPicker 多选 + 视频尾帧）记录到新资产上，画布为每条引用画一条与父子边同款的连线，并经 reference blob 持久化。

**Architecture:** `Asset` 新增 `refIds?: string[]`；`GenPlacement` 新增 `refItemIds` 由 GenerateForm 组装传入；生成占位卡与真实卡均落 `refIds`，经 `assetReference` 回写 `ref_item_ids` 持久化；`selectCanvasEdges` 派生引用边（同款 beam 样式）。

**Tech Stack:** TypeScript / zustand / @xyflow/react / Vitest（jsdom + globals，测试与源码同目录）。

## Global Constraints

- 设计稿：`docs/superpowers/specs/2026-07-04-multi-ref-edges-design.md`
- 注释 / commit message 一律中文；commit message 一句话总结变更。
- reducer / selector / map 均为纯函数、不可变更新。
- 位置与 refIds 归前端所有：轮询 / 重连结果不得覆盖已有值。
- 一键整理（`card-layout.ts`）仍只按 `parentId` 建树，本计划不改它。
- 跑测试命令：`pnpm exec vitest run <文件>`；类型检查 `pnpm exec tsc --noEmit`。

---

### Task 1: 数据模型 + 引用边派生（selectors）

**Files:**
- Modify: `src/store/types.ts:13`（`Asset` 加字段）
- Modify: `src/store/selectors.ts:18-23`（`selectCanvasEdges`）
- Test: `src/store/selectors.test.ts`

**Interfaces:**
- Produces: `Asset.refIds?: string[]`；`selectCanvasEdges(assets)` 对每个 asset 的 `refIds` 产出 `{ id: 'e-ref-{src}-{target}', source, target, animated: false }` 边（过滤：不在画布集合、自指、与 `parentId` 重复、refIds 内重复）。

- [ ] **Step 1: 写失败测试**

在 `src/store/selectors.test.ts` 追加（沿用文件内既有的 asset 构造方式；若无现成工厂，用下面的 `mk`）：

```ts
const mk = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, key: id, label: id, kind: 'image', source: 'generated',
  status: 'ready', position: { x: 0, y: 0 }, ...extra,
});

describe('selectCanvasEdges 引用边', () => {
  test('refIds 每个引用产出一条 e-ref 边,与父子边共存', () => {
    const assets = [mk('a'), mk('b'), mk('c', { parentId: 'a', refIds: ['b'] })];
    const edges = selectCanvasEdges(assets);
    expect(edges).toEqual([
      { id: 'e-a-c', source: 'a', target: 'c', animated: false },
      { id: 'e-ref-b-c', source: 'b', target: 'c', animated: false },
    ]);
  });

  test('过滤:引用不在画布 / 自指 / 与 parentId 重复 / refIds 内重复', () => {
    const assets = [mk('a'), mk('c', { parentId: 'a', refIds: ['a', 'c', 'gone', 'a'] })];
    expect(selectCanvasEdges(assets)).toEqual([
      { id: 'e-a-c', source: 'a', target: 'c', animated: false },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/selectors.test.ts`
Expected: FAIL（refIds 不在 Asset 类型上 / e-ref 边缺失）

- [ ] **Step 3: 最小实现**

`src/store/types.ts` 在 `parentId?: string;` 后加：

```ts
  refIds?: string[];         // 本次生成引用的其他画布资产 id(多引用连线,parentId 之外)
```

`src/store/selectors.ts` 替换 `selectCanvasEdges`：

```ts
export function selectCanvasEdges(assets: Asset[]): RFEdge[] {
  const ids = new Set(assets.map((a) => a.id));
  const edges: RFEdge[] = [];
  for (const a of assets) {
    if (a.parentId && ids.has(a.parentId)) {
      edges.push({ id: `e-${a.parentId}-${a.id}`, source: a.parentId, target: a.id, animated: false });
    }
    // 引用边:与父子边同款样式;过滤不在画布 / 自指 / 与父子边重边,Set 去重 refIds 内重复
    for (const r of new Set(a.refIds ?? [])) {
      if (!ids.has(r) || r === a.id || r === a.parentId) continue;
      edges.push({ id: `e-ref-${r}-${a.id}`, source: r, target: a.id, animated: false });
    }
  }
  return edges;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/selectors.test.ts`
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/selectors.ts src/store/selectors.test.ts
git commit -m "feat: Asset 增加 refIds,画布派生多引用连线"
```

---

### Task 2: reference blob 持久化（pgc/map）

**Files:**
- Modify: `src/lib/pgc/map.ts`（`CanvasReference` / `canvasItemToAsset` / `assetReference`）
- Test: `src/lib/pgc/map.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Asset.refIds`
- Produces: `CanvasReference.ref_item_ids?: string[]`；`canvasItemToAsset` 读回 `refIds`；`assetReference(a)` 在 `a.refIds` 非空时写出 `ref_item_ids`。

- [ ] **Step 1: 写失败测试**

在 `src/lib/pgc/map.test.ts` 追加（沿用文件内既有的 `CanvasItemData` 构造方式）：

```ts
test('reference.ref_item_ids 读写往返', () => {
  const it = {
    item_id: 'i1', type: 'image', status: 'ready', url: null, name: 'n',
    reference: { position: { x: 1, y: 2 }, ref_item_ids: ['r1', 'r2'] },
  } as unknown as CanvasItemData;
  const asset = canvasItemToAsset(it);
  expect(asset.refIds).toEqual(['r1', 'r2']);
  expect(assetReference(asset).ref_item_ids).toEqual(['r1', 'r2']);
});

test('无 refIds 时 reference 不带 ref_item_ids 键', () => {
  const asset = canvasItemToAsset({
    item_id: 'i2', type: 'image', status: 'ready', url: null, name: 'n', reference: {},
  } as unknown as CanvasItemData);
  expect(asset.refIds).toBeUndefined();
  expect('ref_item_ids' in assetReference(asset)).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/map.test.ts`
Expected: FAIL（refIds undefined / ref_item_ids 缺失）

- [ ] **Step 3: 最小实现**

`src/lib/pgc/map.ts`：

`CanvasReference` 接口加一行（`parent_id` 之后）：

```ts
  ref_item_ids?: string[];   // 多引用生成:引用资产 id 列表(前端连线 + 持久化)
```

`canvasItemToAsset` 返回对象加一行（`parentId: ref.parent_id,` 之后）：

```ts
    refIds: Array.isArray(ref.ref_item_ids) ? ref.ref_item_ids.filter((x): x is string => typeof x === 'string') : undefined,
```

`assetReference` 加一行（`if (a.parentId) ...` 之后）：

```ts
  if (a.refIds?.length) ref.ref_item_ids = a.refIds;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/map.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/map.ts src/lib/pgc/map.test.ts
git commit -m "feat: reference blob 持久化 ref_item_ids 多引用"
```

---

### Task 3: 生成链路落 refIds（store actions）

**Files:**
- Modify: `src/store/actions.ts`（`GenPlacement` / `placeAndLink` / `addGenPlaceholders` / `pollGenTasks` 保留处）
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 `Asset.refIds`、Task 2 `assetReference`（回写自动携带 `ref_item_ids`）
- Produces: `GenPlacement.refItemIds?: string[]`——`generateImage/Audio/Video/Model3d` 的 `opts` 均可携带；占位卡与真实卡都带 `refIds`；轮询替换保留已有 `refIds`。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 追加（沿用文件内既有的 store 初始化 / pgcApi mock 方式；下例以既有「同步图片生成」用例为模板改写）：

```ts
test('生成带 refItemIds:占位卡即带 refIds,真实卡替换后保留并回写 ref_item_ids', async () => {
  // 沿用文件内既有 mock:genImage 返回 1 个 item;updateCanvasReference 记录调用
  const p = store.getState().generateImage(
    { prompt: 'x' } as CanvasGenImageRequest,
    { refItemIds: ['r1', 'r2'] },
  );
  // 占位卡阶段:pending_ 卡已带 refIds(占位期即有连线)
  const pending = store.getState().assets.find((a) => a.id.startsWith('pending_'));
  expect(pending?.refIds).toEqual(['r1', 'r2']);
  await p;
  // 真实卡替换后保留 refIds
  const real = store.getState().assets.find((a) => !a.id.startsWith('pending_'));
  expect(real?.refIds).toEqual(['r1', 'r2']);
  // fire-and-forget 回写 reference 携带 ref_item_ids
  expect(mockUpdateCanvasReference).toHaveBeenCalledWith(
    expect.anything(), real!.id, expect.objectContaining({ ref_item_ids: ['r1', 'r2'] }),
  );
});

test('轮询替换不覆盖已有 refIds', () => {
  // 沿用既有 pollGenTasks 测试骨架:画布已有带 refIds 的 generating 卡,poll 返回的 item 无 ref_item_ids
  // 断言替换后 refIds 仍为原值(同 position/parentId 的"前端拥有"原则)
});
```

（第二个用例按文件内既有 `pollGenTasks` 测试的 mock 骨架补全为可执行代码——预置 `assets: [{ ...卡, refIds: ['r1'] }]` 与对应 `genTasks`，mock `genTaskStatus` 返回 ready item，断言 `refIds` 保留。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: FAIL（refIds undefined）

- [ ] **Step 3: 最小实现**

`src/store/actions.ts` 四处修改：

1. `GenPlacement`（约 line 19）：

```ts
export interface GenPlacement { sourceItemId?: string; spawnAt?: XY; refItemIds?: string[] }
```

2. `placeAndLink` 内 `linked`（约 line 255）：

```ts
      const linked = {
        ...(opts?.sourceItemId ? { parentId: opts.sourceItemId, source: 'derived' as const } : {}),
        ...(opts?.refItemIds?.length ? { refIds: opts.refItemIds } : {}),
      };
```

3. `addGenPlaceholders` 占位卡展开处（约 line 276），在 `...(opts?.sourceItemId ? ...)` 后加：

```ts
        ...(opts?.refItemIds?.length ? { refIds: opts.refItemIds } : {}),
```

4. `pollGenTasks` 轮询替换保留处（约 line 608-613），与 `parentId` 同处加一行：

```ts
              refIds: a.refIds ?? asset.refIds,
```

（回写持久化无需改动：`placeAndLink` / `adoptAgentItem` 已走 `assetReference`，Task 2 后自动携带 `ref_item_ids`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 生成链路落 refIds,占位卡与轮询替换保留多引用"
```

---

### Task 4: GenerateForm 提交组装 refItemIds

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx`（`submit` 内 `placement` 组装，约 line 199-210）
- Test: `src/components/canvas/GenerateForm.test.tsx`

**Interfaces:**
- Consumes: Task 3 `GenPlacement.refItemIds`
- Produces: 提交时 `placement.refItemIds = dedupe(refIds ∪ lastFrameId) − primarySourceId`，为空时不带该键。

- [ ] **Step 1: 写失败测试**

在 `src/components/canvas/GenerateForm.test.tsx` 追加（沿用文件内既有「image:图片源派生 → 源经 placement.sourceItemId 下发」用例的渲染 / 选参考 / 提交骨架）：

```ts
test('多选参考 + 尾帧 → 经 placement.refItemIds 下发(去重、排除源)', async () => {
  // 骨架同既有 placement 用例:预置画布资产,打开表单,经 RefPicker 勾选 r1/r2(视频再设尾帧 f1),输入 prompt 提交
  // 断言 generateXxx 第二参:
  expect(mockGenerate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ refItemIds: ['r1', 'r2'] }),
  );
});

test('无参考时 placement 不带 refItemIds', async () => {
  // 直接提交,断言第二参不含 refItemIds 键
  const placement = mockGenerate.mock.calls[0][1];
  expect('refItemIds' in placement).toBe(false);
});
```

（按文件内既有交互测试的查询方式补全勾选参考的操作步骤；若 RefPicker 交互在测试中难以驱动，允许 mock RefPicker 的 `onToggle` 回调路径——以既有用例的做法为准。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: FAIL（refItemIds 缺失）

- [ ] **Step 3: 最小实现**

`src/components/canvas/GenerateForm.tsx` 的 `submit` 内，`placement` 组装处改为：

```ts
    // 多引用连线:RefPicker 多选 ∪ 尾帧,去重且排除源(源走 parentId 父子边)
    const refItemIds = Array.from(new Set([...refIds, ...(lastFrameId ? [lastFrameId] : [])]))
      .filter((id) => id !== primarySourceId);
    const placement = {
      sourceItemId: primarySourceId,
      ...(refItemIds.length ? { refItemIds } : {}),
      spawnAt: (rect && screenToCanvas({ x: rect.left, y: rect.top })) || spawnAt,
    };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: PASS（含既有用例）

- [ ] **Step 5: 全量校验 + Commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 生成弹窗提交组装 refItemIds 多引用连线"
```
