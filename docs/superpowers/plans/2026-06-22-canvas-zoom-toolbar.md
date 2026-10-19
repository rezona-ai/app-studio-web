# 画布底部缩放工具条重做 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把画布底部的单一缩放下拉重做成一条工具条:minimap 全景切换 + `+`/`−` 步进 + 独立 Fit view + 保留的百分比下拉。

**Architecture:** 重写 `AssetCanvas.tsx` 的 `ZoomBar`(纯展示 + React Flow viewport API),把 minimap 开关上提到 `Inner` 本地态以共享给内置 `<MiniMap>`;步进逻辑下沉为纯函数 `src/lib/zoom.ts` 单测;新增 3 个单色图标走既有 `FigIcon` mask 体系。

**Tech Stack:** Next 16 / React 19 / `@xyflow/react` v12(`useReactFlow`/`useViewport`/`MiniMap`)/ Tailwind + CSS 变量令牌 / Vitest。

## Global Constraints

- 色彩 / 布局**一律沿用当前页面令牌与组件**,参考图仅表达需求结构;**不采用参考图的青色**,active 态用 accent 令牌或既有变体。
- 不硬编码色值:颜色走 CSS 变量(形如 `bg-[var(--color-surface)]`);不新建按钮组件 / 变体,不写一次性 keyframes。
- 图标一律 `FigIcon` + `figAsset` 注册;新图标先放 `public/figma/icons/` 再登记。
- 缩放范围沿用 React Flow 默认 `[0.5, 2]`(50%–200%);`+/−` 步进 5 个百分点(0.05)。
- 注释 / commit message 用**中文**;纯逻辑 TDD(同目录 `*.test.ts`)。
- 校验命令:`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm exec vitest run <file>`、`pnpm test`。

---

## File Structure

- Create: `public/figma/icons/map.svg` · `minus.svg` · `frame.svg` —— minimap / 减号 / Fit view 图标(单色,viewBox 0 0 20 20)。
- Modify: `src/components/ui/figma.tsx` —— `figAsset` 登记 `map` / `minus` / `frame`。
- Create: `src/lib/zoom.ts` —— 纯函数 `stepZoom`(步进 + clamp)。
- Create: `src/lib/zoom.test.ts` —— `stepZoom` 单测。
- Modify: `src/components/canvas/AssetCanvas.tsx` —— 重写 `ZoomBar`;`Inner` 加 `minimapOpen` 态 + 条件渲染 `<MiniMap>`。
- Modify: `src/app/globals.css` —— `.canvas-minimap` 皮肤(只用令牌)。

---

## Task 1: 新增 3 个图标并登记 figAsset

**Files:**
- Create: `public/figma/icons/map.svg`
- Create: `public/figma/icons/minus.svg`
- Create: `public/figma/icons/frame.svg`
- Modify: `src/components/ui/figma.tsx:8-30`(`figAsset` 对象)

**Interfaces:**
- Produces: `figAsset.map` / `figAsset.minus` / `figAsset.frame`(string 路径),供 Task 3 的 `FigIcon src=` 使用。

说明:`FigIcon` 的 `primary` tone 用 CSS mask 取形再以 `currentColor` 重着色,故 SVG 只需形状不透明、`fill="none"` 的描边即可;沿用 `plus.svg` 的 `stroke-width="1.5"` + round cap/join,视觉权重与现有图标一致。新图标默认 `primary` tone,无需登记 `ICON_TONE`。

- [ ] **Step 1: 写 `public/figma/icons/minus.svg`**(与 `plus.svg` 横线坐标对齐:x 3.125→16.875,y 10)

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M3.125 10H16.875" stroke="#121212" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 2: 写 `public/figma/icons/map.svg`**(折叠地图:三栏 + 两条折线)

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M2.5 5 7.5 2.5 12.5 5 17.5 2.5V15L12.5 17.5 7.5 15 2.5 17.5Z" stroke="#121212" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 2.5V15" stroke="#121212" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 5V17.5" stroke="#121212" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 3: 写 `public/figma/icons/frame.svg`**(四角框选 = Fit view)

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M3 7V3H7M13 3H17V7M17 13V17H13M7 17H3V13" stroke="#121212" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 4: 在 `figAsset` 登记三枚图标**

`src/components/ui/figma.tsx`,在 `upload: ...` 行后追加(逗号结尾保持对齐):

```ts
  upload: `${F}/upload.svg`,
  map: `${F}/map.svg`,
  minus: `${F}/minus.svg`,
  frame: `${F}/frame.svg`,
```

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 通过(无新增报错)。

- [ ] **Step 6: 提交**

```bash
git add public/figma/icons/map.svg public/figma/icons/minus.svg public/figma/icons/frame.svg src/components/ui/figma.tsx
git commit -m "feat: 新增 map/minus/frame 图标并登记 figAsset(缩放工具条用)"
```

---

## Task 2: `stepZoom` 纯函数(步进 + clamp,TDD)

**Files:**
- Create: `src/lib/zoom.ts`
- Test: `src/lib/zoom.test.ts`

**Interfaces:**
- Produces: `stepZoom(current: number, deltaPercent: number, min: number, max: number): number` —— 把 `current` 按 `deltaPercent` 个百分点(`/100` 换算成缩放比)调整后 clamp 到 `[min, max]`。供 Task 3 的 `+`/`−` 按钮调用。

- [ ] **Step 1: 写失败测试 `src/lib/zoom.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { stepZoom } from './zoom';

describe('stepZoom', () => {
  it('正向步进 5 个百分点(0.05)', () => {
    expect(stepZoom(1, 5, 0.5, 2)).toBeCloseTo(1.05, 5);
  });
  it('负向步进 5 个百分点', () => {
    expect(stepZoom(1, -5, 0.5, 2)).toBeCloseTo(0.95, 5);
  });
  it('超上界 clamp 到 max', () => {
    expect(stepZoom(1.98, 5, 0.5, 2)).toBe(2);
  });
  it('超下界 clamp 到 min', () => {
    expect(stepZoom(0.52, -5, 0.5, 2)).toBe(0.5);
  });
  it('已在 max 时正向步进不越界', () => {
    expect(stepZoom(2, 5, 0.5, 2)).toBe(2);
  });
  it('已在 min 时负向步进不越界', () => {
    expect(stepZoom(0.5, -5, 0.5, 2)).toBe(0.5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/zoom.test.ts`
Expected: FAIL（`stepZoom` 未定义 / 模块不存在）。

- [ ] **Step 3: 写实现 `src/lib/zoom.ts`**

```ts
// 画布缩放纯逻辑:按"百分点"步进并 clamp 到 [min, max]。
// deltaPercent 为正负百分点(如 +5 / -5),内部换算成缩放比 deltaPercent/100。
export function stepZoom(current: number, deltaPercent: number, min: number, max: number): number {
  const next = current + deltaPercent / 100;
  return Math.min(max, Math.max(min, next));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/zoom.test.ts`
Expected: PASS(6 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/zoom.ts src/lib/zoom.test.ts
git commit -m "feat: 新增 stepZoom 纯函数(缩放按百分点步进 + clamp)"
```

---

## Task 3: 重写 ZoomBar 工具条(minimap 切换 + 步进 + Fit + 百分比下拉)

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx:1-22`(imports)、`:82-121`(`ZoomBar`)、`:257`(`<ZoomBar />` 调用处)、`Inner` 顶部(新增 state)

**Interfaces:**
- Consumes: `figAsset.map/minus/frame/plus/chevronDown`(Task 1)、`stepZoom`(Task 2)、`IconButton`、`Tooltip`。
- Produces: `<ZoomBar minimapOpen={boolean} onToggleMinimap={() => void} />` —— Task 4 用 `minimapOpen`/`onToggleMinimap` 接 MiniMap。

说明:本任务先把 `minimapOpen` 接到 `Inner` 本地态并传给 `ZoomBar` 的切换按钮(此时点击仅切换 state,MiniMap 在 Task 4 渲染)。`MIN_ZOOM=0.5`/`MAX_ZOOM=2` 为 React Flow 默认,定义为模块常量。

- [ ] **Step 1: 补充 imports**

在 `AssetCanvas.tsx` 顶部 import 区追加:

```ts
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { stepZoom } from '@/lib/zoom';
```

- [ ] **Step 2: 用新版替换整个 `ZoomBar` 函数(`:82-121`)**

```tsx
// 缩放范围沿用 React Flow 默认(50%–200%)
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

// 底部居中浮动工具条:minimap 切换 | + − Fit view | 百分比下拉
function ZoomBar({
  minimapOpen,
  onToggleMinimap,
}: {
  minimapOpen: boolean;
  onToggleMinimap: () => void;
}) {
  const { fitView, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  const [open, setOpen] = useState(false);
  const presets: { label: string; value: number }[] = [
    { label: '50%', value: 0.5 },
    { label: '100%', value: 1 },
    { label: '200%', value: 2 },
  ];
  return (
    <div className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2">
      {open && (
        <div className="anim-pop-in origin-bottom-right absolute bottom-[52px] right-0 w-28 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-toolbar)]">
          {presets.map((p) => (
            <button
              key={p.label}
              className="block w-full rounded-[6px] px-2 py-1 text-left text-[13px] hover:bg-[var(--color-fill)]"
              onClick={() => {
                void zoomTo(p.value, { duration: 200 });
                setOpen(false);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-toolbar)]">
        {/* ① minimap 切换 */}
        <Tooltip label="Minimap">
          <IconButton
            variant={minimapOpen ? 'raised-active' : 'ghost'}
            onClick={onToggleMinimap}
            aria-label="Toggle minimap"
            aria-pressed={minimapOpen}
            className="size-10"
          >
            <FigIcon src={figAsset.map} size={20} />
          </IconButton>
        </Tooltip>

        <span className="h-6 w-px bg-[var(--color-line)]" />

        {/* ② 步进 + Fit view */}
        <Tooltip label="Zoom in">
          <IconButton
            variant="ghost"
            onClick={() => void zoomTo(stepZoom(zoom, 5, MIN_ZOOM, MAX_ZOOM), { duration: 200 })}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className="size-10"
          >
            <FigIcon src={figAsset.plus} size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Zoom out">
          <IconButton
            variant="ghost"
            onClick={() => void zoomTo(stepZoom(zoom, -5, MIN_ZOOM, MAX_ZOOM), { duration: 200 })}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            className="size-10"
          >
            <FigIcon src={figAsset.minus} size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Fit view">
          <IconButton
            variant="ghost"
            onClick={() => void fitView({ duration: 200 })}
            aria-label="Fit view"
            className="size-10"
          >
            <FigIcon src={figAsset.frame} size={20} />
          </IconButton>
        </Tooltip>

        <span className="h-6 w-px bg-[var(--color-line)]" />

        {/* ③ 百分比下拉 */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Zoom presets"
          className="flex h-10 w-[89px] items-center justify-between rounded-[12px] border border-[var(--color-line)] bg-[var(--color-fill)] px-3 py-1 text-[14px] font-medium tracking-[-0.14px] text-[var(--color-ink)]"
        >
          {Math.round(zoom * 100)}%
          <FigIcon src={figAsset.chevronDown} size={16} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `Inner` 新增 minimap 本地态**

在 `Inner` 函数体内(`const addMenu = useStore(...)` 之后、`const { screenToFlowPosition ... }` 附近)加:

```tsx
  // minimap 开关:瞬态本地态(不落盘)。MiniMap 需作为 ReactFlow 子节点,故在此持有、传给工具条共享
  const [minimapOpen, setMinimapOpen] = useState(false);
```

- [ ] **Step 4: 替换 `<ZoomBar />` 调用(`:257`)**

```tsx
      <ZoomBar minimapOpen={minimapOpen} onToggleMinimap={() => setMinimapOpen((v) => !v)} />
```

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 通过。（若报 `minimapOpen` 已声明未使用,属正常——Task 4 接入 MiniMap 后即消解;如 lint 因未使用变量报错,本步可先在 `<MiniMap>` 接入前临时容忍,但 tsc 不会因此失败。)

- [ ] **Step 6: 启动开发服务器肉眼验证**

Run: `pnpm dev`,打开画布:工具条三组(minimap钮 | `+ − Fit` | `100%▾`)按既有令牌渲染;`+/−` 改变百分比、到 50%/200% 对应按钮禁用;Fit view 纳入全部卡片;下拉右对齐弹出可选 50/100/200%;minimap 钮点击切换 active(`raised-active`)态(此时尚无弹窗,Task 4 接入)。浅/深主题均正常。

- [ ] **Step 7: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 重做画布缩放工具条(minimap切换+步进+Fit view+百分比下拉)"
```

---

## Task 4: 接入内置 MiniMap 全景弹窗 + 皮肤

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(import `MiniMap`、import `KIND_META`/`AssetKind`、`Inner` 内渲染 `<MiniMap>`、新增 `minimapNodeColor`)
- Modify: `src/app/globals.css`(末尾追加 `.canvas-minimap` 皮肤)

**Interfaces:**
- Consumes: `minimapOpen`(Task 3)、`KIND_META`(`src/lib/asset-kind.ts`)。

- [ ] **Step 1: 补充 imports**

`@xyflow/react` 的 import 块里把 `MiniMap` 加入命名导入:

```ts
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useViewport,
  type Node,
} from '@xyflow/react';
```

并追加:

```ts
import { KIND_META, type AssetKind } from '@/lib/asset-kind';
```

- [ ] **Step 2: 新增 `minimapNodeColor` 节点取色函数**

放在 `ZoomBar` 函数之后(模块级):

```tsx
// minimap 节点取色:按资产类型色(无类型回退次级描边色)
function minimapNodeColor(node: Node): string {
  const kind = (node.data as { asset?: { kind?: AssetKind } } | undefined)?.asset?.kind;
  return kind ? KIND_META[kind].colorVar : 'var(--color-line-2)';
}
```

- [ ] **Step 3: 在 `<ReactFlow>` 内 `<Background>` 之后条件渲染 `<MiniMap>`**

```tsx
        <Background variant={BackgroundVariant.Dots} color="var(--color-line-2)" gap={20} size={1.5} />
        {minimapOpen && (
          <MiniMap
            pannable
            zoomable
            position="bottom-center"
            ariaLabel="Canvas minimap"
            className="anim-pop-in canvas-minimap"
            style={{ width: 240, height: 160, marginBottom: 84 }}
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={0}
          />
        )}
```

- [ ] **Step 4: `globals.css` 末尾追加 minimap 皮肤(只用既有令牌)**

```css
/* 画布全景 minimap:沿用浮层令牌,不引入新色;进退场复用 .anim-pop-in(已在 reduced-motion 禁用列表) */
.react-flow__minimap.canvas-minimap {
  background-color: var(--color-pop);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-popover);
  overflow: hidden;
}
.canvas-minimap .react-flow__minimap-mask {
  fill: var(--color-fill);
  fill-opacity: 0.5;
  stroke: var(--color-accent);
  stroke-width: 2;
  stroke-opacity: 0.9;
}
.canvas-minimap .react-flow__minimap-node {
  rx: 3px;
  ry: 3px;
}
```

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 通过。

- [ ] **Step 6: 启动开发服务器肉眼验证**

Run: `pnpm dev`。点 minimap 钮:工具条正上方居中弹出全景卡(`anim-pop-in`),内含按类型上色的卡片矩形与视口遮罩(accent 描边),可点击/拖拽平移、滚轮缩放;再点收起。位置若与工具条贴合不准,微调 `style.marginBottom`(基准 84)。浅/深主题皮肤均用令牌、无青色硬编码。`prefers-reduced-motion` 下无弹入动画。

- [ ] **Step 7: 全量测试 + 构建**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿(`zoom.test.ts` 通过,其余无回归)。

- [ ] **Step 8: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx src/app/globals.css
git commit -m "feat: 画布缩放工具条接入内置 MiniMap 全景弹窗 + 令牌皮肤"
```

---

## Self-Review

**Spec 覆盖:**
- minimap 弹窗(目标1)→ Task 4。
- 复用缩放菜单 + `+/−` 步进 5(目标2)→ Task 2(`stepZoom`)+ Task 3(按钮 + 保留下拉)。
- 独立 Fit view(目标3)→ Task 3(`fitView`)。
- 图标(spec「图标」节)→ Task 1。
- 下拉移除 Fit view 预设 + 右对齐 → Task 3 Step 2(presets 仅 50/100/200%、`origin-bottom-right`/`right-0`)。
- minimap 皮肤只用令牌、不采用青色 → Task 4 Step 4。
- 缩放步进单测 TDD → Task 2。

**占位符扫描:** 无 TBD/TODO;每个代码步骤含完整代码与确切命令。

**类型一致性:** `stepZoom(current, deltaPercent, min, max)` 在 Task 2 定义、Task 3 调用签名一致;`figAsset.map/minus/frame` Task 1 定义、Task 3 使用一致;`minimapOpen`/`onToggleMinimap` props 在 Task 3 定义、Task 3/4 使用一致;`MIN_ZOOM`/`MAX_ZOOM` 与 React Flow 默认一致。
