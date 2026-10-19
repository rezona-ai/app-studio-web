# 流式正文逐字渐显输出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让对话框助手正文从"成块跳现"变为"逐字平滑吐出 + 新字渐显",store 不动,仅在渲染层加缓冲。

**Architecture:** store 仍是完整累加文本的唯一数据源。新增 `useTypewriter` hook 在渲染层把"已到达但未显示"的文本用定时器逐字揭示(自适应追赶 + 结束打完),拆成 `head`(已渐显完毕)与 `tail`(近期 tick 的小段,带 CSS 渐显)。新增 `StreamingText` 组件复用 RichText 的内联解析渲染 head,并把 tail 各 chunk 以 `.tw-fade` span 内联接在最后一个段落末尾。仅 assistant 正文 part 生效。

**Tech Stack:** React 19 + Next 16 + Zustand,Tailwind v4(全局 `globals.css` 写 `@keyframes`),Vitest 4 + React Testing Library(jsdom)。

---

## 文件结构

- **新建** `src/client/useTypewriter.ts` — 时序 hook:`(target, active) → { head, tail }`。纯时序逻辑,不碰 DOM。
- **新建** `src/client/useTypewriter.test.ts` — hook 单测(fake timers)。
- **新建** `src/components/chat/StreamingText.tsx` — 渲染 head 段落 + tail 渐显 span,复用 `renderInline`。
- **新建** `src/components/chat/StreamingText.test.tsx` — 组件单测。
- **修改** `src/components/chat/RichText.tsx` — 把 `renderInline` 改为 `export`(供 StreamingText 复用,DRY)。行为不变。
- **修改** `src/app/globals.css` — 新增 `@keyframes tw-fade` + `.tw-fade` + reduced-motion 降级。
- **修改** `src/components/chat/MessageItem.tsx` — assistant `text` part 改用 `StreamingText`(带 streaming 判定)。
- **修改** `src/components/chat/MessageItem.test.tsx` — 流式正文用例改用 fake timers 推进。

常量(集中在 hook 顶部,便于调参):`TICK_MS=24` · `MIN_STEP=1` · `MAX_STEP=12` · `CATCHUP=8` · `FADE_MS=280`。

---

## Task 1: `useTypewriter` 时序 hook

**Files:**
- Create: `src/client/useTypewriter.ts`
- Test: `src/client/useTypewriter.test.ts`

- [ ] **Step 1: 写失败测试**

`src/client/useTypewriter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTypewriter, TYPEWRITER } from './useTypewriter';

const shownOf = (v: { head: string; tail: { text: string }[] }) =>
  v.head + v.tail.map((c) => c.text).join('');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useTypewriter', () => {
  test('流式中逐字推进,最终揭示全文', () => {
    const { result } = renderHook(() => useTypewriter('hello', true));
    expect(shownOf(result.current)).toBe('');
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 10));
    expect(shownOf(result.current)).toBe('hello');
  });

  test('backlog 大时单 tick 揭示更多字(自适应追赶)', () => {
    const long = 'x'.repeat(80);
    const { result } = renderHook(() => useTypewriter(long, true));
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS));
    const step = Math.min(TYPEWRITER.MAX_STEP, Math.ceil(80 / TYPEWRITER.CATCHUP));
    expect(shownOf(result.current).length).toBe(step); // = 10,远大于 MIN_STEP
  });

  test('active 转 false 后把剩余打完,尾段毕业后清空', () => {
    const { result, rerender } = renderHook(
      ({ t, a }: { t: string; a: boolean }) => useTypewriter(t, a),
      { initialProps: { t: 'abcdef', a: true } },
    );
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 2));
    rerender({ t: 'abcdef', a: false });
    act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 20));
    expect(shownOf(result.current)).toBe('abcdef');
    act(() => vi.advanceTimersByTime(TYPEWRITER.FADE_MS * 2));
    expect(result.current.tail).toEqual([]);
    expect(result.current.head).toBe('abcdef');
  });

  test('首次挂载即非流式 → 立即全量,无逐字', () => {
    const { result } = renderHook(() => useTypewriter('done text', false));
    expect(result.current.head).toBe('done text');
    expect(result.current.tail).toEqual([]);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.head).toBe('done text');
  });

  test('prefers-reduced-motion → 全量无渐显,增量也即时全量', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, media: '', onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    }));
    const { result, rerender } = renderHook(
      ({ t }: { t: string }) => useTypewriter(t, true),
      { initialProps: { t: 'ab' } },
    );
    expect(result.current).toEqual({ head: 'ab', tail: [] });
    rerender({ t: 'abcd' });
    expect(result.current).toEqual({ head: 'abcd', tail: [] });
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm vitest run src/client/useTypewriter.test.ts`
Expected: FAIL —— `Cannot find module './useTypewriter'` / `useTypewriter is not a function`。

- [ ] **Step 3: 实现 hook**

`src/client/useTypewriter.ts`:

```ts
'use client';
import { useEffect, useRef, useState } from 'react';

// 可调常量:节奏手感都在这里
export const TYPEWRITER = {
  TICK_MS: 24,   // 定时器周期
  MIN_STEP: 1,   // 每 tick 最少揭示字数
  MAX_STEP: 12,  // 每 tick 最多揭示字数(封顶单次渐显块,约 500 字/秒追赶上限)
  CATCHUP: 8,    // 自适应追赶除数(越小追得越快)
  FADE_MS: 280,  // 渐显时长 / chunk 毕业阈值
} as const;

export interface TypeChunk { id: number; text: string }
export interface TypewriterView { head: string; tail: TypeChunk[] }

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// 本 tick 揭示到的下标:不跨越段落空行(\n\n),保证每个 chunk 恒为单段落
function stepEnd(target: string, shown: number, rawStep: number): number {
  if (target.startsWith('\n\n', shown)) return shown + 2; // 正落在段界:单独吞掉这对换行,保证推进
  const to = Math.min(shown + rawStep, target.length);
  const nn = target.slice(shown, to).indexOf('\n\n');
  return nn === -1 ? to : shown + nn; // 截到段界前,下个 tick 再吞段界
}

export function useTypewriter(target: string, active: boolean): TypewriterView {
  const reduced = useRef(prefersReducedMotion()).current;

  // 每次渲染同步最新入参到 ref,供定时器闭包读取(避免增量到达就重建定时器)
  const targetRef = useRef(target);
  const activeRef = useRef(active);
  targetRef.current = target;
  activeRef.current = active;

  // 动画路径内部游标
  const headLenRef = useRef(0);
  const chunksRef = useRef<Array<TypeChunk & { bornTick: number }>>([]);
  const tickRef = useRef(0);
  const idRef = useRef(0);
  const sigRef = useRef('');

  const [view, setView] = useState<TypewriterView>(() =>
    // 首挂即非流式(历史/非流式)或降低动态偏好 → 直接全量,无动画
    reduced || !active ? { head: target, tail: [] } : { head: '', tail: [] },
  );

  // 动画主循环:仅在"首挂即流式且非降低动态"时启动
  useEffect(() => {
    if (reduced || !activeRef.current) return;

    const GRAD = Math.ceil(TYPEWRITER.FADE_MS / TYPEWRITER.TICK_MS);
    const shown = () =>
      headLenRef.current + chunksRef.current.reduce((n, c) => n + c.text.length, 0);

    const h = setInterval(() => {
      const t = targetRef.current;
      tickRef.current += 1;
      const now = tickRef.current;

      // 1) 旧 chunk 毕业:超过渐显窗口的尾段折叠进 head
      while (chunksRef.current.length && now - chunksRef.current[0].bornTick >= GRAD) {
        headLenRef.current += chunksRef.current.shift()!.text.length;
      }

      // 2) 揭示新字:自适应步长 + 段界 snap
      const cur = shown();
      const backlog = t.length - cur;
      if (backlog > 0) {
        const raw = Math.min(
          TYPEWRITER.MAX_STEP,
          Math.max(TYPEWRITER.MIN_STEP, Math.ceil(backlog / TYPEWRITER.CATCHUP)),
        );
        const end = stepEnd(t, cur, raw);
        const text = t.slice(cur, end);
        if (text) chunksRef.current.push({ id: idRef.current++, text, bornTick: now });
      }

      // 3) 仅在变化时推送视图(避免无谓重渲染)
      const head = t.slice(0, headLenRef.current);
      const tail = chunksRef.current.map(({ id, text }) => ({ id, text }));
      const sig = head + ' ' + tail.map((c) => c.id).join(',');
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setView({ head, tail });
      }

      // 4) 收尾:非流式且已打完且无尾段 → 停表
      if (!activeRef.current && shown() >= t.length && chunksRef.current.length === 0) {
        clearInterval(h);
      }
    }, TYPEWRITER.TICK_MS);

    return () => clearInterval(h);
  }, [reduced]);

  // 降低动态:始终同步全量(无打字/渐显),覆盖流式增量
  useEffect(() => {
    if (reduced) setView({ head: target, tail: [] });
  }, [reduced, target]);

  return view;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm vitest run src/client/useTypewriter.test.ts`
Expected: PASS(5 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/client/useTypewriter.ts src/client/useTypewriter.test.ts
git commit -m "feat: 新增 useTypewriter 逐字渐显时序 hook"
```

---

## Task 2: `StreamingText` 渲染组件(含 RichText 导出 renderInline)

**Files:**
- Modify: `src/components/chat/RichText.tsx`(把 `renderInline` 改为 `export`)
- Create: `src/components/chat/StreamingText.tsx`
- Test: `src/components/chat/StreamingText.test.tsx`

- [ ] **Step 1: 写失败测试**

`src/components/chat/StreamingText.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import StreamingText from './StreamingText';
import { TYPEWRITER } from '@/client/useTypewriter';

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

test('非流式 → 立即全量:**加粗** 渲染为 strong,空行分段', () => {
  render(<StreamingText text={'**粗体** 普通\n\n第二段'} streaming={false} />);
  expect(screen.getByText('粗体').tagName).toBe('STRONG');
  expect(screen.getByText('第二段')).toBeInTheDocument();
});

test('流式中:尾段渲染为带 tw-fade 的 span,且文本逐步可见', () => {
  vi.useFakeTimers();
  const { container } = render(<StreamingText text="hello" streaming />);
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 3));
  expect(container.querySelectorAll('.tw-fade').length).toBeGreaterThan(0);
  expect(container.textContent).toContain('hel');
});

test('流式打完且渐显窗口过后:尾段毕业,.tw-fade 清零,全文可见', () => {
  vi.useFakeTimers();
  const { container } = render(<StreamingText text="hello" streaming />);
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 10));
  act(() => vi.advanceTimersByTime(TYPEWRITER.FADE_MS * 2));
  expect(container.querySelectorAll('.tw-fade').length).toBe(0);
  expect(container.textContent).toContain('hello');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm vitest run src/components/chat/StreamingText.test.ts`
Expected: FAIL —— `Cannot find module './StreamingText'`。

- [ ] **Step 3a: RichText 导出 renderInline**

把 `src/components/chat/RichText.tsx` 第 5 行的 `function renderInline` 改为 `export function renderInline`(其余不变):

```tsx
// 轻量内联解析:仅支持 **加粗**;单换行→<br>,空行(\n\n)→分段
export function renderInline(text: string): ReactNode[] {
```

- [ ] **Step 3b: 实现 StreamingText**

`src/components/chat/StreamingText.tsx`:

```tsx
'use client';
import { Fragment } from 'react';
import { renderInline } from './RichText';
import { useTypewriter } from '@/client/useTypewriter';

// 把单换行渲染为软换行(尾段恒为单段落,故只需处理 \n)
function softBreaks(text: string) {
  return text.split('\n').map((ln, j) => (
    <Fragment key={j}>
      {j > 0 && <br />}
      {ln}
    </Fragment>
  ));
}

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
  // 不过滤空段:head 末尾若恰为 \n\n,需保留尾部空段承接 tail
  const paras = head.split(/\n{2,}/);
  const lastIdx = paras.length - 1;
  return (
    <div className={`space-y-3 ${className}`}>
      {paras.map((para, i) => (
        <p key={i}>
          {renderInline(para)}
          {i === lastIdx &&
            tail.map((c) => (
              <span key={c.id} className="tw-fade">
                {softBreaks(c.text)}
              </span>
            ))}
        </p>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm vitest run src/components/chat/StreamingText.test.ts`
Expected: PASS(3 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/StreamingText.tsx src/components/chat/StreamingText.test.tsx src/components/chat/RichText.tsx
git commit -m "feat: 新增 StreamingText 组件并复用 RichText 内联解析"
```

---

## Task 3: 渐显 CSS

**Files:**
- Modify: `src/app/globals.css`(追加到文件末尾)

- [ ] **Step 1: 追加 keyframes 与类**

在 `src/app/globals.css` 末尾追加(opacity-only:inline 元素上 transform 不生效、inline-block 又会破坏中途换行,故仅用透明度):

```css
/* 流式正文逐字渐显:每个 tick 的尾段 span 挂一次性渐显;旧 chunk 毕业进 head 后即为普通文本 */
@keyframes tw-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.tw-fade {
  animation: tw-fade 280ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .tw-fade { animation: none; }
}
```

- [ ] **Step 2: 验证构建样式无误**

Run: `pnpm vitest run src/components/chat/StreamingText.test.ts`
Expected: PASS(确认追加 CSS 未影响既有组件测试;`.tw-fade` 类已在上一任务被断言)。

- [ ] **Step 3: 提交**

```bash
git add src/app/globals.css
git commit -m "feat: 新增 tw-fade 渐显动画与 reduced-motion 降级"
```

---

## Task 4: MessageItem 接线

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`
- Test: `src/components/chat/MessageItem.test.tsx`

- [ ] **Step 1: 先改流式正文测试用例(预期会因逐字而失败)**

把 `src/components/chat/MessageItem.test.tsx` 中"思考块后已有正文"这条用例替换为(其余用例不动):

```tsx
test('思考块后已有正文 → 思考可见,正文逐字流式输出', async () => {
  const { useFakeTimers, advanceTimersByTime, useRealTimers } = vi;
  useFakeTimers();
  const m: Message = { id: 'a3', role: 'assistant', status: 'generating', parts: [
    { type: 'thinking', text: '思考内容XYZ' },
    { type: 'text', text: '正文输出中' },
  ] };
  const { unmount } = render(<MessageItem message={m} />);
  expect(screen.getByText('思考内容XYZ')).toBeInTheDocument(); // 思考即时可见
  await act(async () => { advanceTimersByTime(200); }); // 推进定时器,逐字打完
  expect(screen.getByText('正文输出中')).toBeInTheDocument();
  unmount();
  useRealTimers();
});
```

并把文件顶部导入补上 `vi` 与 `act`:

```tsx
import { expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm vitest run src/components/chat/MessageItem.test.ts`
Expected: FAIL —— 该 `generating` 用例下正文此刻仍走 `RichText` 即时整段渲染,`act`/fake timers 与新断言尚未匹配前应先看到红(或因 `StreamingText` 未接线导致行为不符)。

> 注:`status: 'ready'` 的几条用例(开始啦 / 已生成 3 张图 / **加粗**)因 `streaming=false` 走 snap,仍即时全量、保持绿。

- [ ] **Step 3: 接线 MessageItem**

修改 `src/components/chat/MessageItem.tsx`:把 import 的 `RichText` 旁补上 `StreamingText`;assistant 分支渲染前算出最后一个 text part 下标;`case 'text'` 改用 `StreamingText`。

导入处(第 7 行附近)新增:

```tsx
import StreamingText from './StreamingText';
```

把 assistant 分支(第 43 行起)改为:

```tsx
  const isToolOnly = message.parts.length > 0 && message.parts.every((p) => p.type === 'tool');
  // 仅最后一个 text part 在持续增长,只对它做流式逐字
  const lastTextIdx = message.parts.reduce((acc, p, idx) => (p.type === 'text' ? idx : acc), -1);
  return (
    <div className={`${isToolOnly ? 'mb-2' : 'mb-5'} flex flex-col gap-2`}>
      {message.parts.map((p, i) => {
        switch (p.type) {
          case 'text':
            return p.text.trim() ? (
              <StreamingText
                key={i}
                text={p.text}
                className={TEXT}
                streaming={message.status === 'generating' && i === lastTextIdx}
              />
            ) : null;
          case 'thinking':
            // 流式中 = 消息生成中且该思考块是最后一个 part(后续块一旦开始,思考即结束)
            return <ThinkingBlock key={i} text={p.text} streaming={message.status === 'generating' && i === message.parts.length - 1} />;
          case 'tool':
            return <ToolCard key={i} part={p} />;
        }
      })}
    </div>
  );
```

(用户消息分支保持 `RichText` 不变。)

- [ ] **Step 4: 运行测试,确认通过**

Run: `pnpm vitest run src/components/chat/MessageItem.test.ts`
Expected: PASS(全部用例,含逐字流式那条)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/MessageItem.tsx src/components/chat/MessageItem.test.tsx
git commit -m "feat: 助手正文 part 接入 StreamingText 逐字渐显"
```

---

## Task 5: 全量验证

**Files:** 无(仅运行校验)

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`
Expected: PASS(注意:`DiffView.test.tsx` 的"找不到 ./DiffView"为既有、与本功能无关的报错;若此前已存在则不阻塞本计划,但需确认本次新增/改动文件相关用例全绿)。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 无新增告警/错误。

- [ ] **Step 3: 类型检查(构建)**

Run: `pnpm build`
Expected: 构建成功,无类型错误。

- [ ] **Step 4: 真机目测(可选,但推荐)**

`pnpm dev` 起服务,触发一次助手回复,确认:正文逐字平滑吐出、新字渐显、突发大块能追赶、回复结束后剩余被打完;刷新页面历史消息**不回放**(立即整段)。

---

## Self-Review(已执行)

- **Spec 覆盖**:范围(仅正文)→ Task 4 的 `streaming` 判定;自适应追赶+结束打完 → Task 1 step 2/收尾逻辑;按 tick 分块渐显 → Task 1 chunk 队列 + Task 2 `.tw-fade` span;复用解析 → Task 2 step 3a;CSS+reduced-motion → Task 3;hook 不动 store → 全程未触碰 store/koubou。全部有对应任务。
- **占位符**:无 TBD/TODO;每个代码步骤均给出完整代码。
- **类型/命名一致**:`TypewriterView { head, tail }`、`TypeChunk { id, text }`、`TYPEWRITER` 常量、`renderInline` 导出名在 Task 1/2/4 间一致。
- **已知取舍**:若上游"落定"消息重排 part(thinking 前置)致正文 part 下标变化 → `StreamingText` 因 `key={i}` 变更而重挂,此时 `status` 已为 ready → 走 snap 即时显示剩余(非逐字打完)。属收尾瞬间的可接受降级,不单列任务。
