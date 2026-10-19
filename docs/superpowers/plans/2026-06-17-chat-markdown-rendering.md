# 对话消息 Markdown 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让对话栏的助手与用户消息支持完整 GFM markdown 渲染,流式期增量重解析 + 尾部光标。

**Architecture:** 抽一个共享纯展示组件 `<Markdown>`（`react-markdown` + `remark-gfm`，主题 token 映射，不解析裸 HTML）。`RichText`（用户消息，非流式）与 `StreamingText`（助手消息，流式）都委托它；`StreamingText` 用 `useTypewriter` 控制揭示节奏，把已揭示前缀整体喂给 `<Markdown>`，未完时尾部追加闪烁光标。删除旧的 `renderInline` 手写解析。

**Tech Stack:** Next 16 / React 19 / TypeScript / Tailwind v4 / `react-markdown` ^9 / `remark-gfm` ^4 / Vitest + jsdom + RTL。

## Global Constraints

- 代码注释 / 计划 / commit message 一律用**中文**;commit 一句话总结。
- 测试与源码**同目录**(`*.test.tsx`),Vitest + jsdom + RTL,`@` → `src` 别名。
- **不解析裸 HTML**:不引入 `rehype-raw`(react-markdown 默认即把裸 HTML 当非可执行内容处理),保证 XSS 安全。
- **不引入语法高亮库**:代码块仅主题色等宽字体 + 背景框。
- **不引入 `@tailwindcss/typography`**:手写 `components` 映射贴合现有主题 token。
- 主题色用现有 CSS 变量:`--color-ink` / `--color-muted` / `--color-fill` / `--color-surface-2` / `--color-line` / `--color-line-2` / `--color-accent`。
- 现有正文排版常量 `TEXT = 'text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]'`(`MessageItem.tsx`)作为 `className` 传入,本计划不改它。
- react-markdown v9 的自定义 `components` 会收到 `node` prop;务必从 props 中**解构剔除 `node`** 再展开到 DOM 元素,否则 React 报未知 prop 警告。

---

### Task 1: 共享 `<Markdown>` 组件 + 主题样式

**Files:**
- Modify: `package.json`（新增 `react-markdown` / `remark-gfm` 依赖）
- Create: `src/components/chat/Markdown.tsx`
- Create: `src/components/chat/Markdown.test.tsx`
- Modify: `src/app/globals.css`（追加 `.md` 作用域样式 + `.md-caret` 光标）

**Interfaces:**
- Produces: `Markdown`（default export）— `({ text, className? }: { text: string; className?: string }) => JSX.Element`，渲染 GFM markdown，外层 `<div className={`md ${className}`}>`。
- Produces（CSS）：`.md-caret` 闪烁光标类（供 Task 2 的 `StreamingText` 使用）。

- [ ] **Step 1: 安装依赖**

Run:
```bash
pnpm add react-markdown remark-gfm
```
Expected: `package.json` 出现 `react-markdown`（^9）与 `remark-gfm`（^4）。

- [ ] **Step 2: 写失败测试 `Markdown.test.tsx`**

Create `src/components/chat/Markdown.test.tsx`:
```tsx
import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from './Markdown';

test('标题渲染为 h1', () => {
  const { container } = render(<Markdown text="# 大标题" />);
  expect(container.querySelector('h1')?.textContent).toBe('大标题');
});

test('无序列表渲染为 ul>li', () => {
  const { container } = render(<Markdown text={'- 一\n- 二'} />);
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
});

test('有序列表渲染为 ol>li', () => {
  const { container } = render(<Markdown text={'1. 甲\n2. 乙'} />);
  expect(container.querySelector('ol')).toBeTruthy();
  expect(container.querySelectorAll('ol li')).toHaveLength(2);
});

test('行内码渲染为 code', () => {
  const { container } = render(<Markdown text={'用 `pnpm dev` 启动'} />);
  expect(container.querySelector('code')?.textContent).toBe('pnpm dev');
});

test('围栏代码块渲染为 pre>code', () => {
  const { container } = render(<Markdown text={'```\nconst a = 1\n```'} />);
  expect(container.querySelector('pre code')?.textContent).toContain('const a = 1');
});

test('加粗与斜体', () => {
  render(<Markdown text="**粗** 和 *斜*" />);
  expect(screen.getByText('粗').tagName).toBe('STRONG');
  expect(screen.getByText('斜').tagName).toBe('EM');
});

test('引用渲染为 blockquote', () => {
  const { container } = render(<Markdown text="> 引用内容" />);
  expect(container.querySelector('blockquote')?.textContent).toContain('引用内容');
});

test('GFM 表格渲染为 table', () => {
  const md = '| A | B |\n| - | - |\n| 1 | 2 |';
  const { container } = render(<Markdown text={md} />);
  expect(container.querySelector('table')).toBeTruthy();
  expect(container.querySelectorAll('tbody td')).toHaveLength(2);
});

test('GFM 删除线渲染为 del', () => {
  const { container } = render(<Markdown text="~~删了~~" />);
  expect(container.querySelector('del')?.textContent).toBe('删了');
});

test('链接带 target=_blank 与 rel=noopener', () => {
  const { container } = render(<Markdown text="[去](https://a.com)" />);
  const a = container.querySelector('a')!;
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toContain('noopener');
});

test('XSS:裸 <script> 不产生可执行 script 元素', () => {
  const { container } = render(<Markdown text={'前 <script>window.__x=1</script> 后'} />);
  expect(container.querySelector('script')).toBeNull();
});

test('XSS:裸 <img onerror> 不产生 img 元素', () => {
  const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} />);
  expect(container.querySelector('img')).toBeNull();
});

test('XSS:javascript: 链接 href 被剥离', () => {
  const { container } = render(<Markdown text="[x](javascript:alert(1))" />);
  const a = container.querySelector('a');
  expect(a?.getAttribute('href') ?? '').not.toContain('javascript:');
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/Markdown.test.tsx`
Expected: FAIL —— 无法解析模块 `./Markdown`（文件尚未创建）。

- [ ] **Step 4: 实现 `Markdown.tsx`**

Create `src/components/chat/Markdown.tsx`:
```tsx
'use client';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 主题 token 映射:贴合现有字号与 --color-* 变量。
// 不解析裸 HTML(未引入 rehype-raw) → XSS 安全。
// react-markdown v9 会传 node prop;统一解构剔除后再展开到 DOM 元素,避免 React 未知 prop 警告。
const MD_COMPONENTS: Components = {
  h1: ({ node, ...p }) => <h1 className="mt-2 mb-1 text-[19px] font-semibold leading-tight" {...p} />,
  h2: ({ node, ...p }) => <h2 className="mt-2 mb-1 text-[17px] font-semibold leading-tight" {...p} />,
  h3: ({ node, ...p }) => <h3 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...p} />,
  h4: ({ node, ...p }) => <h4 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...p} />,
  h5: ({ node, ...p }) => <h5 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...p} />,
  h6: ({ node, ...p }) => <h6 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...p} />,
  p: ({ node, ...p }) => <p className="my-2" {...p} />,
  ul: ({ node, ...p }) => <ul className="my-2 list-disc pl-5" {...p} />,
  ol: ({ node, ...p }) => <ol className="my-2 list-decimal pl-5" {...p} />,
  li: ({ node, ...p }) => <li className="my-0.5" {...p} />,
  a: ({ node, href, ...p }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--color-accent)] underline underline-offset-2"
      {...p}
    />
  ),
  strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  del: ({ node, ...p }) => <del className="opacity-70" {...p} />,
  hr: ({ node, ...p }) => <hr className="my-3 border-[var(--color-line)]" {...p} />,
  blockquote: ({ node, ...p }) => (
    <blockquote className="my-2 border-l-2 border-[var(--color-line-2)] pl-3 text-[var(--color-muted)]" {...p} />
  ),
  code: ({ node, ...p }) => (
    <code className="rounded bg-[var(--color-fill)] px-1 py-0.5 font-mono text-[13px]" {...p} />
  ),
  pre: ({ node, ...p }) => (
    <pre className="my-2 overflow-x-auto rounded-[8px] bg-[var(--color-surface-2)] p-3 font-mono text-[13px] leading-5" {...p} />
  ),
  table: ({ node, ...p }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]" {...p} />
    </div>
  ),
  thead: ({ node, ...p }) => <thead className="bg-[var(--color-surface-2)]" {...p} />,
  th: ({ node, ...p }) => <th className="border border-[var(--color-line)] px-2 py-1 text-left font-semibold" {...p} />,
  td: ({ node, ...p }) => <td className="border border-[var(--color-line)] px-2 py-1" {...p} />,
};

export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: 追加 `.md` 作用域样式到 `globals.css`**

在 `src/app/globals.css` 末尾追加:
```css
/* 对话消息 markdown 渲染:首尾块去外边距,避免气泡内上下多余空白 */
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
/* 围栏代码块内的 code 不套行内胶囊样式(容器外观由 pre 承载) */
.md pre code { background: transparent; padding: 0; font-size: inherit; border-radius: 0; }

/* 流式尾部光标:细竖条,1s 闪烁;降低动态时不闪 */
.md-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: var(--color-ink);
  animation: md-caret-blink 1s steps(2, start) infinite;
}
@keyframes md-caret-blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .md-caret { animation: none; } }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/Markdown.test.tsx`
Expected: PASS（全部用例）。

- [ ] **Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml src/components/chat/Markdown.tsx src/components/chat/Markdown.test.tsx src/app/globals.css
git commit -m "feat: 新增共享 Markdown 组件,对话消息支持 GFM 渲染"
```

---

### Task 2: `StreamingText` 改用 Markdown + 尾部光标

**Files:**
- Modify: `src/components/chat/StreamingText.tsx`（整体重写渲染逻辑）
- Modify: `src/components/chat/StreamingText.test.tsx`（改写断言）

**Interfaces:**
- Consumes: `Markdown`（Task 1）；`useTypewriter`（`@/client/useTypewriter`，签名 `(target: string, active: boolean) => { head: string; tail: { id: number; text: string }[] }`）；CSS 类 `.md-caret`（Task 1）。
- Produces: `StreamingText`（default export）— `({ text, streaming, className? }: { text: string; streaming: boolean; className?: string }) => JSX.Element`，API 不变。

- [ ] **Step 1: 改写测试 `StreamingText.test.tsx`**

整体替换 `src/components/chat/StreamingText.test.tsx` 为:
```tsx
import { afterEach, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import StreamingText from './StreamingText';
import { TYPEWRITER } from '@/client/useTypewriter';

afterEach(() => {
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

test('非流式 → 全量 markdown:**加粗** 渲染为 strong,无尾部光标', () => {
  const { container } = render(<StreamingText text={'**粗体** 普通'} streaming={false} />);
  expect(container.querySelector('strong')?.textContent).toBe('粗体');
  expect(container.querySelector('.md-caret')).toBeNull();
});

test('非流式 → 标题与列表正常成型', () => {
  const { container } = render(<StreamingText text={'# 标题\n\n- 项一\n- 项二'} streaming={false} />);
  expect(container.querySelector('h1')?.textContent).toBe('标题');
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
});

test('流式中:已揭示文本逐步出现,且存在尾部光标', () => {
  vi.useFakeTimers();
  const { container } = render(<StreamingText text="hello world" streaming />);
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 5));
  expect(container.textContent).toContain('hel');
  expect(container.querySelector('.md-caret')).toBeTruthy();
});

test('流式打完且渐显窗口过后:全文可见,光标消失', () => {
  vi.useFakeTimers();
  const { container } = render(<StreamingText text="hello" streaming />);
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 20));
  act(() => vi.advanceTimersByTime(TYPEWRITER.FADE_MS * 2));
  expect(container.textContent).toContain('hello');
  expect(container.querySelector('.md-caret')).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/StreamingText.test.tsx`
Expected: FAIL —— 旧实现无 `.md-caret`，且 `<h1>`/`<ul>` 断言不成立（旧实现只做 `**加粗**` + 分段）。

- [ ] **Step 3: 重写 `StreamingText.tsx`**

整体替换 `src/components/chat/StreamingText.tsx` 为:
```tsx
'use client';
import Markdown from './Markdown';
import { useTypewriter } from '@/client/useTypewriter';

// 流式期保留打字机的揭示节奏,但渲染走 Markdown:把已揭示前缀整体重解析。
// 不再做字符级淡入与 * 剥离(未闭合的 markdown 由解析器自然处理),改在尾部加闪烁光标。
export default function StreamingText({
  text,
  streaming,
  className = '',
}: {
  text: string;
  streaming: boolean;
  className?: string;
}) {
  const { head, tail } = useTypewriter(text, streaming);
  const revealed = head + tail.map((c) => c.text).join('');
  const showCaret = streaming && revealed.length < text.length;
  return (
    <div className={className}>
      <Markdown text={revealed} />
      {showCaret && <span className="md-caret" aria-hidden />}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/StreamingText.test.tsx`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/StreamingText.tsx src/components/chat/StreamingText.test.tsx
git commit -m "feat: 助手消息流式渲染改用 Markdown 增量重解析 + 尾部光标"
```

---

### Task 3: `RichText` 委托 Markdown + 删除 `renderInline`

**Files:**
- Modify: `src/components/chat/RichText.tsx`（删除 `renderInline` 与分段逻辑，委托 `Markdown`）
- Modify: `src/components/chat/MessageItem.test.tsx`（仅在 markdown 包裹导致断言失配时做最小调整）

**Interfaces:**
- Consumes: `Markdown`（Task 1）。
- Produces: `RichText`（default export）— `({ text, className? }: { text: string; className?: string }) => JSX.Element`，API 不变。**不再导出 `renderInline`**（Task 2 后已无消费者）。

- [ ] **Step 1: 确认 `renderInline` 已无外部消费者**

Run: `grep -rn "renderInline" src --include="*.tsx" --include="*.ts"`
Expected: 仅 `src/components/chat/RichText.tsx` 内部出现（Task 2 已让 `StreamingText` 不再引用它）。若仍有其他文件命中，先处理掉再继续。

- [ ] **Step 2: 重写 `RichText.tsx`**

整体替换 `src/components/chat/RichText.tsx` 为:
```tsx
'use client';
import Markdown from './Markdown';

// 用户消息正文(非流式):委托共享 Markdown 组件做 GFM 渲染。
// 资产 @ 引用的剥离与 chip 渲染仍在 MessageItem 中完成,这里只渲染剩余正文。
export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  return <Markdown text={text} className={className} />;
}
```

- [ ] **Step 3: 跑相关测试确认仍绿**

Run: `pnpm exec vitest run src/components/chat/MessageItem.test.tsx`
Expected: PASS。（注:项目无 `RichText.test.tsx`，`RichText` 的行为由 `MessageItem.test.tsx` 的用户消息用例覆盖。）
说明:`**加粗** → STRONG`、`@key → chip 且正文剥离`、纯文本等断言天然继续通过(markdown 同样产出 `<strong>`,文本节点仍可被 `getByText` 命中)。
若个别断言因 markdown 多包了一层块级元素而失配(例如 `getByText` 跨节点),做**最小**调整:改用 `container.textContent` 包含断言或更精确的选择器,不改变测试意图。

- [ ] **Step 4: 提交**

```bash
git add src/components/chat/RichText.tsx src/components/chat/MessageItem.test.tsx
git commit -m "feat: 用户消息改用 Markdown 渲染,移除手写 renderInline"
```

---

### Task 4: 全量验证

**Files:** 无（仅运行检查）

- [ ] **Step 1: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。重点确认 `Components` 类型映射、`node` 解构无类型报错。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 3: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS（含新增 `Markdown.test.tsx`、改写的 `StreamingText.test.tsx`、未受影响的 `MessageItem.test.tsx` 等）。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: 构建成功（验证 react-markdown ESM 在 Next 16 生产构建下正常打包）。

- [ ] **Step 5: 人工验证（可选但推荐）**

Run: `pnpm dev`，在对话里让 agent 输出含标题 / 列表 / 代码块 / 表格 / 链接的消息,确认:
- 流式期文本逐步揭示、尾部有闪烁光标、块级元素边打边成型;
- 完成后无光标、代码块有背景框、链接新标签页打开;
- 浅色 / 深色主题下配色正常。

---

## 备注:风险与回退

- **react-markdown v9 的 `code` inline/block 判定**:本方案不在 JS 里区分 inline/block,而是 `code` 统一套行内胶囊样式,再用 CSS `.md pre code` 在围栏块内重置掉胶囊外观。这样无需依赖 v9 是否传 `inline` prop(v9 已移除该 prop),更稳。
- **流式半截语法闪烁**:未闭合的 `**`/围栏在闭合前短暂显示字面符号,闭合后成型——这是「增量重解析」既定取舍(见 spec)。
- **每 tick 重解析开销**:`useTypewriter` 仅在揭示内容变化时推视图、且按段界 snap,churn 可控;如后续遇长消息性能问题,再考虑按已完成块缓存,不在本期。
