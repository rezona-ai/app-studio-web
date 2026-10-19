# 一键整理按类型分行 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布「一键整理」按树根类型把卡片分行排列,行带顺序 `video → image → audio → 3D`,前后两步 flextree 布局与吸附不变。

**Architecture:** 只改 `tidyLayout`(`src/lib/card-layout.ts`)的第 3 步「货架打包」——加可选第二参 `kindOrder`,提供时按「树根 kind」把树盒分组、按 `kindOrder` 逐组铺行带(每组起新行、组内超 `MAX_ROW_WIDTH` 本带内换行、空组跳过);缺省时退化为现状单组连续货架(逐字节兼容)。`asset-kind.ts` 新增行带顺序常量 `TIDY_ROW_KIND_ORDER`,`tidyCanvas`(`src/store/actions.ts`)构造 `TidyNode` 带 `kind` 并传入该常量。

**Tech Stack:** TypeScript · 纯函数(`card-layout.ts`)· zustand store action(`actions.ts`)· Vitest(jsdom + globals,`@`→`src`,测试与源码同目录)。

## Global Constraints

- 命令:`pnpm exec vitest run <file>` 跑单文件;`pnpm exec tsc --noEmit` 类型检查;`pnpm lint`。
- `tidyLayout` 保持纯函数、不可变返回、确定性可测;`kindOrder` 缺省必须与现状逐字节兼容(既有 9 条 `card-layout.test.ts` 用例不得改、全绿)。
- `card-layout.ts` 不引入 `AssetKind` 业务枚举;`TidyNode.kind` 用 `string`。类型优先级常量放 `src/lib/asset-kind.ts`,值为 `['video', 'image', 'audio', '3d', 'doc']`。
- `tidyCanvas` 仍是唯一落库入口;坐标 int 化(`SNAP_GRID=10` 吸附取整)尊重后端 `canvas_x/y` int 契约;`pending_` 前缀卡不回写。
- 代码注释、commit message 一律中文;注释解释「为什么」(组间不重叠 / 按根类型归行 / 缺省兼容)。
- 工作目录:worktree `.claude/worktrees/tidy-layout-by-type`(分支 `feat/tidy-layout-by-type`)。所有 `git`/`pnpm` 命令在此目录执行。

---

### Task 1: `tidyLayout` 按类型分组成行带(纯函数)

**Files:**
- Modify: `src/lib/card-layout.ts`(`TidyNode` 接口 67 行附近 · `TreeBox` 接口 70 行附近 · `layoutTree` 返回 163 行附近 · 第 3/4 步货架打包 176–199 行 · 新增 `groupBoxesByKind` helper)
- Test: `src/lib/card-layout.test.ts`(追加新 `describe`,不改既有用例)

**Interfaces:**
- Produces:
  - `interface TidyNode { id: string; parentId?: string; position: XY; width?: number; height?: number; kind?: string }`
  - `function tidyLayout(nodes: TidyNode[], kindOrder?: string[]): Map<string, XY>`
  - 行为:`kindOrder` 提供 → 按「树根 kind」分组,组序先按 `kindOrder` 列出的类型、未列类型/无 kind 按首次出现序追加在最后;每组起新行(`cx` 回 `baseX`、`cy` 接上一组之下),组内沿用货架换行;空组跳过。`kindOrder` 缺省 → 所有盒单组 = 现状。

- [ ] **Step 1: 写失败测试(追加到 `src/lib/card-layout.test.ts` 末尾)**

在文件最后追加一个新 `describe`(已 import 的常量 `CARD_W/CARD_H/GAP_X/GAP_Y/COMPONENT_GAP/MAX_ROW_WIDTH` 复用;`COMPONENT_GAP`/`MAX_ROW_WIDTH` 需补进顶部 import):

先把顶部 import(第 2 行)改为含 `COMPONENT_GAP, MAX_ROW_WIDTH`:

```ts
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, tidyLayout, CARD_W, CARD_H, GAP_X, GAP_Y, CASCADE_STEP, SNAP_GRID, COMPONENT_GAP, MAX_ROW_WIDTH } from './card-layout';
```

再追加:

```ts
describe('tidyLayout 按类型分行(kindOrder)', () => {
  const ORDER = ['video', 'image', 'audio', '3d'];

  test('多类型独立卡:按 video→image→audio→3d 自上而下分行带', () => {
    const m = tidyLayout([
      { id: 'a', kind: 'audio', position: { x: 0, y: 0 } },
      { id: 'v', kind: 'video', position: { x: 0, y: 0 } },
      { id: 'd', kind: '3d', position: { x: 0, y: 0 } },
      { id: 'i', kind: 'image', position: { x: 0, y: 0 } },
    ], ORDER);
    // 每带一张默认尺寸卡,带高 = CARD_H(150);带间 +COMPONENT_GAP(60) → 步距 210
    expect(m.get('v')).toEqual({ x: 0, y: 0 });
    expect(m.get('i')).toEqual({ x: 0, y: 210 });
    expect(m.get('a')).toEqual({ x: 0, y: 420 });
    expect(m.get('d')).toEqual({ x: 0, y: 630 });
  });

  test('派生树按「根类型」整体归行:树内 image/audio 子卡不拆到各自行带', () => {
    const m = tidyLayout([
      { id: 'v', kind: 'video', position: { x: 0, y: 0 } },
      { id: 'i1', kind: 'image', parentId: 'v', position: { x: 0, y: 0 } },
      { id: 'a1', kind: 'audio', parentId: 'v', position: { x: 0, y: 0 } },
      { id: 'i2', kind: 'image', position: { x: 0, y: 0 } },
    ], ORDER);
    // 树(v,i1,a1)整体在最上 video 带;独立 image 卡 i2 在其下一带
    expect(m.get('i1')!.y).toBeLessThan(m.get('i2')!.y);
    expect(m.get('a1')!.y).toBeLessThan(m.get('i2')!.y);
    // 不拆树:树内 image 子卡 i1 不与独立 image 卡 i2 同带
    expect(m.get('i1')!.y).not.toBe(m.get('i2')!.y);
    // 树盒高 = 两子纵堆 2*150 + GAP_Y(40) = 340;image 带起于 340 + COMPONENT_GAP(60) = 400
    expect(m.get('i2')).toEqual({ x: 0, y: 400 });
  });

  test('同类型超 MAX_ROW_WIDTH 在本行带内换行,下一类型再起新带', () => {
    const wide = (id: string, kind: string) => ({ id, kind, width: 1000, height: 150, position: { x: 0, y: 0 } });
    const m = tidyLayout([
      wide('v0', 'video'), wide('v1', 'video'), wide('v2', 'video'), wide('v3', 'video'),
      { id: 'i', kind: 'image', position: { x: 0, y: 0 } },
    ], ORDER);
    // 盒宽1000 + COMPONENT_GAP60 → 步距1060;v0@0 v1@1060 v2@2120;v3 时 3180+1000>3200 → 本带换行
    expect(m.get('v0')).toEqual({ x: 0, y: 0 });
    expect(m.get('v1')).toEqual({ x: 1060, y: 0 });
    expect(m.get('v2')).toEqual({ x: 2120, y: 0 });
    expect(m.get('v3')).toEqual({ x: 0, y: 210 });
    // image 带在 video 两行之下:210 + 150 + 60 = 420
    expect(m.get('i')).toEqual({ x: 0, y: 420 });
  });

  test('空类型跳过,不留空行带', () => {
    const m = tidyLayout([
      { id: 'v', kind: 'video', position: { x: 0, y: 0 } },
      { id: 's', kind: '3d', position: { x: 0, y: 0 } },
    ], ORDER);
    // 无 image/audio:3d 紧接 video 下方(150+60=210),中间不留空带
    expect(m.get('v')).toEqual({ x: 0, y: 0 });
    expect(m.get('s')).toEqual({ x: 0, y: 210 });
  });

  test('未列类型 / 无 kind:按首次出现序追加在已列类型之后,全员有坐标', () => {
    const m = tidyLayout([
      { id: 'v', kind: 'video', position: { x: 0, y: 0 } },
      { id: 'i', kind: 'image', position: { x: 0, y: 0 } },
      { id: 'n', position: { x: 0, y: 0 } }, // 无 kind
    ], ['video']);
    expect(m.size).toBe(3);
    expect(m.get('v')!.y).toBe(0);
    expect(m.get('i')!.y).toBeGreaterThan(m.get('v')!.y); // image 未列,追加在 video 后
    expect(m.get('n')!.y).toBeGreaterThan(m.get('i')!.y); // 无 kind 再后
  });

  test('缺省 kindOrder:不分组,退化为单条货架(带 kind 也不分带)', () => {
    const m = tidyLayout([
      { id: 'a', kind: 'video', position: { x: 0, y: 0 } },
      { id: 'b', kind: 'image', position: { x: 0, y: 0 } },
    ]);
    expect(m.get('a')!.y).toBe(m.get('b')!.y);               // 同一行
    expect(m.get('b')!.x).toBeGreaterThan(m.get('a')!.x);    // b 在 a 右侧
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts -t "按类型分行"`
Expected: FAIL —— 新用例因 `tidyLayout` 尚未分组而坐标不符(如 `m.get('i')` 期望 `{x:0,y:210}` 实得 `{x:240,y:0}`)。

- [ ] **Step 3: 改 `TidyNode` 与 `TreeBox` 接口,加 `kind`(`src/lib/card-layout.ts`)**

`TidyNode`(第 67 行附近):

```ts
// tidyLayout 输入的最小节点形状(不依赖 store 的 Asset,保持本文件无业务耦合;Asset 结构兼容可直接传入)
// width/height 可选:画布层喂入真实量得尺寸;缺失时退回 CARD_W/CARD_H。
// kind 可选:整理「按类型分行」用(树盒按其根的 kind 归带);缺失或不传 kindOrder 时不分带。
export interface TidyNode { id: string; parentId?: string; position: XY; width?: number; height?: number; kind?: string }
```

`TreeBox`(第 70 行附近,补 `kind` 记录该树根 kind):

```ts
// 该树布局结果:局部坐标(左上角 0,0)+ 包围盒尺寸 + 树根 kind(供按类型分行分组)
interface TreeBox { localPos: Map<string, XY>; w: number; h: number; kind?: string }
```

- [ ] **Step 4: `layoutTree` 返回携带根 kind(`src/lib/card-layout.ts` 第 163 行附近)**

把 `return { localPos, w: maxX, h: maxY };` 改为:

```ts
    return { localPos, w: maxX, h: maxY, kind: root.kind };
```

(`roots`/防环兜底分支均以节点为 `root` 调 `layoutTree`,故各盒自然带上对应根的 kind,无需额外改动。)

- [ ] **Step 5: 改第 3/4 步货架打包为「分组成行带」并加 `groupBoxesByKind` helper(`src/lib/card-layout.ts`)**

把第 4 步整段(原 176–199 行,`// 4) 货架打包…` 到 `return result;`)替换为:

```ts
  // 4) 货架打包:按类型分组成行带(kindOrder 缺省则退化为单组 = 原连续货架,逐字节兼容)
  let baseX = Infinity;
  let baseY = Infinity;
  for (const n of nodes) {
    if (n.position.x < baseX) baseX = n.position.x;
    if (n.position.y < baseY) baseY = n.position.y;
  }
  const snap = (v: number) => Math.round(v / SNAP_GRID) * SNAP_GRID;

  // 分组:有 kindOrder 时按「树根 kind」分桶并定序(未列类型/无 kind 按首次出现序追加在后);
  //      缺省时所有盒归一组 → 单组连续货架,与历史行为逐字节等价。
  const groups: TreeBox[][] = kindOrder ? groupBoxesByKind(boxes, kindOrder) : [boxes];

  let cy = baseY;
  for (const group of groups) {
    if (group.length === 0) continue; // 空类型:不推进 cy、不留空行带
    let cx = baseX;
    let rowH = 0;
    for (const box of group) {
      if (cx > baseX && cx + box.w > baseX + MAX_ROW_WIDTH) {
        cy += rowH + COMPONENT_GAP; // 同类型超宽:本行带内换行
        cx = baseX;
        rowH = 0;
      }
      for (const [id, p] of box.localPos) {
        result.set(id, { x: snap(cx + p.x), y: snap(cy + p.y) });
      }
      cx += box.w + COMPONENT_GAP;
      rowH = Math.max(rowH, box.h);
    }
    cy += rowH + COMPONENT_GAP; // 本类型铺完,下一类型起新行带(组间强制换行,故不同类型 y 区间不相交)
  }
  return result;
}
```

并在文件末尾(`tidyLayout` 函数闭合 `}` 之后)新增 helper:

```ts

// 把树盒按「根 kind」分桶并定序:先按 kindOrder 列出的类型取桶,
// 未在 kindOrder 列出的类型(及无 kind 的盒,kind 归一为 '')按其首次出现序追加在最后。
// 桶内保持 boxes 原序(根当前 (y,x) 升序),整体确定性可测。
function groupBoxesByKind(boxes: TreeBox[], kindOrder: string[]): TreeBox[][] {
  const buckets = new Map<string, TreeBox[]>();
  const appearance: string[] = []; // 桶首次出现序,供未列类型确定性兜底
  for (const box of boxes) {
    const k = box.kind ?? '';
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); appearance.push(k); }
    arr.push(box);
  }
  const keys: string[] = [];
  for (const k of kindOrder) if (buckets.has(k) && !keys.includes(k)) keys.push(k);
  for (const k of appearance) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => buckets.get(k)!);
}
```

- [ ] **Step 6: 跑新用例确认通过**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts -t "按类型分行"`
Expected: PASS(6 条新用例全过)。

- [ ] **Step 7: 跑全文件确认既有用例未破(缺省兼容)**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: PASS(含既有 9 条 `tidyLayout` 用例,尤其「货架多行」不变)。

- [ ] **Step 8: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 9: 提交**

```bash
git add src/lib/card-layout.ts src/lib/card-layout.test.ts
git commit -m "feat: tidyLayout 支持按树根类型分组成行带(kindOrder 可选,缺省兼容)"
```

---

### Task 2: 接线 —— 整理时按 `TIDY_ROW_KIND_ORDER` 分行

**Files:**
- Modify: `src/lib/asset-kind.ts`(第 17 行 `KIND_ORDER` 之后新增 `TIDY_ROW_KIND_ORDER`)
- Modify: `src/store/actions.ts`(第 11 行 import · 第 409–413 行 `tidyCanvas` 构造与调用)
- Test: `src/store/actions.test.ts`(`describe('tidyCanvas 一键整理')` 块内追加 1 条混合类型用例)

**Interfaces:**
- Consumes(来自 Task 1):`tidyLayout(nodes: TidyNode[], kindOrder?: string[])`、`TidyNode.kind`。
- Produces:`export const TIDY_ROW_KIND_ORDER: AssetKind[]`(`asset-kind.ts`)。

- [ ] **Step 1: 写失败测试(`src/store/actions.test.ts`,追加到第 874 行 `无当前项目 / 空画布` 用例之后、`describe` 闭合 `})` 之前)**

```ts
  test('按类型分行:tidyCanvas 传入类型顺序,video 行带排在 image 之上', async () => {
    const v: Asset = { id: 'v', key: 'v', label: 'v', kind: 'video', source: 'generated', status: 'ready', position: { x: 0, y: 0 } };
    const i: Asset = { id: 'i', key: 'i', label: 'i', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 } };
    useStore.setState({ currentProjectId: 1, assets: [i, v] }); // 乱序:image 先入
    useStore.getState().tidyCanvas();
    const after = useStore.getState().assets;
    const vy = after.find((a) => a.id === 'v')!.position.y;
    const iy = after.find((a) => a.id === 'i')!.position.y;
    expect(vy).toBeLessThan(iy); // 证明 tidyCanvas 把 kind + TIDY_ROW_KIND_ORDER 透传进了 tidyLayout
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "按类型分行"`
Expected: FAIL —— `tidyCanvas` 当前不传 `kindOrder`,两卡同 y(`vy` 不小于 `iy`),断言失败。

- [ ] **Step 3: 新增 `TIDY_ROW_KIND_ORDER` 常量(`src/lib/asset-kind.ts`,第 17 行 `KIND_ORDER` 定义之后)**

```ts
// 一键整理「按类型分行」的行带顺序(自上而下);与图例 KIND_ORDER 解耦,可独立调整
export const TIDY_ROW_KIND_ORDER: AssetKind[] = ['video', 'image', 'audio', '3d', 'doc'];
```

- [ ] **Step 4: `actions.ts` 改 import 为值导入(第 11 行)**

把 `import type { AssetKind } from '@/lib/asset-kind';` 改为:

```ts
import { TIDY_ROW_KIND_ORDER, type AssetKind } from '@/lib/asset-kind';
```

- [ ] **Step 5: `tidyCanvas` 构造 `TidyNode` 带 `kind` 并传 `TIDY_ROW_KIND_ORDER`(`src/store/actions.ts` 第 409–413 行)**

把:

```ts
    const tidyNodes: TidyNode[] = assets.map((a) => {
      const s = sizeById?.[a.id];
      return { id: a.id, parentId: a.parentId, position: a.position, ...(s ? { width: s.width, height: s.height } : {}) };
    });
    const layout = tidyLayout(tidyNodes);
```

改为:

```ts
    const tidyNodes: TidyNode[] = assets.map((a) => {
      const s = sizeById?.[a.id];
      return { id: a.id, parentId: a.parentId, kind: a.kind, position: a.position, ...(s ? { width: s.width, height: s.height } : {}) };
    });
    const layout = tidyLayout(tidyNodes, TIDY_ROW_KIND_ORDER);
```

- [ ] **Step 6: 跑新用例确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "按类型分行"`
Expected: PASS。

- [ ] **Step 7: 跑整组 `tidyCanvas` 测试确认既有未破(单一类型 fixture 仍逐字节兼容)**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "tidyCanvas 一键整理"`
Expected: PASS(既有 3 条 + 新增 1 条)。

- [ ] **Step 8: 全量校验(类型 + lint + 全测试)**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: 全绿。

- [ ] **Step 9: 提交**

```bash
git add src/lib/asset-kind.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 一键整理按 TIDY_ROW_KIND_ORDER(video→image→audio→3D)分行"
```

---

## 自检(Self-Review)

**Spec coverage**(对照 `2026-06-30-tidy-layout-by-type-design.md`):
- ① 类型优先级常量 `TIDY_ROW_KIND_ORDER` → Task 2 Step 3 ✓
- ② `TidyNode.kind` / `TreeBox.kind` → Task 1 Step 3 ✓
- ③ `tidyLayout(nodes, kindOrder?)` 第 3 步分组成行带(组序 / 本带换行 / 空组跳过 / 缺省兼容)→ Task 1 Step 5 + 测试 Step 1 全覆盖 ✓
- ④ `tidyCanvas` 带 `kind` + 传常量 → Task 2 Step 5 ✓
- ⑤ UI/动画/i18n 沿用 → 无改动,计划不含任务 ✓
- 测试 6 条 card-layout + store 混合类型 → Task 1/2 测试步骤 ✓

**Placeholder scan:** 无 TBD/TODO;每个代码步骤含完整代码与确切命令、预期输出。

**Type consistency:** `TidyNode.kind?: string`、`TreeBox.kind?: string`、`tidyLayout(nodes, kindOrder?: string[])`、`groupBoxesByKind(boxes: TreeBox[], kindOrder: string[]): TreeBox[][]`、`TIDY_ROW_KIND_ORDER: AssetKind[]` 跨任务一致;`tidyCanvas` 签名不变(仅内部多传一参)。
