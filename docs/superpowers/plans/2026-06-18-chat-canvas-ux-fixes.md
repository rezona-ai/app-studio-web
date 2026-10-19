# 聊天滚动 / @ 引用 / 画布落位 三处交互修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复实机测试暴露的三处交互问题——聊天被强制滚底、`@` 引用无说明无反馈、双击创建的卡片跑出视野。

**Architecture:** 三处相互独立。① 画布避让 `avoidOverlap` 由"只向下"改为"就近螺旋搜索"（纯函数）；② 经 `viewport.ts` 新注册的 `ensureVisible` 在落位后把越界新卡平移入视野；③ `Composer`/`MentionPopover` 给 `@` 加 tooltip 与空态反馈；④ `ChatPanel` 引入贴底检测与「回到最新」浮动按钮。

**Tech Stack:** Next 16 + React 19 + zustand + @xyflow/react；Vitest（jsdom + globals，`@`→`src`）。

## Global Constraints

- 运行环境 Node 22 + pnpm 11；测试与源码同目录（`*.test.ts(x)`）。
- 代码注释 / commit message 一律用**中文**；commit 一句话总结，prefix 用 `feat:`/`fix:`。
- **UI 默认语言英文**：所有新增用户可见文案用英文。
- 位置归前端所有：本计划不改轮询/重连落位，不覆盖已有 `position`。
- `ensureVisible` 仅在卡片"越界"时平移，避免每次生成都打断用户视角。
- 每个 Task 完成后跑 `pnpm exec tsc --noEmit` 与 `pnpm lint` 应无新增报错。

---

### Task 1: 画布避让改为就近螺旋搜索（纯函数）

**Files:**
- Modify: `src/lib/card-layout.ts:10`（`MAX_AVOID_STEPS` → `MAX_AVOID_RINGS`）、`src/lib/card-layout.ts:29-38`（重写 `avoidOverlap`）
- Test: `src/lib/card-layout.test.ts:31-47`（改写 `avoidOverlap` describe 块）

**Interfaces:**
- Consumes: 既有常量 `CARD_W=180` `CARD_H=150` `GAP_X=80` `GAP_Y=40`、类型 `XY`。
- Produces: `avoidOverlap(target: XY, occupied: XY[]): XY` —— 签名不变；新语义"返回离 target 最近的非重叠空位，同距离优先正下方、再靠左；超环数上限原样返回 target"。被 `src/store/actions.ts` 的 `addGenPlaceholder`/`placeAndLink` 调用（步距 `STEP_X=CARD_W+GAP_X=260`、`STEP_Y=CARD_H+GAP_Y=190`）。

- [ ] **Step 1: 改写测试中的 `avoidOverlap` describe 块**

把 `src/lib/card-layout.test.ts` 第 31-47 行整段替换为：

```ts
describe('avoidOverlap 就近螺旋避让', () => {
  const STEP_X = CARD_W + GAP_X; // 260
  const STEP_Y = CARD_H + GAP_Y; // 190
  const overlaps = (p: { x: number; y: number }, occupied: { x: number; y: number }[]) =>
    occupied.some((o) => Math.abs(o.x - p.x) < STEP_X && Math.abs(o.y - p.y) < STEP_Y);

  test('无重叠:原样返回', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: STEP_X, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
  test('目标被占:落到最近的一格(垂直比水平近,优先正下方)', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: STEP_Y });
  });
  test('正下方也被占:向上更近,不再无限向下', () => {
    const occupied = [{ x: 0, y: 0 }, { x: 0, y: STEP_Y }];
    expect(avoidOverlap({ x: 0, y: 0 }, occupied)).toEqual({ x: 0, y: -STEP_Y });
  });
  test('返回的落点本身不与任何卡片重叠', () => {
    const occupied = [{ x: 0, y: 0 }, { x: 0, y: STEP_Y }, { x: 0, y: -STEP_Y }, { x: STEP_X, y: 0 }];
    expect(overlaps(avoidOverlap({ x: 0, y: 0 }, occupied), occupied)).toBe(false);
  });
  test('四周环数内全占满:兜底原样返回 target(不死循环)', () => {
    const occupied: { x: number; y: number }[] = [];
    for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) occupied.push({ x: dx * STEP_X, y: dy * STEP_Y });
    expect(avoidOverlap({ x: 0, y: 0 }, occupied)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: FAIL —— "正下方也被占" 用例失败（旧实现返回 `{x:0,y:2*STEP_Y}` 而非 `{x:0,y:-STEP_Y}`）。

- [ ] **Step 3: 重写 `avoidOverlap` 与上限常量**

把 `src/lib/card-layout.ts` 第 10 行的
```ts
const MAX_AVOID_STEPS = 50;
```
改为
```ts
const MAX_AVOID_RINGS = 6;
```

把第 29-38 行整段（`// 重叠避让...` 注释 + `avoidOverlap` 函数）替换为：

```ts
// 重叠避让:目标被占时在其四周按"扩展环"就近搜索最近空位返回。
// 步距取一卡宽/高(含间距),保证相邻候选互不重叠、命中即真正空闲;
// 同距离优先正下方、再靠左;超环数上限兜底原样返回 target(永不抛错/死循环)。
export function avoidOverlap(target: XY, occupied: XY[]): XY {
  const hit = (p: XY) =>
    occupied.some((o) => Math.abs(o.x - p.x) < CARD_W + GAP_X && Math.abs(o.y - p.y) < CARD_H + GAP_Y);
  if (!hit(target)) return target;
  const STEP_X = CARD_W + GAP_X;
  const STEP_Y = CARD_H + GAP_Y;
  for (let r = 1; r <= MAX_AVOID_RINGS; r++) {
    const cells: XY[] = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 仅取该环边界格点
        cells.push({ x: dx, y: dy });
      }
    }
    cells.sort((a, b) => {
      const da = (a.x * STEP_X) ** 2 + (a.y * STEP_Y) ** 2;
      const db = (b.x * STEP_X) ** 2 + (b.y * STEP_Y) ** 2;
      if (da !== db) return da - db;    // 先按到 target 的实际距离从近到远
      if (a.y !== b.y) return b.y - a.y; // 同距离:优先正下方(dy 大者靠前)
      return a.x - b.x;                  // 再:优先靠左(dx 小者靠前)
    });
    for (const c of cells) {
      const pos = { x: target.x + c.x * STEP_X, y: target.y + c.y * STEP_Y };
      if (!hit(pos)) return pos;
    }
  }
  return target;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/card-layout.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 类型检查并提交**

```bash
pnpm exec tsc --noEmit
git add src/lib/card-layout.ts src/lib/card-layout.test.ts
git commit -m "fix: 画布卡片避让改为就近螺旋搜索,不再无限向下"
```

---

### Task 2: 落位后越界自动平移入视野

**Files:**
- Modify: `src/lib/viewport.ts`（新增 `registerEnsureVisible` / `ensureVisible`）
- Modify: `src/components/canvas/AssetCanvas.tsx:21`（import）、`:133`（取 `setCenter`/`getViewport`）、`:137-144`（注册 effect 内追加）
- Modify: `src/store/actions.ts:7`（import）、`:226-234`（`addGenPlaceholder` 末尾调用）
- Test: `src/lib/viewport.test.ts`（新建）

**Interfaces:**
- Consumes: `XY`（来自 `./card-layout`）、`CARD_W`/`CARD_H`、React Flow `useReactFlow().getViewport()`（返回 `{ x, y, zoom }`）与 `setCenter(x, y, opts)`。
- Produces:
  - `registerEnsureVisible(fn: ((pos: XY) => void) | null): void`
  - `ensureVisible(pos: XY): void` —— `pos` 为卡片左上角画布坐标；由 `addGenPlaceholder` 落位后调用。

- [ ] **Step 1: 写 viewport 注册转调的失败测试**

新建 `src/lib/viewport.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { registerEnsureVisible, ensureVisible } from './viewport';

describe('ensureVisible 注册转调', () => {
  test('未注册:调用安全无操作不抛错', () => {
    registerEnsureVisible(null);
    expect(() => ensureVisible({ x: 1, y: 2 })).not.toThrow();
  });
  test('注册后:转调到注册函数并透传坐标', () => {
    const calls: { x: number; y: number }[] = [];
    registerEnsureVisible((p) => calls.push(p));
    ensureVisible({ x: 10, y: 20 });
    expect(calls).toEqual([{ x: 10, y: 20 }]);
    registerEnsureVisible(null); // 复位,避免污染其他测试
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/viewport.test.ts`
Expected: FAIL —— "registerEnsureVisible is not a function"。

- [ ] **Step 3: 在 `viewport.ts` 增加 ensure-visible 注册**

把 `src/lib/viewport.ts` 整个文件替换为：

```ts
// 画布视口工具注册:actions 层(非 React)做兜底落位 / 越界平移时从这里取;
// AssetCanvas 挂载时注册、卸载时注销。
import type { XY } from './card-layout';

let getCenter: (() => XY) | null = null;
let ensureVisibleFn: ((pos: XY) => void) | null = null;

export function registerViewportCenter(fn: (() => XY) | null) { getCenter = fn; }
export function getViewportCenter(): XY | null { return getCenter ? getCenter() : null; }

// 新卡若落在当前视口外则平移带入(在视口内不动);pos 为卡片左上角画布坐标
export function registerEnsureVisible(fn: ((pos: XY) => void) | null) { ensureVisibleFn = fn; }
export function ensureVisible(pos: XY) { ensureVisibleFn?.(pos); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/viewport.test.ts`
Expected: PASS。

- [ ] **Step 5: 在 `AssetCanvas` 注册 ensureVisible**

修改 `src/components/canvas/AssetCanvas.tsx`。

第 21 行 import 改为同时引入 ensureVisible 注册与卡片尺寸：
```ts
import { registerViewportCenter, registerEnsureVisible } from '@/lib/viewport';
import { CARD_W, CARD_H } from '@/lib/card-layout';
```

第 133 行原为：
```ts
  const { screenToFlowPosition } = useReactFlow();
```
改为：
```ts
  const { screenToFlowPosition, setCenter, getViewport } = useReactFlow();
```

在第 137-144 行的"注册视口中心"`useEffect` **之后**，新增一个注册 ensureVisible 的 effect：
```ts
  // 注册"越界平移":新卡矩形落在当前视口外时平移居中带入(在视口内不动)
  useEffect(() => {
    registerEnsureVisible((pos) => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const { x: vx, y: vy, zoom } = getViewport();
      // 视口可见的画布坐标范围:屏幕(0..width/height)按变换反算
      const left = -vx / zoom;
      const top = -vy / zoom;
      const right = left + r.width / zoom;
      const bottom = top + r.height / zoom;
      const outside = pos.x < left || pos.y < top || pos.x + CARD_W > right || pos.y + CARD_H > bottom;
      if (outside) void setCenter(pos.x + CARD_W / 2, pos.y + CARD_H / 2, { zoom, duration: 400 });
    });
    return () => registerEnsureVisible(null);
  }, [getViewport, setCenter]);
```

- [ ] **Step 6: 在 `addGenPlaceholder` 落位后调用 ensureVisible**

修改 `src/store/actions.ts`。

第 7 行 import 改为：
```ts
import { getViewportCenter, ensureVisible } from '@/lib/viewport';
```

第 226-234 行的 `addGenPlaceholder` 改为（在 `set` 之后、`return` 之前插入 `ensureVisible(position)`）：
```ts
  const addGenPlaceholder = (kind: AssetKind, opts?: GenPlacement): string => {
    const id = newId('pending');
    const position = avoidOverlap(placeTarget(opts, []), get().assets.map((e) => e.position));
    set({ assets: [...get().assets, {
      ...makeAsset(kind, { position }), id, key: id, status: 'generating' as const,
      ...(opts?.sourceItemId ? { parentId: opts.sourceItemId, source: 'derived' as const } : {}),
    }] });
    ensureVisible(position); // 新卡若在视口外则平移带入,避免"创建了找不到"
    return id;
  };
```

- [ ] **Step 7: 类型检查、lint、手动验证、提交**

```bash
pnpm exec tsc --noEmit
pnpm lint
```
手动验证（`pnpm dev`，浏览器打开画布）：
1. 在已有若干卡片、较密集的区域双击空白处生成图片 → 新占位卡落在点击点**附近**（不再被顶到远处下方）。
2. 把视口平移到只剩边缘有空白处，在靠近视口边界处双击生成 → 视图自动平移把新卡带入视野并居中。
3. 在视口正中空旷处双击生成 → 视图**不**发生平移（未越界）。

```bash
git add src/lib/viewport.ts src/lib/viewport.test.ts src/components/canvas/AssetCanvas.tsx src/store/actions.ts
git commit -m "feat: 画布生成新卡越界时自动平移入视野"
```

---

### Task 3: `@` 引用——无资产置灰 + tooltip + 弹层空态反馈

**Files:**
- Modify: `src/components/chat/Composer.tsx`（订阅资产数、`startMention` 守卫、`@` 按钮 span+tooltip+disabled）
- Modify: `src/components/chat/MentionPopover.tsx`（去掉 `return null`，加空态文案）
- Test: `src/components/chat/MentionPopover.test.tsx`（新建）

**Interfaces:**
- Consumes: zustand `useStore((s) => s.assets)`；`MentionPopover` props `{ query: string; onPick: (key: string) => void }`（不变）。
- Produces: `MentionPopover` 在无匹配时不再返回 `null`，恒渲染容器（空态给文案）。

- [ ] **Step 1: 写 MentionPopover 空态的失败测试**

新建 `src/components/chat/MentionPopover.test.tsx`：

```tsx
import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';
import MentionPopover from './MentionPopover';

// 最小可用 Asset:无匹配/空资产两种状态下列表为空,不渲染缩略图,字段够用即可
const asset = (over: Partial<Asset> = {}): Asset =>
  ({ id: 'a1', key: 'sky.png', label: 'Sky', kind: 'image', status: 'ready', position: { x: 0, y: 0 }, ...over } as Asset);

afterEach(cleanup);

describe('MentionPopover 空态反馈', () => {
  test('无任何资产:显示引导文案', () => {
    useStore.setState({ assets: [] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/generate some on the canvas/i)).toBeInTheDocument();
  });
  test('有资产但 query 无匹配:显示 No matches', () => {
    useStore.setState({ assets: [asset()] });
    render(<MentionPopover query="zzz" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/MentionPopover.test.tsx`
Expected: FAIL —— 当前 `list.length === 0` 时组件 `return null`，文案查不到。

- [ ] **Step 3: 改写 MentionPopover 渲染空态**

把 `src/components/chat/MentionPopover.tsx` 第 12-37 行（`const assets` 到组件结尾）替换为：

```tsx
  const assets = useStore((s) => s.assets);
  const list = assets
    .filter((a) => (a.key + a.label).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="scrollbar-auto absolute bottom-full mb-1 flex max-h-56 w-64 flex-col gap-0.5 overflow-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
      {list.length === 0 ? (
        <div className="px-2 py-1.5 text-sm leading-5 text-[var(--color-muted)]">
          {assets.length === 0
            ? 'No assets yet — generate some on the canvas to @mention them'
            : 'No matches'}
        </div>
      ) : (
        list.map((a) => (
          <button
            key={a.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(a.key);
            }}
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-fill)]"
          >
            {/* 缩略图贴片与 AssetChip 同款:方形圆角 + 资产封面/类型图标 */}
            <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--color-fill)]">
              <AssetThumb asset={a} />
            </span>
            <span className="truncate">{a.label}</span>
          </button>
        ))
      )}
    </div>
  );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/MentionPopover.test.tsx`
Expected: PASS。

- [ ] **Step 5: Composer——订阅资产数、守卫、按钮 tooltip+disabled**

修改 `src/components/chat/Composer.tsx`。

在第 24 行 `const runStatus = useStore((s) => s.runStatus);` 之后新增订阅：
```ts
  const assetCount = useStore((s) => s.assets.length);
  const canMention = assetCount > 0; // 无资产时 @ 无可引用对象
```

`startMention`（第 46-53 行）开头加守卫，改为：
```ts
  const startMention = () => {
    if (!canMention) return; // 无资产:按钮已 disabled,此处再防御一次
    // 已有激活的 @ 引用时重复点击不再追加符号,仅保持菜单打开;校验 mention 位置防止 draft 已被外部清空的陈旧状态
    if (!(mention && draft[mention.start] === '@')) {
      composerSet({ draft: draft + '@' });
      setMention({ query: '', start: draft.length });
    }
    taRef.current?.focus();
  };
```

把第 134-144 行的 `@` 按钮 `IconButton` 用 `<span>` 外包以承载禁用态 tooltip，替换为：
```tsx
            {/* span 外包:原生 title 在 disabled 按钮上 hover 不触发,套一层让 tooltip 始终可见 */}
            <span
              className="inline-flex"
              title={canMention ? 'Mention an asset' : 'Generate assets on the canvas first to @mention them'}
            >
              <IconButton
                variant="bordered"
                className="h-10 rounded-[12px] px-[10px]"
                aria-label="Mention"
                disabled={!canMention}
                onMouseDown={(e) => {
                  e.preventDefault();
                  startMention();
                }}
              >
                <FigIcon src={figAsset.at} size={20} />
              </IconButton>
            </span>
```

- [ ] **Step 6: 更新既有 Composer 的 @ 用例（避免回归失败）**

既有 `src/components/chat/Composer.test.tsx:64-73` 的"重复点击 @"用例在 `beforeEach` 设 `assets: []`，改动后 @ 按钮 `disabled`、`mouseDown` 不再触发，会失败。需在点击前注入一个资产使 @ 可点。

第 5 行 `import type { KoubouClient } from '@/koubou/client';` 之后新增：
```ts
import type { Asset } from '@/store/types';
```

把第 64-73 行整段替换为：
```tsx
test('重复点击 @ 按钮只插入一个 @ 符号', () => {
  // 有资产时 @ 才可点;注入一个最小资产
  useStore.setState({ assets: [{ id: 'a1', key: 'k1', label: 'asset', kind: 'image', status: 'ready', position: { x: 0, y: 0 } } as Asset] });
  render(<Composer client={clientRef} />);
  const at = screen.getByRole('button', { name: 'Mention' });
  act(() => {
    fireEvent.mouseDown(at);
    fireEvent.mouseDown(at);
    fireEvent.mouseDown(at);
  });
  expect(useStore.getState().composer.draft).toBe('@');
});
```

- [ ] **Step 7: 类型检查、lint、手动验证、提交**

```bash
pnpm exec vitest run src/components/chat/MentionPopover.test.tsx src/components/chat/Composer.test.tsx
pnpm exec tsc --noEmit
pnpm lint
```
手动验证（`pnpm dev`）：
1. 新项目（画布空）→ 输入框 `@` 按钮置灰不可点，hover 显示英文 tooltip 说明用途。
2. 在画布生成 ≥1 个资产后 → `@` 按钮恢复可点；点击弹出资产列表。
3. 输入框打 `@xyz`（无匹配）→ 弹层显示 "No matches" 而非消失。

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx src/components/chat/MentionPopover.tsx src/components/chat/MentionPopover.test.tsx
git commit -m "feat: @ 引用无资产时置灰提示,弹层空态给反馈"
```

---

### Task 4: 聊天贴底检测 + 回到最新按钮

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`（模块常量、refs/state、`onScroll`、自动滚底 effect、消息区 JSX 包浮动按钮）

**Interfaces:**
- Consumes: 既有 `scrollRef`/`endRef`/`messages`/`historyLoading`/`historyHasMore`/`loadOlderMessages`/`figAsset.chevronDown`。
- Produces: 无对外接口；行为变化——用户上滑后不再被强制滚底，发送新消息强制回底，右下角 `showJump` 时显示「回到最新」按钮。

- [ ] **Step 1: 加模块常量与状态/ref**

修改 `src/components/chat/ChatPanel.tsx`。

在第 13 行 `import type { KoubouClient }...` 之后、`export default function` 之前，加模块常量：
```ts
// 距底 < 80px 视为"贴底",阈值足够大以容忍 smooth 滚动途中的度量抖动
const BOTTOM_THRESHOLD = 80;
```

在第 30 行 `const skipBottomScrollRef = useRef(false);` 之后新增：
```ts
  const stickToBottomRef = useRef(true); // 用户是否停在底部:仅贴底时才自动跟随滚动
  const prevLastUserIdRef = useRef<string | null>(null); // 检测"用户刚发了新消息"以强制回底
  const [showJump, setShowJump] = useState(false); // 「回到最新」浮动按钮可见性
```

- [ ] **Step 2: 扩展 `onScroll` 同时维护贴底状态**

把第 40-46 行的 `onScroll` 替换为：
```ts
  // 滚动时:① 维护贴底状态与「回到最新」按钮可见性;② 接近顶部且有更早消息时翻页(记录锚点供前插后恢复视口)
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    stickToBottomRef.current = atBottom;
    setShowJump(!atBottom);
    if (el.scrollTop <= 60 && !historyLoading && historyHasMore) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
      void loadOlderMessages();
    }
  };
```

- [ ] **Step 3: 自动滚底 effect 加贴底守卫与"发送即回底"**

把第 61-65 行的自动滚底 `useEffect` 替换为：
```ts
  // 消息更新或加载动画出现/消失时,仅当用户贴底才滚到列表底部;
  // 用户上滑后(stick=false)不再被拽回;用户刚发送新消息时强制回底。
  useEffect(() => {
    if (skipBottomScrollRef.current) { skipBottomScrollRef.current = false; return; }
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && last.id !== prevLastUserIdRef.current) {
      prevLastUserIdRef.current = last.id; // 用户刚发送 → 强制回底,无视当前 stick 状态
      stickToBottomRef.current = true;
    }
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, awaiting]);
```

- [ ] **Step 4: 消息区外包 relative 容器并加浮动按钮**

把第 110-124 行的消息区 `<div ref={scrollRef} ...>...</div>`（含注释行）替换为：
```tsx
      {/* 消息区(空态居中欢迎语);外包 relative 容器以承载「回到最新」浮动按钮 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-auto flex-1 overflow-auto px-3 py-3">
          {historyLoading && (
            <div className="py-2 text-center text-xs text-[var(--color-muted)]">Loading earlier messages…</div>
          )}
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-muted)]">
              Hi there, what game are we making today
            </div>
          ) : (
            messages.map((m) => <MessageItem key={m.id} message={m} />)
          )}
          {awaiting && <MessageSkeleton />}
          <div ref={endRef} />
        </div>
        {showJump && (
          <button
            type="button"
            aria-label="Jump to latest"
            onClick={() => {
              stickToBottomRef.current = true;
              setShowJump(false);
              endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }}
            className="absolute bottom-3 right-3 z-10 grid size-9 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-pop)] text-[var(--color-ink)] shadow-[var(--shadow-popover)] transition hover:bg-[var(--color-fill)]"
          >
            <FigIcon src={figAsset.chevronDown} size={18} />
          </button>
        )}
      </div>
```

- [ ] **Step 5: 回归测试、类型检查、lint、手动验证、提交**

先确认既有 ChatPanel 测试仍绿（初始 `stickToBottomRef=true` 且 jsdom 不触发滚动事件，自动滚底行为不变）：
```bash
pnpm exec vitest run src/components/chat/ChatPanel.test.tsx
pnpm exec tsc --noEmit
pnpm lint
```
手动验证（`pnpm dev`，发一条会触发较长流式回复的消息）：
1. 流式输出时向上滚动 → 停在原处，不再被拽回底部；右下角出现「回到最新」按钮。
2. 点「回到最新」→ 平滑滚到底部，按钮消失，之后恢复自动跟随。
3. 滚到非底部时发送一条新消息 → 自动回到底部看到自己的消息与回复。
4. 翻页加载更早消息 → 视口稳定不跳动（原有锚点逻辑未被破坏）。

```bash
git add src/components/chat/ChatPanel.tsx
git commit -m "fix: 聊天上滑不再被强制拽回底部,加回到最新按钮"
```

---

## Self-Review

**Spec coverage:**
- 问题1（贴底检测 + 回到最新按钮）→ Task 4 全覆盖（守卫、发送回底、浮动按钮）。✓
- 问题2（按钮置灰 + tooltip + 弹层空态，两者结合）→ Task 3 全覆盖。✓
- 问题3（就近螺旋避让 + 越界才平移）→ Task 1（避让）+ Task 2（越界平移）。✓
- spec "测试" 段：`card-layout.test.ts`（Task 1）、`MentionPopover` 组件测试（Task 3）、`ChatPanel` 以手测为主（Task 4 手动验证）均已落位；额外补 `viewport.test.ts`（Task 2）。✓

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码与确切命令。✓

**Type consistency:** `avoidOverlap` 签名跨 Task 1/2 一致；`ensureVisible(pos: XY)` 在 viewport.ts 定义、AssetCanvas 注册、actions 调用三处签名一致；`registerEnsureVisible` 命名跨文件一致；`canMention`/`assetCount` 在 Composer 内自洽。✓
