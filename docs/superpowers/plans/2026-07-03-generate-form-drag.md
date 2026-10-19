# 生成弹窗支持拖动 + 落点跟随 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布生成弹窗（GenerateForm）空白处可按住拖动重定位；拖动过后提交生成，占位卡落点按弹窗当前位置重算。

**Architecture:** 自研指针拖拽（pointerdown 启动 + window pointermove/pointerup），不引入依赖；屏幕→画布坐标转换经 `src/lib/viewport.ts` 既有注册表模式新增 `screenToCanvas`，由 AssetCanvas 挂载时注册 `screenToFlowPosition`。

**Tech Stack:** React 19 + zustand + @xyflow/react + Vitest(jsdom)。

**Spec:** `docs/superpowers/specs/2026-07-03-generate-form-drag-design.md`

## Global Constraints

- 代码注释 / commit message 一律中文；注释解释「为什么」。
- 不硬编码色值 / 不新增一次性 keyframes / 不新增依赖。
- 测试与源码同目录（`*.test.ts(x)`）；跑测试用 `pnpm exec vitest run <file>`。
- 提交前 `pnpm exec tsc --noEmit` 通过。
- 交互元素按下不触发拖拽；未拖动时 `spawnAt` 语义与现状完全一致（既有测试不得改断言）。

---

### Task 1: viewport.ts 新增 screenToCanvas 注册项 + AssetCanvas 注册

**Files:**
- Modify: `src/lib/viewport.ts`
- Modify: `src/components/canvas/AssetCanvas.tsx`（约 506–512 行附近，与 registerViewportCenter 同区）
- Test: `src/lib/viewport.test.ts`（若不存在则创建）

**Interfaces:**
- Produces: `registerScreenToCanvas(fn: ((p: XY) => XY) | null): void` 与 `screenToCanvas(p: XY): XY | null`（未注册返回 null）。Task 3 消费 `screenToCanvas`。

- [ ] **Step 1: 写失败测试**

在 `src/lib/viewport.test.ts` 追加（文件不存在则新建，含既有函数不动）：

```ts
import { afterEach, expect, test } from 'vitest';
import { registerScreenToCanvas, screenToCanvas } from './viewport';

afterEach(() => registerScreenToCanvas(null));

test('screenToCanvas:未注册返回 null,注册后经转换函数换算,注销后恢复 null', () => {
  expect(screenToCanvas({ x: 10, y: 20 })).toBeNull();
  registerScreenToCanvas((p) => ({ x: p.x * 2, y: p.y * 2 }));
  expect(screenToCanvas({ x: 10, y: 20 })).toEqual({ x: 20, y: 40 });
  registerScreenToCanvas(null);
  expect(screenToCanvas({ x: 10, y: 20 })).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/viewport.test.ts`
Expected: FAIL（`registerScreenToCanvas` 未导出）。

- [ ] **Step 3: 最小实现**

`src/lib/viewport.ts` 末尾追加（与既有注册项同模式）：

```ts
// 屏幕坐标 → 画布(flow)坐标:生成弹窗被拖动后按当前位置重算落点时使用
let toCanvas: ((p: XY) => XY) | null = null;
export function registerScreenToCanvas(fn: ((p: XY) => XY) | null) { toCanvas = fn; }
export function screenToCanvas(p: XY): XY | null { return toCanvas ? toCanvas(p) : null; }
```

`src/components/canvas/AssetCanvas.tsx`：import 行加 `registerScreenToCanvas`，在 `registerViewportCenter` 的 effect 后新增同款 effect：

```tsx
// 注册屏幕→画布坐标转换:弹窗层(画布外 fixed)拖动后重算落点用
useEffect(() => {
  registerScreenToCanvas((p) => screenToFlowPosition(p));
  return () => registerScreenToCanvas(null);
}, [screenToFlowPosition]);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/viewport.test.ts && pnpm exec tsc --noEmit`
Expected: PASS，tsc 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/lib/viewport.ts src/lib/viewport.test.ts src/components/canvas/AssetCanvas.tsx
git commit -m "feat: viewport 注册表新增 screenToCanvas 屏幕→画布转换"
```

---

### Task 2: GenerateForm 空白处指针拖拽

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx`
- Test: `src/components/canvas/GenerateForm.test.tsx`

**Interfaces:**
- Consumes: 无（纯组件内状态）。
- Produces: 组件内 `cardRef`（外层定位 div 的 ref）与 `draggedRef`（本次是否拖动过，boolean ref）——Task 3 在 submit 里读取。

- [ ] **Step 1: 写失败测试**

`GenerateForm.test.tsx` 末尾追加。jsdom 无真实布局，先 mock `getBoundingClientRect`（既有用例不受影响：它们不传 x/y 或不触发测量断言）：

```tsx
// ── 拖拽:空白处按住可拖,交互控件不触发,越界夹取 ─────────────────────
const mockRect = (left: number, top: number, width = 520, height = 200) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  } as DOMRect);

test('拖拽:卡片空白处 pointerdown+move 更新定位', () => {
  mockRect(100, 100);
  render(<GenerateForm kind="image" x={100} y={100} onClose={() => {}} />);
  const card = document.querySelector('.modal-pop')!.parentElement!;
  fireEvent.pointerDown(card, { clientX: 150, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: 250, clientY: 220 });
  fireEvent.pointerUp(window);
  // 按下点相对卡片左上偏移 (50,20),移动到 (250,220) → 左上角 (200,200)
  expect((card as HTMLElement).style.left).toBe('200px');
  expect((card as HTMLElement).style.top).toBe('200px');
});

test('拖拽:textarea 上 pointerdown 不触发拖拽', () => {
  mockRect(100, 100);
  render(<GenerateForm kind="image" x={100} y={100} onClose={() => {}} />);
  const card = document.querySelector('.modal-pop')!.parentElement! as HTMLElement;
  const before = card.style.left;
  fireEvent.pointerDown(screen.getByPlaceholderText(/Describe the image/), { clientX: 150, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: 400, clientY: 400 });
  fireEvent.pointerUp(window);
  expect(card.style.left).toBe(before);
});

test('拖拽:拖出视口时夹取在 12px 边距内', () => {
  mockRect(100, 100, 520, 200);
  render(<GenerateForm kind="image" x={100} y={100} onClose={() => {}} />);
  const card = document.querySelector('.modal-pop')!.parentElement! as HTMLElement;
  fireEvent.pointerDown(card, { clientX: 150, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: -500, clientY: -500 });
  fireEvent.pointerUp(window);
  expect(card.style.left).toBe('12px');
  expect(card.style.top).toBe('12px');
});

test('拖拽:居中回退态(无 x/y)拖动后转为受控 left/top', () => {
  mockRect(300, 250);
  render(<GenerateForm kind="image" onClose={() => {}} />);
  const card = document.querySelector('.modal-pop')!.parentElement! as HTMLElement;
  fireEvent.pointerDown(card, { clientX: 350, clientY: 270, button: 0 });
  fireEvent.pointerMove(window, { clientX: 400, clientY: 320 });
  fireEvent.pointerUp(window);
  // 偏移 (50,20) → 左上角 (350,300);居中 transform 类被移除
  expect(card.style.left).toBe('350px');
  expect(card.style.top).toBe('300px');
  expect(card.className).not.toContain('-translate-x-1/2');
});
```

并在文件顶部 `afterEach(cleanup)` 处补 `afterEach(() => vi.restoreAllMocks())`（或合并进现有 afterEach）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: 新增 4 例 FAIL（style.left 不变 / 类未移除），既有用例 PASS。

- [ ] **Step 3: 实现拖拽**

`GenerateForm.tsx` 修改点：

a. import 增加 `useRef`。

b. 组件内（`measureCard` 附近）新增：

```tsx
// 拖拽:空白处按住整卡拖动;交互控件(输入/按钮/下拉)按下不启动。
// 用 window 级 move/up 监听而非 setPointerCapture:jsdom 可测,且指针滑出卡片仍跟手。
const cardRef = useRef<HTMLDivElement | null>(null);
const draggedRef = useRef(false); // 本次打开是否拖动过:提交时决定是否按当前位置重算落点
const [dragging, setDragging] = useState(false);
const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
  if (e.button !== 0) return;
  // 命中交互元素则放行给控件,不启动拖拽
  if ((e.target as HTMLElement).closest('textarea, button, input, select, a, [role="button"], [role="option"], [role="listbox"]')) return;
  const el = cardRef.current;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const M = 12;
  draggedRef.current = true;
  setDragging(true);
  const move = (ev: PointerEvent) => {
    setPos({
      left: Math.max(M, Math.min(ev.clientX - offset.x, window.innerWidth - rect.width - M)),
      top: Math.max(M, Math.min(ev.clientY - offset.y, window.innerHeight - rect.height - M)),
    });
  };
  const up = () => {
    setDragging(false);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
};
```

c. 外层定位 div：ref 合并测量与 cardRef，定位改「`pos` 优先」，居中类仅在无 `pos` 且无 `x/y` 时应用，挂 `onPointerDown`，拖拽中禁选中文本 + grabbing 光标：

```tsx
<div
  ref={(el) => { cardRef.current = el; measureCard(el); }}
  onPointerDown={onDragStart}
  style={pos ? { left: pos.left, top: pos.top } : x != null && y != null ? { left: x, top: y } : undefined}
  className={`fixed z-50 w-fit min-w-[520px] max-w-[calc(100vw-24px)] ${pos == null && (x == null || y == null) ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''} ${dragging ? 'select-none cursor-grabbing' : ''}`}
>
```

注意 `measureCard` 现有实现只在 `x/y` 非空时 setPos，行为不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx && pnpm exec tsc --noEmit`
Expected: 全部 PASS，tsc 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 生成弹窗空白处可按住拖动重定位"
```

---

### Task 3: 提交时落点跟随弹窗位置

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx`（submit 函数）
- Test: `src/components/canvas/GenerateForm.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `screenToCanvas(p: XY): XY | null`；Task 2 的 `cardRef` / `draggedRef`。
- Produces: `generate*` 的 `placement.spawnAt` 在拖动过后为重算坐标。

- [ ] **Step 1: 写失败测试**

`GenerateForm.test.tsx` 追加（import 增加 `registerScreenToCanvas`）：

```tsx
import { registerScreenToCanvas } from '@/lib/viewport';

test('落点跟随:拖动后提交,spawnAt 按弹窗当前位置经 screenToCanvas 重算', async () => {
  registerScreenToCanvas((p) => ({ x: p.x + 1000, y: p.y + 2000 }));
  const rectSpy = mockRect(100, 100);
  render(<GenerateForm kind="image" x={100} y={100} spawnAt={{ x: 1, y: 2 }} onClose={() => {}} />);
  const card = document.querySelector('.modal-pop')!.parentElement!;
  fireEvent.pointerDown(card, { clientX: 150, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: 250, clientY: 220 });
  fireEvent.pointerUp(window);
  // 拖到 (200,200) 后提交:submit 时 rect 反映新位置
  rectSpy.mockReturnValue({ left: 200, top: 200, width: 520, height: 200, right: 720, bottom: 400, x: 200, y: 200, toJSON: () => ({}) } as DOMRect);
  fireEvent.change(screen.getByPlaceholderText(/Describe the image/), { target: { value: '主角立绘' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genImage).toHaveBeenCalled());
  expect(genImage.mock.calls[0][1]).toEqual({ sourceItemId: undefined, spawnAt: { x: 1200, y: 2200 } });
  registerScreenToCanvas(null);
});

test('落点跟随:未拖动提交,spawnAt 沿用入参不重算', async () => {
  registerScreenToCanvas((p) => ({ x: p.x + 1000, y: p.y + 2000 }));
  mockRect(100, 100);
  render(<GenerateForm kind="image" x={100} y={100} spawnAt={{ x: 1, y: 2 }} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Describe the image/), { target: { value: '主角立绘' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genImage).toHaveBeenCalled());
  expect(genImage.mock.calls[0][1]).toEqual({ sourceItemId: undefined, spawnAt: { x: 1, y: 2 } });
  registerScreenToCanvas(null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: 第一例 FAIL（spawnAt 仍为 `{x:1,y:2}`），第二例 PASS。

- [ ] **Step 3: 实现**

`GenerateForm.tsx`：import 增加 `import { screenToCanvas } from '@/lib/viewport';`。`submit` 内 placement 一行改为：

```tsx
// 落点跟随:拖动过则按弹窗当前左上角重算画布坐标;转换未注册(画布未挂载)回退原 spawnAt
const rect = draggedRef.current ? cardRef.current?.getBoundingClientRect() : undefined;
const placement = {
  sourceItemId: primarySourceId,
  spawnAt: (rect && screenToCanvas({ x: rect.left, y: rect.top })) || spawnAt,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx && pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: 全量 PASS，tsc 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 生成弹窗拖动后提交按当前位置重算落点"
```
