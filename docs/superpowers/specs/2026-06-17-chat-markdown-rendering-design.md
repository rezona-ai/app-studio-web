# 对话消息 Markdown 渲染设计

日期：2026-06-17
状态：已与 Nick 确认方向（助手 + 用户消息均走完整 GFM；流式增量重解析；代码块不做语法高亮；抽共享 `<Markdown>` 组件）

## 背景

当前对话消息（`MessageItem.tsx`）的文本渲染走手写的 `renderInline`（`RichText.tsx`）：**只支持 `**加粗**`、单换行 → `<br>`、空行 → 分段**。其余 markdown 语法（标题、列表、代码块、行内码、链接、引用、表格等）会原样显示字面符号。助手消息（`StreamingText.tsx`）在此基础上套了 `useTypewriter` 的打字机渐显（head 已定稿 / tail 逐字淡入，按段落 `\n\n` 切分），并在流式期剥离 `*` 以避免字面星号闪烁。

LLM 输出普遍带标题 / 列表 / 代码块，现状导致这些内容渲染为带原始符号的纯文本。本期让**助手与用户消息**统一支持**完整 GFM**渲染。

## 已确认的方向（来自需求澄清）

- **范围**：助手消息 + 用户消息都走 markdown 渲染。
- **语法档位**：完整 GFM（标题、有序/无序列表、行内码、代码块、加粗/斜体、链接、引用、表格、任务列表、删除线等）。
- **流式策略**：**增量重解析**——流式期把「已揭示文本」整体过 `react-markdown` 重新渲染，保留打字机的揭示节奏，但**舍弃字符级淡入**，改在尾部加一个闪烁光标。
- **代码块**：**不引入语法高亮库**，只用主题色等宽字体 + 背景框。
- **集成方式**：抽一个共享 `<Markdown>` 组件，`RichText` / `StreamingText` 都委托它（渲染逻辑与样式单点收敛）。

## 核心设计决策

- **不直接用 `@tailwindcss/typography`（prose）**：prose 默认排版与现有主题 token（`--color-ink` / `--color-fill` / `--color-surface-2` 等）对不齐，需大量 `prose-*` override；改为手写 `components` 映射，精确贴合现有 token 与字号。
- **不解析裸 HTML**（不加 `rehype-raw`）：react-markdown 默认即把 `<script>` 等当纯文本输出 → XSS 安全；链接经默认 `urlTransform` 过滤危险协议（`javascript:` 等被剥离）。这是安全基线，不退让。
- **流式期不再做 head/tail 淡入与 `*` 剥离**：增量重解析下，未闭合的 markdown 由解析器自然处理（短暂显示字面 `**`，闭合后成型），无需手动剥符号。`useTypewriter` 仅保留**节奏控制**职能。

## 整体架构

### 1. 依赖

新增 `react-markdown` + `remark-gfm`（均 ESM，兼容 React 19 / Next 16 / Vitest jsdom）。**不引高亮库。**

### 2. `src/components/chat/Markdown.tsx`（新，纯展示组件）

```tsx
'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 主题 token 映射:贴合现有字号与 --color-* 变量;不解析裸 HTML(默认即安全)
const MD_COMPONENTS = { /* h1–h6 / p / ul·ol·li / a / code / pre / blockquote / table 全家 / strong / em / del / hr */ };

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

- 组件映射要点：
  - `a`：`target="_blank" rel="noopener noreferrer"`，主题强调色 + 下划线。
  - `code`：区分**行内码**（`--color-fill` 小胶囊）与**代码块**（在 `pre` 内，`--color-surface-2` 底、等宽、可横向滚动）。react-markdown v9 通过 `code` 是否被 `pre` 包裹判定块级；用 `pre` 承载块级容器样式。
  - `ul/ol`：恢复列表缩进与圆点/序号（Tailwind reset 会清掉，需显式 `list-disc/list-decimal pl-*`）。
  - `table`：边框 + 表头底色（`--color-line` / `--color-surface-2`），`overflow-x-auto` 容器避免撑破聊天栏。
  - `blockquote`：左竖线（`--color-line-2`）+ `--color-muted` 文字。
  - 块间距与现有 `RichText` 的 `space-y-3` 观感一致。
- 段落字号承接调用方传入的 `className`（现有 `TEXT = text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]`）。

### 3. `src/components/chat/RichText.tsx`（用户消息,非流式)

- 删除内部 `renderInline` / 分段逻辑，整体替换为委托：

```tsx
export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  return <Markdown text={text} className={className} />;
}
```

- `MessageItem` 中 `extractRefs` 先把 `@` 资产引用剥离成顶部 chip 的流程**不变**，剩余正文交给 `RichText` → `Markdown`。
- `renderInline` 原由 `RichText` 导出、被 `StreamingText` 复用；两处都改用 `Markdown` 后，`renderInline` 成为 dead code，**一并删除**（不留废代码）。

### 4. `src/components/chat/StreamingText.tsx`（助手消息,流式)

- 保留 `useTypewriter` 做**节奏控制**；取其揭示出的「已揭示前缀」：`revealed = head + tail.map(c => c.text).join('')`。
- 整体喂 `<Markdown text={revealed} />`；流式未结束（`streaming && revealed.length < text.length`）时在内容尾部追加一个 `md-caret` 闪烁光标。
- 移除 head/tail 淡入 span 与 `*` 剥离逻辑。

```tsx
export default function StreamingText({ text, streaming, className = '' }: {...}) {
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

- `useTypewriter` 的 `head`/`tail` 公共 API **保持不变**（仅 `StreamingText` 在用），无需改 hook 内部；本组件不再区分 head/tail 的渲染差异，只拼成揭示前缀。

### 5. `src/app/globals.css`

- 新增 `.md` 作用域下的少量补充样式（若 Tailwind 类不便表达的部分，如代码块滚动条、列表内段落间距微调）。
- 新增 `.md-caret` 闪烁光标 keyframe（细竖条，`--color-ink`,约 1s 闪烁;`prefers-reduced-motion` 下不闪）。

## 数据流

```
用户消息: parts.text ──extractRefs──▶ {chips, 正文} ──▶ RichText ──▶ Markdown(react-markdown + remark-gfm)
助手消息: parts.text ──useTypewriter(节奏)──▶ revealed 前缀 ──▶ StreamingText ──▶ Markdown ──▶ (流式期)尾部 md-caret
```

## 取舍（已确认 / 需知晓）

- **增量重解析的代价**：流式打到一半的 `**粗` 在闭合 `**` 到达前会短暂显示字面 `**`，闭合后成型。这是选「增量重解析」的预期行为，可接受。
- **每 tick 全量重解析的开销**：消息很长时有轻微解析成本；`useTypewriter` 仅在揭示内容变化时推视图、且按段界 snap，churn 可控。perf（如按已完成块缓存）留作后续优化，不在本期。
- **`prefers-reduced-motion`**：`useTypewriter` 已在该模式下直接全量返回（无打字机）；此时 `revealed === text`，光标自然不显示，行为一致。

## 测试（同目录 TDD，vitest + jsdom）

- **`Markdown.test.tsx`（新）**：
  - 标题 `# H1` → `<h1>`;无序/有序列表 → `<ul>/<ol>` 含 `<li>`;行内码 → `<code>`;围栏代码块 → `<pre><code>`;`**粗**`/`*斜*` → `<strong>/<em>`;引用 → `<blockquote>`;GFM 表格 → `<table>`;任务列表 / 删除线。
  - 链接：`<a>` 带 `target="_blank"` 且 `rel` 含 `noopener`。
  - **XSS 断言**：输入含 `<script>alert(1)</script>` / `<img onerror=...>` → 不产生对应 DOM 元素，按文本渲染；`[x](javascript:alert(1))` 的 href 被剥离/不可执行。
- **`StreamingText.test.tsx`（改写）**：删除 `tw-fade` 与「剥离 `*`」两条断言（机制已移除）。新增：流式期推进定时器后已揭示文本出现于 DOM；流式未完时存在 `.md-caret`;`streaming={false}` 全量渲染且无光标;`**加粗**` 仍渲染为 `<strong>`。
- **`MessageItem.test.tsx`（基本不动）**：`**加粗** → STRONG`、`@key → chip 且正文剥离`、思考块流式等断言天然继续通过（markdown 同样产出 `<strong>`，文本节点仍可被 `getByText` 命中）。如个别断言因 markdown 包裹层级变化而失配，做最小调整。

## YAGNI 取舍

- **不做语法高亮**：代码块仅等宽 + 背景框（已确认）。
- **不加 `rehype-raw` / 裸 HTML 渲染**：安全优先,且 LLM/用户输入无需内嵌 HTML。
- **不做「按已完成块增量缓存」的流式优化**：增量全量重解析已够用,perf 留后续。
- **不引入 `@tailwindcss/typography`**：手写 components 映射更贴合主题 token。
- **不改 `useTypewriter` 公共 API**：仅复用其节奏控制,head/tail 拼成揭示前缀即可。
