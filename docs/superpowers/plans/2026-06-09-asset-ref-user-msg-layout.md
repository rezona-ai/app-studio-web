# 资产引用 chip 与用户消息布局 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 Figma 133-2007 / 41-654 统一资产引用 chip 样式,并把用户消息的 `@key` 引用渲染为气泡顶部 chip。

**Architecture:** 抽出单一来源的资产引用 chip(`Chip` 展示基座 + `AssetChip` 资产感知),对话内与组合框共用;新增纯函数 `extractRefs` 在渲染时从 wire 文本提取已知 `@key`;组合框把 `AttachmentBar` 移入卡片并给发送按钮加深色 active 态。

**Tech Stack:** Next.js + React 19 + Tailwind v4 + Zustand(`useStore`)+ Vitest + Testing Library。

设计 spec:`docs/superpowers/specs/2026-06-09-asset-ref-user-msg-layout-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/refs.ts` | 新增 `extractRefs(text, knownKeys)` 纯函数 |
| `src/components/chat/AssetChip.tsx` | 重写:`Chip`(展示基座)+ 默认导出 `AssetChip`(资产感知) |
| `src/components/chat/MessageItem.tsx` | 用户分支:顶部 chip + 正文,左缩进灰底气泡 |
| `src/components/chat/AttachmentBar.tsx` | 改用共享 chip,容器去外边距 |
| `src/components/ui/IconButton.tsx` | 新增 `raised-active` variant |
| `src/app/globals.css` | 新增 `.btn-raised-active` |
| `src/components/chat/Composer.tsx` | `AttachmentBar` 移入卡片;发送按钮 active 态 |

测试运行约定:单文件 `npx vitest run <path>`;全量 `npm test`。

---

## Task 1: `extractRefs` 纯函数

**Files:**
- Modify: `src/lib/refs.ts`
- Test: `src/lib/refs.test.ts`

- [ ] **Step 1: 写失败测试**(追加到 `src/lib/refs.test.ts` 末尾)

```ts
import { extractRefs } from './refs';

test('extractRefs: 命中已知 @key 提取并从正文剥离', () => {
  const r = extractRefs('让 @char-1 更红', new Set(['char-1']));
  expect(r.keys).toEqual(['char-1']);
  expect(r.text).toBe('让 更红');
});

test('extractRefs: 未知 @token 原样保留(不误伤邮箱)', () => {
  const r = extractRefs('联系 nick@rezona.ai', new Set(['char-1']));
  expect(r.keys).toEqual([]);
  expect(r.text).toBe('联系 nick@rezona.ai');
});

test('extractRefs: 多个引用去重保序', () => {
  const r = extractRefs('@a @b @a 文本', new Set(['a', 'b']));
  expect(r.keys).toEqual(['a', 'b']);
  expect(r.text).toBe('文本');
});

test('extractRefs: 无引用时原样返回', () => {
  const r = extractRefs('纯文本', new Set(['a']));
  expect(r.keys).toEqual([]);
  expect(r.text).toBe('纯文本');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/refs.test.ts`
Expected: FAIL —— `extractRefs is not a function` / 导出不存在。

- [ ] **Step 3: 实现 `extractRefs`**(追加到 `src/lib/refs.ts` 末尾)

```ts
// 从用户消息文本提取已知资产引用 @key:命中 knownKeys 才剥离(去重保序),否则原样保留
export function extractRefs(text: string, knownKeys: Set<string>): { keys: string[]; text: string } {
  const keys: string[] = [];
  const stripped = text.replace(/@(\S+)/g, (m, k: string) => {
    if (knownKeys.has(k)) {
      if (!keys.includes(k)) keys.push(k);
      return '';
    }
    return m;
  });
  return { keys, text: stripped.replace(/ {2,}/g, ' ').trim() };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/refs.test.ts`
Expected: PASS(原有 `getActiveMention` 测试 + 4 个新测试)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/refs.ts src/lib/refs.test.ts
git commit -m "feat: 文本资产引用提取 extractRefs"
```

---

## Task 2: 共享资产引用 chip(`Chip` + `AssetChip`)

**Files:**
- Modify(重写): `src/components/chat/AssetChip.tsx`
- Test(新建): `src/components/chat/AssetChip.test.tsx`

- [ ] **Step 1: 写失败测试**(新建 `src/components/chat/AssetChip.test.tsx`)

```tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AssetChip from './AssetChip';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';

afterEach(cleanup);

function seedAsset(a: Partial<Asset>): Asset {
  return {
    id: 'id1', key: 'k1', label: '角色 A', kind: 'image', source: 'generated',
    status: 'ready', position: { x: 0, y: 0 }, pinned: false, ...a,
  };
}

test('有 preview → 贴片显示缩略图', () => {
  useStore.setState({ assets: [seedAsset({ key: 'k1', preview: { src: '/x.png' } })] });
  const { container } = render(<AssetChip assetKey="k1" />);
  expect(container.querySelector('img[src="/x.png"]')).not.toBeNull();
  expect(screen.getByText('角色 A')).toBeInTheDocument();
});

test('无 preview → 回退类型图标(audio=waveform),仍显示标签', () => {
  useStore.setState({ assets: [seedAsset({ key: 'k2', label: '音轨', kind: 'audio' })] });
  const { container } = render(<AssetChip assetKey="k2" />);
  expect(container.querySelector('img[src="/figma/icons/waveform.svg"]')).not.toBeNull();
  expect(screen.getByText('音轨')).toBeInTheDocument();
});

test('查不到资产 → 回退展示 key', () => {
  useStore.setState({ assets: [] });
  render(<AssetChip assetKey="missing-key" />);
  expect(screen.getByText('missing-key')).toBeInTheDocument();
});

test('传 onRemove → 渲染移除按钮并触发回调', () => {
  const onRemove = vi.fn();
  useStore.setState({ assets: [seedAsset({ key: 'k1' })] });
  render(<AssetChip assetKey="k1" onRemove={onRemove} />);
  screen.getByRole('button', { name: '移除引用' }).click();
  expect(onRemove).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/chat/AssetChip.test.tsx`
Expected: FAIL —— 当前 `AssetChip` 无 `onRemove`、贴片无缩略图分支。

- [ ] **Step 3: 重写 `AssetChip.tsx`**(整文件覆盖)

```tsx
'use client';
import type { ReactNode } from 'react';
import { useStore } from '@/store';
import { FigIcon } from '@/components/ui/figma';
import { KIND_META } from '@/lib/asset-kind';

// 资产引用 chip 展示型基座:图标贴片 + 标签,可选 hover 浮现的移除按钮
export function Chip({
  icon,
  label,
  onRemove,
  removeLabel = '移除',
}: {
  icon: ReactNode;
  label: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="group inline-flex h-10 w-fit max-w-full items-center gap-2 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-surface)] py-1 pl-1 pr-3">
      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--color-fill)]">
        {icon}
      </span>
      <span className="truncate text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)]">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 hidden size-5 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition hover:bg-[var(--color-fill)] group-hover:grid"
        >
          ×
        </button>
      )}
    </span>
  );
}

// 对话内/组合框的资产引用 chip:按 key 查 store,有预览图显示缩略图,否则回退类型图标
export default function AssetChip({ assetKey, onRemove }: { assetKey: string; onRemove?: () => void }) {
  const asset = useStore((s) => s.assets.find((a) => a.key === assetKey));
  const meta = KIND_META[asset?.kind ?? 'image'];
  const preview = asset?.preview?.src ?? asset?.preview?.dataUrl;
  return (
    <Chip
      onRemove={onRemove}
      removeLabel="移除引用"
      label={asset?.label ?? assetKey}
      icon={
        preview ? (
          <img src={preview} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <FigIcon src={meta.icon} size={16} />
        )
      }
    />
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/chat/AssetChip.test.tsx`
Expected: PASS(4 个测试)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/AssetChip.tsx src/components/chat/AssetChip.test.tsx
git commit -m "feat: 资产引用 chip 抽共享组件(缩略图回退 + hover 移除)"
```

---

## Task 3: 用户消息布局(`MessageItem` 用户分支)

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`
- Test: `src/components/chat/MessageItem.test.tsx`

- [ ] **Step 1: 写失败测试**(追加到 `src/components/chat/MessageItem.test.tsx` 末尾;并在文件顶部 import 处补 `import { useStore } from '@/store';`)

```tsx
test('用户消息:已知 @key 渲染为 chip 且正文剥离引用', () => {
  useStore.setState({ assets: [{ id: 'i', key: 'char-1', label: '主角', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, pinned: false }] });
  const m: Message = { id: 'u2', role: 'user', status: 'ready', parts: [{ type: 'text', text: '让 @char-1 更红' }] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('主角')).toBeInTheDocument();   // chip 标签
  expect(screen.getByText('让 更红')).toBeInTheDocument(); // 正文已剥离 @char-1
  expect(screen.queryByText(/@char-1/)).not.toBeInTheDocument();
});

test('用户消息:未知 @token 留在正文,不渲染 chip', () => {
  useStore.setState({ assets: [] });
  const m: Message = { id: 'u3', role: 'user', status: 'ready', parts: [{ type: 'text', text: '问 nick@example.com' }] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('问 nick@example.com')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/chat/MessageItem.test.tsx`
Expected: FAIL —— 当前把 `@char-1` 当字面量渲染,无 chip、无剥离。

- [ ] **Step 3: 改写 `MessageItem.tsx`**(替换用户分支并补 imports / hooks;助手分支不变)

将文件顶部 import 段替换为:

```tsx
'use client';
import { useMemo } from 'react';
import type { Message, Part } from '@/store/types';
import { useStore } from '@/store';
import { extractRefs } from '@/lib/refs';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';
import RichText from './RichText';
import AssetChip from './AssetChip';
```

将 `export default function MessageItem(...) {` 之后、到用户分支结束(`}` of the `if (message.role === 'user')` block)替换为:

```tsx
export default function MessageItem({ message }: { message: Message }) {
  const assets = useStore((s) => s.assets);
  const knownKeys = useMemo(() => new Set(assets.map((a) => a.key)), [assets]);

  // 用户消息:左缩进灰底气泡,顶部资产引用 chip(由文本提取 @key),正文在下
  if (message.role === 'user') {
    const raw = message.parts
      .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    const { keys, text } = extractRefs(raw, knownKeys);
    const hasContent = keys.length > 0 || text.trim().length > 0;
    return (
      <div className="mb-5 pl-6">
        {hasContent && (
          <div className="flex w-full flex-col gap-1 rounded-[12px] bg-[var(--color-fill)] p-3">
            {keys.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <AssetChip key={k} assetKey={k} />
                ))}
              </div>
            )}
            {text.trim() && <RichText text={text} className={TEXT} />}
          </div>
        )}
      </div>
    );
  }
```

(其后助手分支与 `TEXT` 常量保持原样。)

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/chat/MessageItem.test.tsx`
Expected: PASS(原有 8 个 + 2 个新测试;原「文本气泡渲染」仍通过)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/MessageItem.tsx src/components/chat/MessageItem.test.tsx
git commit -m "feat: 用户消息顶部资产引用 chip + 正文剥离 @key"
```

---

## Task 4: `AttachmentBar` 改用共享 chip

**Files:**
- Modify(重写): `src/components/chat/AttachmentBar.tsx`
- Test(新建): `src/components/chat/AttachmentBar.test.tsx`

- [ ] **Step 1: 写失败测试**(新建 `src/components/chat/AttachmentBar.test.tsx`)

```tsx
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AttachmentBar from './AttachmentBar';
import { useStore } from '@/store';

beforeEach(() => useStore.setState({ composer: { draft: '', refs: [], attachments: [] }, assets: [] }));
afterEach(cleanup);

test('无引用无附件 → 不渲染', () => {
  const { container } = render(<AttachmentBar />);
  expect(container.firstChild).toBeNull();
});

test('资产引用 chip 显示资产名并可移除', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, pinned: false }],
    composer: { draft: '', refs: ['k1'], attachments: [] },
  });
  render(<AttachmentBar />);
  expect(screen.getByText('背景图')).toBeInTheDocument();
  screen.getByRole('button', { name: '移除引用' }).click();
  expect(useStore.getState().composer.refs).toEqual([]);
});

test('文件附件 chip 显示文件名并可移除', () => {
  useStore.setState({ composer: { draft: '', refs: [], attachments: [{ name: 'a.txt', mime: 'text/plain', dataUrl: 'data:,' }] } });
  render(<AttachmentBar />);
  expect(screen.getByText('a.txt')).toBeInTheDocument();
  screen.getByRole('button', { name: '移除附件' }).click();
  expect(useStore.getState().composer.attachments).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/chat/AttachmentBar.test.tsx`
Expected: FAIL —— 当前文件附件移除按钮 `aria-label` 为「移除附件」可过,但引用 chip 走内联样式且无统一 `移除引用` 标签 ⇒ 至少一项失败;以红灯为准。

- [ ] **Step 3: 重写 `AttachmentBar.tsx`**(整文件覆盖)

```tsx
'use client';
import { useStore } from '@/store';
import { FigIcon } from '@/components/ui/figma';
import { KIND_META } from '@/lib/asset-kind';
import AssetChip, { Chip } from './AssetChip';

// 草稿待发送区:@ 资产引用 + 文件附件,使用与对话一致的资产引用 chip
export default function AttachmentBar() {
  const { refs, attachments } = useStore((s) => s.composer);
  const removeRef = useStore((s) => s.removeRef);
  const composerSet = useStore((s) => s.composerSet);
  if (refs.length === 0 && attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {refs.map((r) => (
        <AssetChip key={r} assetKey={r} onRemove={() => removeRef(r)} />
      ))}
      {attachments.map((f, i) => (
        <Chip
          key={i}
          label={f.name}
          removeLabel="移除附件"
          icon={<FigIcon src={KIND_META.doc.icon} size={16} />}
          onRemove={() => {
            // 读最新 store 快照,避免渲染期闭包 attachments 过期
            const cur = useStore.getState().composer.attachments;
            composerSet({ attachments: cur.filter((_, j) => j !== i) });
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/chat/AttachmentBar.test.tsx`
Expected: PASS(3 个测试)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/AttachmentBar.tsx src/components/chat/AttachmentBar.test.tsx
git commit -m "feat: AttachmentBar 改用共享资产引用 chip"
```

---

## Task 5: 发送按钮深色 active 态(样式 + variant)

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/IconButton.tsx`
- Test(新建): `src/components/ui/IconButton.test.tsx`

- [ ] **Step 1: 写失败测试**(新建 `src/components/ui/IconButton.test.tsx`)

```tsx
import { afterEach, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import IconButton from './IconButton';

afterEach(cleanup);

test("variant='raised-active' 应用深色态 class", () => {
  render(
    <IconButton variant="raised-active" aria-label="发送">
      <span>x</span>
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('btn-raised-active');
});

test('默认 raised 不带 active class', () => {
  render(
    <IconButton variant="raised" aria-label="发送">
      <span>x</span>
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: '发送' }).className).not.toContain('btn-raised-active');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/ui/IconButton.test.tsx`
Expected: FAIL —— TS/运行期不识别 `raised-active` variant。

- [ ] **Step 3a: 加 `.btn-raised-active`**(在 `src/app/globals.css` 的 `.btn-raised:not(:disabled):hover {...}` 规则之后插入)

```css
/* 设计稿「Submit Button / active」:深色渐变 + 深描边阴影 + 内高光(可发送态) */
.btn-raised-active {
  background: linear-gradient(to bottom, #323232, #222);
  box-shadow: 0 2px 4px -1px rgba(13, 13, 13, 0.5), 0 0 0 1px #333,
    inset 0 0.5px 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 1.2px 0.35px #121212;
  color: #fff;
}
.btn-raised-active:not(:disabled):hover {
  filter: brightness(1.08);
}
```

- [ ] **Step 3b: 加 `raised-active` variant**(`src/components/ui/IconButton.tsx`)

将:

```tsx
type Variant = 'ghost' | 'bordered' | 'raised';

const VARIANT: Record<Variant, string> = {
  ghost: 'text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  bordered: 'border border-[var(--color-line-2)] text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  raised: 'btn-raised',
};
```

替换为:

```tsx
type Variant = 'ghost' | 'bordered' | 'raised' | 'raised-active';

const VARIANT: Record<Variant, string> = {
  ghost: 'text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  bordered: 'border border-[var(--color-line-2)] text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  raised: 'btn-raised',
  'raised-active': 'btn-raised-active',
};
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/ui/IconButton.test.tsx`
Expected: PASS(2 个测试)。

- [ ] **Step 5: 提交**

```bash
git add src/app/globals.css src/components/ui/IconButton.tsx src/components/ui/IconButton.test.tsx
git commit -m "feat: IconButton 深色 active 态(btn-raised-active)"
```

---

## Task 6: 组合框对齐(AttachmentBar 移入卡片 + 发送按钮 active)

**Files:**
- Modify: `src/components/chat/Composer.tsx`
- Test(新建): `src/components/chat/Composer.test.tsx`

- [ ] **Step 1: 写失败测试**(新建 `src/components/chat/Composer.test.tsx`)

```tsx
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Composer from './Composer';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';

const clientRef = { current: null } as React.RefObject<KoubouClient | null>;

beforeEach(() => useStore.setState({ composer: { draft: '', refs: [], attachments: [] }, runStatus: 'idle', assets: [] }));
afterEach(cleanup);

test('空草稿 → 发送按钮浅色态(rounded-12,无 active class)', () => {
  render(<Composer client={clientRef} />);
  const send = screen.getByRole('button', { name: 'Send' });
  expect(send.className).toContain('rounded-[12px]');
  expect(send.className).not.toContain('btn-raised-active');
});

test('有草稿 → 发送按钮深色 active 态(rounded-10)', () => {
  useStore.setState({ composer: { draft: '做个游戏', refs: [], attachments: [] } });
  render(<Composer client={clientRef} />);
  const send = screen.getByRole('button', { name: 'Send' });
  expect(send.className).toContain('btn-raised-active');
  expect(send.className).toContain('rounded-[10px]');
});

test('仅有资产引用(无草稿)→ 也是可发送 active 态', () => {
  useStore.setState({ composer: { draft: '', refs: ['k1'], attachments: [] } });
  render(<Composer client={clientRef} />);
  expect(screen.getByRole('button', { name: 'Send' }).className).toContain('btn-raised-active');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/chat/Composer.test.tsx`
Expected: FAIL —— 当前发送按钮恒为 `raised` + `rounded-[12px]`,无 `canSend` 切换。

- [ ] **Step 3: 改写 `Composer.tsx`**

(3a)在 `send` 函数之后、`return (` 之前新增一行:

```tsx
  const canSend = draft.trim().length > 0 || attachments.length > 0 || refs.length > 0;
```

(3b)将原 `return (...)` 的 JSX 整体替换为(把 `<AttachmentBar />` 移入卡片内、置于 textarea 之上,并改写发送/停止按钮):

```tsx
  return (
    <div className="px-3 pb-3 pt-1">
      {/* Prompt Input 卡片 */}
      <div className="relative flex flex-col gap-3 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        {mention && <MentionPopover query={mention.query} onPick={pickMention} />}
        <AttachmentBar />
        <textarea
          ref={taRef}
          value={draft}
          onChange={onChange}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Great to see you, what game do you want to make today..."
          className="w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] outline-none placeholder:text-[#7b7b7b]"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconButton
              variant="bordered"
              className="h-10 rounded-[12px] px-[10px]"
              aria-label="Attach"
              onClick={() => fileRef.current?.click()}
            >
              <FigIcon src={figAsset.plus} size={20} />
            </IconButton>
            <IconButton
              variant="bordered"
              className="h-10 rounded-[12px] px-[10px]"
              aria-label="Mention"
              onMouseDown={(e) => {
                e.preventDefault();
                startMention();
              }}
            >
              <FigIcon src={figAsset.at} size={20} />
            </IconButton>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} />
          </div>
          {runStatus === 'running' ? (
            <IconButton
              variant="raised-active"
              className="size-10 rounded-[10px]"
              aria-label="Stop"
              onClick={() => client.current?.interrupt()}
            >
              <Square size={14} className="text-white" />
            </IconButton>
          ) : (
            <IconButton
              variant={canSend ? 'raised-active' : 'raised'}
              className={`size-10 ${canSend ? 'rounded-[10px]' : 'rounded-[12px]'}`}
              aria-label="Send"
              onClick={send}
            >
              <FigIcon
                src={figAsset.arrowUp}
                size={20}
                className={canSend ? '[filter:brightness(0)_invert(1)]' : ''}
              />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
```

> 说明:`<AttachmentBar />` 不再在卡片外层;白色箭头通过 `[filter:brightness(0)_invert(1)]` 把深色 SVG 反相为白色;`Square`(lucide,用 `currentColor`)直接 `text-white`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/chat/Composer.test.tsx`
Expected: PASS(3 个测试)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx
git commit -m "feat: 组合框资产引用移入卡片 + 发送按钮深色可发送态"
```

---

## Task 7: 全量校验

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿(原 149 + 新增约 14 个测试)。

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 error。

- [ ] **Step 3: 类型/构建快速核验(可选)**

Run: `npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 4: 视觉核验(交给评审环节)**

启动应用,对照 Figma 133-2007 / 41-654 核对:组合框 chip(40px 高、32px 贴片含缩略图)、发送按钮深色态、用户消息顶部 chip + 正文。

---

## Self-Review(plan vs spec)

- **Spec 覆盖:**§1 共享 chip→Task 2;§2 extractRefs→Task 1;§3 用户消息→Task 3;§4 组合框(AttachmentBar 移入+发送 active)→Task 4/5/6。全覆盖。
- **占位符:**无 TBD/TODO;每个代码步骤均有完整代码。
- **类型一致:**`extractRefs(text, Set<string>) => {keys, text}` 在 Task 1 定义、Task 3 使用一致;`Chip`/`AssetChip` 的 props(`icon/label/onRemove/removeLabel`、`assetKey/onRemove`)在 Task 2 定义、Task 3/4 使用一致;`raised-active` variant 在 Task 5 定义、Task 6 使用一致。
