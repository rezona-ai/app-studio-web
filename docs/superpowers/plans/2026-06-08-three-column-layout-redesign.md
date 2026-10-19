# 三栏布局重实现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 Figma `8:1373` 重排三栏外壳(英文文案、中性 Inter 设计系统、双击新增资产菜单),底层功能保留。

**Architecture:** 去掉全宽 `Toolbar`,功能拆进左/右栏头部;新建 `src/components/ui/` 三个原子件统一按钮样式;新增 `AddAssetMenu` + `lib/assets.ts`(纯工厂)+ store `addAsset` 让双击空白画布能落资产;其余组件原地换皮,React Flow 力导向 / WS / store 逻辑不动。

**Tech Stack:** Next.js 16 · React 19 · @xyflow/react v12 · react-resizable-panels v4 · zustand v5 · Tailwind v4 · lucide-react(新增)· vitest。

设计依据:`docs/superpowers/specs/2026-06-08-three-column-layout-redesign-design.md`

---

### Task 0: 加 lucide-react 图标依赖

**Files:** `package.json`(自动)

- [ ] **Step 1: 安装**

Run: `pnpm add lucide-react`
Expected: `package.json` dependencies 出现 `lucide-react`,无报错。

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "新增 lucide-react 图标依赖"
```

---

### Task 1: 设计 token + Inter 字体 + 清理 brand 色

**Files:**
- Modify: `src/app/globals.css`(整文件替换)
- Modify: `src/app/layout.tsx`(整文件替换)
- Modify: `src/components/canvas/nodes/{ImageNode,VideoNode,AudioNode,ThreeDNode,DocNode}.tsx`(选中边框色)
- Modify: `src/components/chat/MessageItem.tsx`(用户文字色)

- [ ] **Step 1: 重写 `src/app/globals.css`**

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;

  /* 文字 */
  --color-ink: #121212;
  --color-muted: #7b7b7b;

  /* 表面 / 填充 */
  --color-surface: #fcfcfc;
  --color-surface-2: #f8f7f7;
  --color-fill: #f1f1f1;
  --color-canvas: #f8f7f7;

  /* 描边 */
  --color-line: #ececec;
  --color-line-2: #e2e2e2;

  /* 强调:仅 Live 绿 */
  --color-live: #49ba61;

  /* 预览舞台底色(GameFrame/CompareView 仍用) */
  --color-preview-bg: #14121c;

  /* 资产类型色(画布节点保留) */
  --color-image: #6c8cff;
  --color-video: #ff8a4c;
  --color-audio: #28c2a8;
  --color-3d: #a06bff;
  --color-doc: #f2c64b;

  /* 圆角 */
  --radius-card: 12px;
  --radius-control: 8px;
}

:root {
  --shadow-toolbar: 0 8px 16px -12px #00000020, 0 1px 4px -4px #00000013;
  --shadow-button: 0 0 0 1px #d4d4d4, inset 0 1px 0 #ffffff54, 0 3px 4px -1px #00000026;
  --shadow-prompt: 0 8px 16px -12px #00000013, inset 0 2px 0 #ffffff, 0 18px 24px -20px #00000020;
}

html, body, #__app { height: 100%; }
body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
```

> 注:已移除 `--color-brand`(蓝)。

- [ ] **Step 2: 重写 `src/app/layout.tsx`(注入 Inter)**

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = { title: 'Taluna · Game Agent', description: 'AI 游戏生成平台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body><div id="__app">{children}</div></body>
    </html>
  );
}
```

> 若沙箱构建无法联网拉 Google 字体:改用本地字体 —— `pnpm add @fontsource/inter`,在 `layout.tsx` 顶部 `import '@fontsource/inter/400.css'` 等,删掉 `next/font/google`,并把 `--font-inter` 直接设为 `"Inter"`。

- [ ] **Step 3: 清理节点选中边框 brand → ink**

Run: `sed -i '' 's/border-\[var(--color-brand)\]/border-[var(--color-ink)]/g' src/components/canvas/nodes/ImageNode.tsx src/components/canvas/nodes/VideoNode.tsx src/components/canvas/nodes/AudioNode.tsx src/components/canvas/nodes/ThreeDNode.tsx src/components/canvas/nodes/DocNode.tsx`
Expected: 5 文件中 `--color-brand` 替换为 `--color-ink`。

- [ ] **Step 4: MessageItem 用户文字 brand → ink**

Run: `sed -i '' 's/text-\[var(--color-brand)\]/text-[var(--color-ink)]/g' src/components/chat/MessageItem.tsx`
Expected: 该文件不再引用 `--color-brand`。

- [ ] **Step 5: 确认无残留 brand 引用(Composer/Workspace/PreviewPanel/VersionTimeline 将在后续任务整文件替换)**

Run: `grep -rn "color-brand" src/ || echo "CLEAN"`
Expected: 仅剩 `Composer.tsx`、`Workspace.tsx`、`PreviewPanel.tsx`、`VersionTimeline.tsx`(均后续整文件替换),无其它。

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/canvas/nodes src/components/chat/MessageItem.tsx
git commit -m "设计 token 改造:Inter 字体、中性浅色体系、移除蓝色 brand"
```

---

### Task 2: UI 原子件 Button / IconButton / Badge

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/IconButton.tsx`
- Create: `src/components/ui/Badge.tsx`

- [ ] **Step 1: `src/components/ui/Button.tsx`**

```tsx
'use client';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'light' | 'dark' | 'ghost';

const VARIANT: Record<Variant, string> = {
  light: 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-button)] hover:bg-[var(--color-surface-2)]',
  dark: 'bg-[var(--color-ink)] text-white hover:opacity-90',
  ghost: 'text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
};

export default function Button({
  variant = 'light',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
    />
  );
}
```

- [ ] **Step 2: `src/components/ui/IconButton.tsx`**

```tsx
'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'ghost' | 'filled';

const VARIANT: Record<Variant, string> = {
  ghost: 'text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  filled: 'bg-[var(--color-ink)] text-white hover:opacity-90',
};

export default function IconButton({
  variant = 'ghost',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      {...props}
      className={`grid place-items-center rounded-[var(--radius-control)] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
```

> 尺寸由调用方传 `className`(如 `h-8 w-8`)。

- [ ] **Step 3: `src/components/ui/Badge.tsx`**

```tsx
'use client';
import type { ReactNode } from 'react';

export default function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-live)] px-2 py-0.5 text-[11px] font-medium text-white">
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/ui
git commit -m "新增 UI 原子件:Button/IconButton/Badge"
```

---

### Task 3: 资产工厂 + mime 推断(纯函数,TDD)

**Files:**
- Create: `src/lib/assets.ts`
- Test: `src/lib/assets.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/assets.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { makeAsset, kindFromMime } from './assets';

describe('makeAsset', () => {
  test('默认值:类型/标签/来源/状态/pinned/位置', () => {
    const a = makeAsset('image');
    expect(a.kind).toBe('image');
    expect(a.label).toBe('Image');
    expect(a.source).toBe('generated');
    expect(a.status).toBe('ready');
    expect(a.pinned).toBe(true);
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.key).toBe(a.id);
  });

  test('doc 默认标签为 Text;可覆盖 label 与 position', () => {
    const a = makeAsset('doc', { label: 'My note', position: { x: 10, y: 20 } });
    expect(a.label).toBe('My note');
    expect(a.position).toEqual({ x: 10, y: 20 });
    const d = makeAsset('doc');
    expect(d.label).toBe('Text');
  });

  test('上传来源带 preview', () => {
    const a = makeAsset('image', { source: 'uploaded', preview: { dataUrl: 'd', src: 'd' } });
    expect(a.source).toBe('uploaded');
    expect(a.preview).toEqual({ dataUrl: 'd', src: 'd' });
  });
});

describe('kindFromMime', () => {
  test('按前缀映射,未知归 doc', () => {
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('text/plain')).toBe('doc');
    expect(kindFromMime('')).toBe('doc');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/assets.test.ts`
Expected: FAIL —— 模块 `./assets` 不存在。

- [ ] **Step 3: 实现 `src/lib/assets.ts`**

```ts
import { newId } from './ids';
import type { Asset, AssetSource, AssetPreviewData } from '@/store/types';
import type { AssetKind } from '@/agent-protocol/messages';

const KIND_LABEL: Record<AssetKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D World',
  doc: 'Text',
};

export interface NewAssetOpts {
  label?: string;
  source?: AssetSource;
  preview?: AssetPreviewData;
  position?: { x: number; y: number };
}

// 本地新增资产工厂:id=key,pinned 避免力导向重排手动添加的节点
export function makeAsset(kind: AssetKind, opts: NewAssetOpts = {}): Asset {
  const id = newId('a');
  return {
    id,
    key: id,
    label: opts.label ?? KIND_LABEL[kind],
    kind,
    source: opts.source ?? 'generated',
    status: 'ready',
    position: opts.position ?? { x: 0, y: 0 },
    pinned: true,
    preview: opts.preview,
  };
}

// 由文件 mime 前缀推断资产类型,未知归 doc
export function kindFromMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'doc';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/assets.test.ts`
Expected: PASS（6 个断言全绿)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/assets.ts src/lib/assets.test.ts
git commit -m "新增资产工厂 makeAsset 与 mime 推断 kindFromMime(含单测)"
```

---

### Task 4: store `addAsset` 动作(TDD)

**Files:**
- Modify: `src/store/index.ts`(Actions 接口 + 实现 + saveVersion summary 英文化)
- Test: `src/store/add-asset.test.ts`

- [ ] **Step 1: 写失败测试 `src/store/add-asset.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';

describe('store.addAsset', () => {
  beforeEach(() => useStore.setState({ assets: [] }));

  test('追加一个指定类型的 pinned 资产', () => {
    useStore.getState().addAsset('image');
    const assets = useStore.getState().assets;
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('image');
    expect(assets[0].pinned).toBe(true);
    expect(assets[0].status).toBe('ready');
  });

  test('透传 position 与 source/preview', () => {
    useStore.getState().addAsset('audio', { source: 'uploaded', position: { x: 5, y: 6 }, preview: { dataUrl: 'd' } });
    const a = useStore.getState().assets[0];
    expect(a.position).toEqual({ x: 5, y: 6 });
    expect(a.source).toBe('uploaded');
    expect(a.preview).toEqual({ dataUrl: 'd' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/add-asset.test.ts`
Expected: FAIL —— `addAsset is not a function`。

- [ ] **Step 3: 在 `src/store/index.ts` 顶部加导入**

在 `import { newId } from '@/lib/ids';` 下一行加:

```ts
import { makeAsset, type NewAssetOpts } from '@/lib/assets';
```

- [ ] **Step 4: Actions 接口加声明**

在 `interface Actions { ... }` 内,`setSearchOpen` 上方加一行:

```ts
  addAsset: (kind: AssetKind, opts?: NewAssetOpts) => void;
```

- [ ] **Step 5: 实现该动作**

在 store 实现里 `setSearchOpen: (searchOpen) => set({ searchOpen }),` 上方加:

```ts
      addAsset: (kind, opts) => set((s) => ({ assets: [...s.assets, makeAsset(kind, opts)] })),
```

- [ ] **Step 6: saveVersion 摘要英文化(UI 一致)**

把 `src/store/index.ts` 中 `summary: '手动保存',` 改为:

```ts
            summary: 'Manual save',
```

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/add-asset.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/store/index.ts src/store/add-asset.test.ts
git commit -m "store 新增 addAsset 动作并英文化版本摘要(含单测)"
```

---

### Task 5: AddAssetMenu 组件(双击画布弹出的新增资产菜单)

**Files:**
- Create: `src/components/canvas/AddAssetMenu.tsx`

- [ ] **Step 1: 实现 `src/components/canvas/AddAssetMenu.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import { Type, Image as ImageIcon, Video, AudioLines, Box, Upload, type LucideIcon } from 'lucide-react';
import { useStore } from '@/store';
import { kindFromMime } from '@/lib/assets';
import type { AssetKind } from '@/agent-protocol/messages';

const ITEMS: { kind: AssetKind; label: string; Icon: LucideIcon }[] = [
  { kind: 'doc', label: 'Text', Icon: Type },
  { kind: 'image', label: 'Image', Icon: ImageIcon },
  { kind: 'video', label: 'Video', Icon: Video },
  { kind: 'audio', label: 'Audio', Icon: AudioLines },
  { kind: '3d', label: '3D World', Icon: Box },
];

export default function AddAssetMenu({
  x, y, flowPos, onClose,
}: {
  x: number;
  y: number;
  flowPos: { x: number; y: number };
  onClose: () => void;
}) {
  const addAsset = useStore((s) => s.addAsset);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (kind: AssetKind) => {
    addAsset(kind, { position: flowPos });
    onClose();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      addAsset(kindFromMime(f.type), {
        label: f.name,
        source: 'uploaded',
        preview: { dataUrl: String(reader.result), src: String(reader.result) },
        position: flowPos,
      });
      onClose();
    };
    reader.readAsDataURL(f);
  };

  const row =
    'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-fill)]';
  const groupLabel = 'px-2 pb-1 pt-2 text-[11px] font-medium text-[var(--color-muted)]';

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="fixed z-50 w-52 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-toolbar)]"
        style={{ left: x, top: y }}
      >
        <div className={groupLabel}>Add notes</div>
        {ITEMS.map(({ kind, label, Icon }) => (
          <button key={kind} className={row} onClick={() => add(kind)}>
            <Icon size={16} className="text-[var(--color-muted)]" />
            {label}
          </button>
        ))}
        <div className={groupLabel}>Add source</div>
        <button className={row} onClick={() => fileRef.current?.click()}>
          <Upload size={16} className="text-[var(--color-muted)]" />
          <span className="flex flex-col leading-tight">
            <span>Upload</span>
            <span className="text-[11px] text-[var(--color-muted)]">Image/ Video/ Audio</span>
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={onFile}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/canvas/AddAssetMenu.tsx
git commit -m "新增 AddAssetMenu(双击画布弹出的新增资产菜单,去掉 Utilities)"
```

---

### Task 6: ChatPanel 头部 + 搜索 + 空态

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`(整文件替换)

- [ ] **Step 1: 重写 `src/components/chat/ChatPanel.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { Search, ChevronDown, Sparkles } from 'lucide-react';
import { useStore } from '@/store';
import MessageItem from './MessageItem';
import Composer from './Composer';
import type { AgentClient } from '@/client/ws-client';

export default function ChatPanel({ client }: { client: React.RefObject<AgentClient | null> }) {
  const messages = useStore((s) => s.messages);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex h-full flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* 头部:logo + 项目名 */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#49ba61] to-[#28c2a8] text-white">
          <Sparkles size={16} />
        </span>
        <button className="flex items-center gap-1 text-[15px] font-semibold text-[var(--color-ink)]">
          Project name
          <ChevronDown size={16} className="text-[var(--color-muted)]" />
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-3 pb-2">
        <button
          onClick={() => setSearchOpen(true)}
          className="flex w-full items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-fill)] px-3 py-2 text-[13px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-line)]"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Search ...</span>
          <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] shadow-sm">⌘K</span>
        </button>
      </div>

      {/* 消息区(空态居中欢迎语) */}
      <div className="flex-1 overflow-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[15px] text-[var(--color-muted)]">
            Hi there, what game are we making today
          </div>
        ) : (
          messages.map((m) => <MessageItem key={m.id} message={m} />)
        )}
        <div ref={endRef} />
      </div>

      <Composer client={client} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/chat/ChatPanel.tsx
git commit -m "ChatPanel 换皮:logo+项目名头部、搜索框、空态欢迎语"
```

---

### Task 7: Composer 换皮成 Prompt Input 卡片(逻辑保留)

**Files:**
- Modify: `src/components/chat/Composer.tsx`(整文件替换)

- [ ] **Step 1: 重写 `src/components/chat/Composer.tsx`**

```tsx
'use client';
import { useRef, useState } from 'react';
import { Plus, AtSign, ArrowUp, Square } from 'lucide-react';
import { useStore } from '@/store';
import { getActiveMention } from '@/lib/refs';
import { newId } from '@/lib/ids';
import MentionPopover from './MentionPopover';
import AttachmentBar from './AttachmentBar';
import IconButton from '@/components/ui/IconButton';
import type { AgentClient } from '@/client/ws-client';

export default function Composer({ client }: { client: React.RefObject<AgentClient | null> }) {
  const { draft, refs, attachments } = useStore((s) => s.composer);
  const composerSet = useStore((s) => s.composerSet);
  const addRef = useStore((s) => s.addRef);
  const resetComposer = useStore((s) => s.resetComposer);
  const pushUserMessage = useStore((s) => s.pushUserMessage);
  const runStatus = useStore((s) => s.runStatus);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    composerSet({ draft: e.target.value });
    setMention(getActiveMention(e.target.value, e.target.selectionStart ?? e.target.value.length));
  };

  const pickMention = (key: string) => {
    if (mention) {
      const cur = useStore.getState().composer.draft;
      const next = cur.slice(0, mention.start) + cur.slice(mention.start + 1 + mention.query.length);
      composerSet({ draft: next });
    }
    addRef(key);
    setMention(null);
    taRef.current?.focus();
  };

  const startMention = () => {
    composerSet({ draft: draft + '@' });
    setMention({ query: '', start: draft.length });
    taRef.current?.focus();
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => {
      if (f.size > 1_000_000) return; // 单文件 ≤ ~1MB
      const reader = new FileReader();
      reader.onload = () =>
        composerSet({
          attachments: [
            ...useStore.getState().composer.attachments,
            { name: f.name, mime: f.type, dataUrl: String(reader.result) },
          ],
        });
      reader.readAsDataURL(f);
    });
  };

  const send = () => {
    if (!draft.trim() || runStatus === 'running') return;
    pushUserMessage({
      id: newId('msg'),
      role: 'user',
      status: 'ready',
      parts: [{ type: 'text', text: draft }],
      refs: [...refs],
      attachments: attachments.map(({ name, mime }) => ({ name, mime })),
    });
    client.current?.sendUserInput({
      text: draft,
      refs,
      attachments,
      baseVersionId: useStore.getState().activeVersionId,
    });
    resetComposer();
  };

  return (
    <div className="p-3">
      <AttachmentBar />
      <div className="relative rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-prompt)]">
        {mention && <MentionPopover query={mention.query} onPick={pickMention} />}
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
          placeholder="Great to see you, what game do you want to make today…"
          className="w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-[var(--color-muted)]"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <IconButton variant="ghost" className="h-8 w-8" aria-label="Attach" onClick={() => fileRef.current?.click()}>
              <Plus size={18} />
            </IconButton>
            <IconButton
              variant="ghost"
              className="h-8 w-8"
              aria-label="Mention"
              onMouseDown={(e) => { e.preventDefault(); startMention(); }}
            >
              <AtSign size={17} />
            </IconButton>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} />
          </div>
          {runStatus === 'running' ? (
            <IconButton variant="filled" className="h-8 w-8" aria-label="Stop" onClick={() => client.current?.abort()}>
              <Square size={14} />
            </IconButton>
          ) : (
            <IconButton variant="filled" className="h-8 w-8" aria-label="Send" onClick={send}>
              <ArrowUp size={18} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/chat/Composer.tsx
git commit -m "Composer 换皮成 Prompt Input 卡片(+/@ 图标键、圆形发送,逻辑保留)"
```

---

### Task 8: AssetCanvas 换皮(点阵、空态、双击新增、浮动缩放条)

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(整文件替换)

- [ ] **Step 1: 重写 `src/components/canvas/AssetCanvas.tsx`**

```tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useViewport,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Undo2, Redo2, ChevronDown, MousePointer2 } from 'lucide-react';
import { useStore } from '@/store';
import { selectCanvasNodes, selectCanvasEdges } from '@/store/selectors';
import { nodeTypes } from './nodeTypes';
import { runForceLayout, type LayoutNode } from '@/lib/force-layout';
import { zonesMap } from '@/lib/zones';
import IconButton from '@/components/ui/IconButton';
import AddAssetMenu from './AddAssetMenu';

// 空态:画布无资产时的居中提示(pointer-events-none 让双击穿透到 pane)
function CanvasEmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-2 text-[15px] text-[var(--color-muted)]">
      <p>AI-generated assets will appear here.</p>
      <p className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-fill)] px-2.5 py-1 text-[13px] font-semibold text-[var(--color-ink)]">
          <MousePointer2 size={14} />
          Double-click
        </span>
        on a blank space can also generate them directly.
      </p>
    </div>
  );
}

// 底部浮动缩放条:缩放预设 + (装饰性禁用) undo/redo
function ZoomBar() {
  const { fitView, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  const [open, setOpen] = useState(false);
  const presets: { label: string; fn: () => void }[] = [
    { label: 'Fit view', fn: () => fitView({ duration: 200 }) },
    { label: '50%', fn: () => zoomTo(0.5, { duration: 200 }) },
    { label: '100%', fn: () => zoomTo(1, { duration: 200 }) },
    { label: '200%', fn: () => zoomTo(2, { duration: 200 }) },
  ];
  return (
    <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
      {open && (
        <div className="absolute bottom-11 left-0 w-32 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-toolbar)]">
          {presets.map((p) => (
            <button
              key={p.label}
              className="block w-full rounded-[6px] px-2 py-1 text-left text-[13px] hover:bg-[var(--color-fill)]"
              onClick={() => { p.fn(); setOpen(false); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-1 shadow-[var(--shadow-toolbar)]">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[13px] font-medium hover:bg-[var(--color-fill)]"
        >
          {Math.round(zoom * 100)}%
          <ChevronDown size={14} className="text-[var(--color-muted)]" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--color-line)]" />
        <IconButton disabled className="h-7 w-7" aria-label="Undo"><Undo2 size={15} /></IconButton>
        <IconButton disabled className="h-7 w-7" aria-label="Redo"><Redo2 size={15} /></IconButton>
      </div>
    </div>
  );
}

function Inner() {
  const assets = useStore((s) => s.assets);
  const visibleKinds = useStore((s) => s.visibleKinds);
  const setAssetPosition = useStore((s) => s.setAssetPosition);
  const setAssetPositions = useStore((s) => s.setAssetPositions);
  const selectAsset = useStore((s) => s.selectAsset);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const { screenToFlowPosition } = useReactFlow();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const isDraggingRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number } } | null>(null);

  // 力导向:仅对新出现的未 pinned 资产跑一次(原逻辑保留)
  useEffect(() => {
    const fresh = assets.filter((a) => !a.pinned && !seenIdsRef.current.has(a.id));
    if (fresh.length === 0) {
      assets.forEach((a) => seenIdsRef.current.add(a.id));
      return;
    }
    fresh.forEach((a) => seenIdsRef.current.add(a.id));
    const input: LayoutNode[] = assets.map((a) => ({
      id: a.id, kind: a.kind, x: a.position.x, y: a.position.y, pinned: a.pinned,
    }));
    const out = runForceLayout(input, zonesMap());
    const updates = out
      .filter((n) => !assets.find((a) => a.id === n.id)?.pinned)
      .map((n) => ({ id: n.id, x: n.x, y: n.y }));
    setAssetPositions(updates);
  }, [assets, setAssetPositions]);

  // store assets → RF 节点同步(拖动中跳过)
  useEffect(() => {
    if (isDraggingRef.current) return;
    const visibleAssets = assets.filter((a) => visibleKinds.includes(a.kind));
    setRfNodes(selectCanvasNodes(visibleAssets, selectedAssetId) as unknown as Node[]);
  }, [assets, visibleKinds, selectedAssetId, setRfNodes]);

  const edges = useMemo(() => selectCanvasEdges(assets), [assets]);

  // 双击空白 pane → 在光标处打开新增资产菜单
  const onPaneDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) return;
    setAddMenu({
      x: e.clientX,
      y: e.clientY,
      flowPos: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    });
  };

  return (
    <div className="relative h-full bg-[var(--color-canvas)]" onDoubleClick={onPaneDoubleClick}>
      {assets.length === 0 && <CanvasEmptyState />}

      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: 'var(--color-line-2)', strokeDasharray: '4 4' } }}
        onNodeClick={(_, n) => selectAsset(n.id)}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          selectAsset(n.id);
          openContextMenu({ id: n.id, x: e.clientX, y: e.clientY });
        }}
        onNodeDragStart={() => { isDraggingRef.current = true; }}
        onNodeDragStop={(_, node) => {
          setAssetPosition(node.id, node.position.x, node.position.y, true);
          setTimeout(() => { isDraggingRef.current = false; }, 0);
        }}
        onPaneClick={() => { selectAsset(null); openContextMenu(null); }}
        zoomOnDoubleClick={false}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#e2e2e2" gap={20} size={1.5} />
      </ReactFlow>

      <ZoomBar />
      {addMenu && (
        <AddAssetMenu x={addMenu.x} y={addMenu.y} flowPos={addMenu.flowPos} onClose={() => setAddMenu(null)} />
      )}
    </div>
  );
}

export default function AssetCanvas() {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR 水合防护需同步 mount
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div className="h-full bg-[var(--color-canvas)]" />;
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
```

> 改动点:移除左上类型 chips、底部提示条、`<Controls>`、`toggleKind`/`ZONE_*`/`AssetKind` 引用;`Background` 改 dots;新增双击触发、空态、`ZoomBar`、`AddAssetMenu`。`visibleKinds` 过滤逻辑保留。

- [ ] **Step 2: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "AssetCanvas 换皮:点阵背景、空态提示、双击新增资产、底部浮动缩放条"
```

---

### Task 9: PreviewPanel 头部 + Live preview 子栏 + 预览区空态

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`(整文件替换)

> 映射决策:Figma 预览头部无独立"保存"键 → **Publish 按钮绑定 `saveVersion`**(把当前草稿快照为版本,Versions 列表随之更新)。download/play 沿用原 ZIP/试玩占位(原本即占位)。DeviceToggle 不再渲染,保留 `device` 状态默认 `mobile`。

- [ ] **Step 1: 重写 `src/components/preview/PreviewPanel.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Share2, Download, Play } from 'lucide-react';
import { useStore } from '@/store';
import { selectActiveVersion } from '@/store/selectors';
import GameFrame from './GameFrame';
import CompareView from './CompareView';
import VersionTimeline from './VersionTimeline';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Badge from '@/components/ui/Badge';

export default function PreviewPanel() {
  const [device] = useState<'mobile' | 'desktop'>('mobile');
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const compareOn = useStore((s) => s.compare.on);
  const saveVersion = useStore((s) => s.saveVersion);
  const active = selectActiveVersion(versions, activeId);
  const hasGame = versions.length > 0;

  return (
    <div className="flex h-full flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* 头部:草稿名 + Live + 分享 + Publish */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{active?.label ?? 'Draft_1'}</span>
          <Badge>Live</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton variant="ghost" className="h-8 w-8" aria-label="Share"><Share2 size={16} /></IconButton>
          <Button variant="light" onClick={saveVersion}>Publish</Button>
        </div>
      </div>

      {/* Live preview 子栏 */}
      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-[13px] font-medium text-[var(--color-muted)]">Live preview</span>
        <div className="flex items-center gap-1.5">
          <IconButton variant="ghost" className="h-8 w-8" aria-label="Download ZIP"><Download size={16} /></IconButton>
          <IconButton variant="filled" className="h-8 w-8" aria-label="Play"><Play size={14} /></IconButton>
        </div>
      </div>

      {/* 预览区:有版本→GameFrame/CompareView;无版本→空态 */}
      <div className="flex-1 overflow-hidden px-4 pb-2">
        {hasGame ? (
          <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)]">
            {compareOn ? <CompareView device={device} /> : <GameFrame version={active} device={device} />}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-card)] bg-[var(--color-fill)] px-8 text-center text-[14px] text-[var(--color-muted)]">
            Live preview, save as version, export as ZIP here.
          </div>
        )}
      </div>

      <VersionTimeline />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/preview/PreviewPanel.tsx
git commit -m "PreviewPanel 换皮:Draft·Live 头部、Live preview 子栏、预览区空态(Publish→saveVersion)"
```

---

### Task 10: VersionTimeline 换皮(英文 + 新 token)

**Files:**
- Modify: `src/components/preview/VersionTimeline.tsx`(整文件替换)

- [ ] **Step 1: 重写 `src/components/preview/VersionTimeline.tsx`**

```tsx
'use client';
import { ArrowLeftRight } from 'lucide-react';
import { useStore } from '@/store';

export default function VersionTimeline() {
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const setActive = useStore((s) => s.setActiveVersion);
  const toggleCompare = useStore((s) => s.toggleCompare);
  const compareOn = useStore((s) => s.compare.on);
  const compareWithId = useStore((s) => s.compare.withId);
  const setCompareWith = useStore((s) => s.setCompareWith);
  const canCompare = versions.length > 1;

  return (
    <div className="border-t border-[var(--color-line)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-medium text-[var(--color-muted)]">Versions</span>
        <button
          onClick={toggleCompare}
          disabled={!canCompare}
          className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            compareOn ? 'bg-[var(--color-ink)] text-white' : 'text-[var(--color-ink)] hover:bg-[var(--color-fill)]'
          }`}
        >
          <ArrowLeftRight size={13} />
          Compare
        </button>
      </div>
      <div className="flex max-h-44 flex-col gap-1.5 overflow-auto">
        {versions.length === 0 && <p className="text-[12px] text-[var(--color-muted)]">No versions yet.</p>}
        {[...versions].reverse().map((v) => {
          const active = v.id === activeId;
          const comparePicked = compareOn && v.id === compareWithId;
          const border = comparePicked
            ? 'border-[var(--color-live)] bg-[var(--color-live)]/5'
            : active
              ? 'border-[var(--color-ink)] bg-[var(--color-fill)]'
              : 'border-[var(--color-line)]';
          return (
            <button
              key={v.id}
              onClick={() => (compareOn ? setCompareWith(v.id) : setActive(v.id))}
              className={`rounded-[var(--radius-control)] border px-3 py-2 text-left ${border}`}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {v.label}
                {v.current && (
                  <span className="rounded bg-[var(--color-ink)] px-1.5 py-0.5 text-[10px] text-white">CURRENT</span>
                )}
              </div>
              <div className="text-[12px] text-[var(--color-muted)]">
                {v.summary} · {new Date(v.createdAt).toLocaleString('en-US')}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/preview/VersionTimeline.tsx
git commit -m "VersionTimeline 换皮:英文 Versions/Compare、新 token 配色"
```

---

### Task 11: Workspace 去 Toolbar + 列宽调整 + 删 Toolbar.tsx

**Files:**
- Modify: `src/components/workspace/Workspace.tsx`(整文件替换)
- Delete: `src/components/workspace/Toolbar.tsx`

- [ ] **Step 1: 重写 `src/components/workspace/Workspace.tsx`**

```tsx
'use client';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useAgentConnection } from '@/client/useAgentConnection';
import SearchPalette from './SearchPalette';
import ChatPanel from '@/components/chat/ChatPanel';
import AssetCanvas from '@/components/canvas/AssetCanvas';
import ContextMenu from '@/components/canvas/ContextMenu';
import PreviewPanel from '@/components/preview/PreviewPanel';

// 列间分隔条:1px 描边,悬停略深
const Handle = () => (
  <Separator className="w-px bg-[var(--color-line)] transition-colors hover:bg-[var(--color-line-2)]" />
);

export default function Workspace() {
  const client = useAgentConnection();
  return (
    <div className="h-full">
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize={22} minSize={18}>
          <ChatPanel client={client} />
        </Panel>
        <Handle />
        <Panel defaultSize={56} minSize={30}>
          <AssetCanvas />
        </Panel>
        <Handle />
        <Panel defaultSize={22} minSize={18}>
          <PreviewPanel />
        </Panel>
      </Group>
      <ContextMenu client={client} />
      <SearchPalette />
    </div>
  );
}
```

- [ ] **Step 2: 删除 Toolbar**

Run: `git rm src/components/workspace/Toolbar.tsx`
Expected: 文件删除。

- [ ] **Step 3: 确认无 Toolbar 残留引用**

Run: `grep -rn "workspace/Toolbar\|from './Toolbar'" src/ || echo "CLEAN"`
Expected: `CLEAN`。

- [ ] **Step 4: Typecheck + Commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/workspace/Workspace.tsx
git commit -m "Workspace 去掉全宽 Toolbar、调三栏列宽、删除 Toolbar 组件"
```

---

### Task 12: 全量验证(lint / test / 浏览器截图比对 / 交互回归)

**Files:** 无(仅验证)

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: 通过(无 error)。

- [ ] **Step 2: 单元测试**

Run: `pnpm test`
Expected: 全绿(含新增 `assets.test.ts`、`add-asset.test.ts`)。

- [ ] **Step 3: 构建确认(SSR/字体/类型)**

Run: `pnpm build`
Expected: 构建成功。若 Inter 字体拉取失败,按 Task 1 Step 2 备注切到 `@fontsource/inter`。

- [ ] **Step 4: 启动并用 Playwright 截图比对**

Run: `pnpm dev`(后台),浏览器访问 `http://localhost:3000`。
- `browser_resize` 到 1440×900。
- `browser_take_screenshot` 全页。
- 逐栏对照 Figma `8:1373` 截图:左栏(logo/项目名/搜索/欢迎语/Prompt 输入卡)、中栏(点阵/空态两行+Double-click pill/底部缩放条)、右栏(Draft_1·Live/分享/Publish、Live preview+下载+播放、预览区空态、Versions+Compare)。

- [ ] **Step 5: 交互回归(浏览器手动验证)**

- 点搜索框 → 打开 SearchPalette;按 `⌘K` 同样打开。
- 在 Composer 输入 + 回车 → 用户消息进入消息区;`@` 键触发 mention 弹层;`+` 选文件进 AttachmentBar。
- **双击空白画布** → 弹出 AddAssetMenu(仅 Add notes / Add source 两组);点 `Image`/`Text` 等 → 画布出现对应类型节点(空态消失);`Upload` 选图片 → 出现 uploaded 节点。
- 底部缩放条:点 `100% ⌄` 选 Fit/50%/100%/200% 生效;undo/redo 为禁用态。
- 右栏 `Publish` → Versions 出现新版本;>1 版本后 `Compare` 可点。
- 节点右键 → 派生菜单仍可用。

- [ ] **Step 6: 最终提交(若验证中有微调)**

```bash
git add -A
git commit -m "三栏布局 Figma 重实现:验证通过与微调"
```

---

## Self-Review(写完后自检)

- **Spec 覆盖**:token/字体(T1)、原子件(T2)、AddAssetMenu+addAsset(T3/4/5)、左栏(T6/7)、中栏(T8)、右栏(T9/10)、Workspace 去 Toolbar(T11)、验证(T12)—— 全覆盖。左栏不折叠 ✅(Workspace 无 collapsible、ChatPanel 头部无折叠键)。Utilities 已去 ✅(AddAssetMenu 仅两组)。双击触发 ✅。
- **占位扫描**:无 TBD/TODO 式占位;download/play/undo/redo 为有意的装饰/占位(沿用原占位语义),已在对应任务说明。
- **类型一致**:`makeAsset`/`kindFromMime`/`NewAssetOpts` 在 T3 定义,T4/T5 引用一致;`addAsset(kind, opts?)` 签名贯穿一致;`AddAssetMenu` props(x/y/flowPos/onClose)与 AssetCanvas 调用一致。
