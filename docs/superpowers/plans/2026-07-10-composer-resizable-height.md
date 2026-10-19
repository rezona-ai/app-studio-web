# 输入框高度可调实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composer 输入框随内容自动增高（2–6 行），并支持上缘拖拽设置基准高度（作为下限，持久化）。

**Architecture:** 纯 clamp/行数换算逻辑下沉 `src/lib/composer-height.ts`；`baseLines` 进 store 的 ComposerState 并持久化；Composer.tsx 把高度作用在 textarea 与镜像层的共同父容器上，新增拖拽把手。实际行数 = `clamp(baseLines, 内容行数, 6)`。

**Tech Stack:** React 19 + zustand + Vitest（jsdom）。

## Global Constraints

- 设计稿：`docs/superpowers/specs/2026-07-10-composer-resizable-height-design.md`
- 行高 24px（`leading-6`），textarea 上内边距 4px（`pt-1`）；行数范围 [2, 6]
- 镜像层与 textarea 的字体/内边距/换行度量必须完全一致（光标对齐约束），高度只改共同父容器
- 颜色/圆角/阴影一律用 CSS 变量令牌，禁止硬编码色值；注释/commit message 用中文
- 测试与源码同目录 `*.test.ts(x)`；验证命令 `pnpm exec vitest run <file>`、`pnpm exec tsc --noEmit`

---

### Task 1: 纯逻辑 `composer-height.ts`

**Files:**
- Create: `src/lib/composer-height.ts`
- Test: `src/lib/composer-height.test.ts`

**Interfaces:**
- Produces:
  - `MIN_LINES = 2`、`MAX_LINES = 6`、`LINE_HEIGHT = 24`、`PAD_TOP = 4`（均 export const）
  - `clampBaseLines(n: number): number` — 取整并夹取到 [2,6]，非法值（NaN/undefined 传入前调用方兜底）返回 2
  - `contentLines(scrollHeight: number): number` — `Math.ceil((scrollHeight - PAD_TOP) / LINE_HEIGHT)`，最小 1
  - `displayLines(baseLines: number, content: number): number` — `Math.min(Math.max(clampBaseLines(baseLines), content), MAX_LINES)`，且不小于 MIN_LINES
  - `boxHeight(lines: number): number` — `lines * LINE_HEIGHT + PAD_TOP`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/composer-height.test.ts
import { describe, it, expect } from 'vitest';
import { clampBaseLines, contentLines, displayLines, boxHeight, MIN_LINES, MAX_LINES } from './composer-height';

describe('composer-height', () => {
  it('clampBaseLines 夹取到 [2,6] 并取整', () => {
    expect(clampBaseLines(0)).toBe(2);
    expect(clampBaseLines(4.6)).toBe(5);
    expect(clampBaseLines(99)).toBe(6);
    expect(clampBaseLines(NaN)).toBe(2);
  });
  it('contentLines 由 scrollHeight 反推行数', () => {
    expect(contentLines(28)).toBe(1);   // 1*24+4
    expect(contentLines(52)).toBe(2);   // 2*24+4
    expect(contentLines(148)).toBe(6);
    expect(contentLines(0)).toBe(1);    // 异常值兜底最小 1
  });
  it('displayLines = clamp(base, content, 6) 且 ≥2', () => {
    expect(displayLines(2, 1)).toBe(2);   // 内容少保持基准
    expect(displayLines(4, 1)).toBe(4);   // 拖高后作下限
    expect(displayLines(2, 5)).toBe(5);   // auto-grow
    expect(displayLines(2, 9)).toBe(6);   // 封顶
    expect(displayLines(6, 9)).toBe(6);
  });
  it('boxHeight 行数换像素', () => {
    expect(boxHeight(MIN_LINES)).toBe(52);
    expect(boxHeight(MAX_LINES)).toBe(148);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/composer-height.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/lib/composer-height.ts
// 输入框高度换算:实际行数 = clamp(基准行数, 内容行数, 6)。度量常量须与 Composer 的 leading-6 / pt-1 保持一致。
export const MIN_LINES = 2;
export const MAX_LINES = 6;
export const LINE_HEIGHT = 24; // leading-6
export const PAD_TOP = 4; // pt-1

export function clampBaseLines(n: number): number {
  if (!Number.isFinite(n)) return MIN_LINES;
  return Math.min(MAX_LINES, Math.max(MIN_LINES, Math.round(n)));
}

export function contentLines(scrollHeight: number): number {
  return Math.max(1, Math.ceil((scrollHeight - PAD_TOP) / LINE_HEIGHT));
}

export function displayLines(baseLines: number, content: number): number {
  return Math.min(MAX_LINES, Math.max(clampBaseLines(baseLines), content));
}

export function boxHeight(lines: number): number {
  return lines * LINE_HEIGHT + PAD_TOP;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/composer-height.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/composer-height.ts src/lib/composer-height.test.ts
git commit -m "feat: 输入框高度换算纯逻辑(clamp基准行数/内容行数)"
```

---

### Task 2: store 增加 `baseLines` 并持久化

**Files:**
- Modify: `src/store/index.ts`（ComposerState 定义 :42、初始态 :164、resetComposer :384、partialize :444）
- Test: `src/store/composer-baselines.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MIN_LINES`
- Produces: `ComposerState.baseLines: number`；`composerSet({ baseLines })` 可更新；`resetComposer()` 保留 baseLines

- [ ] **Step 1: 写失败测试**

```ts
// src/store/composer-baselines.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './index';

describe('composer.baseLines', () => {
  beforeEach(() => useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 } }));

  it('默认 2,可经 composerSet 更新', () => {
    expect(useStore.getState().composer.baseLines).toBe(2);
    useStore.getState().composerSet({ baseLines: 5 });
    expect(useStore.getState().composer.baseLines).toBe(5);
  });

  it('resetComposer 清草稿但保留 baseLines', () => {
    useStore.getState().composerSet({ draft: 'x', baseLines: 4 });
    useStore.getState().resetComposer();
    const c = useStore.getState().composer;
    expect(c.draft).toBe('');
    expect(c.baseLines).toBe(4);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/composer-baselines.test.ts`
Expected: FAIL（类型无 baseLines / reset 后丢失）

- [ ] **Step 3: 实现**

`src/store/index.ts` 四处修改：

```ts
// :42 类型
export interface ComposerState { draft: string; attachments: ChatAttachment[]; baseLines: number; }

// :164 初始态
composer: { draft: '', attachments: [], baseLines: 2 },

// :384 resetComposer —— 保留用户拖出的基准高度
resetComposer: () => set((s) => ({ composer: { draft: '', attachments: [], baseLines: s.composer.baseLines } })),

// :444 partialize —— baseLines 随草稿一起落 taluna-v4
composer: { draft: s.composer.draft, attachments: [], baseLines: s.composer.baseLines },
```

注意 `:256` 附近 `composerSet` 的 prelude 调用与其他 `composer: { ...s.composer, ... }` 展开式写法不受影响。旧持久化数据无 baseLines 字段 → 合并后为 undefined，由 Composer 侧 `clampBaseLines` 兜底为 2（Task 3）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/composer-baselines.test.ts src/store`
Expected: PASS（含存量 store 测试不回归；若存量测试构造 composer 字面量缺 baseLines 导致 ts 报错，补上 `baseLines: 2`）

- [ ] **Step 5: 提交**

```bash
git add src/store/index.ts src/store/composer-baselines.test.ts
git commit -m "feat: composer 基准行数 baseLines 进 store 并持久化"
```

---

### Task 3: Composer 接入 auto-grow 与拖拽把手

**Files:**
- Modify: `src/components/chat/Composer.tsx`
- Test: `src/components/chat/Composer.test.tsx`（存量文件则追加用例；无则新建）

**Interfaces:**
- Consumes: Task 1 全部导出；Task 2 的 `composer.baseLines` / `composerSet`

- [ ] **Step 1: 写失败测试**

追加（渲染上下文/mock 沿用该文件既有写法；若新建，参照 `src/components/chat/` 下其他组件测试的 store 初始化方式）：

```tsx
it('渲染拖拽把手,拖动更新 baseLines', () => {
  render(<Composer client={{ current: null }} />);
  const handle = screen.getByRole('separator', { name: /调整|resize/i });
  // 向上拖 48px = +2 行
  fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: 252, pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(useStore.getState().composer.baseLines).toBe(4);
});

it('容器高度随 baseLines 变化', () => {
  useStore.getState().composerSet({ baseLines: 5 });
  render(<Composer client={{ current: null }} />);
  expect(screen.getByTestId('composer-textbox').style.height).toBe('124px'); // 5*24+4
});
```

（jsdom 无 `setPointerCapture`，测试 setup 里 `HTMLElement.prototype.setPointerCapture ??= () => {}`、`releasePointerCapture` 同理。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: FAIL（无 separator / 无 data-testid）

- [ ] **Step 3: 实现**

`src/components/chat/Composer.tsx` 修改：

```tsx
import { clampBaseLines, contentLines, displayLines, boxHeight, LINE_HEIGHT } from '@/lib/composer-height';

// 组件内:
const baseLines = clampBaseLines(useStore((s) => s.composer.baseLines ?? 2)); // 旧持久化数据无此字段时兜底
const [contentLn, setContentLn] = useState(1);
const lines = displayLines(baseLines, contentLn);

// 内容行数测量:draft 变化后读 scrollHeight。测量前须把高度钳到 0 才能拿到真实内容高度?
// 不需要——textarea 是 h-full 撑满父容器,scrollHeight = max(内容高, 可视高),
// 收缩场景(删字)下 scrollHeight 恒等于可视高会卡住不缩。因此测量用一个恒 1 行高度的
// 隐藏探针不划算,改为:测量时临时将 textarea height 置 0 再读 scrollHeight、随后恢复(同步布局,无闪烁)。
useEffect(() => {
  const ta = taRef.current;
  if (!ta) return;
  const prev = ta.style.height;
  ta.style.height = '0px';
  setContentLn(contentLines(ta.scrollHeight));
  ta.style.height = prev;
}, [draft]);

// 拖拽把手状态
const dragRef = useRef<{ startY: number; startLines: number } | null>(null);
const onHandleDown = (e: React.PointerEvent) => {
  dragRef.current = { startY: e.clientY, startLines: baseLines };
  e.currentTarget.setPointerCapture(e.pointerId);
};
const onHandleMove = (e: React.PointerEvent) => {
  const d = dragRef.current;
  if (!d) return;
  const next = clampBaseLines(d.startLines + (d.startY - e.clientY) / LINE_HEIGHT);
  if (next !== baseLines) composerSet({ baseLines: next });
};
const onHandleUp = (e: React.PointerEvent) => {
  dragRef.current = null;
  e.currentTarget.releasePointerCapture(e.pointerId);
};
```

JSX：文本区外层 `relative` 容器加受控高度与 testid，其上方插入把手（AttachmentBar 之后）：

```tsx
{/* 拖拽把手:向上拖增高,基准行数作 auto-grow 下限;命中区 8px,hover 显示细条(分隔条范式) */}
<div
  role="separator"
  aria-orientation="horizontal"
  aria-label={t('chat.composer.resize')}
  onPointerDown={onHandleDown}
  onPointerMove={onHandleMove}
  onPointerUp={onHandleUp}
  className="group -my-1 flex h-2 cursor-row-resize items-center justify-center touch-none"
>
  <div className="h-[3px] w-8 rounded-full bg-transparent transition-colors group-hover:bg-[var(--color-line)] group-active:bg-[var(--color-teal)]" />
</div>
<div className="relative" data-testid="composer-textbox" style={{ height: boxHeight(lines) }}>
  {/* 镜像层与 textarea 原样保留 */}
```

textarea 改动：删除 `rows={2}`，className 加 `h-full`（其余度量类不动）。镜像层已 `absolute inset-0`，自动跟随。

i18n：`chat.composer.resize` 六语文案补齐（en 为 `Resize input`；zh `调整输入框高度`；fr/ru/ja/vi 对应翻译，按 `src` 下 locales 既有文件结构追加）。

- [ ] **Step 4: 跑测试与全量校验**

Run: `pnpm exec vitest run src/components/chat && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部 PASS

- [ ] **Step 5: 运行态验证**

参照 RULE.md 本地验证约定起 dev（注意端口占用坑），手工/Playwright 验证:输入多行自动长高至 6 行封顶、内部滚动镜像层同步、拖高后清空草稿仍保持高度、刷新后高度保留、光标与高亮胶囊无错位。

- [ ] **Step 6: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx <locales files>
git commit -m "feat: 输入框随内容自动增高至6行,支持拖拽基准高度"
```
