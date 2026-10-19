# Workspace 加载动画优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-08-workspace-loading-animation-design.md`,优化全屏启动加载层(brand 档)的视觉底、入场编排、假进度文案轮播与揭幕退场。

**Architecture:** 全部改动收在展示层:`LoadingScreen.tsx`(brand 分支)+ `globals.css`(新增 `.brand-backdrop`/`.brand-exit`)+ `Workspace.tsx`(退场 240ms、传 hints)。不动 store/actions;文案轮播是组件内本地 interval 假进度。

**Tech Stack:** React 19 / Tailwind v4 CSS 变量令牌 / Vitest(jsdom + fake timers) / react-i18next 六语。

## Global Constraints

- 颜色只用 CSS 变量令牌(`--color-canvas` / `--color-teal-soft` 等),禁止字面色值。
- 进场缓动 `cubic-bezier(0.22, 1, 0.36, 1)`,退场 ease-in 且更短。
- 新增动画类必须补进 `globals.css` 的 `prefers-reduced-motion` 禁用列表。
- i18n:en 为单一真相源,新 key 六语(en/zh/fr/ru/ja/vi)全补。
- 注释/commit message 用中文;`variant="spinner"` 行为不得改变。
- 每个 Task 结束跑 `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx` + 全量前跑 `pnpm exec tsc --noEmit`。

---

### Task 1: brand 档换底 `.brand-backdrop` + 入场延迟编排

**Files:**
- Modify: `src/components/ui/LoadingScreen.tsx`
- Modify: `src/app/globals.css`(约 592 行品牌动画注释块附近新增)
- Test: `src/components/ui/LoadingScreen.test.tsx`

**Interfaces:**
- Consumes: 现有 `LoadingScreen` props(`label/className/closing/variant`)。
- Produces: brand 分支底层 DOM 为 `.brand-backdrop`(替代 `.skeleton-shimmer`);spinner 分支不变。Task 2/3 在该分支内继续叠加。

- [ ] **Step 1: 写失败测试**

在 `LoadingScreen.test.tsx` 的 brand describe 块追加、并在 spinner 块确认 shimmer 保留:

```tsx
  it('brand 档用静态品牌底 brand-backdrop,不用骨架 shimmer', () => {
    const { container } = render(<LoadingScreen variant="brand" />);
    expect(container.querySelector('.brand-backdrop')).toBeTruthy();
    expect(container.querySelector('.skeleton-shimmer')).toBeNull();
  });
```

spinner describe 块追加:

```tsx
  it('spinner 档保留骨架 shimmer 底', () => {
    const { container } = render(<LoadingScreen />);
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: 新增第一条 FAIL(brand 下查到 `.skeleton-shimmer`、查不到 `.brand-backdrop`)。

- [ ] **Step 3: 实现**

`LoadingScreen.tsx`:把底层那行按 variant 分流,并给字标/文案加入场延迟:

```tsx
      {/* brand 档用静态品牌底(canvas 色 + 中心 teal 柔光),spinner 档保留骨架 shimmer */}
      {variant === "brand" ? (
        <div className="brand-backdrop absolute inset-0 rounded-[inherit]" aria-hidden />
      ) : (
        <div className="skeleton-shimmer absolute inset-0 rounded-[inherit]" aria-hidden />
      )}
```

字标 span 的逐字 delay 改为整体 +150ms(基础层与扫光覆盖层同构,覆盖层无逐字动画不用改):

```tsx
              <span key={i} className="brand-letter inline-block" style={{ animationDelay: `${150 + i * 50}ms` }}>
```

label 文案(brand 分支)加 400ms 延迟淡入(150ms 字标起点 + 250ms):

```tsx
          {label && (
            <span className="anim-media-in text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]" style={{ animationDelay: "400ms", animationFillMode: "both" }}>
              {label}
            </span>
          )}
```

`globals.css` 品牌动画块(594 行前)新增:

```css
/* 品牌启动层静态底:画布色 + 中心 teal 柔光,沉静聚焦中心动画;静态无动画,无需 reduced-motion 处理 */
.brand-backdrop {
  background:
    radial-gradient(closest-side, var(--color-teal-soft), transparent 70%) center / 720px 720px no-repeat,
    var(--color-canvas);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LoadingScreen.tsx src/components/ui/LoadingScreen.test.tsx src/app/globals.css
git commit -m "feat: 品牌启动层换静态柔光底并编排入场延迟"
```

### Task 2: 假进度文案轮播(hints prop + 六语文案)

**Files:**
- Modify: `src/components/ui/LoadingScreen.tsx`
- Modify: `src/components/workspace/Workspace.tsx:133`
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`(workspace 段)
- Test: `src/components/ui/LoadingScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 后的 brand 分支结构。
- Produces: `LoadingScreen` 新增可选 prop `hints?: string[]`(仅 brand 档生效):传入时替代 `label` 文案位,每 900ms 顺序切换、停在最后一条;不传时行为同现状(显示 `label`)。`aria-label` 仍用 `label`(状态语义稳定,不随轮播变)。

- [ ] **Step 1: 写失败测试**

`LoadingScreen.test.tsx` 顶部改造 import 并追加用例:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
```

brand describe 块追加:

```tsx
  it('hints 轮播:每 900ms 顺序切换,停在最后一条不回绕', () => {
    vi.useFakeTimers();
    try {
      render(<LoadingScreen variant="brand" hints={['连接中…', '载入画布…', '马上就好…']} />);
      expect(screen.getByText('连接中…')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(900); });
      expect(screen.getByText('载入画布…')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(900); });
      expect(screen.getByText('马上就好…')).toBeTruthy();
      // 走到最后一条后停住:再推进不回绕到第一条
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByText('马上就好…')).toBeTruthy();
      expect(screen.queryByText('连接中…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('不传 hints 时仍显示 label 文案', () => {
    render(<LoadingScreen variant="brand" label="Loading workspace" />);
    expect(screen.getByText('Loading workspace')).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: 轮播用例 FAIL(hints prop 不存在,TS 编译报错或文案未渲染)。

- [ ] **Step 3: 实现**

`LoadingScreen.tsx` 顶部加 import 与 props,brand 分支内实现轮播:

```tsx
import { useEffect, useState } from "react";
```

props 增加(注释同风格):

```tsx
  hints = [],
}: {
  label?: string;
  className?: string;
  closing?: boolean;
  variant?: "brand" | "spinner";
  /** 仅 brand 档:假进度文案序列,每 900ms 顺序切换、停在最后一条;传入时替代 label 文案位 */
  hints?: string[];
}) {
```

组件体内(return 前):

```tsx
  // 假进度轮播:纯展示,不上报真实阶段;booting 撤层即整层退场,走到哪算哪
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (variant !== "brand" || hints.length <= 1) return;
    const timer = setInterval(() => {
      // 走到最后一条停住不回绕;到底后清掉计时器避免空转
      setHintIdx((i) => (i + 1 >= hints.length ? (clearInterval(timer), i) : i + 1));
    }, 900);
    return () => clearInterval(timer);
  }, [variant, hints.length]);
  const hint = hints.length > 0 ? hints[Math.min(hintIdx, hints.length - 1)] : label;
```

brand 分支 label 渲染处改用 `hint`(key 触发换字时重播淡入;reduced-motion 下 `.anim-media-in` 已被禁,自动退化为直接换字):

```tsx
          {hint && (
            <span key={hint} className="anim-media-in text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]" style={{ animationDelay: hintIdx === 0 ? "400ms" : "0ms", animationFillMode: "both" }}>
              {hint}
            </span>
          )}
```

六语 locale 的 `workspace` 段各加 `bootHints`(数组;en 为真相源):

```ts
// en.ts
  workspace: {
    resizeChat: 'Resize chat panel',
    loading: 'Loading workspace…',
    bootHints: ['Connecting to your workspace…', 'Loading projects and canvas…', 'Almost there…'],
  },
// zh.ts: bootHints: ['正在连接工作台…', '载入项目与画布…', '马上就好…'],
// fr.ts: bootHints: ['Connexion à votre espace de travail…', 'Chargement des projets et du canevas…', 'Presque prêt…'],
// ru.ts: bootHints: ['Подключение к рабочему пространству…', 'Загрузка проектов и холста…', 'Почти готово…'],
// ja.ts: bootHints: ['ワークスペースに接続中…', 'プロジェクトとキャンバスを読み込み中…', 'まもなく完了…'],
// vi.ts: bootHints: ['Đang kết nối không gian làm việc…', 'Đang tải dự án và canvas…', 'Sắp xong…'],
```

`Workspace.tsx:133` 传入 hints(`returnObjects` 拿数组):

```tsx
      {loader.mounted && <LoadingScreen variant="brand" className="fixed inset-0 z-50" label={t('workspace.loading')} hints={t('workspace.bootHints', { returnObjects: true }) as string[]} closing={loader.closing} />}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx && pnpm exec tsc --noEmit`
Expected: 全 PASS,tsc 无错(重点确认 `returnObjects` 断言与 locale 类型一致——六语都加了 `bootHints` 才过)。

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LoadingScreen.tsx src/components/ui/LoadingScreen.test.tsx src/components/workspace/Workspace.tsx src/i18n/locales
git commit -m "feat: 启动层假进度文案轮播(六语)"
```

### Task 3: 揭幕退场 `.brand-exit` + 240ms

**Files:**
- Modify: `src/components/ui/LoadingScreen.tsx`
- Modify: `src/components/workspace/Workspace.tsx:52`
- Modify: `src/app/globals.css`(品牌动画块 + reduced-motion 列表)
- Test: `src/components/ui/LoadingScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 brand 分支结构;`useExitTransition(open, ms)` 现有签名。
- Produces: `closing=true` 时 brand 中心内容容器(`role=status` 那层)带 `.brand-exit`;`Workspace` 退场时长 240ms。

- [ ] **Step 1: 写失败测试**

brand describe 块追加:

```tsx
  it('closing=true 时中心内容播放揭幕退场 brand-exit', () => {
    const { container } = render(<LoadingScreen variant="brand" closing />);
    expect(screen.getByRole('status').className).toContain('brand-exit');
    // 整层淡出仍在
    expect((container.firstChild as HTMLElement).className).toContain('anim-fade-out');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: FAIL(className 不含 brand-exit)。

- [ ] **Step 3: 实现**

`LoadingScreen.tsx` brand 中心容器:

```tsx
        <div role="status" aria-label={label ?? "Loading"} className={`relative flex flex-col items-center gap-4 ${closing ? "brand-exit" : ""}`}>
```

`globals.css` 品牌动画块末尾新增,并把 `.brand-exit` 加进 reduced-motion 禁用列表(`.wordmark-sheen,` 之后一行):

```css
/* 揭幕退场:整层淡出的同时,中心内容轻微放大淡出(240ms,退场用 ease-in),制造"揭开进入工作台"的收束感 */
.brand-exit { animation: brand-exit 240ms ease-in both; }
@keyframes brand-exit {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(1.06); }
}
```

```css
  .brand-letter,
  .wordmark-sheen,
  .brand-exit,
```

`Workspace.tsx:52` 退场时长同步 240ms:

```tsx
  const loader = useExitTransition(booting || authRequired, 240);
```

- [ ] **Step 4: 跑测试与全量校验**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx && pnpm exec tsc --noEmit && pnpm test && pnpm lint`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LoadingScreen.tsx src/components/ui/LoadingScreen.test.tsx src/components/workspace/Workspace.tsx src/app/globals.css
git commit -m "feat: 启动层揭幕退场(中心放大淡出 240ms)"
```

### Task 4: 运行态目视验证

**Files:**
- 无代码改动(必要时据结果回修)。

**Interfaces:**
- Consumes: Task 1–3 全部落地。

- [ ] **Step 1: 起 dev 并截图核对**

起 `pnpm dev`(注意端口勿被其他 worktree 占用;若 Google Fonts 被墙导致 dev 500,改跑 prod build)。用 Playwright 打开首页,在 booting 期间与退场瞬间截图,核对:
- 底为画布色 + 中心 teal 柔光,无灰色横扫;
- logo 先入、字标 +150ms、文案 +400ms 的先后呼吸;
- 文案按 900ms 轮播且停在最后一条;
- 加载完成时中心内容放大淡出、整层 240ms 揭开;
- 深色主题(`data-theme="dark"`)下底色与柔光正常。

- [ ] **Step 2: 发现偏差则回修并补提交**

按既有 commit 粒度回修,message 中文一句话。

## Self-Review

- Spec 覆盖:视觉底(T1)、入场编排(T1)、轮播+六语(T2)、揭幕退场+reduced-motion(T3)、spinner 不变(T1 测试)、目视验证(T4)——齐。
- 无占位符;类型/类名前后一致(`brand-backdrop`/`brand-exit`/`hints`)。
