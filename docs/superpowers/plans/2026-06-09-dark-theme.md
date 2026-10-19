# 深色主题 + 主题切换 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现与 Figma 暗色稿一致的深色主题,并在 project 工具栏(ChatPanel 顶部)加入亮/暗切换按钮,刷新不闪白。

**Architecture:** Tailwind v4 `@theme` 亮色 token 作默认,`globals.css` 新增 `[data-theme="dark"]` 覆盖同名 `--color-*`/阴影,组件零改动跟随;少量写死 hex 改引用变量。主题状态存 Zustand(复用 persist),`useTheme` 写 `<html data-theme>`,`layout.tsx` 内联脚本防 FOUC。

**Tech Stack:** Next.js 16 / React 19 / Tailwind CSS v4 / Zustand(persist)/ lucide-react / vitest + @testing-library/react / Playwright(视觉验收)。

**设计稿:** Figma `Taluna_game` node `164-4350`。对应 spec:`docs/superpowers/specs/2026-06-09-dark-theme-design.md`。

---

### Task 1: 暗色 token 与阴影覆盖(globals.css)

纯 CSS,无单测;暗色效果在 Task 7 用 Playwright 统一验收。本任务只保证不破坏现有测试。

**Files:**
- Modify: `src/app/globals.css`(在 `:root { ... }` 块之后追加 `[data-theme="dark"]` 块)

- [ ] **Step 1: 追加暗色覆盖块**

在 `src/app/globals.css` 中,`:root { ... }`(以 `--grad-btn` 结尾那个块)的右花括号之后、`.btn-raised` 规则之前,插入:

```css
/* 深色主题:覆盖语义变量(来源 Figma 164-4350)。
   raised 按钮体系(--grad-btn/--shadow-btn/.btn-raised)在暗色稿中仍为浅色 CTA,故不覆盖。 */
[data-theme="dark"] {
  /* 文字 */
  --color-ink: #fcfcfc;
  --color-muted: #7b7b7b;

  /* 表面 / 填充 */
  --color-surface: #232627;   /* Surface/02:Chat/Preview 面板 */
  --color-surface-2: #2c2c2e; /* Surface/03 */
  --color-fill: #2c2c2e;      /* Surface/03:hover/填充,比 surface 浅 */
  --color-canvas: #141718;    /* Surface/01:画布中心 / 页面底 */

  /* 描边 */
  --color-line: #222222;   /* Stroke/02 */
  --color-line-2: #323232; /* Stroke/01 */

  /* Live 绿 */
  --color-live: #4ccc67;

  /* Composer 提示框:去掉实心白高光,改用低透明度白 */
  --shadow-prompt: 0 18px 24px -20px rgba(0, 0, 0, 0.5), 0 8px 16px -12px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
}
```

- [ ] **Step 2: 跑测试确认未破坏**

Run: `pnpm test`
Expected: PASS(149 tests 全过,本任务不引入/改动测试)

- [ ] **Step 3: 提交**

```bash
git add src/app/globals.css
git commit -m "feat: 深色主题 token 与阴影覆盖"
```

---

### Task 2: 硬编码 hex 清理(改引用语义变量)

把深色下会露馅的写死 hex 改为 `var(--color-*)`,纯 class 替换、无行为变化。

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/components/chat/Composer.tsx`
- Modify: `src/components/chat/ToolCard.tsx`
- Modify: `src/components/chat/ToolApprovalCard.tsx`
- Modify: `src/components/canvas/AssetCanvas.tsx`
- Modify: `src/components/canvas/AddAssetMenu.tsx`
- Modify: `src/components/preview/VersionTimeline.tsx`
- Modify: `src/components/preview/PreviewPanel.tsx`

- [ ] **Step 1: 逐处替换**

精确替换(每处把左边的串改成右边的串):

1. `src/components/chat/ChatPanel.tsx`(空态文字,约 line 98):
   - 旧:`text-[#757575]`
   - 新:`text-[var(--color-muted)]`

2. `src/components/chat/Composer.tsx`(placeholder,约 line 104):
   - 旧:`placeholder:text-[#7b7b7b]`
   - 新:`placeholder:text-[var(--color-muted)]`

3. `src/components/chat/ToolCard.tsx`(两处 `<pre>`,约 line 43、51):
   - 旧:`text-[#555]`
   - 新:`text-[var(--color-muted)]`
   - （line 51 是 `${part.isError ? 'text-red-600' : 'text-[#555]'}`,只改 `text-[#555]` 部分;`text-red-600` 保留)

4. `src/components/chat/ToolApprovalCard.tsx`(`<pre>`,约 line 10):
   - 旧:`text-[#555]`
   - 新:`text-[var(--color-muted)]`

5. `src/components/canvas/AssetCanvas.tsx`:
   - 搜索框 placeholder(约 line 45):`placeholder:text-[#7b7b7b]` → `placeholder:text-[var(--color-muted)]`
   - 空态文字(约 line 59):`text-[#757575]` → `text-[var(--color-muted)]`
   - React Flow 网点(约 line 243):`<Background variant={BackgroundVariant.Dots} color="#e2e2e2" gap={20} size={1.5} />` → 把 `color="#e2e2e2"` 改为 `color="var(--color-line-2)"`
   - 注意:**不要**改 `text-[#1e1e1e]`(约 line 62,浅色 raised 底上的深色文字,保留)

6. `src/components/canvas/AddAssetMenu.tsx`(两处,约 line 19、63):
   - 旧:`text-[#7b7b7b]`
   - 新:`text-[var(--color-muted)]`

7. `src/components/preview/VersionTimeline.tsx`(两处,约 line 61、62):
   - 旧:`text-[#7b7b7b]`
   - 新:`text-[var(--color-muted)]`
   - 注意:**不要**改 `palette === 'neon' ? '#2a1f3d' : '#3a2a22'`(按游戏 palette 取色,与主题无关)

8. `src/components/preview/PreviewPanel.tsx`(空预览占位,约 line 73):
   - 旧:`bg-[#e6e6e6] px-8 text-center text-[15px] leading-6 tracking-[-0.3px] text-black`
   - 新:`bg-[var(--color-fill)] px-8 text-center text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]`

- [ ] **Step 2: 跑测试 + lint 确认未破坏**

Run: `pnpm test && pnpm lint`
Expected: PASS(149 tests 全过;lint 无错)

- [ ] **Step 3: 提交**

```bash
git add src/components
git commit -m "refactor: 写死色值改引用语义变量,适配深色主题"
```

---

### Task 3: store 增加 theme 状态与 toggleTheme(TDD)

**Files:**
- Modify: `src/store/index.ts`
- Create: `src/store/theme.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/store/theme.test.ts`:

```ts
import { expect, test } from 'vitest';
import { useStore } from './index';

// 注:vitest 默认按文件隔离模块,本文件首个测试运行时 store 为初始态
test('theme 默认 light', () => {
  expect(useStore.getState().theme).toBe('light');
});

test('toggleTheme 在 light/dark 间翻转', () => {
  useStore.setState({ theme: 'light' });
  useStore.getState().toggleTheme();
  expect(useStore.getState().theme).toBe('dark');
  useStore.getState().toggleTheme();
  expect(useStore.getState().theme).toBe('light');
});

test('theme 持久化到 localStorage(partialize 含 theme)', () => {
  useStore.setState({ theme: 'dark' });
  const raw = localStorage.getItem('taluna-v4');
  expect(raw).toBeTruthy();
  expect(JSON.parse(raw!).state.theme).toBe('dark');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/store/theme.test.ts`
Expected: FAIL(`theme` 不存在 / `toggleTheme is not a function`)

- [ ] **Step 3: 最小实现**

在 `src/store/index.ts` 中改三处:

(a) `UIState` 接口(约 line 18-26)末尾,`composer: ComposerState;` 之后加一行:
```ts
  theme: 'light' | 'dark';
```

(b) `Actions` 接口(约 line 28+)里加一行(放在 `setPermissionMode` 附近即可):
```ts
  toggleTheme: () => void;
```

(c) store 初始 state 块,在 `composer: { draft: '', refs: [], attachments: [] },`(约 line 70)之后加:
```ts
      theme: 'light',
```

(d) actions 区,在 `setConn: (connStatus) => set({ connStatus }),`(约 line 105)附近加:
```ts
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
```

(e) `partialize`(约 line 156-161)增加 `theme`:
```ts
      partialize: (s) => ({
        visibleKinds: s.visibleKinds,
        currentProjectId: s.currentProjectId,
        koubouByProject: s.koubouByProject,
        composer: { draft: s.composer.draft, refs: s.composer.refs, attachments: [] },
        theme: s.theme,
      }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/store/theme.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: 提交**

```bash
git add src/store/index.ts src/store/theme.test.ts
git commit -m "feat: store 增加 theme 状态与 toggleTheme"
```

---

### Task 4: useTheme hook —— 把 theme 写入 `<html data-theme>`(TDD)

**Files:**
- Create: `src/client/useTheme.ts`
- Create: `src/client/useTheme.test.ts`
- Modify: `src/components/workspace/Workspace.tsx`

- [ ] **Step 1: 写失败测试**

Create `src/client/useTheme.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';
import { useStore } from '@/store';

beforeEach(() => {
  useStore.setState({ theme: 'light' });
  document.documentElement.removeAttribute('data-theme');
});

test('挂载时按当前 theme 标记 data-theme', () => {
  useStore.setState({ theme: 'dark' });
  renderHook(() => useTheme());
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
});

test('theme 变化时更新 data-theme', () => {
  renderHook(() => useTheme());
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  act(() => { useStore.setState({ theme: 'dark' }); });
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/client/useTheme.test.ts`
Expected: FAIL(`Cannot find module './useTheme'`)

- [ ] **Step 3: 最小实现**

Create `src/client/useTheme.ts`:

```ts
'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';

// 把当前主题写入 <html data-theme>,CSS [data-theme="dark"] 据此覆盖变量。
// 初次进入由 layout.tsx 内联脚本提前设置(防闪白),本 hook 负责水合后随状态同步。
export function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/client/useTheme.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 5: 在 Workspace 顶层调用**

`src/components/workspace/Workspace.tsx`:
- 在文件顶部 import 区加:
```ts
import { useTheme } from '@/client/useTheme';
```
- 在 `export default function Workspace() {` 函数体内,现有 `const client = useKoubouConnection();` 这行之后加一行:
```ts
  useTheme();
```

- [ ] **Step 6: 跑全量测试确认未破坏**

Run: `pnpm test`
Expected: PASS(全过)

- [ ] **Step 7: 提交**

```bash
git add src/client/useTheme.ts src/client/useTheme.test.ts src/components/workspace/Workspace.tsx
git commit -m "feat: useTheme 将主题写入 html data-theme"
```

---

### Task 5: FOUC 防闪白内联脚本(layout.tsx)

无单测(Next 根布局 + 水合前内联脚本);效果在 Task 7 用 Playwright 验收(刷新无白闪)。

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 在 `<html>` 内、`<body>` 前注入同步脚本**

把 `src/app/layout.tsx` 的 `return (...)` 改为(在 `<html>` 与 `<body>` 之间插入 `<head>` 脚本):

```tsx
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script
          // 水合前同步读取持久化主题并设置 data-theme,避免刷新时亮→暗白闪
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('taluna-v4')||'{}');document.documentElement.dataset.theme=(s.state&&s.state.theme)==='dark'?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`,
          }}
        />
      </head>
      <body><div id="__app">{children}</div></body>
    </html>
  );
```

- [ ] **Step 2: 跑测试 + lint 确认未破坏**

Run: `pnpm test && pnpm lint`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/app/layout.tsx
git commit -m "feat: 内联脚本在水合前设置主题,避免刷新闪白"
```

---

### Task 6: Project Header 主题切换按钮(TDD)

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/components/chat/ChatPanel.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `src/components/chat/ChatPanel.test.tsx` 末尾追加:

```ts
test('亮色态:显示「切换深色模式」按钮,点击切到 dark', () => {
  useStore.setState({ theme: 'light' });
  render(<ChatPanel client={clientRef} />);
  const btn = screen.getByRole('button', { name: '切换深色模式' });
  act(() => { fireEvent.click(btn); });
  expect(useStore.getState().theme).toBe('dark');
});

test('暗色态:显示「切换浅色模式」按钮', () => {
  useStore.setState({ theme: 'dark' });
  render(<ChatPanel client={clientRef} />);
  expect(screen.getByRole('button', { name: '切换浅色模式' })).toBeInTheDocument();
});
```

并把首行 import 改为包含 `fireEvent`:
```ts
import { act, fireEvent, render, screen } from '@testing-library/react';
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/components/chat/ChatPanel.test.tsx`
Expected: FAIL(找不到名为「切换深色模式」的 button)

- [ ] **Step 3: 实现按钮**

在 `src/components/chat/ChatPanel.tsx`:

(a) import 区(约 line 11-12 附近)增加:
```ts
import IconButton from '@/components/ui/IconButton';
import { Sun, Moon } from 'lucide-react';
```

(b) 组件内,store 取值区(约 line 22 `permissionMode` 附近)增加:
```ts
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
```

(c) Project Header 行内,把 `<PermissionModeMenu ... />`(约 line 81)那一行**之前**插入切换按钮:
```tsx
          <IconButton
            variant="ghost"
            className="size-8 p-1.5"
            aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/components/chat/ChatPanel.test.tsx`
Expected: PASS（含新增 2 个 + 原有 6 个）

- [ ] **Step 5: 跑全量测试 + lint**

Run: `pnpm test && pnpm lint`
Expected: PASS（全过）

- [ ] **Step 6: 提交**

```bash
git add src/components/chat/ChatPanel.tsx src/components/chat/ChatPanel.test.tsx
git commit -m "feat: Project Header 增加亮/暗主题切换按钮"
```

---

### Task 7: Playwright 视觉验收与微调

对照 Figma `164-4350` 暗色稿逐区检查,修掉残留的浅色露馅。

**Files:**
- 视情况微调:`src/app/globals.css` 及相关组件 class

- [ ] **Step 1: 启动 dev server(后台)**

Run(后台):`pnpm dev`
等待日志出现 `> Ready on http://localhost:3000`。

- [ ] **Step 2: 截图亮色态**

用 Playwright 导航到 `http://localhost:3000`,等待页面加载,截全屏图(亮色基线)。

- [ ] **Step 3: 切到暗色并截图**

点击 Project Header 的主题切换按钮(`切换深色模式`),截全屏图。再分别打开:Project 下拉菜单、画布右键 Add 菜单、Composer 提示框,各截一张。

- [ ] **Step 4: 逐区对照 Figma 暗色稿**

对照 `164-4350` 检查以下区域无浅色残留、对比度可读:
- Chat 面板(空态文字 / 消息 / 工具卡 / 思考块)
- 画布(底色 / 网点 / 搜索框 / 空态 / 节点卡 / 缩放 toolbar 浅色 pill)
- Preview 面板(头部 / Live 徽标 / Live preview 子栏 / 空预览占位 / 版本时间线)
- Composer 提示框(底色 + 顶部高光不刺眼)
- 弹层(ProjectMenu / AddAssetMenu / 快捷键 chip)
- raised CTA(Publish / 发送按钮 / 缩放 pill)应保持浅色

- [ ] **Step 5: 修掉发现的问题并复跑**

对每处露馅:优先在 `[data-theme="dark"]` 调 token;若是写死 hex 漏网,改引用变量。每次修改后刷新页面确认,并 `pnpm test` 保持绿。

- [ ] **Step 6: 验证刷新无白闪(FOUC)**

在暗色态刷新页面,确认无亮→暗白闪(内联脚本生效)。

- [ ] **Step 7: 提交(若有微调)**

```bash
git add -A
git commit -m "fix: 深色主题视觉对齐微调"
```

---

## 自查

**Spec 覆盖:**
- 暗色 token 覆盖 → Task 1 ✓
- raised 按钮不反转 → Task 1(不覆盖 grad-btn/shadow-btn)✓
- shadow-prompt 暗色化 → Task 1 ✓
- 硬编码 hex 清理(9 处)→ Task 2 全覆盖 ✓
- store theme + toggleTheme + persist → Task 3 ✓
- useTheme 写 data-theme + Workspace 调用 → Task 4 ✓
- FOUC 内联脚本 → Task 5 ✓
- 切换按钮(Sun/Moon + aria-label)→ Task 6 ✓
- 视觉验收 → Task 7 ✓

**占位符扫描:** 无 TBD/TODO;每个代码步骤含完整代码与精确路径。

**类型一致性:** `theme: 'light' | 'dark'`、`toggleTheme()`、`useTheme()`、persist key `taluna-v4`、aria-label 文案(`切换深色模式`/`切换浅色模式`)在各 Task 间一致。
