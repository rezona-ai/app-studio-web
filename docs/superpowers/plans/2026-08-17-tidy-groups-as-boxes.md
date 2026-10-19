# 分组框作为整体参与一键整理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分组框以「固定尺寸的原子盒子」参与一键整理——框排队、框内不动、跨框引用边提升到框，同时退掉类型分带与障碍避让。

**Architecture:** 布局引擎（`tidyLayout`）**不加新概念**：框被合成为一个普通 `TidyNode`（`position` 取框左上角、`width/height` 取框 w/h、入边取全体成员提升后的并集）。新增两个纯函数层——`lib/tidy-input.ts` 负责「资产 + 框 → TidyNode[]」（含边提升），`lib/tidy-canvas.ts` 负责「布局结果 → 新的 assets/groups + 回写集合 + 撤销 payload」。store 的 `tidyCanvas` 退化成接线：算 outcome → 一次 `set` → 两条回写。按「并存加新（任务 1–4）→ 原子切换（任务 5）→ 删旧（任务 6）」推进。

**Tech Stack:** TypeScript · zustand（`src/store`）· `@xyflow/react`（只读节点尺寸）· Vitest + jsdom（测试与源码同目录）

**Spec:** `docs/superpowers/specs/2026-08-17-tidy-groups-as-boxes-design.md`

## Global Constraints

- **位置归前端所有**：轮询 / 重连 / 服务端旧坐标不得覆盖已落位的 `position`；框几何同一口径。
- **框内不动、框尺寸只读**：整理不改任何框的 `w/h`，不改成员相对框的偏移。
- `tidyLayout` 与新增两个模块必须是**同步纯函数**，不 import store / IO，零新依赖。
- 一次 ⌘Z 回退卡坐标 + 框坐标 + 视口（同一条 `positions` 撤销条目）。
- 卡坐标回写走 `pgcApi.batchUpdateCanvasItems`；框坐标逐个 `pgcApi.updateCanvasGroup`，只带 `canvas_x`/`canvas_y`，坐标 `Math.round`（后端 int 契约），fire-and-forget。
- 占位卡（`isPlaceholderId`，`pending_` 前缀）参与布局但**不回写**。
- 注释 / 提交信息用中文；`eslint-disable` 必带 `-- 理由`。
- 每个任务结束时 `pnpm exec vitest run <本任务测试文件>` 全绿再提交；任务 7 跑完整链。

---

### Task 1: `lib/tidy-input.ts` —— 资产 + 框 → 布局输入（边提升）

**Files:**
- Create: `src/lib/tidy-input.ts`
- Test: `src/lib/tidy-input.test.ts`
- Read for context: `src/lib/card-layout.ts:112-118`（`TidyNode` 定义）、`src/lib/canvas-group.ts`（框语义）

**Interfaces:**
- Consumes: `TidyNode`（`src/lib/card-layout.ts` 已有导出）、`Asset` / `Group`（`@/store/types`）
- Produces: `buildTidyNodes(assets, groups, sizeById?) => TidyNode[]`，任务 2 调用它

- [ ] **Step 1: 写失败测试** —— `src/lib/tidy-input.test.ts`

```ts
import { describe, expect, test } from 'vitest';
import { buildTidyNodes } from './tidy-input';
import type { Asset, Group } from '@/store/types';

const card = (id: string, over: Partial<Asset> = {}): Asset => ({
  id, key: id, label: id, kind: 'image', source: 'generated', status: 'ready',
  position: { x: 0, y: 0 }, ...over,
});
const group = (id: string, over: Partial<Group> = {}): Group => ({
  id, name: id, x: 0, y: 0, w: 400, h: 300, collapsed: false, ...over,
});

describe('buildTidyNodes', () => {
  test('框合成一个节点:位置取左上角、尺寸取 w/h;框内成员不出现在输入里', () => {
    const nodes = buildTidyNodes(
      [card('m1', { groupId: 'g1' }), card('out')],
      [group('g1', { x: 100, y: 200, w: 500, h: 400 })],
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(['g1', 'out']);
    expect(nodes.find((n) => n.id === 'g1')).toMatchObject({
      position: { x: 100, y: 200 }, width: 500, height: 400,
    });
  });

  test('框内卡引用框外卡:边提升成「框外卡 → 框」,挂在框节点的 refIds 上', () => {
    const nodes = buildTidyNodes(
      [card('src'), card('m1', { groupId: 'g1', refIds: ['src'] })],
      [group('g1')],
    );
    expect(nodes.find((n) => n.id === 'g1')!.refIds).toEqual(['src']);
  });

  test('框外卡引用框内卡:该卡的 refIds 被改写成框 id', () => {
    const nodes = buildTidyNodes(
      [card('m1', { groupId: 'g1' }), card('out', { refIds: ['m1'] })],
      [group('g1')],
    );
    expect(nodes.find((n) => n.id === 'out')!.refIds).toEqual(['g1']);
  });

  test('parentId 同样提升:框内卡当父时改指向框', () => {
    const nodes = buildTidyNodes(
      [card('m1', { groupId: 'g1' }), card('out', { parentId: 'm1' })],
      [group('g1')],
    );
    expect(nodes.find((n) => n.id === 'out')!.parentId).toBe('g1');
  });

  test('同框内部的边成自环:丢弃,不进框的 refIds', () => {
    const nodes = buildTidyNodes(
      [card('m1', { groupId: 'g1' }), card('m2', { groupId: 'g1', parentId: 'm1', refIds: ['m1'] })],
      [group('g1')],
    );
    expect(nodes.find((n) => n.id === 'g1')!.refIds ?? []).toEqual([]);
  });

  test('多个成员指向同一外部卡:提升后去重', () => {
    const nodes = buildTidyNodes(
      [card('src'), card('m1', { groupId: 'g1', refIds: ['src'] }), card('m2', { groupId: 'g1', refIds: ['src'] })],
      [group('g1')],
    );
    expect(nodes.find((n) => n.id === 'g1')!.refIds).toEqual(['src']);
  });

  test('空框照样入局(它是用户圈出的区域,跳过等于允许别的卡压上去)', () => {
    const nodes = buildTidyNodes([card('a')], [group('empty')]);
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'empty']);
  });

  test('孤儿 groupId(框已不存在):该卡按普通卡入局,不被当成员剔除', () => {
    const nodes = buildTidyNodes([card('orphan', { groupId: 'gone' })], []);
    expect(nodes.map((n) => n.id)).toEqual(['orphan']);
  });

  test('sizeById 只作用于框外卡;框恒用自己的 w/h', () => {
    const nodes = buildTidyNodes(
      [card('out')],
      [group('g1', { w: 400, h: 300 })],
      { out: { width: 620, height: 150 }, g1: { width: 9, height: 9 } },
    );
    expect(nodes.find((n) => n.id === 'out')).toMatchObject({ width: 620, height: 150 });
    expect(nodes.find((n) => n.id === 'g1')).toMatchObject({ width: 400, height: 300 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/tidy-input.test.ts`
Expected: FAIL —— `Failed to load url ./tidy-input`（模块不存在）

- [ ] **Step 3: 实现** —— `src/lib/tidy-input.ts`

```ts
// 一键整理的布局输入(纯函数,无副作用)。
//
// 布局引擎不认识「框」这个概念:框在这里被**合成为一个普通节点**(位置取框左上角、
// 尺寸取框 w/h),框内成员则整批退出输入 —— 它们的新坐标由框的位移推出,而不是被重排
// (spec 2026-08-17 决策 1:容器模型下几何是真相,重排框内等于系统替用户重新组织内容)。
//
// 成员**仍要读**:决策 2 的「跨框引用边提升到框」需要它们的 parentId / refIds ——
// 「框内卡 → 框外卡」这条边只存在于成员一侧(边方向是「被引用者 → 本节点」)。
import type { Asset, Group } from '@/store/types';
import type { TidyNode } from './card-layout';

export function buildTidyNodes(
  assets: readonly Asset[],
  groups: readonly Group[],
  sizeById?: Record<string, { width: number; height: number }>,
): TidyNode[] {
  // 孤儿 groupId(框已不存在)不算成员:否则这类卡从此永不参与整理,而画布上没有任何框
  // 能解释这个现象(与旧 tidyCanvas 的 gids 校验同一口径)
  const gids = new Set(groups.map((g) => g.id));
  const boxOf = new Map<string, string>();
  for (const a of assets) if (a.groupId && gids.has(a.groupId)) boxOf.set(a.id, a.groupId);
  /** 边的端点提升:框内卡 → 它的框;其余原样 */
  const lift = (id: string): string => boxOf.get(id) ?? id;

  // 框的入边 = 全体成员入边提升后的并集(有序去重、去自环)
  const boxRefs = new Map<string, string[]>();
  const addBoxRef = (owner: string, rawSrc: string) => {
    const src = lift(rawSrc);
    if (src === owner) return;   // 同框内部的边:自环,与整理无关
    const arr = boxRefs.get(owner) ?? [];
    if (!arr.includes(src)) { arr.push(src); boxRefs.set(owner, arr); }
  };
  for (const a of assets) {
    const owner = boxOf.get(a.id);
    if (owner == null) continue;
    if (a.parentId) addBoxRef(owner, a.parentId);
    for (const r of a.refIds ?? []) addBoxRef(owner, r);
  }

  const nodes: TidyNode[] = groups.map((g) => {
    const refIds = boxRefs.get(g.id);
    // 框不带 kind:类型分带已退役(决策 3),且框本就是混合类型
    return { id: g.id, position: { x: g.x, y: g.y }, width: g.w, height: g.h, ...(refIds ? { refIds } : {}) };
  });

  for (const a of assets) {
    if (boxOf.has(a.id)) continue;   // 框内成员不参与落位
    const s = sizeById?.[a.id];
    const parentId = a.parentId ? lift(a.parentId) : undefined;
    const refIds = (a.refIds ?? []).map(lift);
    nodes.push({
      id: a.id,
      position: a.position,
      ...(parentId ? { parentId } : {}),
      ...(refIds.length > 0 ? { refIds } : {}),
      ...(s ? { width: s.width, height: s.height } : {}),
    });
  }
  return nodes;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/tidy-input.test.ts`
Expected: PASS（9 passed）

- [ ] **Step 5: 提交**

```bash
git add src/lib/tidy-input.ts src/lib/tidy-input.test.ts
git commit -m "feat(tidy): 布局输入把框合成为节点并提升跨框引用边"
```

---

### Task 2: `lib/tidy-canvas.ts` —— 布局结果 → 新坐标 + 回写集合 + 撤销 payload

**Files:**
- Create: `src/lib/tidy-canvas.ts`
- Test: `src/lib/tidy-canvas.test.ts`
- Read for context: `src/store/actions.ts:1920-1974`（现行 `tidyCanvas`，本任务把它的计算部分整体搬出来）、`src/lib/ids.ts`（`isPlaceholderId`）

**Interfaces:**
- Consumes: `buildTidyNodes`（任务 1）、`tidyLayout(nodes)`（`src/lib/card-layout.ts`，**只传第一个参数**）
- Produces:
  ```ts
  interface TidyOutcome {
    assets: Asset[]; groups: Group[];
    movedCardIds: string[]; movedGroupIds: string[];
    undoCards: { id: string; x: number; y: number }[];
    undoGroups: { id: string; x: number; y: number }[];
    changed: boolean;
  }
  function tidyOutcome(assets, groups, sizeById?): TidyOutcome
  ```
  任务 5 的 store action 只调这一个函数。

- [ ] **Step 1: 写失败测试** —— `src/lib/tidy-canvas.test.ts`

```ts
import { describe, expect, test } from 'vitest';
import { tidyOutcome } from './tidy-canvas';
import type { Asset, Group } from '@/store/types';

const card = (id: string, x: number, y: number, over: Partial<Asset> = {}): Asset => ({
  id, key: id, label: id, kind: 'image', source: 'generated', status: 'ready',
  position: { x, y }, ...over,
});
const group = (id: string, over: Partial<Group> = {}): Group => ({
  id, name: id, x: 0, y: 0, w: 400, h: 300, collapsed: false, ...over,
});

describe('tidyOutcome', () => {
  test('框整体平移:成员保持相对框的偏移,框的 w/h 一字不改', () => {
    const g = group('g1', { x: 1000, y: 2000, w: 500, h: 400 });
    const m1 = card('m1', 1050, 2050, { groupId: 'g1' });
    const m2 = card('m2', 1200, 2100, { groupId: 'g1' });
    const out = tidyOutcome([m1, m2, card('a', 0, 0)], [g]);

    const ng = out.groups.find((x) => x.id === 'g1')!;
    expect(ng.w).toBe(500);
    expect(ng.h).toBe(400);
    const dx = ng.x - g.x;
    const dy = ng.y - g.y;
    const nm1 = out.assets.find((a) => a.id === 'm1')!;
    const nm2 = out.assets.find((a) => a.id === 'm2')!;
    expect(nm1.position).toEqual({ x: 1050 + dx, y: 2050 + dy });
    expect(nm2.position).toEqual({ x: 1200 + dx, y: 2100 + dy });
  });

  test('框没动:成员一个对象都不新建(引用相等)', () => {
    // 单框单卡且框已在锚点:布局把它放回原处 → 零位移
    const g = group('g1', { x: 0, y: 0 });
    const m1 = card('m1', 10, 10, { groupId: 'g1' });
    const out = tidyOutcome([m1], [g]);
    expect(out.assets[0]).toBe(m1);
    expect(out.groups[0]).toBe(g);
    expect(out.changed).toBe(false);
  });

  test('框与框外卡不重叠:任意两个结果矩形都不相交', () => {
    const g = group('g1', { x: 0, y: 0, w: 600, h: 500 });
    const assets = [
      card('m1', 20, 20, { groupId: 'g1' }),
      card('a', 30, 30), card('b', 40, 40), card('c', 50, 50),
    ];
    const out = tidyOutcome(assets, [g]);
    const rects = [
      ...out.groups.map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h })),
      ...out.assets.filter((a) => !a.groupId).map((a) => ({ x: a.position.x, y: a.position.y, w: 180, h: 150 })),
    ];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const r1 = rects[i];
        const r2 = rects[j];
        const overlap = r1.x < r2.x + r2.w && r2.x < r1.x + r1.w && r1.y < r2.y + r2.h && r2.y < r1.y + r1.h;
        expect(overlap).toBe(false);
      }
    }
  });

  test('跨框引用:框外的产物卡落在框右侧(同分量、框有列位)', () => {
    const g = group('g1', { x: 0, y: 0, w: 400, h: 300 });
    const out = tidyOutcome(
      [card('m1', 20, 20, { groupId: 'g1' }), card('derived', 900, 900, { refIds: ['m1'] })],
      [g],
    );
    const ng = out.groups[0];
    const derived = out.assets.find((a) => a.id === 'derived')!;
    expect(derived.position.x).toBeGreaterThanOrEqual(ng.x + ng.w);
  });

  test('回写集合:占位卡不进 movedCardIds,但仍拿到新坐标', () => {
    const out = tidyOutcome([card('pending_x', 999, 999), card('a', 500, 500)], []);
    expect(out.movedCardIds).not.toContain('pending_x');
    expect(out.assets.find((a) => a.id === 'pending_x')!.position).not.toEqual({ x: 999, y: 999 });
    expect(out.changed).toBe(true);
  });

  test('撤销 payload 记的是「变位前」的坐标,只记真的动过的', () => {
    const g = group('g1', { x: 1000, y: 1000 });
    const out = tidyOutcome([card('m1', 1010, 1010, { groupId: 'g1' }), card('a', 5000, 5000)], [g]);
    expect(out.undoGroups).toEqual([{ id: 'g1', x: 1000, y: 1000 }]);
    expect(out.undoCards.map((c) => c.id).sort()).toEqual(['a', 'm1']);
    expect(out.undoCards.find((c) => c.id === 'm1')).toEqual({ id: 'm1', x: 1010, y: 1010 });
  });

  test('全部卡都在框里:框照样被摆放(旧实现此时整理无事可做)', () => {
    const g1 = group('g1', { x: 0, y: 0, w: 400, h: 300 });
    const g2 = group('g2', { x: 10, y: 10, w: 400, h: 300 });   // 与 g1 重叠
    const out = tidyOutcome([card('m1', 20, 20, { groupId: 'g1' }), card('m2', 30, 30, { groupId: 'g2' })], [g1, g2]);
    expect(out.changed).toBe(true);
    const a = out.groups.find((x) => x.id === 'g1')!;
    const b = out.groups.find((x) => x.id === 'g2')!;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
  });

  test('无框时:等价于直接对全部卡跑 tidyLayout(不因框逻辑跑偏)', () => {
    const assets = [card('p', 0, 0), card('c', 40, 40, { parentId: 'p' })];
    const out = tidyOutcome(assets, []);
    expect(out.groups).toEqual([]);
    expect(out.assets.every((a) => a.position != null)).toBe(true);
    expect(out.changed).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/tidy-canvas.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现** —— `src/lib/tidy-canvas.ts`

```ts
// 一键整理的结果组装(纯函数,无副作用)。store 的 tidyCanvas 只负责「调它 → set → 回写」。
//
// 分工:布局怎么排在 card-layout(tidyLayout),布局输入怎么造在 tidy-input(框合成 + 边提升),
// 这里只做三件事 —— 把布局结果贴回 assets/groups、按框的位移平移成员、算出回写与撤销要用的集合。
import type { Asset, Group } from '@/store/types';
import { tidyLayout } from './card-layout';
import { buildTidyNodes } from './tidy-input';
import { isPlaceholderId } from './ids';

export interface TidyOutcome {
  /** 新的 assets(未变的保持原引用,便于 RF 复用节点) */
  assets: Asset[];
  /** 新的 groups(只改 x/y,w/h 原样) */
  groups: Group[];
  /** 需批量回写坐标的卡(已排除占位卡) */
  movedCardIds: string[];
  /** 需 PATCH 坐标的框 */
  movedGroupIds: string[];
  /** 撤销用:变位卡的**旧**坐标 */
  undoCards: { id: string; x: number; y: number }[];
  /** 撤销用:变位框的**旧**坐标 */
  undoGroups: { id: string; x: number; y: number }[];
  /** 卡或框任一真的动过。false ⟹ 调用方不入栈、不落库、不发请求(如连点两次整理) */
  changed: boolean;
}

export function tidyOutcome(
  assets: readonly Asset[],
  groups: readonly Group[],
  sizeById?: Record<string, { width: number; height: number }>,
): TidyOutcome {
  const layout = tidyLayout(buildTidyNodes(assets, groups, sizeById));

  // 框先定位:成员的新坐标是框位移的导出量
  const deltaByGroup = new Map<string, { x: number; y: number }>();
  const nextGroups = groups.map((g) => {
    const p = layout.get(g.id);
    if (!p || (p.x === g.x && p.y === g.y)) return g;
    deltaByGroup.set(g.id, { x: p.x - g.x, y: p.y - g.y });
    return { ...g, x: p.x, y: p.y };
  });

  const gids = new Set(groups.map((g) => g.id));
  const nextAssets = assets.map((a) => {
    // 框内成员:跟着框走,**不查 layout**(它压根不在布局输入里)
    const owner = a.groupId && gids.has(a.groupId) ? a.groupId : undefined;
    if (owner != null) {
      const d = deltaByGroup.get(owner);
      if (!d) return a;
      return { ...a, position: { x: a.position.x + d.x, y: a.position.y + d.y } };
    }
    const p = layout.get(a.id);
    if (!p || (p.x === a.position.x && p.y === a.position.y)) return a;
    return { ...a, position: p };
  });

  // 「动过」的判定一律按引用比对:上面两个 map 只在真的变了时才新建对象
  const undoCards: TidyOutcome['undoCards'] = [];
  const movedCardIds: string[] = [];
  assets.forEach((a, i) => {
    if (nextAssets[i] === a) return;
    undoCards.push({ id: a.id, x: a.position.x, y: a.position.y });
    if (!isPlaceholderId(a.id)) movedCardIds.push(a.id);   // 占位卡无后端 item,不回写
  });
  const undoGroups: TidyOutcome['undoGroups'] = [];
  const movedGroupIds: string[] = [];
  groups.forEach((g, i) => {
    if (nextGroups[i] === g) return;
    undoGroups.push({ id: g.id, x: g.x, y: g.y });
    movedGroupIds.push(g.id);
  });

  return {
    assets: nextAssets,
    groups: nextGroups,
    movedCardIds,
    movedGroupIds,
    undoCards,
    undoGroups,
    changed: undoCards.length > 0 || undoGroups.length > 0,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/tidy-canvas.test.ts src/lib/tidy-input.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/tidy-canvas.ts src/lib/tidy-canvas.test.ts
git commit -m "feat(tidy): 整理结果组装(框平移带走成员 + 回写/撤销集合)"
```

---

### Task 3: store 两个框坐标 action（本地 set + 逐框 PATCH）

**Files:**
- Modify: `src/store/actions.ts`（在 `moveGroup` 之后加两个 action，并挂进 `createServerActions` 的返回对象，见文件末尾 `return {` 那一大坨）
- Modify: `src/store/types.ts`（`ServerActions` 接口加两条签名）
- Test: `src/store/actions.test.ts`（新增一个 describe）
- Read for context: `src/store/actions.ts:1463-1479`（`moveGroup`：`realGid` / `withRealGroupId` / `trackGroupWrite` / `guard` 的用法照抄）

**Interfaces:**
- Produces:
  ```ts
  setGroupPositions(list: { id: string; x: number; y: number }[]): void   // 只改本地,一次 set
  persistGroupPositions(ids: string[]): void                              // 逐框 PATCH canvas_x/canvas_y,fire-and-forget
  ```
  任务 4（撤销）与任务 5（整理）都调它们。

- [ ] **Step 1: 写失败测试** —— 追加到 `src/store/actions.test.ts` 末尾

```ts
describe('setGroupPositions / persistGroupPositions', () => {
  const g = (id: string, x: number, y: number) => ({ id, name: id, x, y, w: 400, h: 300, collapsed: false });

  test('setGroupPositions 只改本地 x/y,不动 w/h、不发请求', () => {
    useStore.setState({ currentProjectId: 1, groups: [g('g1', 0, 0), g('g2', 50, 50)] });
    useStore.getState().setGroupPositions([{ id: 'g1', x: 300, y: 400 }]);
    const groups = useStore.getState().groups!;
    expect(groups.find((x) => x.id === 'g1')).toMatchObject({ x: 300, y: 400, w: 400, h: 300 });
    expect(groups.find((x) => x.id === 'g2')).toMatchObject({ x: 50, y: 50 });   // 未列出的框不动
    expect(api.updateCanvasGroup).not.toHaveBeenCalled();
  });

  test('persistGroupPositions 逐框 PATCH,只带取整后的 canvas_x/canvas_y', async () => {
    useStore.setState({ currentProjectId: 1, groups: [g('g1', 10.4, 20.6)] });
    useStore.getState().persistGroupPositions(['g1']);
    await Promise.resolve();   // 放行 fire-and-forget 回写微任务
    expect(api.updateCanvasGroup).toHaveBeenCalledWith(1, 'g1', { canvas_x: 10, canvas_y: 21 });
  });

  test('框已不存在(期间被删):跳过,不发请求也不抛', async () => {
    useStore.setState({ currentProjectId: 1, groups: [g('g1', 0, 0)] });
    expect(() => useStore.getState().persistGroupPositions(['gone'])).not.toThrow();
    await Promise.resolve();   // 放行 fire-and-forget 回写微任务
    expect(api.updateCanvasGroup).not.toHaveBeenCalled();
  });

  test('PATCH 失败:不抛到调用方(fire-and-forget,同 moveGroup)', async () => {
    api.updateCanvasGroup.mockRejectedValueOnce(new Error('boom'));
    useStore.setState({ currentProjectId: 1, groups: [g('g1', 0, 0)] });
    expect(() => useStore.getState().persistGroupPositions(['g1'])).not.toThrow();
    await Promise.resolve();   // 放行 fire-and-forget 回写微任务
  });
});
```

> 执行提示：`api` 是 `src/store/actions.test.ts:51` 已有的夹具（`pgcApi` 的 mock 对象），`api.updateCanvasGroup` 该文件已 mock（`updateGroupGeometry` / `moveGroup` 的用例在用），直接用。该文件**没有** `flush` 帮手，放行 fire-and-forget 微任务一律写 `await Promise.resolve()`（同文件 2380 / 3063 行的既有写法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "setGroupPositions"`
Expected: FAIL —— `setGroupPositions is not a function`

- [ ] **Step 3: 实现**

`src/store/types.ts` 的 `ServerActions` 接口里，紧跟 `moveGroup` 那行加：

```ts
  /** 批量把框搬到指定坐标(只改本地,一次 set)。整理与撤销共用 */
  setGroupPositions: (list: { id: string; x: number; y: number }[]) => void;
  /** 逐框回写坐标(只写 canvas_x/canvas_y);fire-and-forget,失败只 Toast 不阻塞 */
  persistGroupPositions: (ids: string[]) => void;
```

`src/store/actions.ts` 在 `moveGroup` 之后加：

```ts
  // 批量搬框(只改本地):整理一次可能挪几十个框,逐个 patchGroupLocal 会触发同样多次 set。
  // **不复判归属**:框与成员是同一个刚性位移,成员跟着走,谁也没进出框
  const setGroupPositions = (list: { id: string; x: number; y: number }[]) => {
    if (list.length === 0) return;
    const byId = new Map(list.map((p) => [realGid(p.id), p]));
    set({ groups: (get().groups ?? []).map((g) => {
      const p = byId.get(g.id);
      return p ? { ...g, x: p.x, y: p.y } : g;
    }) });
  };

  // 逐框回写坐标。框没有批量端点(卡有 batchUpdateCanvasItems),故 N 个框 N 个 PATCH;
  // 与 moveGroup 同款 fire-and-forget:失败只由 guard 报一条 Toast,不回滚、不阻塞后续框
  const persistGroupPositions = (ids: string[]) => {
    const pid = get().currentProjectId; if (pid == null) return;
    for (const rawGid of ids) {
      const gid = realGid(rawGid);
      const g = (get().groups ?? []).find((x) => x.id === gid);
      if (!g) continue;   // 期间被删/框不存在:无事可写
      void guard(set, () => withRealGroupId(gid, (real) => trackGroupWrite(real, () => pgcApi.updateCanvasGroup(pid, real, {
        canvas_x: Math.round(g.x), canvas_y: Math.round(g.y),
      }))).then(() => undefined));
    }
  };
```

并把两个名字加进本文件末尾 `return { ... }` 的导出列表（与 `moveGroup` 同一行附近）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "setGroupPositions"` 然后 `pnpm exec tsc --noEmit`
Expected: PASS + tsc 0 错

- [ ] **Step 5: 提交**

```bash
git add src/store/actions.ts src/store/types.ts src/store/actions.test.ts
git commit -m "feat(tidy): 新增批量搬框与框坐标回写两个 action"
```

---

### Task 4: 撤销条目带上框坐标

**Files:**
- Modify: `src/store/types.ts`（`UndoEntry` 的 `positions` 分支加 `groupGeoms`）
- Modify: `src/store/index.ts:897-923`（`case 'positions'` 分支）
- Test: `src/store/undo.test.ts`
- Read for context: `src/store/index.ts:881-960`（`undo` 全貌）

**Interfaces:**
- Consumes: `setGroupPositions` / `persistGroupPositions`（任务 3）
- Produces: `UndoEntry` 的 `positions` 分支新增可选字段 `groupGeoms?: { id: string; x: number; y: number }[]`；任务 5 写入它

- [ ] **Step 1: 写失败测试** —— 追加到 `src/store/undo.test.ts`

先在文件顶部那个 `vi.mock('@/lib/pgc/client', ...)` 的 `pgcApi` 对象里补一个端点（与既有 `batchUpdateCanvasItems` 同款写法）：

```ts
      updateCanvasGroup: vi.fn(async () => ({})),
```

再追加用例（**用真实 action**，断言 store 结果与请求，不打桩 action —— 与本文件既有风格一致）：

```ts
const group = (id: string, x: number, y: number) =>
  ({ id, name: id, x, y, w: 400, h: 300, collapsed: false });

describe('撤销一键整理:框坐标一并还原', () => {
  test('groupGeoms 里的框被搬回旧坐标并回写,w/h 不动', async () => {
    useStore.setState({
      groups: [group('g1', 900, 900)],
      undoStack: [{ ...positionsEntry([], 'tidy'), groupGeoms: [{ id: 'g1', x: 100, y: 200 }] }],
    });

    useStore.getState().undo();
    await Promise.resolve();

    expect(useStore.getState().groups).toEqual([group('g1', 100, 200)]);
    expect(pgcApi.updateCanvasGroup).toHaveBeenCalledWith(1, 'g1', { canvas_x: 100, canvas_y: 200 });
  });

  test('没有 groupGeoms(普通拖动的撤销):框一个都不碰', async () => {
    useStore.setState({
      assets: [makeAsset('image', { label: 'a' })],
      groups: [group('g1', 900, 900)],
      undoStack: [positionsEntry([{ id: 'a', x: 0, y: 0 }])],
    });

    useStore.getState().undo();
    await Promise.resolve();

    expect(useStore.getState().groups).toEqual([group('g1', 900, 900)]);
    expect(pgcApi.updateCanvasGroup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/undo.test.ts -t "框坐标一并还原"`
Expected: FAIL —— `setGroupPositions` 未被调用

- [ ] **Step 3: 实现**

`src/store/types.ts` 把 `positions` 分支改成（只加最后一个字段与注释）：

```ts
  | { type: 'positions'; op: 'move' | 'tidy'; pid: number; positions: { id: string; x: number; y: number }[]; groups?: { id: string; groupId: string | null }[]; groupGeoms?: { id: string; x: number; y: number }[]; viewport?: Viewport }
```

并在该分支上方的注释里补一句：

```ts
  // groupGeoms:本次操作若挪过**分组框**(只有一键整理会),撤销要把框搬回去 —— 成员坐标已在
  // positions 里,故这里只记框自己。**不能复用上面的 `groups` 字段**:那个记的是归属还原
  // ({ id, groupId }),语义完全不同
```

`src/store/index.ts` 的 `case 'positions'` 里，紧跟 `get().setAssetPositions(entry.positions);` 之后插入：

```ts
            // 框一并还原(只有整理会挪框)。**排在卡之后**:框几何回位时若先于成员,
            // 成员还在新位置上,任何按几何复判归属的路径都会看到「成员在框外」的瞬态
            if (entry.groupGeoms?.length) {
              get().setGroupPositions(entry.groupGeoms);
              get().persistGroupPositions(entry.groupGeoms.map((g) => g.id));
            }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/undo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/types.ts src/store/index.ts src/store/undo.test.ts
git commit -m "feat(tidy): 撤销条目带上框坐标,⌘Z 把框一起搬回去"
```

---

### Task 5: `tidyCanvas` 原子切换到新机制

**Files:**
- Modify: `src/store/actions.ts:1920-1974`（整段 `tidyCanvas` 换掉）
- Modify: `src/store/actions.test.ts`（`describe('tidyCanvas 跳过框内成员并避开框')` 整段重写为「框整体参与」；`test('按类型分行...')` 删除——决策 3 已退役该行为）
- Read for context: `src/lib/tidy-canvas.ts`（任务 2）

**Interfaces:**
- Consumes: `tidyOutcome`（任务 2）、`setGroupPositions` / `persistGroupPositions`（任务 3）、`groupGeoms`（任务 4）

- [ ] **Step 1: 写失败测试** —— 替换 `src/store/actions.test.ts` 里那个 describe

```ts
describe('tidyCanvas:框作为整体参与整理', () => {
  const card = (id: string, x: number, y: number, over: Partial<Asset> = {}): Asset => ({
    id, key: id, label: id, kind: 'image', source: 'generated', status: 'ready',
    position: { x, y }, ...over,
  } as Asset);
  const grp = (id: string, x: number, y: number) => ({ id, name: id, x, y, w: 400, h: 300, collapsed: false });

  test('框被挪动:成员按同一 delta 跟随,框的 w/h 不变', () => {
    useStore.setState({
      currentProjectId: 1, undoStack: [],
      groups: [grp('g1', 2000, 2000)],
      assets: [card('m1', 2050, 2050, { groupId: 'g1' }), card('a', 0, 0)],
    } as never);

    useStore.getState().tidyCanvas();

    const g = useStore.getState().groups!.find((x) => x.id === 'g1')!;
    const m1 = useStore.getState().assets.find((a) => a.id === 'm1')!;
    expect(g.w).toBe(400);
    expect(g.h).toBe(300);
    expect(m1.position).toEqual({ x: 2050 + (g.x - 2000), y: 2050 + (g.y - 2000) });
  });

  test('框坐标走 updateCanvasGroup 回写,成员坐标走批量端点', async () => {
    useStore.setState({
      currentProjectId: 1, undoStack: [],
      groups: [grp('g1', 2000, 2000)],
      assets: [card('m1', 2050, 2050, { groupId: 'g1' }), card('a', 0, 0)],
    } as never);

    useStore.getState().tidyCanvas();
    await Promise.resolve();   // 放行 fire-and-forget 回写微任务

    expect(api.updateCanvasGroup).toHaveBeenCalledWith(1, 'g1', expect.objectContaining({
      canvas_x: expect.any(Number), canvas_y: expect.any(Number),
    }));
    // 框的 PATCH 不许带尺寸(框尺寸只读)
    const patch = api.updateCanvasGroup.mock.calls[0][2];
    expect(patch).not.toHaveProperty('width');
    expect(patch).not.toHaveProperty('height');
    expect(api.batchUpdateCanvasItems).toHaveBeenCalled();
  });

  test('撤销条目带 groupGeoms,记的是框的旧坐标', () => {
    useStore.setState({
      currentProjectId: 1, undoStack: [],
      groups: [grp('g1', 2000, 2000)],
      assets: [card('m1', 2050, 2050, { groupId: 'g1' }), card('a', 0, 0)],
    } as never);

    useStore.getState().tidyCanvas();

    const entry = useStore.getState().undoStack.at(-1)!;
    expect(entry).toMatchObject({ type: 'positions', op: 'tidy' });
    expect((entry as { groupGeoms?: unknown }).groupGeoms).toEqual([{ id: 'g1', x: 2000, y: 2000 }]);
  });

  test('全部卡都在框里:整理仍摆放这些框(旧实现此时什么都不做)', () => {
    useStore.setState({
      currentProjectId: 1, undoStack: [],
      groups: [grp('g1', 0, 0), grp('g2', 10, 10)],
      assets: [card('m1', 20, 20, { groupId: 'g1' }), card('m2', 30, 30, { groupId: 'g2' })],
    } as never);

    useStore.getState().tidyCanvas();

    const [a, b] = ['g1', 'g2'].map((id) => useStore.getState().groups!.find((x) => x.id === id)!);
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  test('groups 为 null(未加载/flag 关):不把它写成空数组', () => {
    useStore.setState({ currentProjectId: 1, undoStack: [], groups: null, assets: [card('a', 500, 500)] } as never);
    useStore.getState().tidyCanvas();
    expect(useStore.getState().groups).toBeNull();
  });

  test('连点两次:第二次不入栈、不发任何回写', async () => {
    useStore.setState({
      currentProjectId: 1, undoStack: [],
      groups: [grp('g1', 2000, 2000)],
      assets: [card('m1', 2050, 2050, { groupId: 'g1' }), card('a', 0, 0)],
    } as never);
    useStore.getState().tidyCanvas();
    await Promise.resolve();   // 放行 fire-and-forget 回写微任务
    api.batchUpdateCanvasItems.mockClear();
    api.updateCanvasGroup.mockClear();

    useStore.getState().tidyCanvas();
    await Promise.resolve();   // 放行 fire-and-forget 回写微任务

    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(api.batchUpdateCanvasItems).not.toHaveBeenCalled();
    expect(api.updateCanvasGroup).not.toHaveBeenCalled();
  });
});
```

同时**删掉** `test('按类型分行:tidyCanvas 传入类型顺序,video 行带排在 image 之上', ...)` 这条（决策 3：类型分带退役）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "框作为整体参与整理"`
Expected: FAIL —— 框坐标不变（旧实现只把框当障碍）

- [ ] **Step 3: 实现** —— 把 `src/store/actions.ts` 的 `tidyCanvas` 整体换成

```ts
  // 一键整理(用户主动触发,是「系统不挪卡」原则的有意例外)。
  // 计算全在 lib/tidy-canvas 的纯函数里(框合成节点 + 边提升 + 结果组装),这里只接线:
  // 一次 set 落定 → 卡走批量回写 → 框逐个 PATCH。
  // sizeById:画布层量得的真实节点尺寸(id→{width,height}),缺失走 CARD_W/CARD_H 兜底。
  // viewportBefore:整理前视口。整理本身会 fitView 改视口,故连视口一起入撤销栈 ——
  // 只还原坐标会让卡片回原位而视口停在整理后的全景框景(spec 2026-08-03-canvas-undo)。
  const tidyCanvas = (sizeById?: Record<string, { width: number; height: number }>, viewportBefore?: Viewport) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const assets = get().assets;
    const groups = get().groups ?? [];
    if (assets.length === 0 && groups.length === 0) return;

    const out = tidyOutcome(assets, groups, sizeById);
    // 零位移(如连点两次整理):不入栈、不落库、不发请求。入栈在前会占一格空条目,
    // 第一次 ⌘Z 只弹「已撤销:一键整理」而画布不动(spec 2026-08-11-drag-commit-guards #3)
    if (!out.changed) return;

    set({
      assets: out.assets,
      // groups 恒为 null 时别写成 []:null 是「未加载 / flag 关」,空数组是「加载完了确实没框」
      ...(get().groups ? { groups: out.groups } : {}),
      undoStack: pushUndoEntry(get().undoStack, {
        type: 'positions',
        op: 'tidy',
        pid,
        positions: out.undoCards,
        ...(out.undoGroups.length > 0 ? { groupGeoms: out.undoGroups } : {}),
        ...(viewportBefore ? { viewport: viewportBefore } : {}),
      }),
    });
    void persistAssetPositions(out.movedCardIds);
    persistGroupPositions(out.movedGroupIds);
  };
```

顶部 import 加 `import { tidyOutcome } from '@/lib/tidy-canvas';`，并删掉已不再使用的 `tidyLayout` / `TidyNode` / `TIDY_ROW_KIND_ORDER` / `membersOf`（按 tsc 与 lint 的未用告警清）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts src/store/undo.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + tsc 0 错

- [ ] **Step 5: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat(tidy): 整理切到新机制,框作为整体入队并回写坐标"
```

---

### Task 6: 删旧 —— 类型分带与障碍避让

**Files:**
- Modify: `src/lib/card-layout.ts`（删 `kindOrder` / `obstacles` 两个参数、`groupBoxesByKind`、`TreeBox.kind`、`TidyNode.kind`、迭代避障那段 for 循环；`Box` 类型若仅供 obstacles 使用则一并删）
- Modify: `src/lib/card-layout.test.ts`（删 `describe('tidyLayout 按类型分行(kindOrder)')` 与 `describe('tidyLayout 避开障碍')` 两整段，新增 1 条锁「分量按 (y,x) 序连续货架」）
- Modify: `src/lib/asset-kind.ts:29`（删 `TIDY_ROW_KIND_ORDER`）
- Read for context: `src/lib/card-layout.ts:123-140`（函数注释也要改）

**Interfaces:**
- Produces: `tidyLayout(nodes: TidyNode[]): Map<string, XY>` —— 单参数签名，任务 2 的 `tidy-canvas.ts` 已按此调用

- [ ] **Step 1: 新增锁住新形态的测试** —— 追加到 `src/lib/card-layout.test.ts`

```ts
describe('tidyLayout 分量货架(取消类型分带后的唯一形态)', () => {
  test('多个独立分量:同一行从左到右铺,不再按 kind 分行带', () => {
    const m = tidyLayout([
      { id: 'v', kind: 'video', position: { x: 0, y: 0 } },
      { id: 'i', kind: 'image', position: { x: 200, y: 0 } },
      { id: 'a', kind: 'audio', position: { x: 400, y: 0 } },
    ]);
    // 三张卡同 y(一行),x 递增 —— kind 不再影响落位
    expect(m.get('i')!.y).toBe(m.get('v')!.y);
    expect(m.get('a')!.y).toBe(m.get('v')!.y);
    expect(m.get('i')!.x).toBeGreaterThan(m.get('v')!.x);
    expect(m.get('a')!.x).toBeGreaterThan(m.get('i')!.x);
  });

  test('分量序按当前 (y, x):上方的分量先铺,位置记忆可测', () => {
    const m = tidyLayout([
      { id: 'low', position: { x: 0, y: 900 } },
      { id: 'high', position: { x: 0, y: 100 } },
    ]);
    expect(m.get('high')!.x).toBeLessThan(m.get('low')!.x);
  });
});
```

- [ ] **Step 2: 跑测试确认现状**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts -t "分量货架"`
Expected: PASS（缺省 kindOrder 时本就是连续货架——这两条是**删除的安全网**，不是红→绿）

- [ ] **Step 3: 删旧**

1. `src/lib/card-layout.ts`：把签名改成 `export function tidyLayout(nodes: TidyNode[]): Map<string, XY>`；删 `const groups: TreeBox[][] = kindOrder ? ... : [boxes]` 改为直接用 `[boxes]`（或把 `pack` 内层循环摊平）；删 `groupBoxesByKind` 整个函数；删 `TreeBox` 的 `kind` 字段与 `layoutComponent` 返回里的 `kind: roots[0]?.kind`；删 `TidyNode` 的 `kind?: string`；删 `let startY = baseY; ... for (let round = 0; round < 4; round++) { ... }` 那段迭代避障，改成 `const packed = pack(baseY);`。函数头注释同步改写（去掉「按类型分行」与 obstacles 两段）。
2. `src/lib/asset-kind.ts`：删 `export const TIDY_ROW_KIND_ORDER = [...]`。
3. `src/lib/card-layout.test.ts`：删两个 describe（分带 6 例、避障 4 例）。
4. `src/store/actions.test.ts`：删残留的 `TIDY_ROW_KIND_ORDER` import。

- [ ] **Step 4: 验证零残留 + 全量绿**

```bash
grep -rn "TIDY_ROW_KIND_ORDER\|obstacles\|groupBoxesByKind\|kindOrder" src/ ; echo "expect: 无输出"
pnpm exec tsc --noEmit && pnpm test
```
Expected: grep 无输出；tsc 0 错；全量测试通过

- [ ] **Step 5: 提交**

```bash
git add src/lib/card-layout.ts src/lib/card-layout.test.ts src/lib/asset-kind.ts src/store/actions.test.ts
git commit -m "refactor(tidy): 删掉类型分带与障碍避让(已被框入队取代)"
```

---

### Task 7: 文档与完整验证

**Files:**
- Modify: `CLAUDE.md`（「画布与生成」一节：补一句整理的新语义）
- Test: 无新增，跑完整链

- [ ] **Step 1: 更新 CLAUDE.md**

在「画布与生成」小节 `- 画布用 **`@xyflow/react`**，落位走 `src/lib/card-layout.ts`...」那条之后插入：

```markdown
- **一键整理**：`tidyLayout` 只认「节点 + 尺寸 + 边」，**分组框被合成为一个固定尺寸节点**参与分量与货架铺放（`src/lib/tidy-input.ts` 造输入并把跨框引用边提升到框，`src/lib/tidy-canvas.ts` 组装结果）。框内相对布局与框的 w/h **只读**，成员按框的位移整体平移；整理不再有类型分带，也不再有「避开框」的障碍逻辑（两者已随该机制退役，勿重新引入）。框坐标没有批量端点，逐个 `updateCanvasGroup` 回写；⌘Z 靠撤销条目的 `groupGeoms` 把框一起搬回去。
```

- [ ] **Step 2: 跑完整验证链**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build
```
Expected: 全部退出码 0；测试 0 失败

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 补齐整理的新语义(框入队、分带与避障退役)"
```

---

## 执行后的收尾（不属于任务，由主会话做）

- 派干净上下文子代理基于 `dev..HEAD` 的 commit 范围独立评审（只给 spec 与 diff）。
- Critical / Important 修完后 `--no-ff` 合并进 dev，并**在合并结果上**重跑完整链。
- 跑 `/walkthrough` 生成本回合走读。
