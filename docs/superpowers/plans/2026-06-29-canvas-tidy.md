# 资产画布「一键整理」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给资产画布加一个「一键整理」按钮(放在画布下方 `ZoomBar` 工具栏),把所有卡片重排成整齐的树形布局并平滑动画到位。

**Architecture:** 纯落位逻辑下沉到 `lib/card-layout.ts` 的新纯函数 `tidyLayout`(树形布局,列=深度、行=DFS 叶序+父居中,锚点取当前 min(x,y));store action `tidyCanvas` 调它算坐标、一次 `set` 落库、对变位的非占位卡 fire-and-forget 回写;UI 在 `ZoomBar` 加按钮触发,整理期间给画布容器加 `.canvas-tidying` 类驱动一条 CSS transition 实现平滑滑动。

**Tech Stack:** TypeScript · React 19 · zustand · @xyflow/react · vitest(jsdom)· Tailwind v4 + CSS 变量 · react-i18next。

## Global Constraints

- 代码注释 / commit message 一律用**中文**;commit 里 `docs:` 与 `feat:` 成对。
- 纯函数不可变返回;状态变更只走唯一 store 入口;坐标 `Math.round` 取整(后端 `canvas_x/y` 是 int)。
- 颜色 / 圆角 / 阴影 / 动效全走既有令牌与动画类:**禁止**硬编码色值、一次性 keyframes、新按钮种类、自造 toast。
- 图标走 `FigIcon` + `figAsset` 注册表;按钮走 `IconButton`;所有交互元素配 `aria-label` 或包 `Tooltip`。
- 新增的过渡必须同步进 `globals.css` 的 `@media (prefers-reduced-motion: reduce)` 禁用列表。
- i18n:en 是唯一真相源,新增文案补齐 en / zh / vi / es 四套。
- 测试与源码同目录;Vitest 用 jsdom + globals,`@`→`src`。
- 常量来自 `card-layout.ts`:`CARD_W=180`、`CARD_H=150`、`GAP_X=80`、`GAP_Y=40` → 列距 `COL=260`、行距 `ROW=190`。

---

## Task 0: 工作区准备(装依赖)

新建的 worktree 没有 `node_modules`,任何 `pnpm exec`/`vitest`/`tsc` 之前必须先装依赖。

- [ ] **Step 1: 安装依赖**

Run: `pnpm install`
Expected: 安装完成,`node_modules/.bin/vitest` 可执行。(若已由准备步骤装好,此步幂等跳过。)

---

## Task 1: `tidyLayout` 纯函数(树形布局)

**Files:**
- Modify: `src/lib/card-layout.ts`(在文件末尾追加 `TidyNode` 接口与 `tidyLayout` 函数)
- Test: `src/lib/card-layout.test.ts`(追加一个 `describe` 块)

**Interfaces:**
- Consumes: 现有导出常量 `CARD_W`、`CARD_H`、`GAP_X`、`GAP_Y` 与类型 `XY`(同文件)。
- Produces:
  - `export interface TidyNode { id: string; parentId?: string; position: XY }`
  - `export function tidyLayout(nodes: TidyNode[]): Map<string, XY>` —— 返回 id→新坐标。后续 `tidyCanvas` 直接传 `Asset[]`(结构兼容 `TidyNode`)。

- [ ] **Step 1: 写失败测试**

在 `src/lib/card-layout.test.ts` 顶部 import 里加上 `tidyLayout`(与现有 import 合并):

```ts
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, tidyLayout, CARD_W, CARD_H, GAP_X, GAP_Y, CASCADE_STEP } from './card-layout';
```

在文件末尾追加:

```ts
describe('tidyLayout 树形整理布局', () => {
  const COL = CARD_W + GAP_X; // 260
  const ROW = CARD_H + GAP_Y; // 190

  test('空数组 → 空 Map', () => {
    expect(tidyLayout([]).size).toBe(0);
  });

  test('扁平多卡(无 parentId):单列纵向、按当前 (y,x) 排序、锚点取 min(x,y)、树间留一行', () => {
    const m = tidyLayout([
      { id: 'a', position: { x: 50, y: 300 } },
      { id: 'b', position: { x: 20, y: 100 } },
      { id: 'c', position: { x: 80, y: 200 } },
    ]);
    // baseX=20, baseY=100;排序 b(100)→c(200)→a(300);各自单根,行 0/2/4(树间空一行)
    expect(m.get('b')).toEqual({ x: 20, y: 100 });
    expect(m.get('c')).toEqual({ x: 20, y: 100 + 2 * ROW });
    expect(m.get('a')).toEqual({ x: 20, y: 100 + 4 * ROW });
  });

  test('单棵树:父列<子列,子节点纵向堆叠,父纵向居中于子', () => {
    const m = tidyLayout([
      { id: 'p', position: { x: 0, y: 0 } },
      { id: 'c1', parentId: 'p', position: { x: 0, y: 0 } },
      { id: 'c2', parentId: 'p', position: { x: 0, y: 0 } },
    ]);
    expect(m.get('c1')).toEqual({ x: COL, y: 0 });
    expect(m.get('c2')).toEqual({ x: COL, y: ROW });
    expect(m.get('p')).toEqual({ x: 0, y: Math.round(0.5 * ROW) }); // 居中于 c1/c2
  });

  test('森林(多根):各树分带、整体无重叠', () => {
    const m = tidyLayout([
      { id: 'p1', position: { x: 0, y: 0 } },
      { id: 'c', parentId: 'p1', position: { x: 0, y: 0 } },
      { id: 'p2', position: { x: 0, y: 0 } },
    ]);
    expect(m.get('p1')).toEqual({ x: 0, y: 0 });
    expect(m.get('c')).toEqual({ x: COL, y: 0 });
    expect(m.get('p2')).toEqual({ x: 0, y: 2 * ROW }); // 第 1 棵树占行 0,树间空行 1,p2 落行 2
  });

  test('孤儿 parentId(指向不存在的 id)→ 当作根处理', () => {
    const m = tidyLayout([{ id: 'a', parentId: 'ghost', position: { x: 5, y: 5 } }]);
    expect(m.get('a')).toEqual({ x: 5, y: 5 });
  });

  test('坐标取整(浮点视口坐标 → int)', () => {
    const m = tidyLayout([{ id: 'a', position: { x: 10.4, y: 20.6 } }]);
    expect(m.get('a')).toEqual({ x: 10, y: 21 });
  });

  test('防环:parentId 互指不死循环,所有节点都落位', () => {
    const m = tidyLayout([
      { id: 'a', parentId: 'b', position: { x: 0, y: 0 } },
      { id: 'b', parentId: 'a', position: { x: 0, y: 0 } },
    ]);
    expect(m.size).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: FAIL —— `tidyLayout` 未导出(`tidyLayout is not a function` / 类型报错)。

- [ ] **Step 3: 实现 `tidyLayout`**

在 `src/lib/card-layout.ts` 文件末尾追加:

```ts
// tidyLayout 输入的最小节点形状(不依赖 store 的 Asset,保持本文件无业务耦合;Asset 结构兼容可直接传入)
export interface TidyNode { id: string; parentId?: string; position: XY }

// 一键整理:把森林(parentId 关系)重排成整齐的树形布局,返回 id→新坐标。
// 用户主动触发,是"系统永不挪动卡片"原则的有意例外。
// 列=深度(根在左、派生链向右);行=DFS 叶序(叶各占一行),内部节点纵向居中于其子树;每棵树间留一行空隙。
// 根之间、兄弟之间均按各自"当前 (y,x)"排序 → 结果贴近现有排布、确定性可测。
// 锚点取所有卡当前 min(x,y) → 整理后仍停在原区域;坐标取整匹配后端 int。
export function tidyLayout(nodes: TidyNode[]): Map<string, XY> {
  const result = new Map<string, XY>();
  if (nodes.length === 0) return result;

  const ids = new Set(nodes.map((n) => n.id));
  // 有效父:parentId 指向集合内、且不自指,才算真正的父子边(与 selectCanvasEdges 一致)
  const hasParent = (n: TidyNode) => !!n.parentId && ids.has(n.parentId) && n.parentId !== n.id;
  const byPos = (a: TidyNode, b: TidyNode) => a.position.y - b.position.y || a.position.x - b.position.x;

  // 子节点索引,按当前位置排序
  const childrenOf = new Map<string, TidyNode[]>();
  for (const n of nodes) {
    if (!hasParent(n)) continue;
    const arr = childrenOf.get(n.parentId!);
    if (arr) arr.push(n);
    else childrenOf.set(n.parentId!, [n]);
  }
  for (const list of childrenOf.values()) list.sort(byPos);

  const roots = nodes.filter((n) => !hasParent(n)).sort(byPos);

  const COL = CARD_W + GAP_X;
  const ROW = CARD_H + GAP_Y;
  let baseX = Infinity;
  let baseY = Infinity;
  for (const n of nodes) {
    if (n.position.x < baseX) baseX = n.position.x;
    if (n.position.y < baseY) baseY = n.position.y;
  }

  const visited = new Set<string>();
  let row = 0;
  // 落位并返回该节点占据的行号(供父居中);防环:已访问直接返回当前游标,不重复落位
  const place = (node: TidyNode, depth: number): number => {
    if (visited.has(node.id)) return row;
    visited.add(node.id);
    const kids = childrenOf.get(node.id) ?? [];
    let nodeRow: number;
    if (kids.length === 0) {
      nodeRow = row;
      row += 1;
    } else {
      const childRows = kids.map((c) => place(c, depth + 1));
      nodeRow = (childRows[0] + childRows[childRows.length - 1]) / 2; // 居中于首末子节点
    }
    result.set(node.id, {
      x: Math.round(baseX + depth * COL),
      y: Math.round(baseY + nodeRow * ROW),
    });
    return nodeRow;
  };

  for (const r of roots) {
    place(r, 0);
    row += 1; // 树间留一行空隙
  }
  // 防环兜底:纯环里无根可达的节点,按原顺序补落为根,保证每个节点都有坐标
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      place(n, 0);
      row += 1;
    }
  }
  return result;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: PASS —— 含原有用例与新增 7 个 `tidyLayout` 用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/card-layout.ts src/lib/card-layout.test.ts
git commit -m "feat: card-layout 新增 tidyLayout 树形整理布局纯函数"
```

---

## Task 2: `tidyCanvas` store action

**Files:**
- Modify: `src/store/actions.ts`(import 加 `tidyLayout`;在 `createServerActions` 内加 `tidyCanvas`;加入返回对象)
- Test: `src/store/actions.test.ts`(追加一个 `describe` 块)

**Interfaces:**
- Consumes: `tidyLayout`(Task 1);同闭包内的 `persistAssetPosition`(已存在,签名 `(itemId: string) => Promise<void>`,内部调 `pgcApi.updateCanvasReference(pid, itemId, ref)`)。
- Produces: `tidyCanvas: () => void` —— 自动并入 `ServerActions`(`ReturnType<typeof createServerActions>`),经 `AppStore` 暴露到 store,UI 用 `useStore((s) => s.tidyCanvas)` 取用。**无需改 `index.ts` 类型**。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 末尾追加(`useStore`、`pgcApi as api`、`CARD_W`/`GAP_X`、`type Asset` 等已在该文件 import;若 `Asset` 未 import,则把 `type Message` 那行的 import 扩成 `import { createInitialKoubouState, createInitialServerState, type Message, type Asset } from './types';`):

```ts
describe('tidyCanvas 一键整理', () => {
  const asset = (id: string, parentId: string | undefined, x: number, y: number): Asset => ({
    id, key: id, label: id, kind: 'image', source: 'generated', status: 'ready',
    position: { x, y }, ...(parentId ? { parentId } : {}),
  });

  test('重排所有卡为树形布局;只对变位且非 pending_ 的卡回写坐标', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [
        asset('p', undefined, 0, 0),
        asset('c', 'p', 0, 0),                       // 与 p 重叠 → 会被移到右列
        asset('pending_x', undefined, 999, 999),     // 占位卡:参与布局但不回写
      ],
    });

    useStore.getState().tidyCanvas();

    const a = useStore.getState().assets;
    expect(a.find((x) => x.id === 'c')!.position).toEqual({ x: CARD_W + GAP_X, y: 0 });
    expect(a.find((x) => x.id === 'p')!.position).toEqual({ x: 0, y: 0 }); // 未变位

    await Promise.resolve(); // 放行 fire-and-forget 回写微任务
    const calledIds = api.updateCanvasReference.mock.calls.map((call) => call[1]);
    expect(calledIds).toContain('c');            // 变位的真实卡回写
    expect(calledIds).not.toContain('pending_x'); // 占位卡不回写
    expect(calledIds).not.toContain('p');         // 未变位不回写
  });

  test('无当前项目 / 空画布 → no-op 不抛错', () => {
    useStore.setState({ currentProjectId: null, assets: [] });
    expect(() => useStore.getState().tidyCanvas()).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "tidyCanvas"`
Expected: FAIL —— `tidyCanvas is not a function`。

- [ ] **Step 3: 实现 `tidyCanvas`**

3a. 在 `src/store/actions.ts` 第 6 行的 import 里加上 `tidyLayout`:

```ts
import { childPosition, spawnAtPoint, cascadePosition, avoidOverlap, tidyLayout, type XY } from '@/lib/card-layout';
```

3b. 在 `createServerActions` 内、`persistAssetPosition` 定义之后(约第 380 行 `};` 之后)加入:

```ts
  // 一键整理:把画布所有卡重排成整齐树形布局(用户主动触发,是"系统不挪卡"原则的有意例外)。
  // 一次 set 落库;只对真正变位且非占位(pending_)的卡 fire-and-forget 回写坐标(复用 persistAssetPosition)。
  const tidyCanvas = () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const assets = get().assets;
    if (assets.length === 0) return;
    const layout = tidyLayout(assets);
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

3c. 把 `tidyCanvas` 加入 `createServerActions` 的返回对象(约第 549 行那一段),例如挂在 `persistAssetPosition` 同行:

```ts
    uploadAsset, deleteCanvasItem, persistAssetPosition, tidyCanvas, pollGenTasks, restoreGenTasks,
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS —— 含原有用例与新增 2 个 `tidyCanvas` 用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: store 新增 tidyCanvas 一键整理 action(变位卡回写坐标)"
```

---

## Task 3: 整理图标 + i18n 文案 + 动画 CSS

**Files:**
- Create: `public/figma/icons/tidy.svg`
- Modify: `src/components/ui/figma.tsx`(`figAsset` 加 `tidy`)
- Modify: `src/i18n/locales/en.ts` / `zh.ts` / `vi.ts` / `es.ts`(canvas 块加 `tidy`)
- Modify: `src/app/globals.css`(末尾加过渡规则 + 进 reduced-motion 禁用列表)

**Interfaces:**
- Produces:
  - `figAsset.tidy: string`(供 `FigIcon src={figAsset.tidy}`,tone 默认 primary 随主题翻转)。
  - i18n key `canvas.tidy`(Tooltip 与 aria 复用)。
  - CSS:`.canvas-tidying .react-flow__node { transition: transform ... }`,在该容器加/去 `.canvas-tidying` 即开/关整理动画。

- [ ] **Step 1: 新建图标 `public/figma/icons/tidy.svg`**

线性风格(20×20、`fill="none"`、`stroke-width="1.5"`、currentColor 经 mask 重着色),左一大块 + 右两小块,寓意「父→子整齐排布」:

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><rect x="3" y="4" width="6" height="12" rx="1.5" stroke="#121212" stroke-width="1.5"/><rect x="12" y="4" width="5" height="4.5" rx="1.5" stroke="#121212" stroke-width="1.5"/><rect x="12" y="11.5" width="5" height="4.5" rx="1.5" stroke="#121212" stroke-width="1.5"/></svg>
```

- [ ] **Step 2: 注册 `figAsset.tidy`**

在 `src/components/ui/figma.tsx` 的 `figAsset` 对象里,`frame` 那行后加:

```ts
  frame: `${F}/frame.svg`,
  tidy: `${F}/tidy.svg`,
  gamepad: `${F}/gamepad.svg`,
```

(无需加进 `ICON_TONE` 表 —— 默认即 primary,随容器 currentColor 翻转,与 map/frame/plus 等工具栏图标一致。)

- [ ] **Step 3: 补四语文案 `canvas.tidy`**

每个 locale 的 canvas 块在 `fitView` 那行后插入一行(en 第 109 行后,其余第 106 行后):

`src/i18n/locales/en.ts`:
```ts
    fitView: 'Fit view',
    tidy: 'Tidy up',
```
`src/i18n/locales/zh.ts`:
```ts
    fitView: '适应视图',
    tidy: '一键整理',
```
`src/i18n/locales/vi.ts`:
```ts
    fitView: 'Vừa khung nhìn',
    tidy: 'Sắp xếp',
```
`src/i18n/locales/es.ts`:
```ts
    fitView: 'Ajustar vista',
    tidy: 'Ordenar',
```

- [ ] **Step 4: 加动画 CSS**

4a. 在 `src/app/globals.css` 文件**末尾**(最后一行 `.canvas-minimap .react-flow__minimap-node { ... }` 之后)追加:

```css
/* 一键整理:整理期间给画布容器加 .canvas-tidying,节点 transform 变化时平滑滑到新位;拖拽时无此类,保持瞬时 */
.canvas-tidying .react-flow__node { transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1); }
```

4b. 在已有的 `@media (prefers-reduced-motion: reduce)` 块里(含 `.composer-card { transition: none; }` 那个,约第 536–545 行),在 `.composer-card { transition: none; }` 后加一行:

```css
  .composer-card { transition: none; }
  .canvas-tidying .react-flow__node { transition: none; }
```

- [ ] **Step 5: 类型检查 + lint(无单测,以静态检查兜底)**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 均通过,无新增报错。

> 注意:Tailwind v4 会扫描 .md 文档并把其中形如 arbitrary value 的 class 字面量也生成进 CSS(已知坑)。故本计划/设计稿提到类名时一律用普通文字转述变量名(如 color-surface、shadow-popover),**不要**写成可被扫描的 arbitrary class 字面量,否则会生成非法 CSS 让 dev 构建/页面报错。源码改动不引入硬编码 class。

- [ ] **Step 6: 提交**

```bash
git add public/figma/icons/tidy.svg src/components/ui/figma.tsx src/i18n/locales/en.ts src/i18n/locales/zh.ts src/i18n/locales/vi.ts src/i18n/locales/es.ts src/app/globals.css
git commit -m "feat: 新增整理图标 figAsset.tidy、canvas.tidy 四语文案与整理动画 CSS"
```

---

## Task 4: `ZoomBar` 整理按钮 + 整理动画接线

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(`ZoomBar` 加按钮与 props;`Inner` 加 `tidying` 态、`onTidy` handler、容器类)

**Interfaces:**
- Consumes: `useStore((s) => s.tidyCanvas)`(Task 2);`figAsset.tidy`、`t('canvas.tidy')`(Task 3);现有 `IconButton`、`Tooltip`、`FigIcon`。
- Produces: 画布下方工具栏最左多出一个「整理」按钮;点击重排并平滑动画。

- [ ] **Step 1: `ZoomBar` 增加 props 与按钮**

1a. 把 `ZoomBar` 的参数签名(约第 94–100 行)改为:

```tsx
function ZoomBar({
  minimapOpen,
  onToggleMinimap,
  onTidy,
  canTidy,
}: {
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  onTidy: () => void;
  canTidy: boolean;
}) {
```

1b. 在工具条 flex 容器内(约第 128 行 `<div className="flex items-center gap-2 ...">` 之后、`{/* ① minimap 切换 */}` 之前)插入整理按钮 + 分隔条:

```tsx
      <div className="flex items-center gap-2 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-toolbar)]">
        {/* ⓪ 一键整理 */}
        <Tooltip label={t('canvas.tidy')}>
          <IconButton
            variant="ghost"
            onClick={onTidy}
            disabled={!canTidy}
            aria-label={t('canvas.tidy')}
            className="size-10"
          >
            <FigIcon src={figAsset.tidy} size={20} />
          </IconButton>
        </Tooltip>

        <span className="h-6 w-px bg-[var(--color-line)]" />

        {/* ① minimap 切换 */}
```

- [ ] **Step 2: `Inner` 接线整理动画**

2a. 在 `Inner` 顶部、其它 `useStore` 取值附近(约第 210 行 `const addMenu = ...` 之后)加:

```tsx
  const tidyCanvas = useStore((s) => s.tidyCanvas);
```

2b. 在 `Inner` 内、`const [minimapOpen, setMinimapOpen] = useState(false);`(约第 216 行)之后加整理瞬态与 handler:

```tsx
  // 一键整理:整理期间挂 .canvas-tidying 类驱动节点 transform 过渡;~340ms 后摘除,使拖拽恢复瞬时
  const [tidying, setTidying] = useState(false);
  const tidyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tidyTimer.current) clearTimeout(tidyTimer.current); }, []);
  const onTidy = () => {
    setTidying(true);
    tidyCanvas();
    if (tidyTimer.current) clearTimeout(tidyTimer.current);
    tidyTimer.current = setTimeout(() => setTidying(false), 340);
  };
```

2c. 把最外层容器 div(约第 297 行)的 className 改为按 `tidying` 拼接 `canvas-tidying`:

```tsx
    <div
      ref={wrapRef}
      className={`relative h-full bg-[var(--color-canvas)]${tidying ? ' canvas-tidying' : ''}`}
      onDoubleClick={onPaneDoubleClick}
    >
```

2d. 把 `ZoomBar` 的使用(约第 350 行)补上新 props:

```tsx
      <ZoomBar
        minimapOpen={minimapOpen}
        onToggleMinimap={() => setMinimapOpen((v) => !v)}
        onTidy={onTidy}
        canTidy={assets.length > 0}
      />
```

- [ ] **Step 3: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 均通过。(`useRef`/`useEffect`/`useState` 已在第 2 行 import;若 lint 报 `useRef` 未引入则补进 import。)

- [ ] **Step 4: 全量校验(测试 + 构建)**

Run: `pnpm test && pnpm build`
Expected: 全部测试通过;`next build` 成功。

- [ ] **Step 5: 手动验证(开发服务器)**

Run: `pnpm dev`,浏览器打开画布:
- 工具栏最左出现「整理」按钮;空画布时按钮 disabled。
- 生成/派生若干卡并随意拖乱后点「整理」:卡片平滑滑到树形排布(根在左、派生链向右、兄弟纵向堆叠),整体停在原区域。
- 刷新页面后位置保持(回写生效)。
- 系统开启「减少动态」后点整理:卡片瞬间到位、无滑动。

Expected: 行为符合上述;无 console 报错。

- [ ] **Step 6: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 画布工具栏加一键整理按钮与平滑整理动画"
```

---

## Self-Review(计划自查)

- **Spec coverage:**
  - 树形布局算法 → Task 1 ✓ | 全部卡片范围 → Task 2(`tidyCanvas` 遍历全部 assets)✓ | 平滑动画 → Task 3(CSS)+ Task 4(接线)✓ | 不动相机/锚点 min(x,y) → Task 1 ✓ | 按钮在 ZoomBar → Task 4 ✓ | 图标+i18n → Task 3 ✓ | TDD 覆盖 → Task 1/2 ✓ | reduced-motion → Task 3 ✓ | pending_ 不回写 → Task 2 ✓。
- **Placeholder scan:** 无 TBD/TODO;每个代码步骤含完整代码与确切命令。
- **Type consistency:** `tidyLayout(nodes: TidyNode[]): Map<string, XY>` 在 Task 1 定义,Task 2 以 `Asset[]`(结构兼容 `TidyNode`)传入并取 `layout.get(a.id)`;`tidyCanvas: () => void` 在 Task 2 产出、Task 4 经 `useStore((s) => s.tidyCanvas)` 消费;`figAsset.tidy` / `canvas.tidy` 在 Task 3 产出、Task 4 消费;`.canvas-tidying` 类名 Task 3 定义、Task 4 施加。命名一致。
