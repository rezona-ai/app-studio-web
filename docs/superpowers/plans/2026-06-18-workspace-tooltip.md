# Workspace 图标按钮气泡提示（Tooltip）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Workspace 三栏内所有「无可见文字标签」的图标按钮/控件，增加 hover / focus 触发的可视气泡提示。

**Architecture:** 新建一个依赖无关的 `<Tooltip>` 通用 UI 原语：用 `createPortal` 把气泡渲到 `document.body`（不被 overflow 裁剪），hover/focus 监听挂在**外包 span** 上（解决 disabled 按钮 hover 不触发），但**定位测量外包 span 的第一个子元素**（兼容 `absolute` 定位的触发）。气泡文案优先用显式 `label`，缺省回退读子元素的 `aria-label`（单一真相源）。然后按栏逐一接入约 18 处图标按钮。

**Tech Stack:** Next 16 + React 19 + TypeScript；`createPortal`（react-dom）；Tailwind v4 + CSS 设计 token；Vitest + jsdom + @testing-library/react。

## Global Constraints

- 零新增依赖（不引入 Radix / Floating UI）。
- 代码注释 / commit message 一律用**中文**；commit 一句话总结。
- 复用设计 token：`--color-pop` / `--color-ink` / `--color-line` / `--shadow-popover`。
- `aria-label` 为单一文案真相源；气泡纯视觉，`aria-hidden`，不改动任何现有 `aria-label`。
- 测试与源码同目录（`*.test.tsx`），Vitest globals + jsdom。
- 范围仅 Workspace 三栏（`src/components/workspace|chat|canvas|preview/`），不动 landing。

---

### Task 1: Tooltip 通用组件（TDD）

**Files:**
- Create: `src/components/ui/Tooltip.tsx`
- Test: `src/components/ui/Tooltip.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // 默认导出
  export default function Tooltip(props: {
    label?: string;                 // 气泡文案;缺省时回退读 children 的 aria-label
    side?: 'top' | 'bottom';        // 默认 'top';触发元素贴近视口顶部时自动翻转到 bottom
    children: ReactElement;         // 唯一触发子元素(IconButton / button / span[role=button] 等)
  }): ReactElement;
  ```
  行为契约：无任何文案来源（label 与子元素 aria-label 均无）时，原样透传 children、不包裹、不显示气泡。

- [ ] **Step 1: 写失败测试**

创建 `src/components/ui/Tooltip.test.tsx`：

```tsx
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import Tooltip from './Tooltip';

// 触发外包 span:render 返回 container 的第一个子节点
function trigger(container: HTMLElement) {
  return container.firstChild as HTMLElement;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
  cleanup();
});

// 推进打开延时(350ms)
function advanceOpen() {
  act(() => vi.advanceTimersByTime(400));
}

describe('Tooltip', () => {
  it('渲染子元素', () => {
    render(<Tooltip label="发送"><button aria-label="发送">x</button></Tooltip>);
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('hover 经过延时后显示气泡文案', () => {
    const { container } = render(<Tooltip label="发送"><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    expect(screen.queryByText('发送')).not.toBeInTheDocument(); // 延时内不显示
    advanceOpen();
    expect(screen.getByText('发送')).toBeInTheDocument();
  });

  it('无 label 时回退读子元素 aria-label', () => {
    const { container } = render(<Tooltip><button aria-label="提及">x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('提及')).toBeInTheDocument();
  });

  it('显式 label 覆盖 aria-label', () => {
    const { container } = render(
      <Tooltip label="提及一个资产"><button aria-label="提及">x</button></Tooltip>,
    );
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('提及一个资产')).toBeInTheDocument();
    expect(screen.queryByText('提及')).not.toBeInTheDocument();
  });

  it('mouseleave 后隐藏气泡', () => {
    const { container } = render(<Tooltip label="发送"><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('发送')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger(container));
    expect(screen.queryByText('发送')).not.toBeInTheDocument();
  });

  it('包裹 disabled 按钮时 hover 外包仍触发气泡', () => {
    const { container } = render(
      <Tooltip label="发送"><button disabled>x</button></Tooltip>,
    );
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('发送')).toBeInTheDocument();
  });

  it('气泡为纯视觉:带 aria-hidden', () => {
    const { container } = render(<Tooltip label="发送"><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('发送')).toHaveAttribute('aria-hidden', 'true');
  });

  it('无任何文案来源时透传子元素、不显示气泡', () => {
    const { container } = render(<Tooltip><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.queryByText('x')).toBeInTheDocument(); // 子元素仍在
    // 没有额外气泡节点(body 下除按钮外无其它文本节点),此处仅断言不抛错且子元素存在
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/ui/Tooltip.test.tsx`
Expected: FAIL（`Cannot find module './Tooltip'` 或解析失败）。

- [ ] **Step 3: 实现 Tooltip 组件**

创建 `src/components/ui/Tooltip.tsx`：

```tsx
'use client';
import { useState, useRef, useEffect, useLayoutEffect, isValidElement, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

const OPEN_DELAY = 350; // hover 打开延时(ms),防止扫过时闪烁

type Side = 'top' | 'bottom';
type Pos = { x: number; y: number; placement: Side };

export default function Tooltip({
  label,
  side = 'top',
  children,
}: {
  label?: string;
  side?: Side;
  children: ReactElement;
}) {
  // 文案单一真相源:优先显式 label,否则回退子元素 aria-label
  const text =
    label ??
    (isValidElement(children)
      ? (children.props as { 'aria-label'?: string })['aria-label']
      : undefined);

  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // 卸载时清理定时器
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // 打开期间:滚动 / 滚轮 / 按下即关闭(画布平移、列表滚动时避免气泡滞留在旧位置)
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('pointerdown', close, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('pointerdown', close, true);
    };
  }, [pos]);

  // 渲染后按气泡实际宽度做水平 clamp,确保不溢出视口(useLayoutEffect 在绘制前生效,无闪烁)
  useLayoutEffect(() => {
    if (!pos) return;
    const b = bubbleRef.current;
    if (!b) return;
    const w = b.offsetWidth;
    const margin = 8;
    const left = Math.min(Math.max(pos.x - w / 2, margin), window.innerWidth - w - margin);
    b.style.left = `${left}px`;
  }, [pos]);

  if (!text) return children; // 无文案来源:直接透传,不包裹

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // 测量「第一个子元素」而非外包 span:兼容 absolute 定位的触发(外包 span 处于流内、尺寸为 0)
      const node = (wrapRef.current?.firstElementChild ?? wrapRef.current) as HTMLElement | null;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const placement: Side = side === 'top' && r.top < 40 ? 'bottom' : side;
      const y = placement === 'top' ? r.top : r.bottom;
      setPos({ x: r.left + r.width / 2, y, placement });
    }, OPEN_DELAY);
  };
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPos(null);
  };

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            ref={bubbleRef}
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: pos.y,
              left: pos.x, // 初值,useLayoutEffect 会按实际宽度 clamp
              transform: pos.placement === 'top' ? 'translateY(calc(-100% - 8px))' : 'translateY(8px)',
            }}
            className="pointer-events-none z-[100] max-w-[240px] whitespace-nowrap rounded-[8px] border border-[var(--color-line)] bg-[var(--color-pop)] px-2 py-1 text-[12px] font-medium text-[var(--color-ink)] shadow-[var(--shadow-popover)]"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/ui/Tooltip.test.tsx`
Expected: PASS（8 个用例全绿）。

- [ ] **Step 5: 类型检查并提交**

```bash
pnpm exec tsc --noEmit
git add src/components/ui/Tooltip.tsx src/components/ui/Tooltip.test.tsx
git commit -m "feat: 新增依赖无关的 Tooltip 气泡组件(portal+延时+disabled 兼容)"
```

---

### Task 2: 接入 Chat 栏

**Files:**
- Modify: `src/components/chat/Composer.tsx`（Attach / Mention / Send / Stop，移除旧 span+title hack）
- Modify: `src/components/chat/ChatPanel.tsx`（Jump to latest）
- Modify: `src/components/chat/ProjectMenu.tsx`（改名 / 删除）
- Modify: `src/components/chat/AssetChip.tsx`（`Chip` 的移除按钮 —— 同时覆盖 AttachmentBar）

**Interfaces:**
- Consumes: `Tooltip`（Task 1）—— `import Tooltip from '@/components/ui/Tooltip';`

- [ ] **Step 1: Composer.tsx —— 包裹 4 个按钮，移除 span+title hack**

在文件顶部 import 区加入：
```tsx
import Tooltip from '@/components/ui/Tooltip';
```

Attach 按钮（约 129-136 行）外包 `<Tooltip>`：
```tsx
            <Tooltip>
              <IconButton
                variant="bordered"
                className="h-10 rounded-[12px] px-[10px]"
                aria-label="Attach"
                onClick={() => fileRef.current?.click()}
              >
                <FigIcon src={figAsset.plus} size={20} />
              </IconButton>
            </Tooltip>
```

Mention 按钮（约 137-154 行）—— 删除原 `{/* span 外包... */}` 注释与外层 `<span ... title=...>`，替换为 `<Tooltip label=...>`：
```tsx
            <Tooltip label={canMention ? 'Mention an asset' : 'Generate assets on the canvas first to @mention them'}>
              <IconButton
                variant="bordered"
                className="h-10 rounded-[12px] px-[10px]"
                aria-label="Mention"
                disabled={!canMention}
                onMouseDown={(e) => {
                  e.preventDefault();
                  startMention();
                }}
              >
                <FigIcon src={figAsset.at} size={20} />
              </IconButton>
            </Tooltip>
```

Stop / Send 按钮（约 159-179 行）—— 分别外包 `<Tooltip>`：
```tsx
            {runStatus === 'running' ? (
              <Tooltip>
                <IconButton
                  variant={submitVariant(true, dark)}
                  className="size-10 rounded-[10px]"
                  aria-label="Stop"
                  onClick={() => client.current?.interrupt()}
                >
                  <Square size={14} />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip>
                <IconButton
                  variant={submitVariant(canSend, dark)}
                  className={`size-10 ${canSend ? 'rounded-[10px]' : 'rounded-[12px]'}`}
                  aria-label="Send"
                  onClick={send}
                >
                  <FigIcon src={figAsset.arrowUp} size={20} />
                </IconButton>
              </Tooltip>
            )}
```

- [ ] **Step 2: ChatPanel.tsx —— 包裹 Jump to latest**

import 区加入 `import Tooltip from '@/components/ui/Tooltip';`。
将 `{showJump && (<button .../>)}`（约 153-166 行）的 `<button>` 外包 `<Tooltip>`（按钮 `absolute` 定位，由组件测量子元素，无需改其定位类）：
```tsx
        {showJump && (
          <Tooltip>
            <button
              type="button"
              aria-label="Jump to latest"
              onClick={() => {
                stickToBottomRef.current = true;
                setShowJump(false);
                endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }}
              className="absolute bottom-3 right-3 z-10 grid size-9 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-pop)] text-[var(--color-ink)] shadow-[var(--shadow-popover)] transition hover:bg-[var(--color-fill)]"
            >
              <FigIcon src={figAsset.chevronDown} size={18} />
            </button>
          </Tooltip>
        )}
```

- [ ] **Step 3: ProjectMenu.tsx —— 包裹改名 / 删除**

import 区加入 `import Tooltip from '@/components/ui/Tooltip';`。
将改名、删除两个 `span[role="button"]`（约 114-131 行）分别外包 `<Tooltip>`：
```tsx
                  <span className="hidden shrink-0 items-center gap-[2px] group-hover:flex">
                    <Tooltip>
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Rename ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); startRename(p); }}
                        className="grid size-[24px] place-items-center rounded-[6px] transition-colors hover:bg-[var(--color-surface-2)]"
                      >
                        <FigIcon src={figAsset.pencil} size={14} className="opacity-70" />
                      </span>
                    </Tooltip>
                    <Tooltip>
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Delete ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); startDelete(p.id); }}
                        className="grid size-[24px] place-items-center rounded-[6px] transition-colors hover:bg-[var(--color-surface-2)]"
                      >
                        <FigIcon src={figAsset.trash} size={14} className="opacity-70" />
                      </span>
                    </Tooltip>
                  </span>
```

- [ ] **Step 4: AssetChip.tsx —— 包裹 `Chip` 的移除按钮（覆盖 AttachmentBar）**

import 区加入 `import Tooltip from '@/components/ui/Tooltip';`。
将 `Chip` 内 `onRemove && (<button .../>)`（约 26-39 行）的 `<button>` 外包 `<Tooltip label={removeLabel}>`：
```tsx
      {onRemove && (
        <Tooltip label={removeLabel}>
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="-mr-1 invisible grid size-5 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition hover:bg-[var(--color-fill)] group-hover:visible"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
      )}
```

- [ ] **Step 5: 类型检查 + 全量测试（防回归）**

Run:
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/components/chat
```
Expected: tsc 无错；chat 目录现有测试全绿（外包 span 不改 `aria-label`，`getByRole`/`getByLabelText` 仍命中按钮）。

- [ ] **Step 6: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/ChatPanel.tsx src/components/chat/ProjectMenu.tsx src/components/chat/AssetChip.tsx
git commit -m "feat: Chat 栏图标按钮接入 Tooltip 气泡(并移除 Composer 手写 title hack)"
```

---

### Task 3: 接入 Canvas 栏

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`（Generate from this asset）
- Modify: `src/components/canvas/GenerateForm.tsx`（Generate / Remove ref）
- Modify: `src/components/canvas/GenParamControls.tsx`（Advanced settings）
- Modify: `src/components/canvas/MediaLightbox.tsx`（Close）
- Modify: `src/components/canvas/nodes/VideoNode.tsx`（Play / Expand）
- Modify: `src/components/canvas/nodes/AudioNode.tsx`（Play / Pause）
- Modify: `src/components/canvas/nodes/ThreeDNode.tsx`（Expand）

**Interfaces:**
- Consumes: `Tooltip`（Task 1）。每个文件 import 区加入 `import Tooltip from '@/components/ui/Tooltip';`。

- [ ] **Step 1: NodeCard.tsx —— 包裹「Generate from this asset」**

将 `selected && (<button aria-label="Generate from this asset" .../>)`（约 68-87 行）的 `<button>` 外包 `<Tooltip>`（按钮 `absolute`，组件测量子元素）。保持按钮内 `onClick` 中 `e.currentTarget`（仍指按钮）不变。

- [ ] **Step 2: GenerateForm.tsx —— 包裹 Generate 与 ref 移除按钮**

Generate 提交按钮（约 242-250 行）外包 `<Tooltip>`：
```tsx
          <Tooltip>
            <IconButton
              variant={submitVariant(hasText, dark)}
              className={`size-10 shrink-0 ${hasText ? 'rounded-[10px]' : 'rounded-[12px]'}`}
              aria-label="Generate"
              disabled={!hasText}
              onClick={submit}
            >
              <FigIcon src={figAsset.arrowUp} size={20} />
            </IconButton>
          </Tooltip>
```
ref chip 的移除按钮（约 43-47 行）外包 `<Tooltip>`：
```tsx
      {onRemove && (
        <Tooltip>
          <button type="button" aria-label={`Remove ${a.label}`} onClick={onRemove} className="opacity-50 transition hover:opacity-100">
            <X size={12} />
          </button>
        </Tooltip>
      )}
```

- [ ] **Step 3: GenParamControls.tsx —— 包裹 Advanced settings 齿轮**

将 Advanced 齿轮 `<button aria-label="Advanced settings">`（约 219-223 行）外包 `<Tooltip>`（仅包按钮，`{open && ...}` 面板保持为同级兄弟，不进 Tooltip）。

- [ ] **Step 4: MediaLightbox.tsx —— 包裹 Close**

将 Close `<button aria-label="Close" .../>`（约 40-49 行）外包 `<Tooltip>`（按钮 `absolute right-5 top-5`，贴近顶部，组件会自动翻转到下方并水平 clamp）。

- [ ] **Step 5: VideoNode.tsx —— 包裹 Play 与 Expand**

将 Play `<button aria-label={`Play ${label}`} .../>`（约 69-80 行）与 Expand `<button aria-label={`Expand ${label}`} .../>`（约 91-100 行）分别外包 `<Tooltip>`（均 `absolute`/`inset-0`，组件测量子元素）。

- [ ] **Step 6: AudioNode.tsx —— 包裹 Play / Pause**

将 `<button aria-label={playing ? 'Pause' : 'Play'} .../>`（约 93-108 行）外包 `<Tooltip>`。父级 `onMouseDown` stopPropagation 不受影响。

- [ ] **Step 7: ThreeDNode.tsx —— 包裹 Expand**

将 Expand `<button aria-label={`Expand ${label}`} .../>`（约 59-68 行）外包 `<Tooltip>`。

- [ ] **Step 8: 类型检查 + 全量测试（防回归）**

Run:
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/components/canvas
```
Expected: tsc 无错；canvas 目录现有测试全绿（GenerateForm / GenParamControls / RenameAssetModal 等）。

- [ ] **Step 9: 提交**

```bash
git add src/components/canvas/nodes/NodeCard.tsx src/components/canvas/GenerateForm.tsx src/components/canvas/GenParamControls.tsx src/components/canvas/MediaLightbox.tsx src/components/canvas/nodes/VideoNode.tsx src/components/canvas/nodes/AudioNode.tsx src/components/canvas/nodes/ThreeDNode.tsx
git commit -m "feat: Canvas 栏图标按钮接入 Tooltip 气泡"
```

---

### Task 4: 接入 Preview 栏

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`（Download ZIP / Refresh preview）

**Interfaces:**
- Consumes: `Tooltip`（Task 1）。

- [ ] **Step 1: PreviewPanel.tsx —— 包裹下载与刷新**

import 区加入 `import Tooltip from '@/components/ui/Tooltip';`。
Download ZIP 按钮（约 52-69 行）外包 `<Tooltip>`（disabled 态由外包 span 捕获 hover，仍显示气泡）：
```tsx
            {!compareOn && (
              <Tooltip>
                <IconButton
                  variant="bordered"
                  className="rounded-[12px] bg-[var(--color-surface-2)] p-2"
                  aria-label="Download ZIP"
                  aria-busy={downloading}
                  disabled={!hasGame}
                  onClick={() => void handleDownload()}
                >
                  {downloading ? (
                    <span
                      role="status"
                      aria-label="Downloading"
                      className="block size-5 animate-spin rounded-full border-2 border-current/25 border-t-current"
                    />
                  ) : (
                    <FigIcon src={figAsset.download} size={20} />
                  )}
                </IconButton>
              </Tooltip>
            )}
```
Refresh preview 按钮（约 71-79 行）外包 `<Tooltip>`：
```tsx
            <Tooltip>
              <IconButton
                variant="bordered"
                className="rounded-[12px] bg-[var(--color-surface-2)] p-2"
                aria-label="Refresh preview"
                disabled={!hasGame}
                onClick={() => setRefreshNonce((n) => n + 1)}
              >
                <FigIcon src={figAsset.refresh} size={20} />
              </IconButton>
            </Tooltip>
```

- [ ] **Step 2: 类型检查 + 全量测试（防回归）**

Run:
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/components/preview
```
Expected: tsc 无错；preview 目录现有测试全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/preview/PreviewPanel.tsx
git commit -m "feat: Preview 栏下载/刷新按钮接入 Tooltip 气泡"
```

---

### Task 5: 全量验证与目视 QA

**Files:** 无（仅验证）

- [ ] **Step 1: 全量自动化检查**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```
Expected: 四步全部通过（tsc 无错、lint 无错、vitest 全绿、next build 成功）。

- [ ] **Step 2: 启动应用目视核对**

Run: `pnpm dev`（端口 3000），逐栏 hover 核对气泡：
- Chat：Attach / Mention（可用 + disabled 两态文案不同）/ Send / Stop / Jump to latest / 项目改名·删除 / chip 移除 ×。
- Canvas：节点卡选中后的 ＋ / GenerateForm 的 Generate 与 ref 移除 / 高级齿轮 / Lightbox 关闭（贴顶应翻转到下方、贴右应 clamp 不溢出）/ 视频 Play·Expand / 音频 Play·Pause / 3D Expand。
- Preview：下载（无版本 disabled 时仍出气泡）/ 刷新。

核对要点：
1. 气泡不被节点卡 / 滚动区 overflow 裁剪（portal 生效）。
2. 画布平移 / 滚动 / 滚轮缩放时气泡及时消失（不滞留旧位置）。
3. 浅色 / 深色主题下气泡配色正确（`--color-pop` / `--color-ink`）。
4. 各栏按钮间距 / 布局未被外包 span 破坏（重点看 Composer 行内按钮、chip 内移除按钮、节点卡 absolute 按钮）。

- [ ] **Step 3:（如目视发现布局/位置问题）修正并补提交**

若 Step 2 发现问题（如某外包 span 影响 flex 间距、某 absolute 按钮气泡偏移），定位修正后：
```bash
git add -A
git commit -m "fix: 修正 Tooltip 接入后的布局/定位问题"
```

---

## Self-Review

**Spec 覆盖核对：**
- 方案 A（portal + 测量 + disabled 兼容）→ Task 1 ✅
- 组件 API（label / side / aria-label 回退 / aria-hidden）→ Task 1 测试 1–8 ✅
- 清单约 18 处（Chat 8 / Canvas 8 / Preview 2）→ Task 2/3/4 全覆盖 ✅
- 移除 Composer 手写 span+title hack → Task 2 Step 1 ✅
- 跳过项（ModelSelector / DeviceToggle / Compare / 提交按钮 / 菜单项 / 步进 ±）→ 计划未触及，符合 spec ✅
- 测试用例 7 项 → Task 1 写了 8 项（含「无文案透传」额外项）✅

**占位符扫描：** 无 TBD/TODO；每个代码步骤含完整代码或精确编辑位置 ✅

**类型/命名一致性：** `Tooltip` 默认导出、props `label?/side?/children`、import 路径 `@/components/ui/Tooltip` 在 Task 2–4 全文一致 ✅
