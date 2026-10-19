# 一键整理纳入引用边 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一键整理时，无 `parentId` 但有 `refIds` 的卡取第一个有效引用为「布局父」，落到主引用资产右侧下一列。

**Architecture:** 全部在 `src/lib/card-layout.ts` 纯函数内：`TidyNode` 加 `refIds?: string[]`，预计算 `layoutParentOf` Map（parentId 优先、回退首个有效 ref），`hasParent` 与 `childrenOf` 基于该 Map；调用方 `actions.ts` 组装 TidyNode 时补传 `refIds`。防环沿用既有 `visited`/`seenP`/`seenW` 守卫。

**Tech Stack:** TypeScript / Vitest（jsdom + globals，测试与源码同目录）。

## Global Constraints

- 设计稿：`docs/superpowers/specs/2026-07-04-tidy-ref-edges-design.md`
- 注释 / commit message 一律中文；commit 一句话总结变更。
- `card-layout.ts` 保持纯函数、无业务耦合（不 import store 类型）。
- 布局父优先级：有效 `parentId` > `refIds` 首个有效引用 > 根；「有效」= 指向集合内且非自指。
- 不变：分带（kindOrder）、货架铺放、锚点、网格吸附、`selectCanvasEdges`。
- 测试命令：`pnpm exec vitest run <文件>`；类型检查 `pnpm exec tsc --noEmit`。

---

### Task 1: card-layout 布局父纳入引用

**Files:**
- Modify: `src/lib/card-layout.ts:91`（`TidyNode`）与 `:107-124`（建树前索引）
- Test: `src/lib/card-layout.test.ts`

**Interfaces:**
- Produces: `TidyNode.refIds?: string[]`；`tidyLayout` 内部布局父规则：`parentId`（有效）优先，否则 `refIds` 中首个有效引用；对外签名不变。

- [ ] **Step 1: 写失败测试**

在 `src/lib/card-layout.test.ts` 的 tidyLayout 相关 describe 中追加（节点构造沿用文件内既有方式；下面 `tn` 为示意工厂，若文件已有等价工厂则复用）：

```ts
const tn = (id: string, extra: Partial<TidyNode> = {}): TidyNode =>
  ({ id, position: { x: 0, y: 0 }, ...extra });

describe('tidyLayout 引用边参与建树', () => {
  test('无 parentId 有 refIds:挂到首个有效引用右侧下一列', () => {
    const out = tidyLayout([tn('a'), tn('gen', { refIds: ['a'] })]);
    expect(out.get('gen')!.x).toBeGreaterThan(out.get('a')!.x);
    // 同一棵树:不会被货架式铺成两棵并排的根(y 带内、x 相邻列)
  });

  test('parentId 优先于 refIds', () => {
    const out = tidyLayout([tn('p'), tn('r'), tn('c', { parentId: 'p', refIds: ['r'] })]);
    expect(out.get('c')!.x).toBeGreaterThan(out.get('p')!.x);
    // c 是 p 的独子:与 p 同带;r 是另一棵单节点树
  });

  test('refIds 首个无效则取下一个有效;全部无效仍为根', () => {
    const out = tidyLayout([tn('a'), tn('g1', { refIds: ['gone', 'a'] }), tn('g2', { refIds: ['gone', 'g2'] })]);
    expect(out.get('g1')!.x).toBeGreaterThan(out.get('a')!.x);   // 跳过 gone 取 a
    expect(out.get('g2')).toBeDefined();                          // 自指+缺失 → 根,仍有落位
  });

  test('互指环不死循环,两节点各落位一次', () => {
    const out = tidyLayout([tn('a', { refIds: ['b'] }), tn('b', { refIds: ['a'] })]);
    expect(out.size).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: FAIL（refIds 不在 TidyNode 上 / gen 与 a 被铺成并排根，x 不满足右移断言）

- [ ] **Step 3: 最小实现**

`src/lib/card-layout.ts`：

1. `TidyNode`（line 91）加 `refIds`：

```ts
export interface TidyNode { id: string; parentId?: string; refIds?: string[]; position: XY; width?: number; height?: number; kind?: string }
```

2. 把 line 108-121 的 `hasParent` 与 `childrenOf` 建索引段替换为基于「布局父」：

```ts
  // 有效引用:指向集合内、且不自指(与 selectCanvasEdges 一致)
  const valid = (n: TidyNode, p: string | undefined): p is string => !!p && byId.has(p) && p !== n.id;
  // 布局父:有效 parentId 优先;否则取 refIds 中首个有效引用(引用生成卡挂到主引用右侧,其余引用边纯视觉)
  const layoutParentOf = new Map<string, string>();
  for (const n of nodes) {
    if (valid(n, n.parentId)) layoutParentOf.set(n.id, n.parentId);
    else {
      const r = (n.refIds ?? []).find((x) => valid(n, x));
      if (r) layoutParentOf.set(n.id, r);
    }
  }
  const hasParent = (n: TidyNode) => layoutParentOf.has(n.id);
  const byPos = (a: TidyNode, b: TidyNode) => a.position.y - b.position.y || a.position.x - b.position.x;
  const w = (n: TidyNode) => n.width ?? CARD_W;
  const h = (n: TidyNode) => n.height ?? CARD_H;

  // 子节点索引,按当前位置排序(整理贴近现有排布,确定性可测)
  const childrenOf = new Map<string, TidyNode[]>();
  for (const n of nodes) {
    const p = layoutParentOf.get(n.id);
    if (!p) continue;
    const arr = childrenOf.get(p);
    if (arr) arr.push(n);
    else childrenOf.set(p, [n]);
  }
  for (const list of childrenOf.values()) list.sort(byPos);
```

（互指环 a⇄b：两者互为布局父 → 都 `hasParent` → 都不是根。roots 为空时既有代码不会遍历到它们——检查 `roots` 计算后是否有兜底；若没有，需在 roots 之后补一段「未入任何树的剩余节点按根处理」：

```ts
  const roots = nodes.filter((n) => !hasParent(n)).sort(byPos);
  // 互指环兜底:环内节点互为布局父,谁都不是根 → 会整体漏排;把尚未可达的节点按位置序补为根
  const reachable = new Set<string>();
  const mark = (n: TidyNode) => {
    if (reachable.has(n.id)) return;
    reachable.add(n.id);
    for (const c of childrenOf.get(n.id) ?? []) mark(c);
  };
  for (const r of roots) mark(r);
  for (const n of [...nodes].sort(byPos)) if (!reachable.has(n.id)) { roots.push(n); mark(n); }
```

注意：`mark` 用 `childrenOf` 可达性；补根后其环内伙伴经 childrenOf 可达，由 `layoutTree` 的 `seenP`/`visited` 保证只落位一次。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: PASS（含既有用例——纯 parentId 场景行为不变）

- [ ] **Step 5: Commit**

```bash
git add src/lib/card-layout.ts src/lib/card-layout.test.ts
git commit -m "feat: 一键整理布局父纳入 refIds 引用"
```

---

### Task 2: actions 组装 TidyNode 传 refIds

**Files:**
- Modify: `src/store/actions.ts:511`（tidy 处组装 TidyNode）
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 `TidyNode.refIds`；`Asset.refIds`（已存在）。
- Produces: 一键整理 action 喂给 `tidyLayout` 的节点带 `refIds`。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 追加（沿用文件内既有一键整理用例的 store 初始化方式）：

```ts
test('一键整理:引用生成卡(无 parentId 有 refIds)挂到引用资产右侧', async () => {
  // 预置画布:资产 a 与引用它的 gen(refIds:['a'],无 parentId),坐标故意拉远
  // 沿用既有 tidy 用例骨架触发整理 action,断言整理后 gen.position.x > a.position.x
});
```

（按文件内既有 tidy/整理测试的构造方式补全为可执行代码；若 actions.test.ts 无既有 tidy 用例，则找到触发 `tidyLayout` 的 action 名——`src/store/actions.ts:511` 所在函数——按其它 action 测试的 store 骨架写。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: FAIL（refIds 未传入 tidyLayout，gen 被当作独立根铺放）

- [ ] **Step 3: 最小实现**

`src/store/actions.ts:511` 组装处加 `refIds`：

```ts
      return { id: a.id, parentId: a.parentId, refIds: a.refIds, kind: a.kind, position: a.position, ...(s ? { width: s.width, height: s.height } : {}) };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含既有用例）

- [ ] **Step 5: 全量校验 + Commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 一键整理组装 TidyNode 传入 refIds"
```
