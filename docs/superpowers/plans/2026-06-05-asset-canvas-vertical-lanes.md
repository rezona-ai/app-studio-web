# 资产画布纵向泳道化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把资产画布从横向类型盒子改为纵向力导向泳道，去掉盒子边框，并保证新增资产自动重排不重叠。

**Architecture:** 保留 d3-force 引擎，把 zone 几何从横向列改为纵向带（由上至下等距）；力导向只夹纵向、横向不限以消除重叠；删除 `ZoneLayer` 盒子；SEED 改 `pinned:false` 交引擎统一排布；persist key 升版清理旧坐标。

**Tech Stack:** Next.js 16 / React 19 / @xyflow/react / d3-force / zustand / vitest

---

## 文件结构

- Modify: `src/lib/zones.ts` — zone 几何由横向列改纵向带（`BAND_W/H/GAP`）
- Create: `src/lib/zones.test.ts` — 纵向几何断言
- Modify: `src/lib/force-layout.ts` — 力方向重定向、仅夹 y、提高 ticks
- Modify: `src/lib/force-layout.test.ts` — 改 y 约束用例 + 新增不重叠用例
- Delete: `src/components/canvas/ZoneLayer.tsx` — 移除盒子渲染
- Modify: `src/components/canvas/AssetCanvas.tsx` — 移除 `ZoneLayer` 引用
- Modify: `src/server/scripts.ts` — SEED 改 `pinned:false` 并按带中心重摆
- Modify: `src/store/index.ts` — persist key `taluna-v2` → `taluna-v3`

---

### Task 1: 纵向泳道几何（zones.ts）

**Files:**
- Modify: `src/lib/zones.ts`
- Create: `src/lib/zones.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/zones.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { zoneFor, zoneCenter, ZONE_ORDER, BAND_H, BAND_GAP } from './zones';

describe('zoneFor 纵向泳道', () => {
  test('所有带 x 对齐为 0', () => {
    for (const k of ZONE_ORDER) expect(zoneFor(k).x).toBe(0);
  });

  test('各类带由上至下等距堆叠', () => {
    for (let i = 0; i < ZONE_ORDER.length; i++) {
      expect(zoneFor(ZONE_ORDER[i]).y).toBe(i * (BAND_H + BAND_GAP));
    }
  });

  test('带中心 x 全部相等、y 严格递增', () => {
    const centers = ZONE_ORDER.map((k) => zoneCenter(zoneFor(k)));
    expect(new Set(centers.map((c) => c.x)).size).toBe(1);
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i].y).toBeGreaterThan(centers[i - 1].y);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/lib/zones.test.ts`
Expected: FAIL（`BAND_H`/`BAND_GAP` 未导出，或 `x`/`y` 不符）

- [ ] **Step 3: 改 zones.ts 为纵向带**

把 `src/lib/zones.ts` 全文替换为：

```ts
import type { AssetKind } from '@/agent-protocol/messages';

export interface Zone { kind: AssetKind; x: number; y: number; width: number; height: number; }
export const ZONE_ORDER: AssetKind[] = ['image', 'video', 'audio', '3d', 'doc'];
export const ZONE_LABEL: Record<AssetKind, string> = { image: '图像', video: '视频', audio: '音频', '3d': '3D', doc: '文档' };
// 纵向泳道:每类一条横向带,由上至下等距堆叠;带很宽(横向铺开)、较矮(纵向紧凑)
export const BAND_W = 1200, BAND_H = 220, BAND_GAP = 48;

export function zoneFor(kind: AssetKind): Zone {
  let i = ZONE_ORDER.indexOf(kind);
  if (i === -1) { console.warn('[zones] 未知资产类型,回退到 image band:', kind); i = 0; }
  return { kind, x: 0, y: i * (BAND_H + BAND_GAP), width: BAND_W, height: BAND_H };
}
export function zoneCenter(z: Zone) { return { x: z.x + z.width / 2, y: z.y + z.height / 2 }; }
export function zonesMap(): Record<AssetKind, Zone> {
  return Object.fromEntries(ZONE_ORDER.map((k) => [k, zoneFor(k)])) as Record<AssetKind, Zone>;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/lib/zones.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/zones.ts src/lib/zones.test.ts
git commit -m "zone几何改纵向泳道(由上至下等距、横向铺开)"
```

---

### Task 2: 力导向重定向 + 消除重叠（force-layout.ts）

**Files:**
- Modify: `src/lib/force-layout.ts`
- Modify: `src/lib/force-layout.test.ts`

- [ ] **Step 1: 改测试（替换 y 约束用例 + 新增不重叠用例）**

把 `src/lib/force-layout.test.ts` 第 20-30 行的 `'未 pinned 节点被约束在所属 zone 边界内'` 用例替换为下面两个用例：

```ts
  test('未 pinned 节点的 y 被约束在所属带内', () => {
    const z = zoneFor('image');
    const nodes = Array.from({ length: 6 }, (_, i) => imageNode(`n${i}`, z.x + 10, z.y + 10));
    const out = runForceLayout(nodes, zones);
    for (const n of out) {
      expect(n.y).toBeGreaterThanOrEqual(z.y);
      expect(n.y).toBeLessThanOrEqual(z.y + z.height);
    }
  });

  test('未 pinned 节点两两不重叠(中心间距 ≥ 120)', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => imageNode(`n${i}`, 600 + i, 110));
    const out = runForceLayout(nodes, zones);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dist = Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y);
        expect(dist).toBeGreaterThanOrEqual(120);
      }
    }
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/lib/force-layout.test.ts`
Expected: FAIL（现实现横向被夹在 zone 内、且 ticks/力参数未保证 8 点散开到 ≥120）

- [ ] **Step 3: 改 force-layout.ts**

把 `src/lib/force-layout.ts` 全文替换为：

```ts
import { forceSimulation, forceManyBody, forceCollide, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { AssetKind } from '@/agent-protocol/messages';
import { zoneCenter, type Zone } from './zones';

export interface LayoutNode { id: string; kind: AssetKind; x: number; y: number; pinned: boolean; }
interface SimNode extends SimulationNodeDatum { id: string; kind: AssetKind; fx?: number; fy?: number; }

const NODE_R = 70;   // 碰撞半径
const PAD_Y = 40;    // 纵向距带边内边距
const TICKS = 200;

export function runForceLayout(nodes: LayoutNode[], zones: Record<AssetKind, Zone>): LayoutNode[] {
  const sim: SimNode[] = nodes.map((n) => ({
    id: n.id, kind: n.kind, x: n.x, y: n.y, vx: 0, vy: 0,
    ...(n.pinned ? { fx: n.x, fy: n.y } : {}),
  }));

  const simulation = forceSimulation<SimNode>(sim)
    .force('charge', forceManyBody().strength(-180))
    .force('collide', forceCollide(NODE_R))
    // 横向弱吸向带中心(鼓励铺开),纵向强吸向带中心(留在本带)
    .force('x', forceX<SimNode>((d) => zoneCenter(zones[d.kind]).x).strength(0.04))
    .force('y', forceY<SimNode>((d) => zoneCenter(zones[d.kind]).y).strength(0.18))
    .stop();

  for (let i = 0; i < TICKS; i++) {
    simulation.tick();
    for (const d of sim) {
      if (d.fy != null) continue; // pinned 不夹
      const z = zones[d.kind];
      // 仅纵向夹到本带内;横向不限,保证有足够空间散开、彻底消除重叠
      const ny = Math.min(Math.max(d.y!, z.y + PAD_Y), z.y + z.height - PAD_Y);
      if (ny !== d.y) { d.y = ny; d.vy = 0; }
    }
  }

  const byId = new Map(sim.map((d) => [d.id, d]));
  return nodes.map((n) => {
    const d = byId.get(n.id)!;
    return n.pinned ? n : { ...n, x: Math.round(d.x!), y: Math.round(d.y!) };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/lib/force-layout.test.ts`
Expected: PASS（pinned 不变、y 约束、不重叠、确定性 4 项全过）
若「不重叠」阈值因 collide 软解算略偏低，可把 120 调到实际稳定下界（仍须远大于卡片半重叠区，不得低于 90）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/force-layout.ts src/lib/force-layout.test.ts
git commit -m "力导向重定向到纵向带、仅夹y、横向放开以消除重叠"
```

---

### Task 3: 移除盒子（ZoneLayer）

**Files:**
- Delete: `src/components/canvas/ZoneLayer.tsx`
- Modify: `src/components/canvas/AssetCanvas.tsx`

- [ ] **Step 1: 删除 ZoneLayer 文件**

```bash
git rm src/components/canvas/ZoneLayer.tsx
```

- [ ] **Step 2: 从 AssetCanvas 移除引用**

删除 `src/components/canvas/AssetCanvas.tsx:15` 这一行：

```ts
import ZoneLayer from './ZoneLayer';
```

删除 `src/components/canvas/AssetCanvas.tsx:127` 这一行（位于 `<ReactFlow>` 内、`<Background>` 上方）：

```tsx
        <ZoneLayer visibleKinds={visibleKinds} />
```

- [ ] **Step 3: 校验类型/lint 不报未用变量**

Run: `pnpm lint`
Expected: 通过（`visibleKinds` 仍被第 68 行的 store→RF 同步过滤使用，不会未用）

- [ ] **Step 4: 跑全量测试确认无回归**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "移除资产类型盒子(ZoneLayer)与其引用"
```

---

### Task 4: SEED 改 pinned:false 并按带中心重摆（scripts.ts）

**Files:**
- Modify: `src/server/scripts.ts`

- [ ] **Step 1: 替换 SEED 区块（约第 101-154 行）**

把 `src/server/scripts.ts` 中从注释 `// ---- 初始种子` 起、到 `seedAsset({ key: 'cutscene', ... })` 这一项结束（含 `seedAsset` 定义、`imgZ/vidZ/audZ/docZ/HERO_V0_*` 常量、注释块、全部 11 个 `seedAsset(...)` 调用），整体替换为：

```ts
// ---- 初始种子(打开即对齐演示)----
// 纵向泳道:各类资产落到各自带中心附近(类内序号打散以破对称),pinned:false 交力导向统一排布去重叠
const kindCount: Partial<Record<Asset['kind'], number>> = {};
const seedAsset = (o: Partial<Asset> & Pick<Asset, 'key' | 'label' | 'kind'>): Asset => {
  const i = (kindCount[o.kind] = (kindCount[o.kind] ?? 0) + 1) - 1; // 该类内序号(0 起)
  const c = zoneCenter(zoneFor(o.kind));
  return {
    id: `seed_${o.key}`, source: 'generated', status: 'ready', pinned: false,
    position: { x: c.x + (i - 3) * 130, y: c.y + (i % 2 === 0 ? -30 : 30) },
    ...o,
  } as Asset;
};

export const SEED: { assets: Asset[]; versions: Version[] } = {
  assets: [
    // image 带
    seedAsset({ key: 'bar_scene',  label: '参考·酒吧场景', kind: 'image', source: 'reference', preview: { color: '#3a2b5c', title: 'NIGHTCAP' } }),
    seedAsset({ key: 'palette',    label: '赛博霓虹配色',  kind: 'image', preview: { color: '#5b1a52' } }),
    seedAsset({ key: 'sunset_bar', label: '场景·黄昏酒吧', kind: 'image', preview: { color: '#b5532a', title: 'SUNSET BAR' } }),
    seedAsset({ key: 'hero_v0', label: '主角_v0', kind: 'image', preview: { color: '#1f8f5f' } }),
    seedAsset({ key: 'hero_v1', label: '主角_v1', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#c0392b' } }),
    seedAsset({ key: 'hero_v2', label: '主角_v2', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#1f8f5f' } }),
    seedAsset({ key: 'hero_v3', label: '主角_v3', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#7b3fe4' } }),
    seedAsset({ key: 'hero_v4', label: '主角_v4', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#d96a1f' } }),
    // 其他带
    seedAsset({ key: 'plan_doc',  label: '策划稿 v1',     kind: 'doc',   preview: { title: '调酒师模拟器·策划稿' } }),
    seedAsset({ key: 'bgm',       label: 'BGM·合成器',     kind: 'audio', preview: { duration: '1:46' } }),
    seedAsset({ key: 'cutscene',  label: '过场动画·开场',  kind: 'video', preview: { duration: '0:24', color: '#7a3b8c' } }),
  ],
```

注意：保留其后原有的 `versions: [...]` 区块和闭合 `};` 不动。

- [ ] **Step 2: 跑 scripts 测试确认通过**

Run: `pnpm test src/server/scripts.test.ts`
Expected: PASS（SEED 仍含 bar_scene/palette/plan_doc/bgm/cutscene/hero_v0 与 3 个版本）

- [ ] **Step 3: 校验类型/lint**

Run: `pnpm lint`
Expected: 通过（不再使用 `imgZ/vidZ/audZ/docZ/HERO_V0_*`，无未用变量）

- [ ] **Step 4: 提交**

```bash
git add src/server/scripts.ts
git commit -m "SEED改pinned:false并按纵向带中心重摆(交力导向统一排布)"
```

---

### Task 5: persist 升版清理旧坐标（store/index.ts）

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: 改 persist key**

把 `src/store/index.ts:109` 的：

```ts
      name: 'taluna-v2',
```

改为：

```ts
      name: 'taluna-v3',
```

- [ ] **Step 2: 跑全量测试 + 构建确认无回归**

Run: `pnpm test && pnpm build`
Expected: 测试 PASS、构建成功

- [ ] **Step 3: 提交**

```bash
git add src/store/index.ts
git commit -m "persist升版v3清理旧横向坐标、重新注入新布局SEED"
```

---

## 验收（执行完所有任务后）

- [ ] `pnpm lint && pnpm test && pnpm build` 全绿
- [ ] 手动起 `pnpm dev` 验证：画布无盒子边框/底纹/类型标签；5 类资产由上至下成带、带间等距；同带资产横向铺开互不重叠
- [ ] 触发新增（generate/derive）后画布自动重排、新老未 pinned 资产不重叠；拖拽过的资产位置不变
