# 工具调用块 pill 化 + thinking 统一 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工具调用折叠块的容器与状态图标对齐 Figma `647-23435`（`status-pill`），并把 thinking 块统一成同款可折叠 pill；文案与折叠行为保持现状。

**Architecture:** 抽一个共享视觉原子模块 `toolPill.tsx`（容器类 `pillClass`、`Spinner`、`ToolStatusIcon`、`CollapseArrow`），`ToolCard` 与 `ThinkingBlock` 复用，避免两处漂移。新增三枚设计图标（走 `FigIcon` mask 重着色）+ 一个 `--color-warning` token。

**Tech Stack:** Next 16 / React 19 / Tailwind v4（`@theme` + `bg-[var(--…)]` arbitrary）/ react-i18next / Vitest + Testing Library（jsdom）。

## Global Constraints

- **文案不变**：工具名、文件名、`+N/-M`、"用户已编辑"徽章的内容、字体、位置都不动（不切等宽字体，仍用现有 Inter 13px）。既有的 `text-emerald-600`/`text-red-600` 差异色是历史遗留、不在本次范围，原样保留。
- **折叠行为不变**：进行中/失败自动展开、完成自动收起、手动切换、`anim-collapse-in` 正文逻辑全不变；折叠箭头位置按设计移到右侧。
- **颜色走 CSS 变量**：禁止新硬编码色值（`globals.css` 外）。状态色用 `--color-teal`（成功）/ `--color-warning`（进行中，新增 `#ffab00`）/ `--color-danger`（失败）。
- **图标走 `FigIcon`**：不直接 `<img>`；新图标先落 `public/figma/icons/` 再登记 `figAsset`。
- **不用 effect setState**：跟随状态的展开态用渲染期 guard setState（见 [[react-hooks-lint-constraints]]），沿用 `ToolCard` 现有写法。
- 命令 / 注释 / commit message 一律中文。执行前在 `superpowers:using-git-worktrees` 建 `feat/tool-call-pill-style` worktree（注意 [[worktree-absolute-path-trap]] / [[subagent-may-commit-wrong-branch]]，改完用 `git -C <worktree>` 校验落点）。

---

## 文件结构

- 新建 `src/components/chat/toolPill.tsx` — 共享 pill 视觉原子（容器类 + 三种状态图标 + 折叠箭头）。
- 新建 `src/components/chat/toolPill.test.tsx` — 原子单测。
- 新建 `public/figma/icons/check-circle.svg` / `warning-sign.svg` / `arrow-down.svg` — 设计图标。
- 改 `src/components/ui/figma.tsx` — `figAsset` 加三枚图标，`ICON_TONE` 登记 `arrowDown: secondary`。
- 改 `src/app/globals.css` — `@theme` 加 `--color-warning: #ffab00`。
- 改 `src/components/chat/ToolCard.tsx` — 容器 pill 化 + 左状态图标 + 右折叠箭头（正文/媒体逻辑不动）。
- 改 `src/components/chat/ToolCard.test.tsx` — 更新受影响断言 + 新增图标/箭头断言。
- 改 `src/components/chat/ThinkingBlock.tsx` — 改为受控折叠 + 同款 pill。
- 改 `src/components/chat/ThinkingBlock.test.tsx` — 重写为折叠行为断言。

---

## Task 1: 共享 pill 原子 + 图标资产 + token

**Files:**
- Create: `public/figma/icons/check-circle.svg`, `public/figma/icons/warning-sign.svg`, `public/figma/icons/arrow-down.svg`
- Modify: `src/components/ui/figma.tsx`（`figAsset` 8-47 段、`ICON_TONE` 57-74 段）
- Modify: `src/app/globals.css`（`@theme` `:root`，`--color-danger` 附近 ~55 行）
- Create: `src/components/chat/toolPill.tsx`
- Test: `src/components/chat/toolPill.test.tsx`

**Interfaces:**
- Produces:
  - `pillClass(expanded: boolean): string` — pill 容器类。
  - `Spinner(): JSX.Element` — amber 转圈，含 `role="status"` `aria-label={t('chat.tool.running')}` 与 `data-tool-status="running"`。
  - `ToolStatusIcon({ status }: { status: Status }): JSX.Element` — `Status` 来自 `@/store/types`（`'pending'|'generating'|'ready'|'error'`）。
  - `CollapseArrow({ open }: { open: boolean }): JSX.Element` — 右侧折叠箭头，含 `data-collapse-arrow`。
  - `figAsset.checkCircle` / `figAsset.warningSign` / `figAsset.arrowDown`。

- [ ] **Step 1: 写三枚图标 SVG**

`public/figma/icons/check-circle.svg`：
```svg
<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.7168 5.83345C12.9832 7.14088 12.7934 8.50012 12.1789 9.6845C11.5644 10.8689 10.5625 11.8068 9.3402 12.3419C8.1179 12.877 6.7491 12.9768 5.46208 12.6248C4.17505 12.2728 3.0476 11.4903 2.26773 10.4076C1.48786 9.32496 1.10272 8.00768 1.17654 6.67543C1.25035 5.34318 1.77866 4.07651 2.67336 3.08664C3.56806 2.09677 4.77507 1.44354 6.09311 1.23589C7.41114 1.02823 8.76052 1.27871 9.91623 1.94554M5.24979 6.41651L6.99979 8.16651L12.8331 2.33318" stroke="var(--stroke-0, #14B8A6)" stroke-width="2" stroke-linecap="round"/></svg>
```

`public/figma/icons/warning-sign.svg`：
```svg
<svg width="12.8333" height="11.6667" viewBox="0 0 12.8333 11.6667" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.41667 3.5C6.73883 3.5 7 3.74108 7 4.03846V6.46154C7 6.75892 6.73883 7 6.41667 7C6.0945 7 5.83333 6.75892 5.83333 6.46154V4.03846C5.83333 3.74108 6.0945 3.5 6.41667 3.5Z" fill="var(--fill-0, #FF5630)"/><path fill-rule="evenodd" clip-rule="evenodd" d="M6.41667 8.16667C6.73883 8.16667 7 8.42783 7 8.75C7 9.07217 6.73883 9.33339 6.41667 9.33339C6.0945 9.33339 5.83333 9.07223 5.83333 8.75006C5.83333 8.42789 6.0945 8.16667 6.41667 8.16667Z" fill="var(--fill-0, #FF5630)"/><path fill-rule="evenodd" clip-rule="evenodd" d="M6.93005 1.46337C6.70598 1.07056 6.13975 1.07026 5.91525 1.46283L1.24831 9.62375C1.02556 10.0133 1.30682 10.4981 1.75556 10.4981H11.0778C11.5262 10.4981 11.8075 10.0138 11.5853 9.6243L6.93005 1.46337ZM4.90076 0.882739C5.57425 -0.294975 7.27294 -0.294063 7.94516 0.884376L12.6005 9.0453C13.267 10.2139 12.4232 11.6667 11.0778 11.6667H1.75556C0.409354 11.6667 -0.434439 10.2122 0.233823 9.04366L4.90076 0.882739Z" fill="var(--fill-0, #FF5630)"/></svg>
```

`public/figma/icons/arrow-down.svg`：
```svg
<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.96 4.09H5.845H3.04C2.56 4.09 2.32 4.67 2.66 5.01L5.25 7.6C5.665 8.015 6.34 8.015 6.755 7.6L7.74 6.615L9.345 5.01C9.68 4.67 9.44 4.09 8.96 4.09Z" fill="var(--fill-0, #494949)"/></svg>
```

（`stroke`/`fill` 的 `var(…, #hex)` 回退色仅供 `FigIcon` mask 取形状 alpha，实际显示色由容器 `currentColor`/`--color-muted` 决定。）

- [ ] **Step 2: figAsset 登记三枚图标 + arrow-down 设为 secondary**

`src/components/ui/figma.tsx`，在 `figAsset` 对象末尾（`fileCode` 后、`} as const;` 前）加：
```ts
  checkCircle: `${F}/check-circle.svg`,
  warningSign: `${F}/warning-sign.svg`,
  arrowDown: `${F}/arrow-down.svg`,
```
在 `ICON_TONE` 里 `[figAsset.fileCode]: 'secondary',` 之后加（`arrow-down` 恒 `--color-muted` 灰，与折叠指示语义一致；`checkCircle`/`warningSign` 不登记，保持默认 `primary` 由容器 `text-*` 上色）：
```ts
  [figAsset.arrowDown]: 'secondary',
```

- [ ] **Step 3: 新增 `--color-warning` token**

`src/app/globals.css`，在 `:root` 的 `@theme` 块内 `--color-danger: #e5484d;` 一行后加：
```css
  --color-warning: #ffab00; /* 工具/思考进行中 amber 转圈,对齐 Figma warning/main;明暗同色皆可读 */
```
（`--color-teal` `--color-danger` 已存在，`[data-theme="dark"]` 无需覆盖 `--color-warning`——amber 在深浅底都可读。）

- [ ] **Step 4: 写失败测试 `toolPill.test.tsx`**

```tsx
import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolStatusIcon, CollapseArrow } from './toolPill';

test('generating → amber 转圈(role=status)', () => {
  render(<ToolStatusIcon status="generating" />);
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
});

test('pending → 同样显示转圈', () => {
  render(<ToolStatusIcon status="pending" />);
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
});

test('ready → teal check(data-tool-status=done)', () => {
  const { container } = render(<ToolStatusIcon status="ready" />);
  const icon = container.querySelector('[data-tool-status="done"]');
  expect(icon).toBeInTheDocument();
  expect(icon).toHaveClass('text-[var(--color-teal)]');
});

test('error → danger warning(data-tool-status=error)', () => {
  const { container } = render(<ToolStatusIcon status="error" />);
  const icon = container.querySelector('[data-tool-status="error"]');
  expect(icon).toBeInTheDocument();
  expect(icon).toHaveClass('text-[var(--color-danger)]');
});

test('CollapseArrow 展开 → rotate-180', () => {
  const { container, rerender } = render(<CollapseArrow open={false} />);
  expect(container.querySelector('[data-collapse-arrow]')).not.toHaveClass('rotate-180');
  rerender(<CollapseArrow open />);
  expect(container.querySelector('[data-collapse-arrow]')).toHaveClass('rotate-180');
});
```

- [ ] **Step 5: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/toolPill.test.tsx`
Expected: FAIL（`toolPill` 模块 / 导出不存在）。

- [ ] **Step 6: 实现 `toolPill.tsx`**

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { FigIcon, figAsset } from '@/components/ui/figma';
import type { Status } from '@/store/types';

// 工具/思考块统一 pill 容器:收起(无正文)→ 全圆胶囊;有下方内容 → 卡片角。描边、无填充。
export function pillClass(expanded: boolean): string {
  return `border border-[var(--color-line)] px-4 py-2.5 text-[13px] ${expanded ? 'rounded-[16px]' : 'rounded-[30px]'}`;
}

// 进行中转圈:amber 头 + 中性轨;role=status 供无障碍与测试识别。
export function Spinner() {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      aria-label={t('chat.tool.running')}
      data-tool-status="running"
      className="inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--color-line-2)] border-t-[var(--color-warning)]"
    />
  );
}

// 左侧状态图标:进行中/等待=amber 转圈,失败=红 warning,完成=teal 勾。
// check/warning 走 FigIcon mask(primary=currentColor),由外层 text-* 决定色 → 随主题正确重着色。
export function ToolStatusIcon({ status }: { status: Status }) {
  if (status === 'generating' || status === 'pending') return <Spinner />;
  if (status === 'error')
    return (
      <span data-tool-status="error" className="flex shrink-0 text-[var(--color-danger)]">
        <FigIcon src={figAsset.warningSign} size={14} tone="primary" />
      </span>
    );
  return (
    <span data-tool-status="done" className="flex shrink-0 text-[var(--color-teal)]">
      <FigIcon src={figAsset.checkCircle} size={14} tone="primary" />
    </span>
  );
}

// 右侧折叠箭头:收起朝下,展开 180° 朝上;降低动态时去过渡。
export function CollapseArrow({ open }: { open: boolean }) {
  return (
    <span
      data-collapse-arrow
      className={`ml-auto flex shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
    >
      <FigIcon src={figAsset.arrowDown} size={12} />
    </span>
  );
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/chat/toolPill.test.tsx`
Expected: PASS（5 个用例）。

- [ ] **Step 8: 清理临时导出目录 + 提交**

```bash
rm -rf public/figma/_tmp_toolcall
git add public/figma/icons/check-circle.svg public/figma/icons/warning-sign.svg public/figma/icons/arrow-down.svg \
  src/components/ui/figma.tsx src/app/globals.css \
  src/components/chat/toolPill.tsx src/components/chat/toolPill.test.tsx
git commit -m "feat: 工具/思考 pill 共享原子——状态图标+折叠箭头+warning token"
```

---

## Task 2: ToolCard 采用 pill 样式

**Files:**
- Modify: `src/components/chat/ToolCard.tsx`
- Test: `src/components/chat/ToolCard.test.tsx`

**Interfaces:**
- Consumes: `pillClass`、`ToolStatusIcon`、`CollapseArrow`（Task 1）。

- [ ] **Step 1: 更新受影响测试 + 新增断言**

`src/components/chat/ToolCard.test.tsx` 里，把原「已完成 → 不显示旋转指示器,显示状态字」用例（约 25-29 行）整段替换为：
```tsx
test('已完成 → 不显示转圈,改显 teal check 状态图标(不再显示状态字)', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready' })} />);
  expect(screen.queryByRole('status', { name: 'Running' })).not.toBeInTheDocument();
  expect(container.querySelector('[data-tool-status="done"]')).toBeInTheDocument();
  expect(screen.queryByText('ready')).not.toBeInTheDocument();
});
```
并在文件末尾新增：
```tsx
test('失败 → 显示 danger warning 状态图标', () => {
  const { container } = render(<ToolCard part={tool({ status: 'error' })} />);
  expect(container.querySelector('[data-tool-status="error"]')).toBeInTheDocument();
});

test('有正文 → 右侧渲染折叠箭头,点击切换 aria-expanded', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready' })} />);
  expect(container.querySelector('[data-collapse-arrow]')).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: /Bash/ });
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-expanded', 'true');
});

test('无正文(无 diff 无参数)→ 不渲染折叠箭头', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready', input: undefined })} />);
  expect(container.querySelector('[data-collapse-arrow]')).toBeNull();
});
```
其余用例（转圈/参数/折叠/diff 文件名 +N -M/徽章/媒体/result 不渲染）保持不变。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ToolCard.test.tsx`
Expected: FAIL（新增 `data-tool-status`/`data-collapse-arrow` 断言与「不显示 ready」在旧实现下不满足）。

- [ ] **Step 3: 改写 `ToolCard.tsx`**

替换 9-77 行（`export default function ToolCard` 整体，`MediaItemView` 80 行起不动）为：
```tsx
export default function ToolCard({ part }: { part: Extract<Part, { type: 'tool' }> }) {
  const { t } = useTranslation();
  const running = part.status === 'generating';
  const errored = part.status === 'error';
  // 运行中 / 失败默认展开(展开后显示发起调用的参数),正常完成后自动折叠;用户仍可手动切换
  const [open, setOpen] = useState(running || errored);
  // 跟随状态切换:仅在 status 变化时自动调整展开态,不覆盖用户手动操作
  const [prevStatus, setPrevStatus] = useState(part.status);
  if (prevStatus !== part.status) {
    setPrevStatus(part.status);
    setOpen(part.status === 'generating' || part.status === 'error');
  }

  const diff = part.diff;
  const fileName = diff ? (diff.filePath.split('/').pop() || diff.filePath) : '';

  let argText = '';
  try { argText = part.input !== undefined ? JSON.stringify(part.input) : ''; } catch { argText = String(part.input); }

  // 可折叠正文:有 diff 时 diff 即正文(隐藏参数);否则仅展示参数(工具结果 result 只作中间处理、不展示;媒体不参与折叠,始终可见)
  const hasBody = Boolean(diff) || Boolean(argText);
  // 有下方内容(展开正文 或 始终可见的媒体)→ 卡片角;纯单行 → 全圆胶囊
  const showsBelow = (open && hasBody) || Boolean(part.media?.length);

  return (
    <div className={pillClass(showsBelow)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <ToolStatusIcon status={part.status} />
        <span className="font-medium">{part.name}</span>
        {diff && (
          <>
            <span className="min-w-0 truncate text-[var(--color-muted)]" title={diff.filePath}>{fileName}</span>
            <span className="shrink-0 text-[11px] text-emerald-600">+{diff.additions}</span>
            <span className="shrink-0 text-[11px] text-red-600">-{diff.deletions}</span>
            {diff.userModified && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-600">{t('chat.tool.userEdited')}</span>
            )}
          </>
        )}
        {hasBody && <CollapseArrow open={open} />}
      </button>
      {/* 可折叠正文:展开时挂载并下滑淡入(折叠即时卸载);仅 diff / 参数,工具结果 result 不展示;媒体始终可见,不参与折叠 */}
      {open && hasBody && (
        <div className="anim-collapse-in mt-1.5 space-y-2">
          {diff && <DiffView diff={diff} />}
          {/* 参数=送进工具的「投入」:压进凹槽、保持暗 muted */}
          {!diff && argText && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium tracking-[0.04em] text-[var(--color-muted)]">{t('chat.tool.input')}</div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--color-fill)] px-2 py-1.5 text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400)}</pre>
            </div>
          )}
        </div>
      )}
      {part.media?.map((item, i) => <MediaItemView key={i} item={item} />)}
    </div>
  );
}
```
并把顶部 import 补上（第 7 行 `import DiffView from './DiffView';` 之后）：
```tsx
import { pillClass, ToolStatusIcon, CollapseArrow } from './toolPill';
```
说明：删掉了原右侧的转圈 / `{part.status}` 状态字（改由左侧 `ToolStatusIcon` 表达），删掉了左侧文字 `▸/▾`（改为右侧 `CollapseArrow`）。`running`/`errored` 仅用于 `open` 初值，保留不删以维持折叠不变式。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ToolCard.test.tsx`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/ToolCard.tsx src/components/chat/ToolCard.test.tsx
git commit -m "feat: 工具调用块 pill 化——描边胶囊容器+左状态图标+右折叠箭头"
```

---

## Task 3: thinking 块统一成同款 pill

**Files:**
- Modify: `src/components/chat/ThinkingBlock.tsx`
- Test: `src/components/chat/ThinkingBlock.test.tsx`

**Interfaces:**
- Consumes: `pillClass`、`Spinner`、`CollapseArrow`（Task 1）、`figAsset.sparkle`（已有）。

- [ ] **Step 1: 重写测试 `ThinkingBlock.test.tsx`**

整文件替换为：
```tsx
import { expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThinkingBlock from './ThinkingBlock';

test('展示英文 Thinking 标签', () => {
  render(<ThinkingBlock text="推理内容ABC" streaming />);
  expect(screen.getByText('Thinking')).toBeInTheDocument();
});

test('流式中 → 自动展开显示思考文本 + 转圈', () => {
  render(<ThinkingBlock text="推理内容ABC" streaming />);
  expect(screen.getByText('推理内容ABC')).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
});

test('完成(非流式)→ 自动收起,思考文本隐藏且无转圈', () => {
  render(<ThinkingBlock text="推理内容ABC" streaming={false} />);
  expect(screen.queryByText('推理内容ABC')).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Running' })).not.toBeInTheDocument();
});

test('收起态 → 点击标题手动展开', () => {
  render(<ThinkingBlock text="推理内容ABC" />);
  expect(screen.queryByText('推理内容ABC')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
  expect(screen.getByText('推理内容ABC')).toBeInTheDocument();
});

test('流式结束(streaming true → false)→ 自动收起', () => {
  const { rerender } = render(<ThinkingBlock text="推理内容ABC" streaming />);
  expect(screen.getByText('推理内容ABC')).toBeInTheDocument();
  rerender(<ThinkingBlock text="推理内容ABC" streaming={false} />);
  expect(screen.queryByText('推理内容ABC')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ThinkingBlock.test.tsx`
Expected: FAIL（旧实现始终展示文本、无折叠、无 `role=status`）。

- [ ] **Step 3: 改写 `ThinkingBlock.tsx`**

整文件替换为：
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FigIcon, figAsset } from '@/components/ui/figma';
import { pillClass, Spinner, CollapseArrow } from './toolPill';

export default function ThinkingBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  // 跟随流式状态:流式中自动展开,结束自动收起(与工具卡一致);渲染期 guard setState,不用 effect(见项目 lint 约束)
  const [open, setOpen] = useState(streaming);
  const [prevStreaming, setPrevStreaming] = useState(streaming);
  if (prevStreaming !== streaming) {
    setPrevStreaming(streaming);
    setOpen(streaming);
  }
  // 流式输出且展开时自动滚动到底部,跟随最新思考内容
  useEffect(() => {
    if (streaming && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, streaming, open]);

  return (
    <div className={pillClass(open)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {/* 流式中=amber 转圈;完成=sparkle(中性灰,thinking 非成功/失败语义) */}
        {streaming ? (
          <Spinner />
        ) : (
          <span className="flex shrink-0"><FigIcon src={figAsset.sparkle} size={14} tone="secondary" /></span>
        )}
        <span className="font-medium">{t('chat.thinking')}</span>
        <CollapseArrow open={open} />
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="anim-collapse-in scrollbar-auto mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] text-[var(--color-muted)]"
        >
          {text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ThinkingBlock.test.tsx`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/ThinkingBlock.tsx src/components/chat/ThinkingBlock.test.tsx
git commit -m "feat: thinking 块统一为同款可折叠 pill——流式展开/完成收起+状态图标"
```

---

## Task 4: 全量校验 + 设计对齐核对

**Files:**（临时，验证后删除）
- Create/Delete: `src/app/_dev-toolpill/page.tsx`（scratch 预览页）

- [ ] **Step 1: 全量检查**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: 三者全绿。（勿只信 IDE 诊断，见 [[worktree-ide-diagnostics-false-positive]]。）

- [ ] **Step 2: 建 scratch 预览页**

`src/app/_dev-toolpill/page.tsx`：
```tsx
'use client';
import ToolCard from '@/components/chat/ToolCard';
import ThinkingBlock from '@/components/chat/ThinkingBlock';
import type { Part } from '@/store/types';

const t = (o: Partial<Extract<Part, { type: 'tool' }>>): Extract<Part, { type: 'tool' }> =>
  ({ type: 'tool', id: 't', name: 'Search asset json writer skill', input: { q: 'x' }, status: 'ready', ...o });

export default function DevToolPill() {
  return (
    <div className="mx-auto flex max-w-[320px] flex-col gap-3 p-6">
      <ToolCard part={t({ status: 'generating' })} />
      <ToolCard part={t({ status: 'ready' })} />
      <ToolCard part={t({ status: 'error' })} />
      <ThinkingBlock text={'思考中的一段较长文本…\n'.repeat(6)} streaming />
      <ThinkingBlock text="已完成的思考文本" streaming={false} />
    </div>
  );
}
```

- [ ] **Step 3: 起 prod-mode 服务并截图**

Run（后台，端口须空闲，见 [[runtime-verification-local-gotchas]]）：`NODE_ENV=production pnpm exec tsx server.ts`
用 Playwright 打开 `http://localhost:3000/_dev-toolpill`，浅色 + 深色（`document.documentElement.dataset.theme='dark'`）各截一张。

- [ ] **Step 4: 逐项比对（按 [[verify-design-alignment-before-claiming]] 列对照表）**

取 Figma `647-26026/26029/26034` 精确 px 与截图逐项核对，至少覆盖：容器圆角（收起 30 / 展开 16）、`border --color-line` 无填充、`px-16 py-10`、左图标色（amber/teal/红）、右 `arrow-down` 贴右、thinking 收起为单行 pill。列 `属性 | 设计 | 实测 | ✓/✗` 表，有差异回对应 Task 修正。

- [ ] **Step 5: 删 scratch 页 + 停服**

```bash
rm -rf src/app/_dev-toolpill
```
停掉后台 server。scratch 页不进版本库，无需提交。

---

## Self-Review

**1. Spec coverage：**
- 容器 pill 样式（圆角/边框/无填充/padding）→ Task 1 `pillClass` + Task 2/3 应用 ✓
- 左状态图标（amber/teal/红）→ Task 1 `ToolStatusIcon`/`Spinner` + Task 2 应用 ✓
- 右折叠箭头（移到右侧、旋转）→ Task 1 `CollapseArrow` + Task 2/3 ✓
- 三枚图标资产 + figAsset + ICON_TONE → Task 1 Step 1-2 ✓
- `--color-warning` token → Task 1 Step 3 ✓
- thinking 统一（同款 pill + 流式展开/完成收起 + sparkle）→ Task 3 ✓
- 文案/折叠行为不变 → Task 2/3 保留原文案与 `open` 逻辑 ✓
- 清理临时导出 → Task 1 Step 8 ✓
- 设计对齐核对 → Task 4 ✓

**2. Placeholder scan：** 无 TBD/TODO；所有代码步给出完整代码；SVG 内容为实测导出。

**3. Type consistency：** `pillClass(boolean)`、`ToolStatusIcon({status: Status})`、`CollapseArrow({open: boolean})`、`Spinner()` 在 Task 1 定义，Task 2/3 按同名同签名消费；`figAsset.checkCircle/warningSign/arrowDown` 命名前后一致；`data-tool-status`（running/done/error）与 `data-collapse-arrow` 在实现与测试间一致。
