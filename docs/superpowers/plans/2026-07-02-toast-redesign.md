# 全局 Toast 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 Figma 设计稿(node 955-49756 及分型)重做全局 Toast——三型(error/success/warning)恒浅色、实心状态图标 + 单行消息 + 标准关闭 X,去掉加粗 code 前缀。

**Architecture:** store `ToastMessage.kind` 由 `error|notice` 扩为 `error|success|warning`,现有 `notice` 调用迁到 `warning`;新增 3 个恒定 toast accent 令牌 + 4 个手写 SVG 图标(经 `FigIcon`/`figAsset` 渲染);`Toast.tsx` 按 kind 映射图标与 accent,底色/边框用 `color-mix` 派生,恒浅色不写主题分支。

**Tech Stack:** Next.js 16 + React 19 + zustand + Tailwind v4(CSS 变量令牌)+ vitest/jsdom + react-i18next。

## Global Constraints

- 代码注释 / commit message 一律用**中文**。
- 颜色走 CSS 变量;三型 accent 用新令牌 `--color-toast-{error,success,warning}`。toast 专用固定色(文字 `#262626` / 关闭 `#202020` / hover 底 `rgba(0,0,0,0.06)`)是「恒浅色」语境的 sanctioned 例外(类比 `.btn-raised` 固定深色字),直接写在组件里并注明理由,**不进** `[data-theme="dark"]` 覆盖。
- 图标一律经 `FigIcon` + `figAsset` 注册表,不裸 `<img>`、不留字符 `✕`。
- 自身静态资源路径经 `assetPath()`(`figAsset` 已用 `F = assetPath('/figma/icons')`,新增键沿用即可)。
- 不新增按钮种类、不自造 toast、不写一次性 keyframes(复用 `.toast-pop`)。
- 在 worktree 内改动,**用 worktree 绝对路径** Edit/Write,改完 `git -C` 校验落点。
- 测试与源码同目录;`pnpm exec vitest run <file>` 跑单文件。

---

### Task 1: store 契约扩型 + `notice`→`warning` 迁移

**Files:**
- Modify: `src/store/types.ts:106`(`ToastMessage` 定义)
- Modify: `src/i18n/errors.ts:45-48`(`connErrorToast`)
- Modify: `src/i18n/errors.test.ts:32-35`(断言)
- Modify: `src/components/preview/SharePopover.tsx:34`
- Modify: `src/client/useAuthGuard.ts:19`

**Interfaces:**
- Produces: `export type ToastKind = 'error' | 'success' | 'warning'`;`ToastMessage = { code: string; message: string; kind?: ToastKind }`(默认 `error`)。Task 3 的组件按此 `kind` 映射图标/配色。

- [ ] **Step 1: 改测试断言(先让它失败)**

`src/i18n/errors.test.ts` 第 34 行,把 `notice` 改为 `warning`:

```ts
  expect(connErrorToast('superseded')).toEqual({ code: 'SESSION_SUPERSEDED', message: '', kind: 'warning' });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/i18n/errors.test.ts`
Expected: FAIL —— 实际返回 `kind: 'notice'`,与期望 `'warning'` 不符。

- [ ] **Step 3: 扩展 `ToastMessage` 类型**

`src/store/types.ts` 第 106 行,替换:

```ts
export type ToastKind = 'error' | 'success' | 'warning';
export type ToastMessage = { code: string; message: string; kind?: ToastKind };
```

- [ ] **Step 4: 迁移 `connErrorToast`(`notice`→`warning`)**

`src/i18n/errors.ts` 第 45-48 行,替换:

```ts
// 传输层终态 → 通用提示(纯函数)。superseded 为多标签顶替,归入柔和 warning 类。
// fatal 与其余非终态(connecting/open/closed/error/stalled)返回 null:fatal 由 ReconnectBanner 内联条接管(持久提示+手动重连),不再叠加一次性 toast(避免与内联条双重通知)。
export function connErrorToast(status: string): { code: string; message: string; kind: 'error' | 'warning' } | null {
  if (status === 'superseded') return { code: 'SESSION_SUPERSEDED', message: '', kind: 'warning' };
  return null;
}
```

- [ ] **Step 5: 迁移 SharePopover 调用**

`src/components/preview/SharePopover.tsx` 第 34 行,`kind: 'notice'` → `kind: 'warning'`:

```tsx
      setError({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually', kind: 'warning' });
```

- [ ] **Step 6: 迁移 useAuthGuard 调用**

`src/client/useAuthGuard.ts` 第 19 行,`kind: 'notice'` → `kind: 'warning'`:

```ts
      setError({ code: 'AUTH', message: '本地未鉴权,请更新 DEV_COOKIE 后刷新', kind: 'warning' });
```

- [ ] **Step 7: 跑测试 + 类型检查确认通过**

Run: `pnpm exec vitest run src/i18n/errors.test.ts && pnpm exec tsc --noEmit`
Expected: 测试 PASS;tsc 无错(确认全项目再无 `kind: 'notice'` 残留导致的类型错)。

- [ ] **Step 8: 提交**

```bash
git add src/store/types.ts src/i18n/errors.ts src/i18n/errors.test.ts src/components/preview/SharePopover.tsx src/client/useAuthGuard.ts
git commit -m "feat: Toast kind 扩为 error/success/warning,notice 调用迁移到 warning"
```

---

### Task 2: 图标资产 + accent 令牌 + figAsset 注册

**Files:**
- Create: `public/figma/icons/toast-error.svg`
- Create: `public/figma/icons/toast-success.svg`
- Create: `public/figma/icons/toast-warning.svg`
- Create: `public/figma/icons/close.svg`
- Modify: `src/app/globals.css`(`@theme` 内,danger 令牌后约第 57 行)
- Modify: `src/components/ui/figma.tsx:46`(`figAsset` 末尾)

**Interfaces:**
- Produces: `figAsset.toastError / toastSuccess / toastWarning / close`(均为 `string` 资源路径);CSS 令牌 `--color-toast-error/success/warning`。Task 3 消费这些键与令牌。

- [ ] **Step 1: 创建 error 图标(实心圆 + 白 `!`)**

`public/figma/icons/toast-error.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#FF5630"/><path d="M12 7v6" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.15" fill="#fff"/></svg>
```

- [ ] **Step 2: 创建 success 图标(实心圆 + 白 ✓)**

`public/figma/icons/toast-success.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#22C55E"/><path d="M7.75 12.25 10.5 15l5.75-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 3: 创建 warning 图标(圆角三角 + 白 `!`)**

`public/figma/icons/toast-warning.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M10.28 3.86 2.36 18a2 2 0 0 0 1.72 3h15.84a2 2 0 0 0 1.72-3L13.72 3.86a2 2 0 0 0-3.44 0Z" fill="#FFAB00"/><path d="M12 9v4" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.1" fill="#fff"/></svg>
```

- [ ] **Step 4: 创建通用关闭 X 图标(单色可 mask)**

`public/figma/icons/close.svg`(mask 模式只用覆盖形状,stroke 色任意):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>
```

- [ ] **Step 5: 新增 accent 令牌到 globals.css**

`src/app/globals.css`,在 danger 令牌块(`--color-danger-soft: #e5484d1f;` 那一行)之后插入(仅在 `@theme` 内,**不加**到 `[data-theme="dark"]` 覆盖块):

```css
  /* Toast 三型状态色(恒浅色 toast 专用,不随主题翻转;对齐 Figma 955-49756/49849/43601) */
  --color-toast-error: #ff5630;
  --color-toast-success: #22c55e;
  --color-toast-warning: #ffab00;
```

- [ ] **Step 6: 注册 figAsset 键**

`src/components/ui/figma.tsx`,在 `fileCode: \`${F}/file-code.svg\`,` 之后、`} as const;` 之前插入:

```ts
  // 全局 Toast:三型状态图标(双色 baked,original 渲染)+ 通用关闭 X
  toastError: `${F}/toast-error.svg`,
  toastSuccess: `${F}/toast-success.svg`,
  toastWarning: `${F}/toast-warning.svg`,
  close: `${F}/close.svg`,
```

- [ ] **Step 7: 类型检查确认无误**

Run: `pnpm exec tsc --noEmit`
Expected: 无错(figAsset 新键为合法字面量;令牌为纯 CSS 不参与 TS)。

> 注:图标形状/配色的最终正确性由 Task 4 的 Figma 像素比对把关(SVG 无法单元测试),此处仅确保文件合法、键可引用。

- [ ] **Step 8: 提交**

```bash
git add public/figma/icons/toast-error.svg public/figma/icons/toast-success.svg public/figma/icons/toast-warning.svg public/figma/icons/close.svg src/app/globals.css src/components/ui/figma.tsx
git commit -m "feat: 新增 toast 三型状态图标 + close 图标、accent 令牌与 figAsset 注册"
```

---

### Task 3: Toast 组件重写 + 组件测试

**Files:**
- Modify: `src/components/ui/Toast.tsx`(整文件重写)
- Modify: `src/components/ui/Toast.test.tsx`(整文件重写)

**Interfaces:**
- Consumes: Task 1 的 `ToastMessage.kind`;Task 2 的 `figAsset.toastError/toastSuccess/toastWarning/close` 与令牌 `--color-toast-*`。
- Produces: 默认导出 `Toast` 组件(无 props,订阅 store)。

- [ ] **Step 1: 重写组件测试(先让它失败)**

`src/components/ui/Toast.test.tsx` 整文件替换为:

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '@/store';
import Toast from './Toast';

beforeEach(() => { vi.useFakeTimers(); useStore.setState({ lastError: null }); });
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  useStore.setState({ lastError: null });
});

describe('Toast', () => {
  test('只渲染消息文本,不再显示 code 前缀;默认 kind=error 用 alert + error 图标', () => {
    useStore.setState({ lastError: { code: 'ERR', message: '出错了' } });
    const { container } = render(<Toast />);
    expect(screen.getByText('出错了')).toBeTruthy();
    expect(screen.queryByText('ERR')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(container.querySelector('img[src$="toast-error.svg"]')).toBeTruthy();
  });

  test('success 用 status role + success 图标', () => {
    useStore.setState({ lastError: { code: 'OK', message: '成功了', kind: 'success' } });
    const { container } = render(<Toast />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(container.querySelector('img[src$="toast-success.svg"]')).toBeTruthy();
  });

  test('warning 用 status role + warning 图标', () => {
    useStore.setState({ lastError: { code: 'WARN', message: '注意', kind: 'warning' } });
    const { container } = render(<Toast />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(container.querySelector('img[src$="toast-warning.svg"]')).toBeTruthy();
  });

  test('退场期间仍渲染末次内容,延时后卸载', () => {
    useStore.setState({ lastError: { code: 'ERR', message: '出错了' } });
    render(<Toast />);
    expect(screen.getByText('出错了')).toBeTruthy();
    act(() => { useStore.getState().setError(null); });
    expect(screen.queryByText('出错了')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('出错了')).toBeNull();
  });

  test('鼠标移入暂停自动消失,移出后重新计 4s', () => {
    useStore.setState({ lastError: { code: 'ERR', message: '出错了' } });
    render(<Toast />);
    const toast = screen.getByRole('alert');
    act(() => fireEvent.mouseEnter(toast));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('出错了')).toBeTruthy();
    act(() => fireEvent.mouseLeave(toast));
    act(() => vi.advanceTimersByTime(4000));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('出错了')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/Toast.test.tsx`
Expected: FAIL —— 旧组件仍渲染 code 前缀 `ERR`、无 `toast-*.svg` 图标(旧组件用 CSS 点),新断言不满足。

- [ ] **Step 3: 重写 Toast 组件**

`src/components/ui/Toast.tsx` 整文件替换为:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useExitTransition } from '@/client/useExitTransition';
import { resolveErrorMessage } from '@/i18n/errors';
import { FigIcon, figAsset } from './figma';

// 按 kind 映射状态图标与 accent 令牌(对齐 Figma 955-49756/49849/43601)。
// 恒浅色:文字/关闭/hover 底为 toast 专用固定色,不随主题翻转(类比 .btn-raised 例外)。
const TOAST_ICON = { error: figAsset.toastError, success: figAsset.toastSuccess, warning: figAsset.toastWarning } as const;
const TOAST_ACCENT = {
  error: 'var(--color-toast-error)',
  success: 'var(--color-toast-success)',
  warning: 'var(--color-toast-warning)',
} as const;

// 订阅 store.lastError,展示一条 toast:进出场用 toast-pop(退场期间保留末次内容)。
// 自动消失 4s,但鼠标移入暂停计时、移出重新计 4s(避免用户阅读时被吞掉)。
// 位置在搜索框下方空白带:toast 为 viewport-fixed,与顶部搜索框/底部缩放条解耦不重叠。
export default function Toast() {
  const { t } = useTranslation();
  const error = useStore((s) => s.lastError);
  const setError = useStore((s) => s.setError);
  const { mounted, closing } = useExitTransition(!!error, 200);
  // 退场动画期间 error 已为 null:用 shown 保留末次非空内容供退场渲染。
  // 渲染期按 prop 调整 state(React 官方「adjust state during render」模式,非 effect)。
  const [shown, setShown] = useState(error);
  if (error && error !== shown) setShown(error);

  // 鼠标悬停暂停自动消失:hovering 进入 deps,移入不调度计时器,移出重新调度全新 4s。
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!error || hovering) return;
    const id = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(id);
  }, [error, hovering, setError]);

  if (!mounted || !shown) return null;
  const kind = shown.kind ?? 'error';
  const isError = kind === 'error';
  const accent = TOAST_ACCENT[kind];
  return (
    <div className="fixed left-1/2 top-[68px] z-[100] -translate-x-1/2">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        data-closing={closing}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="toast-pop flex max-w-[min(473px,calc(100vw-32px))] items-center gap-4 rounded-[8px] py-3 pl-4 pr-3"
        style={{
          background: `color-mix(in srgb, ${accent} 10%, #ffffff)`,
          border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
        }}
      >
        <FigIcon src={TOAST_ICON[kind]} tone="original" size={24} className="shrink-0" />
        <p className="min-w-0 flex-1 break-words text-[14px] leading-[22px] tracking-[0.22px] text-[#262626]">
          {resolveErrorMessage(shown.code, shown.message, t)}
        </p>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => setError(null)}
          className="grid size-6 shrink-0 place-items-center rounded-[8px] text-[#202020] transition-colors hover:bg-[rgba(0,0,0,0.06)] motion-safe:active:scale-[0.92]"
        >
          <FigIcon src={figAsset.close} tone="primary" size={24} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/Toast.test.tsx`
Expected: PASS(5 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/components/ui/Toast.tsx src/components/ui/Toast.test.tsx
git commit -m "feat: Toast 组件按设计稿重做——三型状态图标 + 单行消息 + 关闭 X,恒浅色"
```

---

### Task 4: 全量校验 + Figma 像素比对(验收门)

**Files:**
- 可能微调:`src/components/ui/Toast.tsx`(边框透明度/图标几何)、`public/figma/icons/toast-*.svg`

**Interfaces:** 无新增,只做验证与微调。

- [ ] **Step 1: 全量检查全绿**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: 三者均 0 错(注意 worktree IDE 诊断误报忽略,只信这三条退出码)。

- [ ] **Step 2: 本地生产模式起服务**

Run(后台):`NEXT_PUBLIC_PGC_BASE_URL=... PORT=<空闲端口> NODE_ENV=production pnpm exec tsx server.ts`
说明:Turbopack dev 因 Google Fonts 被墙会 500,故用 `NODE_ENV=production tsx server.ts`;端口避开其它 worktree 占用(见记忆「运行态验证本地两坑」)。

- [ ] **Step 3: 用 Playwright 触发并截三型 toast**

分别把 `lastError` 置为 error/success/warning(可经 `browser_evaluate` 调 `useStore.getState().setError({...})`,或复用 SharePopover 复制失败路径),对每型 `browser_take_screenshot` 截图。

- [ ] **Step 4: 逐项像素比对并列对照表**

对照 Figma 截图(error 955-49756 / success 955-49849 / warning 955-43601),逐项核对:容器 padding(12/12/12/16)、gap(16)、圆角(8)、底色(白+10% accent)、边框(1px accent 淡边——若肉眼偏粗/偏细则在 Step 6 调 `22%`)、图标(实心形 + 白字形几何)、文字(Inter 14/22、#262626)、关闭 X(#202020、~10px 字形)。产出「设计值 vs 实测值」对照表。

- [ ] **Step 5: 深色主题下复核**

切 `data-theme="dark"`(画布切深色),确认 toast 仍为恒浅色卡片、文字/图标清晰可读、无主题串色。

- [ ] **Step 6: 按比对结果微调(如需)**

若某项不达标:边框改 `color-mix(... <accent> N%, transparent)` 的 N;图标几何改对应 SVG 的 path/坐标。改后回到 Step 1 复跑全量检查 + 重截图复比对,直到全部达标。

- [ ] **Step 7: 提交微调(如有)**

```bash
git add -A
git commit -m "fix: Toast 像素对齐微调(边框/图标几何)"
```

---

## Self-Review

**1. Spec coverage(逐条对照 spec):**
- 恒浅色像素还原 → Task 3 组件固定色 + Task 4 比对 ✓
- 扩展三型 + 去 code 前缀 → Task 1 类型 + Task 3 组件(只渲 message)✓
- 容器/文案/图标/关闭视觉规格 → Task 2 资产/令牌 + Task 3 类名 + Task 4 比对 ✓
- 三型令牌 → Task 2 Step 5 ✓
- 4 个图标 + registry → Task 2 ✓
- store 契约 + 4 处 notice 迁移(SharePopover/useAuthGuard/errors.ts+其测试)→ Task 1 全覆盖 ✓
- 保留 4s+hover 暂停 / useExitTransition / toast-pop / role / i18n → Task 3 组件保留 ✓
- 测试更新 → Task 1(errors.test)+ Task 3(Toast.test)✓
- 验收(全量绿 + 像素比对 + 深色复核)→ Task 4 ✓

**2. Placeholder scan:** 无 TBD/TODO;所有步骤含完整代码/命令。边框 `22%` 与 Step 6 微调是明确的「起始值 + 验证收敛」,非占位。✓

**3. Type consistency:** `ToastKind`/`ToastMessage`(Task 1)→ 组件 `shown.kind`(Task 3)一致;`figAsset.toastError/toastSuccess/toastWarning/close`(Task 2)→ `TOAST_ICON` 与 close 按钮(Task 3)键名一致;令牌 `--color-toast-{error,success,warning}`(Task 2)→ `TOAST_ACCENT`(Task 3)一致。✓
