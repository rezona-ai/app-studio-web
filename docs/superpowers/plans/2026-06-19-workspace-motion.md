# Workspace 交互动效优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一套统一、克制、可降级的纯 CSS 动效语汇,补全 workspace(Chat / Canvas / Preview)及共享 UI 中「瞬现 / 瞬变 / 无反馈」的交互。

**Architecture:** 在 `globals.css` 集中定义一组 keyframe 与工具类(`pop-in` / `modal` / `toast` / 媒体淡入 / Composer 聚焦),配一个极小的 `useExitTransition` hook 处理「退场播完再卸载」。各组件只挂类名或做最小结构改造;凡用 `transform` 定位的元素(Tooltip / Toast),用「外层定位 + 内层动画」避免与动画 transform 冲突。

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4(`@theme` 设计 token) / Vitest 4 + jsdom + @testing-library/react。**不引入任何动画库。**

## Global Constraints

- **零新依赖**:只用 CSS keyframes/transition + 自写 hook,禁止引入 framer-motion 等。
- **合成属性优先**:动画只动 `transform` / `opacity`;高度展开用 `grid-template-rows: 0fr→1fr`(不量内容高度)。
- **必带降级**:每条动画在 `@media (prefers-reduced-motion: reduce)` 下退化为无位移/无缩放(瞬现或纯淡入)。
- **不破坏不变式**:不得干扰 xyflow 节点最终 `position`(只叠加视觉 transform);Workspace overlay 既有 `transition-[width]` 在拖拽期间关闭的逻辑保留。
- **注释 / commit message 一律中文**;`eslint-disable` 必带 `-- 理由`。
- **测试边界**:CSS/视觉改动不写单测(脆且无意义),靠 `tsc + lint + 人工核验`;仅**有逻辑的部分**(`useExitTransition`、`Toast` 保留末次内容)写 Vitest 单测。xyflow 节点因需 ReactFlow 上下文,节点内动效一律人工核验。
- **校验命令**(每个任务结束跑):`pnpm exec tsc --noEmit && pnpm lint && pnpm test`。

---

## 批次一:基建 + Tier 1(高频微交互)

### Task 1: 动效基建 —— keyframes/工具类 + `useExitTransition` hook

**Files:**
- Modify: `src/app/globals.css`(文件末尾追加)
- Create: `src/client/useExitTransition.ts`
- Test: `src/client/useExitTransition.test.ts`

**Interfaces:**
- Produces:
  - CSS 工具类:`.anim-pop-in`、`.modal-backdrop`、`.modal-pop`、`.toast-pop`、`.composer-card`、`.anim-media-in`(均含 `data-closing` 变体 / reduced-motion 降级)。
  - `useExitTransition(open: boolean, ms: number): { mounted: boolean; closing: boolean }` —— `open` 转 `false` 时先置 `closing` 播放退场,延时 `ms`(reduced-motion 下视为 0)后才 `mounted=false` 卸载。

- [ ] **Step 1: 追加 CSS(globals.css 末尾)**

```css
/* ===== 交互动效统一语汇(见 specs/2026-06-19-workspace-motion-design.md) ===== */

/* 弹层/菜单/Tooltip 进场:微缩放 + 上浮 + 淡入。transform-origin 由使用处指定 */
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}
.anim-pop-in { animation: pop-in 150ms cubic-bezier(0.22, 1, 0.36, 1) both; }

/* 通用淡入/淡出 */
@keyframes mo-fade-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes mo-fade-out { from { opacity: 1; } to { opacity: 0; } }
.anim-media-in { animation: mo-fade-in 200ms ease both; }

/* 模态:遮罩淡入淡出 + 面板上浮缩放进出场(配合 data-closing) */
@keyframes modal-in  { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: translateY(0)   scale(1);    } }
@keyframes modal-out { from { opacity: 1; transform: translateY(0)   scale(1);    } to { opacity: 0; transform: translateY(6px) scale(0.98); } }
.modal-backdrop { animation: mo-fade-in 200ms ease both; }
.modal-backdrop[data-closing="true"] { animation: mo-fade-out 160ms ease both; }
.modal-pop { animation: modal-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.modal-pop[data-closing="true"] { animation: modal-out 160ms ease-in both; }

/* Toast:顶部下滑淡入 / 对称退场 */
@keyframes toast-in  { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-8px); } }
.toast-pop { animation: toast-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.toast-pop[data-closing="true"] { animation: toast-out 160ms ease-in both; }

/* Composer 输入卡聚焦光晕(克制:边框转 accent + 一圈柔光环,不上浮不旋转) */
.composer-card { transition: border-color 180ms ease, box-shadow 180ms ease; }
.composer-card:focus-within {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-prompt), 0 0 0 3px var(--color-accent-soft);
}

@media (prefers-reduced-motion: reduce) {
  .anim-pop-in,
  .anim-media-in,
  .modal-backdrop, .modal-backdrop[data-closing="true"],
  .modal-pop, .modal-pop[data-closing="true"],
  .toast-pop, .toast-pop[data-closing="true"] { animation: none; }
  .composer-card { transition: none; }
}
```

- [ ] **Step 2: 写失败测试 `src/client/useExitTransition.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExitTransition } from './useExitTransition';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useExitTransition', () => {
  test('open=true 立即挂载且非 closing', () => {
    const { result } = renderHook(() => useExitTransition(true, 200));
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  test('open 转 false:先 closing 仍挂载,延时后卸载', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitTransition(open, 200),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  test('退场途中重新 open:取消卸载,恢复挂载', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitTransition(open, 200),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(100));
    rerender({ open: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  test('prefers-reduced-motion:退场延时视为 0,立即卸载', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitTransition(open, 200),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.mounted).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useExitTransition.test.ts`
Expected: FAIL —— `Failed to resolve import "./useExitTransition"`。

- [ ] **Step 4: 实现 `src/client/useExitTransition.ts`**

```ts
import { useEffect, useRef, useState } from 'react';

// open 变 false 时:先置 closing 播放退场,延时 ms 后才真正卸载(mounted=false)。
// reduced-motion 下退场延时视为 0(瞬卸,不空等)。沿用 GamePreviewModal 的 data-closing 思路,抽成可复用 hook。
export function useExitTransition(open: boolean, ms: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return; // 本就未挂载,无需退场
    const reduce = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    timer.current = setTimeout(() => { setMounted(false); setClosing(false); }, reduce ? 0 : ms);
  }, [open, ms, mounted]);

  // 卸载清理定时器
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { mounted, closing };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useExitTransition.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 6: 校验并提交**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add src/app/globals.css src/client/useExitTransition.ts src/client/useExitTransition.test.ts
git commit -m "feat: 新增动效基建(统一 keyframe 工具类 + useExitTransition hook)"
```

---

### Task 2: Composer 输入框聚焦光晕

**Files:**
- Modify: `src/components/chat/Composer.tsx:110`

**Interfaces:**
- Consumes: `.composer-card`(Task 1)。

- [ ] **Step 1: 给输入卡挂 `composer-card` 类**

`src/components/chat/Composer.tsx` 第 110 行,把：

```tsx
      <div className="relative flex flex-col gap-3 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
```

改为（追加 `composer-card`,其余不变）：

```tsx
      <div className="composer-card relative flex flex-col gap-3 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
```

- [ ] **Step 2: 校验 + 人工核验**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:`pnpm dev` → 点击对话输入框,边框平滑转蓝并出现一圈柔光环;失焦平滑还原。系统开启「减弱动态」后聚焦态仍生效但无过渡。

- [ ] **Step 3: 提交**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat: 对话输入框聚焦柔光描边动效"
```

---

### Task 3: Tooltip 进场（外层定位 + 内层动画）

**Files:**
- Modify: `src/components/ui/Tooltip.tsx:88-104`

**Interfaces:**
- Consumes: `.anim-pop-in`(Task 1)。
- 约束:`bubbleRef` 仍挂在「定位用外层」,clamp 逻辑(useLayoutEffect 读 `offsetWidth`、写 `style.left`)不变 —— 外层设 `inline-block` 使其宽度收缩为内层气泡宽度。

- [ ] **Step 1: 重构 portal 结构**

把 `src/components/ui/Tooltip.tsx` 第 88-104 行的 `pos && createPortal(...)` 整段替换为：

```tsx
      {pos &&
        createPortal(
          <span
            ref={bubbleRef}
            aria-hidden="true"
            // 外层只负责定位(含 placement 位移),内层做进场动画,二者 transform 互不覆盖
            style={{
              position: 'fixed',
              top: pos.y,
              left: pos.x, // 初值,useLayoutEffect 会按实际宽度 clamp
              transform: pos.placement === 'top' ? 'translateY(calc(-100% - 8px))' : 'translateY(8px)',
            }}
            className="pointer-events-none z-[100] inline-block"
          >
            <span
              className="anim-pop-in block max-w-[240px] whitespace-nowrap rounded-[8px] border border-[var(--color-line)] bg-[var(--color-pop)] px-2 py-1 text-[12px] font-medium text-[var(--color-ink)] shadow-[var(--shadow-popover)]"
              style={{ transformOrigin: pos.placement === 'top' ? 'center bottom' : 'center top' }}
            >
              {text}
            </span>
          </span>,
          document.body,
        )}
```

- [ ] **Step 2: 校验 + 测试 + 人工核验**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/components/ui/Tooltip.test.tsx`
（已有 Tooltip 测试断言「文案/定位」,结构改造后仍应通过；若按 DOM 层级取气泡的断言失败,把取节点改为最内层 `span` 文本断言。）
人工:悬停任意带 tooltip 的按钮 350ms 后,气泡淡入 + 轻微上浮/缩放;滚动/按下即瞬隐。

- [ ] **Step 3: 提交**

```bash
git add src/components/ui/Tooltip.tsx src/components/ui/Tooltip.test.tsx
git commit -m "feat: Tooltip 气泡进场动效(内外层拆分避免 transform 冲突)"
```

---

### Task 4: 双击菜单 + 右键菜单进场

**Files:**
- Modify: `src/components/canvas/AddAssetMenu.tsx:63`
- Modify: `src/components/canvas/ContextMenu.tsx:53`

**Interfaces:**
- Consumes: `.anim-pop-in`(Task 1)。两菜单均 `fixed` + 左上角锚定触发点 → `origin-top-left`。

- [ ] **Step 1: AddAssetMenu 菜单本体加类**

`src/components/canvas/AddAssetMenu.tsx` 第 63 行,把开头的：

```tsx
      <div className="fixed z-50 flex w-[250px] flex-col gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] p-3 shadow-[var(--shadow-toolbar)]" style={{ left: x, top: y }}>
```

改为：

```tsx
      <div className="anim-pop-in origin-top-left fixed z-50 flex w-[250px] flex-col gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] p-3 shadow-[var(--shadow-toolbar)]" style={{ left: x, top: y }}>
```

- [ ] **Step 2: ContextMenu 菜单本体加类**

`src/components/canvas/ContextMenu.tsx` 第 52-54 行,把：

```tsx
      <div
        className="fixed z-50 flex w-[276px] flex-col gap-0.5 overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 backdrop-blur-[12px]"
        style={{ left: menu.x, top: menu.y, boxShadow: POPOVER_SHADOW }}
```

改为（追加 `anim-pop-in origin-top-left`）：

```tsx
      <div
        className="anim-pop-in origin-top-left fixed z-50 flex w-[276px] flex-col gap-0.5 overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 backdrop-blur-[12px]"
        style={{ left: menu.x, top: menu.y, boxShadow: POPOVER_SHADOW }}
```

- [ ] **Step 3: 校验 + 人工核验**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:画布双击空白 → 菜单从点击点缩放淡入;右键节点 → 同样。

- [ ] **Step 4: 提交**

```bash
git add src/components/canvas/AddAssetMenu.tsx src/components/canvas/ContextMenu.tsx
git commit -m "feat: 画布双击/右键菜单从触发点缩放淡入"
```

---

### Task 5: Toast 进出场

**Files:**
- Modify: `src/components/ui/Toast.tsx`(整体重写)
- Test: `src/components/ui/Toast.test.tsx`(新建)

**Interfaces:**
- Consumes: `useExitTransition`(Task 1)、`.toast-pop`(Task 1)。
- 外层维持 `-translate-x-1/2` 定位,内层 `.toast-pop` 动 translateY/opacity;退场期间用 `shown` 保留末次错误内容。

- [ ] **Step 1: 重写 `src/components/ui/Toast.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { useExitTransition } from '@/client/useExitTransition';

// 订阅 store.lastError,展示一个 4s 自动消失的错误条;进出场用 toast-pop(退场期间保留末次内容)
export default function Toast() {
  const error = useStore((s) => s.lastError);
  const setError = useStore((s) => s.setError);
  const { mounted, closing } = useExitTransition(!!error, 200);
  // 退场动画期间 error 已为 null,用 shown 保留最后一次内容供渲染
  const [shown, setShown] = useState(error);
  useEffect(() => { if (error) setShown(error); }, [error]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!mounted || !shown) return null;
  return (
    <div className="fixed top-4 left-1/2 z-[100] -translate-x-1/2">
      <div
        data-closing={closing}
        className="toast-pop flex items-center gap-2 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] text-[var(--color-ink)] shadow-[var(--shadow-popover)]"
      >
        <span className={`font-semibold ${shown.kind === 'notice' ? 'text-[var(--color-muted)]' : 'text-red-600'}`}>{shown.code}</span>
        <span className="text-[var(--color-muted)]">{shown.message}</span>
        <button type="button" onClick={() => setError(null)} className="ml-2 text-[var(--color-muted)] hover:text-[var(--color-ink)]">✕</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写测试 `src/components/ui/Toast.test.tsx`**

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useStore } from '@/store';
import Toast from './Toast';

beforeEach(() => { vi.useFakeTimers(); useStore.setState({ lastError: null }); });
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  useStore.setState({ lastError: null });
});

describe('Toast', () => {
  test('退场期间仍渲染末次内容,延时后卸载', () => {
    useStore.setState({ lastError: { code: 'ERR', message: '出错了' } });
    render(<Toast />);
    expect(screen.getByText('ERR')).toBeTruthy();

    // 点 ✕ 关闭 → error 置 null,进入退场但仍挂载
    act(() => { useStore.getState().setError(null); });
    expect(screen.queryByText('ERR')).toBeTruthy();

    // 退场动画时长(200ms)后卸载
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('ERR')).toBeNull();
  });
});
```

> 说明:`lastError` 形如 `{ code, message, kind? }`;若 store 的字段名不同,以 `src/store/types.ts` 实际类型为准微调测试与组件取值。

- [ ] **Step 3: 跑测试**

Run: `pnpm exec vitest run src/components/ui/Toast.test.tsx`
Expected: PASS。

- [ ] **Step 4: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:触发一个错误(如上传超限),Toast 从顶部下滑淡入;4s 后或点 ✕ 平滑上滑淡出。

```bash
git add src/components/ui/Toast.tsx src/components/ui/Toast.test.tsx
git commit -m "feat: Toast 顶部滑入/对称退场动效"
```

---

### Task 6: 下拉 / 弹层统一进场 + Select chevron 旋转

**Files:**
- Modify: `src/components/ui/Select.tsx:66,71`
- Modify: `src/components/chat/ProjectMenu.tsx:67`
- Modify: `src/components/chat/MentionPopover.tsx:17`
- Modify: `src/components/canvas/RefPicker.tsx:40`
- Modify: `src/components/canvas/GenParamControls.tsx:14-15`
- Modify: `src/components/canvas/AssetCanvas.tsx:95`

**Interfaces:**
- Consumes: `.anim-pop-in`(Task 1)。各弹层按展开方向设 `origin`:向上展开→`origin-bottom*`,向下展开→`origin-top*`。`ModelSelector` 复用 `Select`,随之获得动效。

- [ ] **Step 1: Select 下拉 + chevron**

`src/components/ui/Select.tsx` 第 66 行 chevron,把：

```tsx
        <FigIcon src={figAsset.chevronDown} size={16} className="shrink-0 rotate-180 opacity-70" />
```

改为（打开时旋转回正,带过渡）：

```tsx
        <FigIcon src={figAsset.chevronDown} size={16} className={`shrink-0 opacity-70 transition-transform duration-150 ${open ? 'rotate-0' : 'rotate-180'}`} />
```

第 71 行下拉容器(向上展开 `bottom-[calc(100%+6px)]`),把：

```tsx
          <div className={`absolute bottom-[calc(100%+6px)] ${align === 'right' ? 'right-0' : 'left-0'} z-[56] flex min-w-[200px] flex-col gap-1 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]`}>
```

改为（追加 `anim-pop-in` + 方向 origin）：

```tsx
          <div className={`anim-pop-in ${align === 'right' ? 'origin-bottom-right' : 'origin-bottom-left'} absolute bottom-[calc(100%+6px)] ${align === 'right' ? 'right-0' : 'left-0'} z-[56] flex min-w-[200px] flex-col gap-1 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]`}>
```

- [ ] **Step 2: ProjectMenu 菜单(向下展开,左上锚定)**

`src/components/chat/ProjectMenu.tsx` 第 67 行,把：

```tsx
      <div className="absolute left-[10px] top-[calc(100%-1px)] z-50 flex w-[204px] flex-col items-start overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
```

改为：

```tsx
      <div className="anim-pop-in origin-top-left absolute left-[10px] top-[calc(100%-1px)] z-50 flex w-[204px] flex-col items-start overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
```

- [ ] **Step 3: MentionPopover(向上展开)**

`src/components/chat/MentionPopover.tsx` 第 17 行,把：

```tsx
    <div className="scrollbar-auto absolute bottom-full mb-1 flex max-h-56 w-64 flex-col gap-0.5 overflow-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
```

改为：

```tsx
    <div className="anim-pop-in origin-bottom-left scrollbar-auto absolute bottom-full mb-1 flex max-h-56 w-64 flex-col gap-0.5 overflow-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
```

- [ ] **Step 4: RefPicker(向下展开)**

`src/components/canvas/RefPicker.tsx` 第 40 行,把：

```tsx
          <div className="absolute left-0 top-[calc(100%+6px)] z-[56] max-h-[240px] w-[300px] overflow-y-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
```

改为：

```tsx
          <div className="anim-pop-in origin-top-left absolute left-0 top-[calc(100%+6px)] z-[56] max-h-[240px] w-[300px] overflow-y-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
```

- [ ] **Step 5: GenParamControls 的 ParamPill / AdvancedPill 弹层(共享 `popCls`,向上展开)**

`src/components/canvas/GenParamControls.tsx` 第 14-15 行,把：

```tsx
const popCls =
  'absolute bottom-[calc(100%+6px)] left-0 z-[56] flex max-h-[280px] flex-col gap-1 overflow-y-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]';
```

改为（追加 `anim-pop-in origin-bottom`;AdvancedPill 右对齐时 bottom 起点亦可接受）：

```tsx
const popCls =
  'anim-pop-in origin-bottom absolute bottom-[calc(100%+6px)] left-0 z-[56] flex max-h-[280px] flex-col gap-1 overflow-y-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]';
```

- [ ] **Step 6: AssetCanvas 的 ZoomBar 预设菜单(向上展开)**

`src/components/canvas/AssetCanvas.tsx` 第 95 行,把：

```tsx
        <div className="absolute bottom-[52px] left-0 w-32 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-toolbar)]">
```

改为：

```tsx
        <div className="anim-pop-in origin-bottom-left absolute bottom-[52px] left-0 w-32 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-toolbar)]">
```

- [ ] **Step 7: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
人工:依次打开 模型选择(Composer 右下)、项目菜单、@提及、生成弹窗里的参考/参数/高级、画布缩放预设 —— 均从对应方向缩放淡入;Select chevron 打开时旋转。

```bash
git add src/components/ui/Select.tsx src/components/chat/ProjectMenu.tsx src/components/chat/MentionPopover.tsx src/components/canvas/RefPicker.tsx src/components/canvas/GenParamControls.tsx src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 下拉/弹层统一缩放淡入进场 + Select chevron 旋转过渡"
```

---

## 批次二:Tier 2(弹窗 & 内容切换)

### Task 7: 居中模态进出场 —— CreateGameModal + RenameAssetModal

**Files:**
- Modify: `src/components/chat/CreateGameModal.tsx`
- Modify: `src/components/canvas/RenameAssetModal.tsx`

**Interfaces:**
- Consumes: `.modal-backdrop`、`.modal-pop`(Task 1)、`useExitTransition`(Task 1)。
- 改造点:把「遮罩 + 兄弟绝对定位面板(`-translate-x/y-1/2` 居中)」改为「遮罩用 `grid place-items-center` 居中,面板无定位 transform」(对齐 `GamePreviewModal`),从而让面板 transform 可自由做进出场。

- [ ] **Step 1: 重写 CreateGameModal 的返回结构**

`src/components/chat/CreateGameModal.tsx`:在组件内、`return` 前加入退场态;把现有 `useEffect`(Esc) 与 `return (...)` 调整为先 `requestClose`、再用 `useExitTransition`。

将顶部 imports 追加:

```tsx
import { useExitTransition } from '@/client/useExitTransition';
```

把组件体中的 Esc useEffect 与整段 `return` 替换为:

```tsx
  const { mounted, closing } = useExitTransition(open, 200);

  // 常驻挂载后状态会跨多次打开残留,故每次打开重置输入
  useEffect(() => { if (open) { setName(''); setBusy(false); } }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;
  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      data-closing={closing}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">Create new game</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          placeholder="Game name"
          className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">Cancel</button>
          <IconButton
            variant={submitVariant(canSubmit, dark)}
            className="h-10 rounded-[10px] px-4 text-[13px] font-semibold"
            aria-label="Create"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : 'Create'}
          </IconButton>
        </div>
      </div>
    </div>
  );
```

> ⚠️ **props 签名 + 调用处同步改**:`CreateGameModal` 函数签名由 `{ onClose }` 改为 `{ open, onClose }`(组件顶部解构新增 `open`)。调用处在 `src/components/chat/ChatPanel.tsx:186`,把:
> ```tsx
>       {createOpen && <CreateGameModal onClose={() => setCreateOpen(false)} />}
> ```
> 改为常驻渲染(由 `open` 驱动进出场):
> ```tsx
>       <CreateGameModal open={createOpen} onClose={() => setCreateOpen(false)} />
> ```

- [ ] **Step 2: 同法重写 RenameAssetModal**

`src/components/canvas/RenameAssetModal.tsx`:它由 `store.renameTarget` 驱动且在 `Workspace` 中以 `{renameTarget && <RenameAssetModal />}` 渲染。改造:把 `Workspace.tsx:106` 的 `{renameTarget && <RenameAssetModal />}` 改为常驻 `<RenameAssetModal />`;组件内用 `useExitTransition(!!target, 200)` 驱动,退场期间保留 `asset` 内容(用 `shown` 模式)。

`RenameAssetModal.tsx` imports 追加:

```tsx
import { useExitTransition } from '@/client/useExitTransition';
```

组件体改为(保留末次 asset 供退场渲染):

```tsx
  const target = useStore((s) => s.renameTarget);
  const assets = useStore((s) => s.assets);
  const renameAsset = useStore((s) => s.renameAsset);
  const close = useStore((s) => s.closeRenameModal);
  const dark = useIsDark();
  const { mounted, closing } = useExitTransition(!!target, 200);
  const liveAsset = assets.find((a) => a.id === target?.id);
  const [shown, setShown] = useState(liveAsset);
  useEffect(() => { if (liveAsset) setShown(liveAsset); }, [liveAsset]);
  const asset = shown;
  const [name, setName] = useState(asset?.label ?? '');

  const canSubmit = name.trim().length > 0;
  const submit = () => {
    if (!canSubmit || !asset) return;
    renameAsset(asset.id, name.trim());
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // 每次打开把输入同步到当前资产名
  useEffect(() => { if (target && liveAsset) setName(liveAsset.label); }, [target, liveAsset]);

  if (!mounted || !asset) return null;
  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} aria-hidden="true" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">Rename</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Asset name"
          className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">Cancel</button>
          <IconButton variant={submitVariant(canSubmit, dark)} className="h-10 rounded-[10px] px-4 text-[13px] font-semibold" aria-label="Rename" disabled={!canSubmit} onClick={submit}>
            Rename
          </IconButton>
        </div>
      </div>
    </div>
  );
```

`Workspace.tsx:106` 改为:

```tsx
      <RenameAssetModal />
```

并补 `import { useState } from 'react';` 已存在的话忽略(RenameAssetModal 已 import useState/useEffect)。

- [ ] **Step 3: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
人工:打开/关闭「创建游戏」「重命名」弹窗 —— 遮罩淡入淡出,面板上浮缩放进/退场;Esc 与点遮罩均走退场。减弱动态下瞬现瞬隐。

```bash
git add src/components/chat/CreateGameModal.tsx src/components/canvas/RenameAssetModal.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: 创建/重命名弹窗进出场动效(遮罩淡入 + 面板上浮缩放)"
```

---

### Task 8: MediaLightbox 进出场

**Files:**
- Modify: `src/components/canvas/MediaLightbox.tsx`

**Interfaces:**
- Consumes: `.modal-backdrop`、`.modal-pop`、`useExitTransition`。
- Lightbox 已是 `grid place-items-center`,无定位 transform,改造最小:遮罩加 `modal-backdrop`、内容本体包一层 `modal-pop`、用 `useExitTransition(!!lightbox, 200)` 驱动并保留末次内容。

- [ ] **Step 1: 引入退场态并保留内容**

`src/components/canvas/MediaLightbox.tsx` imports 追加:

```tsx
import { useState } from 'react';
import { useExitTransition } from '@/client/useExitTransition';
```

把 `const lightbox = ...` 起到 `if (... ) return null;` 的判定段改为(保留末次可显示资产):

```tsx
  const lightbox = useStore((s) => s.lightbox);
  const assets = useStore((s) => s.assets);
  const close = useStore((s) => s.openLightbox);
  const mvReady = useModelViewer();
  const { mounted, closing } = useExitTransition(!!lightbox, 200);

  const live = lightbox ? assets.find((a) => a.id === lightbox.assetId) : undefined;
  const liveSrc = live?.preview?.dataUrl || live?.preview?.src;
  const showable =
    live && live.status === 'ready' && liveSrc &&
    (live.kind === 'image' || live.kind === 'video' || live.kind === '3d')
      ? { asset: live, src: liveSrc }
      : undefined;
  const [shown, setShown] = useState(showable);
  useEffect(() => { if (showable) setShown(showable); }, [showable]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [lightbox, close]);

  if (!mounted || !shown) return null;
  const { asset, src } = shown;
```

> 注:`useEffect` 已在原文件 import;`useState` 需新增(见上)。下方 JSX 中所有 `asset`/`src` 引用保持不变(现在来自 `shown`)。

- [ ] **Step 2: 遮罩与内容加动画类**

把第 33-39 行遮罩开头:

```tsx
    <div
      className="absolute inset-0 z-30 grid place-items-center bg-black/75 p-8"
      role="dialog"
      aria-modal="true"
      aria-label={asset.label}
      onClick={() => close(null)}
    >
```

改为(加 `modal-backdrop` + `data-closing`):

```tsx
    <div
      className="modal-backdrop absolute inset-0 z-30 grid place-items-center bg-black/75 p-8"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={asset.label}
      onClick={() => close(null)}
    >
```

并把「内容本体」(image / video / model-viewer / spinner 的三元表达式)整体用一个带 `modal-pop` 的容器包裹。即在 `{/* 内容本体... */}` 注释处,将三元 `asset.kind === 'image' ? (...) : ...` 外层包一层:

```tsx
      <div className="modal-pop contents" data-closing={closing}>
        {/* 原 image/video/model-viewer/spinner 三元表达式整体放这里 */}
      </div>
```

> `contents` 会让该 wrapper 不产生盒子(动画作用于子项)——若 `model-viewer` 的 100%/100% 尺寸受影响,改为去掉 `contents`、保留 `modal-pop` 并加 `grid place-items-center`。人工核验为准。

- [ ] **Step 3: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:画布点资产放大 → 遮罩淡入、内容上浮缩放;Esc / 点遮罩 / 关闭按钮均走退场。三种类型(图/视频/3D)都验证。

```bash
git add src/components/canvas/MediaLightbox.tsx
git commit -m "feat: 媒体放大浮层进出场动效"
```

---

### Task 9: GenerateForm 进出场（内层动画,兼容锚定/居中两种定位）

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx:153-160,257-258`

**Interfaces:**
- Consumes: `.modal-backdrop`、`.modal-pop`、`useExitTransition`。
- GenerateForm 同时有「锚定触发点(`fixed left/top`)」与「居中(`-translate-x/y-1/2`)」两种定位,且外层挂了 `measureCard` 回调 ref。故**保留外层定位 div(含 ref)不动,在其内部包一层 `.modal-pop` 承载进出场**,避免动画 transform 覆盖居中 transform。由父级 `GenerateFormHost` 常驻并传 `open`。

- [ ] **Step 1: GenerateFormHost 改为常驻 + 传 open(整体重写)**

把 `src/components/canvas/GenerateFormHost.tsx` 整个文件替换为:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import GenerateForm from './GenerateForm';

// 全局承载生成弹窗:由 store.genForm 驱动。常驻挂载、open 驱动进出场;
// 退场期间 genForm 已为 null,用 shown 保留末次内容供退场渲染;
// key 随「本次打开的 kind/源/落点」变化 → 重新打开时强制重挂载,重置表单内部状态(prompt/params)。
export default function GenerateFormHost() {
  const genForm = useStore((s) => s.genForm);
  const closeGenForm = useStore((s) => s.closeGenForm);
  const [shown, setShown] = useState(genForm);
  useEffect(() => { if (genForm) setShown(genForm); }, [genForm]);
  if (!shown) return null;
  return (
    <GenerateForm
      key={`${shown.kind}:${shown.sourceId ?? ''}:${shown.x ?? ''}:${shown.y ?? ''}`}
      open={!!genForm}
      kind={shown.kind}
      sourceId={shown.sourceId}
      x={shown.x}
      y={shown.y}
      spawnAt={shown.spawnAt}
      onClose={closeGenForm}
    />
  );
}
```

> 原 `if (!genForm) return null` 改为「常驻 + open 驱动」:退场播完由 `GenerateForm` 内部(`useExitTransition`)返回 null。`key` 在真正重新打开(参数不同)时变化触发重挂载 → 表单状态自然重置,等价于旧的「每次开都重挂载」。

- [ ] **Step 2: GenerateForm 接收 open + 包裹 modal-pop + 遮罩动画**

`GenerateForm.tsx` 函数签名加 `open: boolean`;imports 追加 `import { useExitTransition } from '@/client/useExitTransition';`。在组件体加 `const { mounted, closing } = useExitTransition(open, 200);`,并在 Esc effect 后加 `if (!mounted) return null;`。

第 154-160 行:

```tsx
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={measureCard}
        style={x != null && y != null ? { left: pos?.left ?? x, top: pos?.top ?? y } : undefined}
        className={`fixed z-50 flex w-fit min-w-[520px] max-w-[calc(100vw-24px)] flex-col gap-6 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px] ${x != null && y != null ? '' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'}`}
      >
        <div className="flex flex-col gap-3">
```

改为(遮罩加 `modal-backdrop`;外层定位 div 保留;在内部新增 `.modal-pop` 包裹整张卡内容):

```tsx
    <>
      <div className="modal-backdrop fixed inset-0 z-40" data-closing={closing} onClick={onClose} />
      <div
        ref={measureCard}
        style={x != null && y != null ? { left: pos?.left ?? x, top: pos?.top ?? y } : undefined}
        className={`fixed z-50 w-fit min-w-[520px] max-w-[calc(100vw-24px)] ${x != null && y != null ? '' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'}`}
      >
        <div
          data-closing={closing}
          className="modal-pop flex flex-col gap-6 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
          style={{ transformOrigin: x != null && y != null ? 'top left' : 'center' }}
        >
        <div className="flex flex-col gap-3">
```

并在原最外层卡片 `</div>` 收尾处(第 257 行 `</div>` 之前对应层级)补上新增 `.modal-pop` div 的闭合 `</div>`。即结构由 `定位div > 内容` 变为 `定位div > modal-pop div > 内容`。

> 注意:`measureCard` 测的是外层定位 div 尺寸用于夹取——把视觉样式(border/bg/padding/gap)下移到内层 `.modal-pop` 后,外层只剩定宽类(`w-fit min-w-[520px] max-w-...`),测量仍有效(宽度由内层撑开)。若夹取出现偏差,把 `min-w/max-w/w-fit` 同时保留在两层。

- [ ] **Step 3: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
人工:画布双击 → 选 Image/Video/Audio/3D → 生成弹窗从触发点(锚定)上浮缩放进场;从右侧「+」打开亦然;提交/Esc/点遮罩走退场。

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateFormHost.tsx
git commit -m "feat: 生成弹窗进出场动效(内层动画兼容锚定/居中定位)"
```

---

### Task 10: 占位卡 → 真实资产 交叉淡入（ImageNode）

**Files:**
- Modify: `src/components/canvas/nodes/ImageNode.tsx:28-37`

**Interfaces:**
- 图片 `onLoad` 前保留底色占位,加载完成后 `opacity` 交叉淡入(底色块在后、img 在前)。无单测(节点需 ReactFlow 上下文),人工核验。

- [ ] **Step 1: img 加载完成淡入 + 占位底色垫底**

`ImageNode.tsx` 顶部 imports 追加 `import { useState } from 'react';`。在 `ImageNode` 组件体内(`const canExpand = ...` 后)加:

```tsx
  const [loaded, setLoaded] = useState(false);
```

把第 28-37 行的 `src ? (<img .../>) : (<div 占位/>)` 三元改为「占位底色恒在底层 + img 覆盖其上、加载完成淡入」:

```tsx
        {/* 占位底色:src 加载完成前垫底,避免淡入期间露白 */}
        {(!src || !loaded) && (
          <div
            className="grid h-[150px] place-items-center px-2 text-center text-[13px] font-semibold text-white"
            style={{ background: a.preview?.color ?? 'var(--color-image)' }}
          >
            {a.preview?.title ?? ''}
          </div>
        )}
        {src && (
          <img
            src={src}
            alt={a.label}
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={`block h-[150px] w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'absolute inset-0 opacity-0'}`}
          />
        )}
```

> `absolute inset-0` 仅在未加载时给 img,使其叠在占位底色之上;加载后转为正常流。`motion-reduce` 下 `transition-opacity` 自然无过渡(Tailwind 的 transition 不受 reduced-motion 影响,但 200ms 极短可接受;如需严格,加 `motion-reduce:transition-none`)。

- [ ] **Step 2: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:生成一张图片,完成时图片柔和淡入而非硬切;重新生成同样平滑。

```bash
git add src/components/canvas/nodes/ImageNode.tsx
git commit -m "feat: 图像节点生成完成淡入(占位底色垫底交叉淡入)"
```

---

### Task 11: 就绪媒体淡入（VideoNode / AudioNode / ThreeDNode）

**Files:**
- Modify: `src/components/canvas/nodes/VideoNode.tsx:54`
- Modify: `src/components/canvas/nodes/AudioNode.tsx:90-92`
- Modify: `src/components/canvas/nodes/ThreeDNode.tsx:47-48`

**Interfaces:**
- Consumes: `.anim-media-in`(Task 1)。三者 ReadyBody/PlayerBody 在 `status` 转 ready 时首次挂载 → 给其根容器加 `.anim-media-in`,实现「就绪时淡入」(比 ImageNode 的交叉淡入更轻量,因占位与就绪是不同子树,克制即可)。

- [ ] **Step 1: VideoNode ReadyBody 根容器淡入**

`VideoNode.tsx` 第 55 行,把:

```tsx
    <div className="nodrag relative overflow-hidden rounded-[11px]" onMouseDown={(e) => e.stopPropagation()}>
```

改为:

```tsx
    <div className="anim-media-in nodrag relative overflow-hidden rounded-[11px]" onMouseDown={(e) => e.stopPropagation()}>
```

- [ ] **Step 2: AudioNode PlayerBody 根容器淡入**

`AudioNode.tsx` 第 92 行,把:

```tsx
    <div className="nodrag rounded-[11px] px-3 pb-2.5 pt-2.5" style={{ background: AUDIO_BG }} onMouseDown={(e) => e.stopPropagation()}>
```

改为:

```tsx
    <div className="anim-media-in nodrag rounded-[11px] px-3 pb-2.5 pt-2.5" style={{ background: AUDIO_BG }} onMouseDown={(e) => e.stopPropagation()}>
```

- [ ] **Step 3: ThreeDNode ReadyBody 根容器淡入**

`ThreeDNode.tsx` 第 48 行,把:

```tsx
    <div className="nodrag relative overflow-hidden rounded-[11px]" onMouseDown={(e) => e.stopPropagation()}>
```

改为:

```tsx
    <div className="anim-media-in nodrag relative overflow-hidden rounded-[11px]" onMouseDown={(e) => e.stopPropagation()}>
```

- [ ] **Step 4: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:生成视频/音频/3D,完成时播放器/模型柔和淡入。

```bash
git add src/components/canvas/nodes/VideoNode.tsx src/components/canvas/nodes/AudioNode.tsx src/components/canvas/nodes/ThreeDNode.tsx
git commit -m "feat: 视频/音频/3D 节点就绪时淡入"
```

---

### Task 12: 预览内容切换淡入 + LoadingScreen 进出场

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx:90-102`
- Modify: `src/components/ui/LoadingScreen.tsx:3-4`
- Modify: `src/components/workspace/Workspace.tsx:108-109`

**Interfaces:**
- Consumes: `.anim-media-in`、`useExitTransition`。预览内容用「keyed 包裹层」在切换/刷新时重挂载并淡入;启动加载层淡入(挂载)+ 淡出(Workspace 用 useExitTransition)。
- 说明:spec #8 的「overlay 打开淡入」在本项目不适用 —— 预览面板**常驻挂载**(无打开/关闭事件),仅 compare 模式有宽度过渡(已存在 `transition-[width]`),故此处只做「内容切换淡入 + 加载层进出场」。

- [ ] **Step 1: PreviewPanel 内容用 keyed 包裹层淡入**

`PreviewPanel.tsx` 第 90-102 行,把:

```tsx
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {hasGame ? (
            compareOn ? (
              <CompareView key={`compare-${refreshNonce}`} />
            ) : (
              <GameFrame key={`game-${refreshNonce}-${active?.id ?? 'none'}`} version={active} />
            )
          ) : (
            <div className="flex h-full items-center justify-center bg-[var(--color-canvas)] px-8 text-center text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
              Live preview, save as version, export as ZIP here.
            </div>
          )}
        </div>
```

改为(把 key 上提到包裹层 → 切换/刷新时整层重挂载并淡入;子层去掉重复 key):

```tsx
        <div
          key={hasGame ? (compareOn ? `compare-${refreshNonce}` : `game-${refreshNonce}-${active?.id ?? 'none'}`) : 'empty'}
          className="anim-media-in flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {hasGame ? (
            compareOn ? <CompareView /> : <GameFrame version={active} />
          ) : (
            <div className="flex h-full items-center justify-center bg-[var(--color-canvas)] px-8 text-center text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
              Live preview, save as version, export as ZIP here.
            </div>
          )}
        </div>
```

- [ ] **Step 2: LoadingScreen 支持 data-closing 淡出 + 默认淡入**

`LoadingScreen.tsx` 第 3-4 行,把:

```tsx
export default function LoadingScreen({ className = '', label }: { className?: string; label?: string }) {
  return (
    <div className={`skeleton-shimmer grid place-items-center ${className}`}>
```

改为(新增可选 `closing` prop,挂载淡入 + 退场淡出):

```tsx
export default function LoadingScreen({ className = '', label, closing = false }: { className?: string; label?: string; closing?: boolean }) {
  return (
    <div data-closing={closing} className={`skeleton-shimmer anim-media-in grid place-items-center ${className} data-[closing=true]:[animation:mo-fade-out_200ms_ease_both]`}>
```

> `data-[closing=true]:[animation:...]` 用 Tailwind 任意值实现退场,避免再加专用类。

- [ ] **Step 3: Workspace 启动层用 useExitTransition 淡出**

`Workspace.tsx` imports 追加 `import { useExitTransition } from '@/client/useExitTransition';`;在组件体加:

```tsx
  const loaderOpen = booting || authRequired;
  const loader = useExitTransition(loaderOpen, 200);
```

第 108-109 行,把:

```tsx
      {/* 启动加载或检测到未登录(跳转 sign-in 前):全局加载层盖住整个工作区,避免空工作台闪现 */}
      {(booting || authRequired) && <LoadingScreen className="fixed inset-0 z-50" label="Loading workspace…" />}
```

改为:

```tsx
      {/* 启动加载或检测到未登录(跳转 sign-in 前):全局加载层盖住整个工作区,避免空工作台闪现;就绪后淡出 */}
      {loader.mounted && <LoadingScreen className="fixed inset-0 z-50" label="Loading workspace…" closing={loader.closing} />}
```

- [ ] **Step 4: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
人工:切换版本 / 点刷新 / 进出 compare —— 预览区淡入切换;首屏加载层在就绪后淡出而非瞬消。

```bash
git add src/components/preview/PreviewPanel.tsx src/components/ui/LoadingScreen.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: 预览内容切换淡入 + 启动加载层进出场"
```

---

### Task 13: 画布节点出现淡入

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx:49-55`

**Interfaces:**
- Consumes: `.anim-media-in`。NodeCard 实例按 id 复用,仅首次挂载(新资产出现)时播放一次淡入;搜索高亮等重渲不重挂载、不重放。根容器无 transform,加 opacity 淡入不冲突选中流光。
- 说明:连线(FlowEdge)出现淡入因 SVG 包裹受限、且已有流光,**本计划不做**(见 spec「不做」)。

- [ ] **Step 1: NodeCard 根容器加淡入**

`NodeCard.tsx` 第 49-55 行,把:

```tsx
    <div
      style={{ width }}
      className={`relative rounded-[16px] bg-[var(--color-surface)] p-1.5 transition ${
        selected
          ? 'border-[1.5px] border-[color-mix(in_srgb,var(--color-accent)_24%,transparent)] shadow-[0_4px_14px_-6px_rgba(53,130,255,0.4)]'
          : 'border border-[var(--color-line-2)] shadow-[var(--shadow-card)]'
      }`}
    >
```

改为(追加 `anim-media-in`):

```tsx
    <div
      style={{ width }}
      className={`anim-media-in relative rounded-[16px] bg-[var(--color-surface)] p-1.5 transition ${
        selected
          ? 'border-[1.5px] border-[color-mix(in_srgb,var(--color-accent)_24%,transparent)] shadow-[0_4px_14px_-6px_rgba(53,130,255,0.4)]'
          : 'border border-[var(--color-line-2)] shadow-[var(--shadow-card)]'
      }`}
    >
```

- [ ] **Step 2: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:生成新资产 / 切项目加载画布时,卡片淡入出现;拖动、选中、搜索高亮不会重新触发淡入。

```bash
git add src/components/canvas/nodes/NodeCard.tsx
git commit -m "feat: 画布节点出现时淡入"
```

---

## 批次三:Tier 3(质感细节)

### Task 14: 按钮按压微反馈（Button / IconButton）

**Files:**
- Modify: `src/components/ui/Button.tsx:12`
- Modify: `src/components/ui/IconButton.tsx:28`

**Interfaces:**
- 用 `motion-safe:active:scale-*` 做按压缩放,`motion-safe:` 在 reduced-motion 下天然不触发。

- [ ] **Step 1: Button 按压缩放**

`Button.tsx` 第 12 行,把 `transition` 替换为更明确的过渡 + 按压缩放:

```tsx
      className={`btn-raised inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[14px] font-semibold transition-[transform,filter,opacity] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
```

- [ ] **Step 2: IconButton 按压缩放**

`IconButton.tsx` 第 28 行,把 `transition` 替换:

```tsx
      className={`grid place-items-center rounded-[10px] transition-[transform,background-color,opacity,filter] duration-150 ease-out motion-safe:active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-30 ${VARIANT[variant]} ${className}`}
```

- [ ] **Step 3: 校验 + 测试 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/components/ui/IconButton.test.tsx`
人工:点击各处图标按钮 / 提交按钮有轻微下压回弹。

```bash
git add src/components/ui/Button.tsx src/components/ui/IconButton.tsx
git commit -m "feat: 按钮按压微缩放反馈"
```

---

### Task 15: Segmented 选中滑块平移

**Files:**
- Modify: `src/components/ui/Segmented.tsx:30-52`

**Interfaces:**
- 用绝对定位滑块 + `translateX` 平移到选中档。等分 N 段、去掉 `gap`,滑块宽 `100/N%`、`translateX(index*100%)` 精确对齐;选中段文字反色,未选中文字 muted。

- [ ] **Step 1: 重写 render 部分加滑块**

`Segmented.tsx` 第 30-52 行 `return (...)` 替换为:

```tsx
  const activeIndex = Math.max(0, segments.findIndex((s) => s.val === value));
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="relative flex w-full rounded-[10px] bg-[var(--color-fill)] p-0.5">
      {/* 滑块:绝对定位,按选中档平移(去 gap 后等分,translateX 精确对齐) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[8px] bg-[var(--color-ink)] transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 4px) / ${segments.length})`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {segments.map((s) => {
        const active = s.val === value;
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active || undefined}
            onClick={() => onChange(s.val)}
            className={`relative z-10 min-w-0 flex-1 truncate rounded-[8px] px-1.5 py-1 text-center text-[12px] transition-colors duration-150 ${
              active ? 'font-medium text-[var(--color-surface)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
```

> 滑块宽 `calc((100% - 4px)/N)`:`4px` = 左右各 `p-0.5`(2px);`translateX(index*100%)` 相对自身宽度平移,因等分无 gap 故精确落位。

- [ ] **Step 2: 校验 + 测试 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/components/ui/Segmented.test.tsx`
（若既有测试断言「选中段背景类」,改为断言 `aria-checked`/`data-active` 或滑块存在。）
人工:生成弹窗高级设置里的分段控件、Count 分段 —— 切换时黑色滑块平滑滑到目标档。

```bash
git add src/components/ui/Segmented.tsx src/components/ui/Segmented.test.tsx
git commit -m "feat: Segmented 选中滑块平移动效"
```

---

### Task 16: NodeCard 「+」按钮浮出 + 节点 hover 微抬

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx:49-55,69-90`

**Interfaces:**
- Consumes: `.anim-media-in`。`+` 按钮用 transform 定位,只能加纯 opacity 淡入(`.anim-media-in`);hover 微抬加在根容器(无 transform,不与 xyflow 定位冲突,且 hover 在拖拽时不触发)。

- [ ] **Step 1: 根容器 hover 微抬(仅未选中)**

延续 Task 13 的根容器 className,把 `transition` 段细化并加 hover 抬升。第 51 行 className 模板里 `p-1.5 transition` 改为:

```tsx
      className={`anim-media-in relative rounded-[16px] bg-[var(--color-surface)] p-1.5 transition-[transform,box-shadow,border-color] duration-150 motion-safe:hover:-translate-y-px ${
```

（其余 selected 三元不变。）

- [ ] **Step 2: 「+」按钮淡入浮出**

第 71-74 行 `+` 按钮 className,把:

```tsx
            className="nodrag absolute right-0 top-1/2 grid size-6 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-[var(--color-line-2)] text-[var(--color-accent)] transition hover:brightness-95"
```

改为(追加 `anim-media-in`,选中时随挂载淡入):

```tsx
            className="anim-media-in nodrag absolute right-0 top-1/2 grid size-6 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-[var(--color-line-2)] text-[var(--color-accent)] transition hover:brightness-95"
```

- [ ] **Step 3: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:hover 未选中卡片轻微上抬;选中卡片右侧「+」淡入浮现;拖拽不抖。

```bash
git add src/components/canvas/nodes/NodeCard.tsx
git commit -m "feat: 节点 hover 微抬 + 选中态「+」按钮淡入"
```

---

### Task 17: ToolCard 展开/折叠高度过渡

**Files:**
- Modify: `src/components/chat/ToolCard.tsx:58-65`

**Interfaces:**
- 用 `grid-template-rows: 0fr→1fr` + 内层 `overflow-hidden` 实现不量高的展开折叠;媒体(始终可见)留在过渡容器外。

- [ ] **Step 1: 可折叠正文包进 grid-rows 过渡容器**

`ToolCard.tsx` 第 58-65 行,把:

```tsx
      {open && diff && <DiffView diff={diff} />}
      {open && !diff && argText && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400)}</pre>
      )}
      {part.media?.map((item, i) => <MediaItemView key={i} item={item} />)}
      {open && !diff && !part.media && part.result && (
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-muted)]">{part.result.slice(0, 600)}</pre>
      )}
```

改为(diff / argText / result 三块装进可过渡容器;媒体保持独立常显):

```tsx
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open && hasBody ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'}`}>
        <div className="overflow-hidden">
          {diff && <DiffView diff={diff} />}
          {!diff && argText && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400)}</pre>
          )}
          {!diff && !part.media && part.result && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-muted)]">{part.result.slice(0, 600)}</pre>
          )}
        </div>
      </div>
      {part.media?.map((item, i) => <MediaItemView key={i} item={item} />)}
```

> 折叠时容器为 `0fr` 高度 0、内层 `overflow-hidden` 裁掉内容;展开 `1fr` 平滑撑开。内容始终渲染(不再 `open &&`),仅靠高度显隐。

- [ ] **Step 2: 校验 + 测试 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/components/chat/ToolCard.test.tsx`
（若既有测试断言「折叠时 diff 不在 DOM」,改为断言容器 `[grid-template-rows:0fr]` 或可见性;内容现在常驻 DOM。）
人工:点 ToolCard 标题展开/折叠 —— 内容平滑展开/收起,不再瞬现。

```bash
git add src/components/chat/ToolCard.tsx src/components/chat/ToolCard.test.tsx
git commit -m "feat: ToolCard 展开/折叠高度过渡"
```

---

### Task 18: 版本卡片选中 glow + hover + Compare 按钮过渡

**Files:**
- Modify: `src/components/preview/VersionTimeline.tsx:38,65`

**Interfaces:**
- 版本卡加边框/阴影过渡 + 选中蓝色 glow + hover 底色;Compare 按钮补 `disabled` 过渡(已有 `transition`,确认覆盖即可)。

- [ ] **Step 1: 版本卡片过渡 + glow + hover**

`VersionTimeline.tsx` 第 65 行,把:

```tsx
              className={`flex shrink-0 items-center gap-2 rounded-[16px] border bg-[var(--color-surface)] p-2 text-left ${ring}`}
```

改为(加过渡 + hover 底色 + 高亮 glow):

```tsx
              className={`flex shrink-0 items-center gap-2 rounded-[16px] border bg-[var(--color-surface)] p-2 text-left transition-[border-color,box-shadow,background-color] duration-200 hover:bg-[var(--color-fill)] ${ring} ${highlighted ? 'shadow-[0_0_12px_-2px_rgba(53,130,255,0.25)]' : ''}`}
```

- [ ] **Step 2: Compare 按钮过渡口径确认**

`VersionTimeline.tsx` 第 38 行已含 `transition`,把它细化为含 opacity(disabled↔enabled 平滑):把 `transition` 改为 `transition-[background-color,opacity,filter] duration-200`。

- [ ] **Step 3: 校验 + 人工核验 + 提交**

Run: `pnpm exec tsc --noEmit && pnpm lint`
人工:hover 版本卡有底色反馈;切换激活/对比版本时蓝框 + 柔光平滑出现;Compare 从禁用变可用时平滑。

```bash
git add src/components/preview/VersionTimeline.tsx
git commit -m "feat: 版本卡片选中辉光/hover 反馈 + Compare 按钮过渡"
```

---

## 收尾

### Task 19: 全量回归 + 降级核验

**Files:** 无(纯核验)

- [ ] **Step 1: 全量校验**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 全绿。

- [ ] **Step 2: prefers-reduced-motion 全局核验**

人工:系统/浏览器开启「减弱动态」,过一遍 Tier 1–3 各动效 —— 均退化为瞬现 / 纯淡入,无位移无缩放无旋转,功能不受影响。

- [ ] **Step 3: 三栏巡检**

人工:Chat(输入框聚焦、Tooltip、模型下拉、项目菜单、@提及、Toast)、Canvas(双击/右键菜单、生成弹窗、参数弹层、节点出现/就绪淡入、节点 hover/选中「+」、放大浮层、缩放预设)、Preview(内容切换、版本卡、加载层),逐一确认顺滑无抖动、无残留。

> 本计划无遗留 flag / 临时代码,Task 19 通过即整体完成。
