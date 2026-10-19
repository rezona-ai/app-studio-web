# 资产画布一键整理 flextree 增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有纯函数 `tidyLayout` 升级为 flextree 布局(真实尺寸列宽 + 子树相对定位紧凑 + 分量货架多行打包 + 网格吸附),并把画布真实节点尺寸喂入。

**Architecture:** 纯落位逻辑仍在 `src/lib/card-layout.ts`(同步纯函数);store action `tidyCanvas(sizeById?)` 把 `assets` 并入画布尺寸映射后调 `tidyLayout`,沿用「一次 set + 仅变位非 pending 卡 fire-and-forget 回写」;`AssetCanvas.onTidy` 从 React Flow `getNodes().measured` 收集尺寸传入。不引入 elkjs。

**Tech Stack:** TypeScript、Vitest(jsdom + globals)、Zustand、@xyflow/react。

## Global Constraints

- 不引入 elkjs / Web Worker;`tidyLayout` 保持纯函数、不可变返回、确定性可测。
- 真实尺寸缺失时退回常量 `CARD_W=180 / CARD_H=150`;旧调用 `tidyLayout(assets)` 必须仍编译通过。
- 坐标最终 `Math.round(v/SNAP_GRID)*SNAP_GRID`,结果为整数(后端 `canvas_x/y` 是 int)。
- 相机不动(不 fitView);锚点取当前所有卡 `min(x,y)`。
- `pending_` 前缀占位卡参与布局但不回写;回写走既有 `persistAssetPosition`(内部 `pgcApi.updateCanvasReference`,fire-and-forget)。
- 注释中文,解释「为什么」(不变式 / 无重叠 / 锚点语义)。
- 命令在 worktree 内运行:`/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/tidy-flextree`。首次需 `pnpm install`(worktree 有独立 node_modules)。

---

## Task 0: worktree 装依赖(一次性)

**Files:** 无(环境准备)

- [ ] **Step 1: 安装依赖**

Run(在 worktree 根目录):
```bash
cd /Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/tidy-flextree
pnpm install
```
Expected: 安装完成,`node_modules` 就绪;`pnpm exec vitest run src/lib/card-layout.test.ts` 能跑(此时旧用例应仍 PASS)。

---

## Task 1: `tidyLayout` flextree 重写(纯函数)

**Files:**
- Modify: `src/lib/card-layout.ts`(新增常量、扩展 `TidyNode`、重写 `tidyLayout`,第 4-10 行常量区与第 61-133 行 `tidyLayout`)
- Test: `src/lib/card-layout.test.ts`(替换 `describe('tidyLayout 树形整理布局', ...)` 整块,第 58-117 行;并在顶部 import 补新常量)

**Interfaces:**
- Produces:
  - `export interface TidyNode { id: string; parentId?: string; position: XY; width?: number; height?: number }`
  - `export function tidyLayout(nodes: TidyNode[]): Map<string, XY>`
  - 新常量 `export const COMPONENT_GAP = 60`、`export const MAX_ROW_WIDTH = 3200`、`export const SNAP_GRID = 10`
  - 既有 `CARD_W=180 / CARD_H=150 / GAP_X=80 / GAP_Y=40` 不变

- [ ] **Step 1: 替换测试 — 改 import 行 + 整块 `tidyLayout` describe**

把 `src/lib/card-layout.test.ts` 第 2 行 import 改为(补三个新常量):
```ts
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, tidyLayout, CARD_W, CARD_H, GAP_X, GAP_Y, CASCADE_STEP, COMPONENT_GAP, MAX_ROW_WIDTH, SNAP_GRID } from './card-layout';
```

把第 58-117 行的 `describe('tidyLayout 树形整理布局', () => { ... });` 整块替换为:
```ts
describe('tidyLayout flextree 整理布局', () => {
  const COL = CARD_W + GAP_X;       // 260:父→子列步距(尺寸均为默认时)
  const ROW = CARD_H + GAP_Y;       // 190:同列叶子纵向步距(尺寸均为默认时)
  const snap = (v: number) => Math.round(v / SNAP_GRID) * SNAP_GRID;

  test('空数组 → 空 Map', () => {
    expect(tidyLayout([]).size).toBe(0);
  });

  test('单卡:锚点取 min(x,y) 且网格吸附', () => {
    // baseX=53→snap 50;baseY=117→snap 120
    const m = tidyLayout([{ id: 'a', position: { x: 53, y: 117 } }]);
    expect(m.get('a')).toEqual({ x: 50, y: 120 });
  });

  test('单棵树:父列<子列,子节点纵向堆叠,父纵向居中于子(吸附后)', () => {
    const m = tidyLayout([
      { id: 'p', position: { x: 0, y: 0 } },
      { id: 'c1', parentId: 'p', position: { x: 0, y: 0 } },
      { id: 'c2', parentId: 'p', position: { x: 0, y: 0 } },
    ]);
    expect(m.get('c1')).toEqual({ x: COL, y: 0 });
    expect(m.get('c2')).toEqual({ x: COL, y: ROW });        // 190
    // 子中心 75 / 265,中点 170,父 y=170-75=95,snap→100
    expect(m.get('p')).toEqual({ x: 0, y: 100 });
  });

  test('真实尺寸:宽卡撑宽整列,后续列按真实宽 + GAP_X 右移', () => {
    const m = tidyLayout([
      { id: 'p', position: { x: 0, y: 0 } },
      { id: 'c', parentId: 'p', width: 600, height: 150, position: { x: 0, y: 0 } },
      { id: 'g', parentId: 'c', position: { x: 0, y: 0 } },
    ]);
    expect(m.get('p')).toEqual({ x: 0, y: 0 });
    expect(m.get('c')).toEqual({ x: COL, y: 0 });           // 260
    // colX[2] = colX[1] + 真实宽600 + GAP_X80 = 260 + 680 = 940
    expect(m.get('g')).toEqual({ x: 940, y: 0 });
  });

  test('货架多行:首行累计宽超 MAX_ROW_WIDTH 后换行,x 回到 baseX、y 进入第二行', () => {
    const wide = (id: string, y: number) => ({ id, width: 1000, height: 150, position: { x: 0, y } });
    const m = tidyLayout([wide('n0', 0), wide('n1', 1), wide('n2', 2), wide('n3', 3)]);
    // 盒宽1000,盒距COMPONENT_GAP60 → 步距1060;baseX=0
    // n0@0, n1@1060, n2@2120;n3 时 cx=3180,3180+1000>3200 → 换行:cx=0, cy=150+60=210
    expect(m.get('n0')).toEqual({ x: 0, y: 0 });
    expect(m.get('n1')).toEqual({ x: 1060, y: 0 });
    expect(m.get('n2')).toEqual({ x: 2120, y: 0 });
    expect(m.get('n3')).toEqual({ x: 0, y: 210 });
  });

  test('网格吸附:所有输出坐标均为 SNAP_GRID 的整数倍', () => {
    const m = tidyLayout([
      { id: 'p', position: { x: 7, y: 3 } },
      { id: 'c1', parentId: 'p', position: { x: 0, y: 0 } },
      { id: 'c2', parentId: 'p', position: { x: 0, y: 0 } },
      { id: 'c3', parentId: 'p', position: { x: 0, y: 0 } },
    ]);
    for (const pos of m.values()) {
      expect(pos.x % SNAP_GRID).toBe(0);
      expect(pos.y % SNAP_GRID).toBe(0);
    }
  });

  test('孤儿 parentId(指向不存在 id)→ 当作根处理', () => {
    const m = tidyLayout([{ id: 'a', parentId: 'ghost', position: { x: 50, y: 50 } }]);
    expect(m.get('a')).toEqual({ x: 50, y: 50 });
  });

  test('防环:parentId 互指不死循环,所有节点都落位', () => {
    const m = tidyLayout([
      { id: 'a', parentId: 'b', position: { x: 0, y: 0 } },
      { id: 'b', parentId: 'a', position: { x: 0, y: 0 } },
    ]);
    expect(m.size).toBe(2);
  });

  test('同列(同深度)节点两两不重叠', () => {
    // 父 p,三子 c1/c2/c3 同列;断言相邻子 y 差 ≥ CARD_H(不重叠)
    const m = tidyLayout([
      { id: 'p', position: { x: 0, y: 0 } },
      { id: 'c1', parentId: 'p', position: { x: 0, y: 0 } },
      { id: 'c2', parentId: 'p', position: { x: 0, y: 0 } },
      { id: 'c3', parentId: 'p', position: { x: 0, y: 0 } },
    ]);
    const ys = ['c1', 'c2', 'c3'].map((id) => m.get(id)!.y).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(CARD_H);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(CARD_H);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm exec vitest run src/lib/card-layout.test.ts
```
Expected: FAIL —— 新用例(真实尺寸 / 货架 / 吸附 / 同列不重叠)断言不符,且 `COMPONENT_GAP/MAX_ROW_WIDTH/SNAP_GRID` 未导出(import 报错)。

- [ ] **Step 3: 实现 — 新增常量并重写 `tidyLayout`**

在 `src/lib/card-layout.ts`,把第 4-10 行常量区(`CARD_W`…`MAX_AVOID_RINGS`)之后补三个新常量(放在 `CASCADE_STEP` 之后、`MAX_AVOID_RINGS` 之前或之后均可):
```ts
// flextree 整理:货架打包与吸附参数
export const COMPONENT_GAP = 60;     // 树盒之间(横向)与货架行之间(纵向)留白
export const MAX_ROW_WIDTH = 3200;   // 货架换行阈值:一行累计宽超过它就换到下一行
export const SNAP_GRID = 10;         // 网格吸附粒度:坐标吸附到该倍数
```

把第 61-133 行(`export interface TidyNode` 到 `tidyLayout` 结束)整块替换为:
```ts
// tidyLayout 输入的最小节点形状(不依赖 store 的 Asset,保持本文件无业务耦合;Asset 结构兼容可直接传入)
// width/height 可选:画布层喂入真实量得尺寸;缺失时退回 CARD_W/CARD_H。
export interface TidyNode { id: string; parentId?: string; position: XY; width?: number; height?: number }

// 该树布局结果:局部坐标(左上角 0,0)+ 包围盒尺寸
interface TreeBox { localPos: Map<string, XY>; w: number; h: number }

// 一键整理(flextree):把森林(parentId 关系)重排成整齐树形,返回 id→新坐标。
// 用户主动触发,是"系统永不挪动卡片"原则的有意例外。
// 列=深度(根在左、派生链向右),列宽按该树各深度真实最大宽累计;
// 行=子树相对定位(Reingold–Tilford,变高):兄弟按各自子树纵向占位依次堆叠,父居中于首末子;
//    不同深度分支不在同列,可复用纵向空间 → 比"每叶独占全局一行"更紧凑。
// 多树:各树先在局部坐标布好得包围盒,再货架式从左到右铺、超 MAX_ROW_WIDTH 换行。
// 锚点取所有卡当前 min(x,y) → 整理后仍停在原区域;末了网格吸附 + 取整匹配后端 int。
export function tidyLayout(nodes: TidyNode[]): Map<string, XY> {
  const result = new Map<string, XY>();
  if (nodes.length === 0) return result;

  const ids = new Set(nodes.map((n) => n.id));
  // 有效父:parentId 指向集合内、且不自指,才算真正的父子边(与 selectCanvasEdges 一致)
  const hasParent = (n: TidyNode) => !!n.parentId && ids.has(n.parentId) && n.parentId !== n.id;
  const byPos = (a: TidyNode, b: TidyNode) => a.position.y - b.position.y || a.position.x - b.position.x;
  const w = (n: TidyNode) => n.width ?? CARD_W;
  const h = (n: TidyNode) => n.height ?? CARD_H;

  // 子节点索引,按当前位置排序(整理贴近现有排布,确定性可测)
  const childrenOf = new Map<string, TidyNode[]>();
  for (const n of nodes) {
    if (!hasParent(n)) continue;
    const arr = childrenOf.get(n.parentId!);
    if (arr) arr.push(n);
    else childrenOf.set(n.parentId!, [n]);
  }
  for (const list of childrenOf.values()) list.sort(byPos);

  const roots = nodes.filter((n) => !hasParent(n)).sort(byPos);
  const visited = new Set<string>(); // 跨树去重 + 防环:已布过的节点不再进别的树

  // 单棵树布局:返回局部坐标(左上角归零)与包围盒
  const layoutTree = (root: TidyNode): TreeBox => {
    // 1) 收集各深度真实最大宽 → 列 x 累计
    const seenW = new Set<string>();
    const depthMaxW: number[] = [];
    const collect = (node: TidyNode, depth: number) => {
      if (seenW.has(node.id) || visited.has(node.id)) return;
      seenW.add(node.id);
      depthMaxW[depth] = Math.max(depthMaxW[depth] ?? 0, w(node));
      for (const c of childrenOf.get(node.id) ?? []) collect(c, depth + 1);
    };
    collect(root, 0);
    const colX: number[] = [];
    let acc = 0;
    for (let d = 0; d < depthMaxW.length; d++) {
      colX[d] = acc;
      acc += (depthMaxW[d] ?? CARD_W) + GAP_X;
    }

    // 2) 纵向相对定位:place 返回子树纵向区间 [top, bottom],并写入局部坐标
    //    父居中用「子节点返回的 band 中心」而非读 localPos —— 互指环里子尚未落位时不会读到 undefined
    const localPos = new Map<string, XY>();
    const seenP = new Set<string>();
    const place = (node: TidyNode, depth: number, yStart: number): { top: number; bottom: number } => {
      if (seenP.has(node.id)) return { top: yStart, bottom: yStart };
      seenP.add(node.id);
      const x = colX[depth];
      const kids = (childrenOf.get(node.id) ?? []).filter((c) => !visited.has(c.id));
      if (kids.length === 0) {
        localPos.set(node.id, { x, y: yStart });
        return { top: yStart, bottom: yStart + h(node) };
      }
      let cursor = yStart;
      const bands: { top: number; bottom: number }[] = [];
      for (const kid of kids) {
        const band = place(kid, depth + 1, cursor);
        bands.push(band);
        cursor = band.bottom + GAP_Y; // 下一兄弟接在上一子树底部之下,子树整体不重叠
      }
      const first = bands[0];
      const last = bands[bands.length - 1];
      const center = ((first.top + first.bottom) / 2 + (last.top + last.bottom) / 2) / 2;
      const y = center - h(node) / 2; // 父纵向居中于首末子
      localPos.set(node.id, { x, y });
      return { top: Math.min(y, first.top), bottom: Math.max(y + h(node), last.bottom) };
    };
    const band = place(root, 0, 0);

    // 3) 归一:整棵树平移到左上角 (0,0)(minX 恒为 colX[0]=0,minY=band.top),并量包围盒
    const minY = band.top;
    let maxX = 0;
    let maxY = 0;
    for (const [id, p] of localPos) {
      const node = nodes.find((n) => n.id === id)!;
      const ny = p.y - minY;
      localPos.set(id, { x: p.x, y: ny });
      maxX = Math.max(maxX, p.x + w(node));
      maxY = Math.max(maxY, ny + h(node));
    }
    for (const id of localPos.keys()) visited.add(id);
    return { localPos, w: maxX, h: maxY };
  };

  const boxes: TreeBox[] = [];
  for (const r of roots) {
    if (visited.has(r.id)) continue;
    boxes.push(layoutTree(r));
  }
  // 防环兜底:纯环里无根可达的节点,按原序补落为根,保证每个节点都有坐标
  for (const n of nodes) {
    if (!visited.has(n.id)) boxes.push(layoutTree(n));
  }

  // 4) 货架打包:从所有卡当前 min(x,y) 起从左到右铺,超 MAX_ROW_WIDTH 换行;末了网格吸附 + 取整
  let baseX = Infinity;
  let baseY = Infinity;
  for (const n of nodes) {
    if (n.position.x < baseX) baseX = n.position.x;
    if (n.position.y < baseY) baseY = n.position.y;
  }
  const snap = (v: number) => Math.round(v / SNAP_GRID) * SNAP_GRID;
  let cx = baseX;
  let cy = baseY;
  let rowH = 0;
  for (const box of boxes) {
    if (cx > baseX && cx + box.w > baseX + MAX_ROW_WIDTH) {
      cy += rowH + COMPONENT_GAP;
      cx = baseX;
      rowH = 0;
    }
    for (const [id, p] of box.localPos) {
      result.set(id, { x: snap(cx + p.x), y: snap(cy + p.y) });
    }
    cx += box.w + COMPONENT_GAP;
    rowH = Math.max(rowH, box.h);
  }
  return result;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm exec vitest run src/lib/card-layout.test.ts
```
Expected: PASS(全部用例)。

- [ ] **Step 5: 类型检查**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: 无新增错误(`tidyCanvas` 仍以无尺寸方式调用,Task 2 再扩展)。

- [ ] **Step 6: 提交**

```bash
git add src/lib/card-layout.ts src/lib/card-layout.test.ts
git commit -m "feat: tidyLayout 升级为 flextree(真实尺寸列宽/子树紧凑/货架多行/网格吸附)"
```

---

## Task 2: store action `tidyCanvas(sizeById?)` 喂入真实尺寸

**Files:**
- Modify: `src/store/actions.ts`(第 6 行 import 补 `type TidyNode`;第 404-418 行 `tidyCanvas` 重写)
- Test: `src/store/actions.test.ts`(替换 `describe('tidyCanvas 一键整理', ...)`,第 819-852 行;顶部已 import `CARD_W/GAP_X`,补 `tidyLayout`)

**Interfaces:**
- Consumes: `tidyLayout`、`TidyNode`(Task 1)
- Produces: `tidyCanvas: (sizeById?: Record<string, { width: number; height: number }>) => void`(经 `ReturnType<typeof createServerActions>` 自动并入 `ServerActions` 类型,无需手改类型声明)

- [ ] **Step 1: 替换 store 测试块**

把 `src/store/actions.test.ts` 第 819-852 行 `describe('tidyCanvas 一键整理', ...)` 整块替换为:
```ts
describe('tidyCanvas 一键整理', () => {
  const asset = (id: string, parentId: string | undefined, x: number, y: number): Asset => ({
    id, key: id, label: id, kind: 'image', source: 'generated', status: 'ready',
    position: { x, y }, ...(parentId ? { parentId } : {}),
  });

  test('重排所有卡为 tidyLayout 输出;仅对变位且非 pending_ 的卡回写坐标', async () => {
    const before = [
      asset('p', undefined, 0, 0),
      asset('c', 'p', 0, 0),
      asset('pending_x', undefined, 999, 999),
    ];
    useStore.setState({ currentProjectId: 1, assets: before });

    useStore.getState().tidyCanvas();

    // 落库坐标必须等于纯函数输出(与算法解耦,算法细节由 card-layout.test 守护)
    const layout = tidyLayout(before);
    const after = useStore.getState().assets;
    for (const a of after) expect(a.position).toEqual(layout.get(a.id));

    await Promise.resolve(); // 放行 fire-and-forget 回写微任务
    const calledIds = api.updateCanvasReference.mock.calls.map((call) => call[1]);
    const expectedPersist = before
      .filter((a) => !a.id.startsWith('pending_'))
      .filter((a) => {
        const p = layout.get(a.id)!;
        return p.x !== a.position.x || p.y !== a.position.y;
      })
      .map((a) => a.id);
    expect(new Set(calledIds)).toEqual(new Set(expectedPersist));
    expect(calledIds).not.toContain('pending_x'); // 占位卡永不回写
  });

  test('sizeById 透传:宽卡撑宽列 → 其子列右移', () => {
    const before = [
      asset('p', undefined, 0, 0),
      asset('c', 'p', 0, 0),
      asset('g', 'c', 0, 0),
    ];
    useStore.setState({ currentProjectId: 1, assets: before });

    useStore.getState().tidyCanvas({ c: { width: 600, height: 150 } });

    const after = useStore.getState().assets;
    const px = after.find((a) => a.id === 'p')!.position.x;
    const gx = after.find((a) => a.id === 'g')!.position.x;
    // g 在第 3 列:列 x 累计含 c 的真实宽 600,远大于默认 CARD_W 情形
    expect(gx).toBe(px + (CARD_W + GAP_X) + (600 + GAP_X));
  });

  test('无当前项目 / 空画布 → no-op 不抛错', () => {
    useStore.setState({ currentProjectId: null, assets: [] });
    expect(() => useStore.getState().tidyCanvas()).not.toThrow();
  });
});
```

确认 `src/store/actions.test.ts` 顶部 import 含 `tidyLayout`(与 `CARD_W, GAP_X` 同处导入 `@/lib/card-layout`);若缺则补:
```ts
import { CARD_W, GAP_X, tidyLayout } from '@/lib/card-layout';
```
(注:沿用文件现有的 `@/lib/card-layout` 导入行,把 `tidyLayout` 加进去即可,不要新增重复 import 行。)

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm exec vitest run src/store/actions.test.ts -t "tidyCanvas"
```
Expected: FAIL —— `sizeById 透传` 用例因 `tidyCanvas` 当前不接收参数而尺寸未生效(gx 不等于预期),且 `tidyLayout` 若未 import 会报错。

- [ ] **Step 3: 实现 — `tidyCanvas` 接收并并入 sizeById**

在 `src/store/actions.ts` 第 6 行 import 补 `type TidyNode`:
```ts
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, tidyLayout, type XY, type TidyNode } from '@/lib/card-layout';
```

把第 404-418 行 `tidyCanvas` 整块替换为:
```ts
  // 一键整理:把画布所有卡重排成整齐 flextree 布局(用户主动触发,是"系统不挪卡"原则的有意例外)。
  // sizeById:画布层量得的真实节点尺寸(id→{width,height}),缺失走 CARD_W/CARD_H 兜底。
  // 一次 set 落库;只对真正变位且非占位(pending_)的卡 fire-and-forget 回写坐标(复用 persistAssetPosition)。
  const tidyCanvas = (sizeById?: Record<string, { width: number; height: number }>) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const assets = get().assets;
    if (assets.length === 0) return;
    const tidyNodes: TidyNode[] = assets.map((a) => {
      const s = sizeById?.[a.id];
      return { id: a.id, parentId: a.parentId, position: a.position, ...(s ? { width: s.width, height: s.height } : {}) };
    });
    const layout = tidyLayout(tidyNodes);
    const moved: string[] = [];
    const next = assets.map((a) => {
      const pos = layout.get(a.id);
      if (!pos || (pos.x === a.position.x && pos.y === a.position.y)) return a;
      if (!a.id.startsWith('pending_')) moved.push(a.id); // 占位卡无后端 item,不回写
      return { ...a, position: pos };
    });
    set({ assets: next });
    for (const id of moved) void persistAssetPosition(id);
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm exec vitest run src/store/actions.test.ts -t "tidyCanvas"
```
Expected: PASS(三条用例)。

- [ ] **Step 5: 类型检查**

Run:
```bash
pnpm exec tsc --noEmit
```
Expected: 无错误(`ServerActions` 经 `ReturnType` 自动带上新签名)。

- [ ] **Step 6: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: tidyCanvas 接收画布真实尺寸 sizeById 并透传给 tidyLayout"
```

---

## Task 3: `AssetCanvas.onTidy` 收集真实尺寸传入

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(第 232 行 `useReactFlow` 解构补 `getNodes`;第 242-247 行 `onTidy` 重写)

**Interfaces:**
- Consumes: `tidyCanvas(sizeById?)`(Task 2)、`useReactFlow().getNodes()`(@xyflow/react)

- [ ] **Step 1: 解构补 `getNodes`**

把 `src/components/canvas/AssetCanvas.tsx` 第 232 行:
```ts
  const { screenToFlowPosition, setCenter, getViewport } = useReactFlow();
```
改为:
```ts
  const { screenToFlowPosition, setCenter, getViewport, getNodes } = useReactFlow();
```

- [ ] **Step 2: 重写 `onTidy` 收集真实尺寸**

把第 242-247 行 `onTidy`:
```ts
  const onTidy = () => {
    setTidying(true);
    tidyCanvas();
    if (tidyTimer.current) clearTimeout(tidyTimer.current);
    tidyTimer.current = setTimeout(() => setTidying(false), 340);
  };
```
改为:
```ts
  const onTidy = () => {
    setTidying(true);
    // 从 React Flow 取各节点量得的真实尺寸(measured 优先,回退声明值),喂给 tidyLayout 做按尺寸布局
    const sizeById: Record<string, { width: number; height: number }> = {};
    for (const n of getNodes()) {
      const width = n.measured?.width ?? n.width;
      const height = n.measured?.height ?? n.height;
      if (typeof width === 'number' && typeof height === 'number') sizeById[n.id] = { width, height };
    }
    tidyCanvas(sizeById);
    if (tidyTimer.current) clearTimeout(tidyTimer.current);
    tidyTimer.current = setTimeout(() => setTidying(false), 340);
  };
```

- [ ] **Step 3: 类型检查 + lint**

Run:
```bash
pnpm exec tsc --noEmit && pnpm lint
```
Expected: 无错误、无 lint 告警。

- [ ] **Step 4: 全量测试**

Run:
```bash
pnpm test
```
Expected: 全绿(含 card-layout、store actions)。

- [ ] **Step 5: 手动验证(真实画布)**

Run:
```bash
pnpm dev
```
打开画布,生成/派生多张卡并拖乱(含宽视频卡、若干游离卡),点左下「整理」按钮:
- 卡片平滑滑动到 flextree 布局(列按深度、宽卡列更宽、子树紧凑)。
- 游离卡/多树铺成多行(超宽换行),整体停在原视野(相机不动)。
- 刷新后位置保持(变位卡已回写)。
Expected: 行为符合上述;无控制台报错。

- [ ] **Step 6: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 一键整理从 React Flow measured 收集真实尺寸喂入 tidyCanvas"
```

---

## 收尾(全部任务后)

- [ ] 回主仓合并并清理 worktree(按 CLAUDE.md 约定):
```bash
cd /Users/nickhopps/Documents/taluna/game-create-platform
git merge feat/tidy-flextree
git worktree remove .claude/worktrees/tidy-flextree
git branch -d feat/tidy-flextree
```
- [ ] 确认主仓 `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build` 全绿。

## Self-Review 记录

- **Spec 覆盖**:四项能力 → 真实尺寸(Task1 colX 累计 + Task2/3 喂入)、子树紧凑(Task1 place band 定位)、货架多行(Task1 第 4 步 + Task1 货架用例)、网格吸附(Task1 snap + 吸附用例)。接线(Task2/3)、测试(Task1/2)、动画/按钮/i18n(沿用,无任务)均有归属。
- **占位符**:无 TBD/TODO;每个代码步给出完整代码与命令。
- **类型一致**:`tidyLayout(nodes: TidyNode[]): Map<string, XY>`、`TidyNode{width?,height?}`、`tidyCanvas(sizeById?: Record<string,{width:number;height:number}>)`、常量 `COMPONENT_GAP/MAX_ROW_WIDTH/SNAP_GRID` 在 Task1 定义、Task1/2 测试与 Task3 调用处一致。
- **边界**:cycle 用 band 中心而非 localPos 读,避免互指环 undefined;leaf/internal band 语义统一。
