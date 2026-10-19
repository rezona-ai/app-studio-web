# 预览面板分享按钮 + 游玩链接弹窗 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在预览面板下载 ZIP 按钮左侧加一个分享按钮,点击弹出小型模态展示当前选中版本的公开游玩直链并支持一键复制。

**Architecture:** 链接由纯函数 `buildPlayUrl` 拼接(`{NEXT_PUBLIC_PGC_BASE_URL}/game/pgcserver/pv/{public_id}/v{seq}/dist/index.html`,与 `resolveAssetUrl` 同源,指向 PGC 公开域名,不经 apiPath);弹窗 `SharePopover` 复用 `CreateGameModal` 模态范式;`PreviewPanel` 取原料、管开关、放按钮。

**Tech Stack:** Next.js 16 / React 19 / zustand / Vitest(jsdom + globals)/ Tailwind(CSS 变量令牌)/ lucide-react(图标)。

## Global Constraints

- 代码注释 / commit message 一律用**中文**;commit 一句话总结。
- 复用既有设计令牌 / 基础组件 / 动效类:颜色走 `var(--color-*)`,**禁硬编码色值**;按钮用 `Button`/`IconButton`,**不新建按钮种类**;模态用 `modal-backdrop`+`modal-pop`+`useRequestClose`,**不写一次性 keyframes**。
- 纯逻辑下沉 `lib/` 且无副作用;测试与源码**同目录**(`*.test.ts(x)`)。
- `buildPlayUrl` 产出的是 **PGC 公开域名直链**(供他人打开),故**不经** `apiPath()`/`assetPath()`(那是本服务 `/api` 与 `public/` 用);读 env 方式与 `resolveAssetUrl` 完全一致。
- 所有交互元素配 `aria-label` 或包 `Tooltip`。
- TDD:先写失败测试,最小实现,跑绿,提交。

---

### Task 1: `buildPlayUrl` 纯函数 + 单测

**Files:**
- Modify: `src/lib/pgc/url.ts`
- Test: `src/lib/pgc/url.test.ts`

**Interfaces:**
- Consumes: 模块常量 `PGC_PREFIX`(已在 `url.ts` 由 `@/lib/backend-routes` 导入)。
- Produces: `buildPlayUrl(publicId: string | null | undefined, versionSeq: number | null | undefined, entryPath?: string): string | null`。

- [ ] **Step 1: 追加失败测试**

在 `src/lib/pgc/url.test.ts` 末尾(`describe('resolveAssetUrl', …)` 之后)追加,并把首行 import 改为同时引入 `buildPlayUrl`:

```ts
import { resolveAssetUrl, buildPlayUrl } from './url';
```

```ts
describe('buildPlayUrl', () => {
  test('拼接公开游玩直链(默认入口 dist/index.html)', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://tlndev.taluna.ai');
    expect(buildPlayUrl('DakkYXUy', 5)).toBe(
      'https://tlndev.taluna.ai/game/pgcserver/pv/DakkYXUy/v5/dist/index.html',
    );
  });
  test('base 末尾斜杠归一', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://tlndev.taluna.ai/');
    expect(buildPlayUrl('abc', 1)).toBe(
      'https://tlndev.taluna.ai/game/pgcserver/pv/abc/v1/dist/index.html',
    );
  });
  test('自定义入口路径(去前导斜杠)', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://x');
    expect(buildPlayUrl('abc', 2, '/index.html')).toBe('https://x/game/pgcserver/pv/abc/v2/index.html');
  });
  test('缺 publicId / seq / base 时返回 null', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://x');
    expect(buildPlayUrl(null, 5)).toBeNull();
    expect(buildPlayUrl('abc', null)).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', '');
    expect(buildPlayUrl('abc', 5)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/url.test.ts`
Expected: FAIL(`buildPlayUrl is not a function` / 未导出)。

- [ ] **Step 3: 实现 `buildPlayUrl`**

在 `src/lib/pgc/url.ts` 末尾追加(`PGC_PREFIX` 已在文件顶部导入):

```ts
// 构造公开游玩直链:{base}/game/pgcserver/pv/{code}/v{seq}/{path}
// code=项目 public_id(见 2026-06-17-project-public-id-design.md:public_id 用于分享/预览链)。
// 读 NEXT_PUBLIC_PGC_BASE_URL + PGC_PREFIX,与 resolveAssetUrl 同源,指向 PGC 公开域名,
// 故不经 apiPath/basePath。缺 base/publicId/seq 时返回 null(调用方据此禁用分享按钮)。
export function buildPlayUrl(
  publicId: string | null | undefined,
  versionSeq: number | null | undefined,
  entryPath = 'dist/index.html',
): string | null {
  if (!publicId || versionSeq == null || !Number.isFinite(versionSeq)) return null;
  const base = (process.env.NEXT_PUBLIC_PGC_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}${PGC_PREFIX}/pv/${publicId}/v${versionSeq}/${entryPath.replace(/^\//, '')}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/url.test.ts`
Expected: PASS(含原 `resolveAssetUrl` 用例)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/pgc/url.ts src/lib/pgc/url.test.ts
git commit -m "feat: 新增 buildPlayUrl 纯函数拼接公开游玩直链"
```

---

### Task 2: `SharePopover` 分享弹窗组件 + 测试

**Files:**
- Create: `src/components/preview/SharePopover.tsx`
- Test: `src/components/preview/SharePopover.test.tsx`

**Interfaces:**
- Consumes: `useStore`(取 `setError`)、`useRequestClose`、`Button`、lucide-react 的 `Copy`/`Check`。
- Produces: `default function SharePopover({ url, onClose }: { url: string; onClose: () => void })`。

- [ ] **Step 1: 写失败测试**

创建 `src/components/preview/SharePopover.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SharePopover from './SharePopover';

afterEach(cleanup);

test('展示传入的 url', () => {
  render(<SharePopover url="https://x/game/pgcserver/pv/abc/v1/dist/index.html" onClose={() => {}} />);
  expect(screen.getByDisplayValue('https://x/game/pgcserver/pv/abc/v1/dist/index.html')).toBeInTheDocument();
});

test('点击 Copy 写入剪贴板并显示 Copied', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<SharePopover url="https://x/y" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(writeText).toHaveBeenCalledWith('https://x/y');
  await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/SharePopover.test.tsx`
Expected: FAIL(`Cannot find module './SharePopover'`)。

- [ ] **Step 3: 实现组件**

创建 `src/components/preview/SharePopover.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import Button from '@/components/ui/Button';

// 分享弹窗:展示当前选中版本的公开游玩直链 + 一键复制。复用 CreateGameModal 模态范式(modal-* + Esc/点遮罩关闭)。
export default function SharePopover({ url, onClose }: { url: string; onClose: () => void }) {
  const setError = useStore((s) => s.setError);
  const { closing, requestClose } = useRequestClose(onClose, 200);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 卸载清理复制反馈定时器
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用(非 https / 无权限):走全局 Toast 提示手动复制
      setError({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually', kind: 'notice' });
    }
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={requestClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[420px] flex-col gap-4 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">Share game</span>
        <div className="flex items-center gap-2">
          <input
            readOnly
            autoFocus
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 min-w-0 flex-1 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[13px] tracking-[-0.14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />
          <Button type="button" aria-label="Copy link" className="h-11 shrink-0 px-4" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/SharePopover.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/preview/SharePopover.tsx src/components/preview/SharePopover.test.tsx
git commit -m "feat: 新增 SharePopover 游玩链接分享弹窗"
```

---

### Task 3: `PreviewPanel` 接线分享按钮 + 弹窗 + 清理多余图标

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`
- Modify: `src/components/preview/PreviewPanel.test.tsx`
- Delete: `public/figma/icons/762f833b2b7abb39b41419883a7c27b96c91cd0c.svg`

**Interfaces:**
- Consumes: `buildPlayUrl`(Task 1)、`SharePopover`(Task 2)、`figAsset.share`(已注册)、store 的 `projects`/`currentProjectId`。

- [ ] **Step 1: 写失败测试**

在 `src/components/preview/PreviewPanel.test.tsx` 追加用例(无需新增 import —— `vi`/`afterEach`/`screen`/`within`/`fireEvent`/`waitFor` 均已在文件顶部导入)。在文件末尾追加:

```ts
test('分享按钮渲染在下载按钮左侧,配齐 projects/env 后可用', async () => {
  vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://tlndev.taluna.ai');
  useStore.setState({
    projects: [{ id: 7, public_id: 'DakkYXUy', name: 'G', cover_url: null, cover_source: null, current_version_id: null, status: 'ready', created_at: '', updated_at: '' }],
    currentProjectId: 7,
  });
  render(<PreviewPanel />);
  await flush();
  const statusBar = screen.getByText('Live preview').parentElement!;
  const share = within(statusBar).getByRole('button', { name: 'Share' });
  const download = within(statusBar).getByRole('button', { name: 'Download ZIP' });
  expect(share).toBeEnabled();
  // 左侧 = DOM 顺序在前
  expect(share.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('无 projects(无法拼链)时分享按钮禁用', async () => {
  render(<PreviewPanel />); // beforeEach 未设 projects
  await flush();
  expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
});

test('点击分享按钮弹出含游玩链接的弹窗', async () => {
  vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://tlndev.taluna.ai');
  useStore.setState({
    projects: [{ id: 7, public_id: 'DakkYXUy', name: 'G', cover_url: null, cover_source: null, current_version_id: null, status: 'ready', created_at: '', updated_at: '' }],
    currentProjectId: 7,
  });
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(await screen.findByDisplayValue('https://tlndev.taluna.ai/game/pgcserver/pv/DakkYXUy/v1/dist/index.html')).toBeInTheDocument();
});

test('Compare 模式隐藏分享按钮', async () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: 'v2' },
  });
  render(<PreviewPanel />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
});
```

并在文件顶部 `afterEach(cleanup);` 改为同时清理 env(避免污染相邻用例):

```ts
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
```

> 注:`makeVersion` 的 `index` 恒为 1,故链接版本段为 `v1`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: FAIL(找不到名为 `Share` 的按钮)。

- [ ] **Step 3: 实现 —— 改 `PreviewPanel.tsx`**

3a. 顶部 import 区追加:

```tsx
import SharePopover from './SharePopover';
import { buildPlayUrl } from '@/lib/pgc/url';
```

3b. 在组件内(`const active = …` 一行附近)追加 store 读取与派生:

```tsx
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const [shareOpen, setShareOpen] = useState(false);
```

并在 `const hasGame = …` 之后追加:

```tsx
  const publicId = projects.find((p) => p.id === currentProjectId)?.public_id ?? null;
  const shareUrl = buildPlayUrl(publicId, active?.index);
```

3c. 在「下载按钮」`<Tooltip>…Download ZIP…</Tooltip>` 整块**之前**插入分享按钮(使其位于下载左侧),同样仅 `!compareOn` 时显示:

```tsx
            {!compareOn && (
              <Tooltip>
                <IconButton
                  variant="bordered"
                  className="rounded-[12px] bg-[var(--color-surface-2)] p-2"
                  aria-label="Share"
                  disabled={!hasGame || !shareUrl}
                  onClick={() => setShareOpen(true)}
                >
                  <FigIcon src={figAsset.share} size={20} />
                </IconButton>
              </Tooltip>
            )}
```

3d. 在 `<VersionTimeline />` 之后(根 `</div>` 之前)渲染弹窗:

```tsx
      {shareOpen && shareUrl && <SharePopover url={shareUrl} onClose={() => setShareOpen(false)} />}
```

- [ ] **Step 4: 删除多余导出图标**

```bash
git rm public/figma/icons/762f833b2b7abb39b41419883a7c27b96c91cd0c.svg
```

(`figAsset.share` 指向 `public/figma/icons/share.svg`,与 node 23-190 同款,无需该多余文件。)

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: PASS(原下载/刷新/对比用例 + 新增分享用例全绿)。

- [ ] **Step 6: 全量校验**

Run:
```bash
pnpm exec vitest run src/lib/pgc/url.test.ts src/components/preview/
pnpm exec tsc --noEmit
pnpm lint
```
Expected: 测试全绿、类型无误、lint 通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/PreviewPanel.test.tsx
git commit -m "feat: 预览面板新增分享按钮与游玩链接弹窗,清理多余图标"
```

---

### Task 4: 运行时验证链接可玩(契约校验)

> spec 第 3.4 节列出的待验证项:入口路径恒为 `dist/index.html` 属前端推断。本任务无代码改动,仅人工验证。

- [ ] **Step 1: 起本地服务并打开一个有已 build 版本的项目**

Run: `pnpm dev`(确保 `.env` 配了 `NEXT_PUBLIC_PGC_BASE_URL` 与 `DEV_COOKIE`)。

- [ ] **Step 2: 点分享按钮,复制链接,在新标签打开**

Expected: 链接形如 `https://<pgc 域名>/game/pgcserver/pv/<public_id>/v<seq>/dist/index.html`,可正常加载并试玩选中版本。

- [ ] **Step 3: 若打不开(入口路径不符)**

按 spec 第 3.4 节降级:改用该版本 `previewVersionById(active.id)` 返回的 `preview_url`,从中提取 `v{seq}` 起的尾段,仅把前缀替换为 `{base}/game/pgcserver/pv/{public_id}/`。届时把 `buildPlayUrl` 改造为接受「尾段」参数,并补对应单测。**仅在验证失败时执行**,否则跳过。

---

## Self-Review

**1. Spec coverage:**
- 链接语义=锁定当前版本 → Task 1 `buildPlayUrl`(`v{seq}` + `dist/index.html`)✓
- `{code}`=public_id / `{version}`=v{seq} / `{path}`=入口 → Task 1 ✓,原料取用 Task 3(3b)✓
- 分享按钮位置/样式/可见/禁用 → Task 3(3c)✓
- 小型模态弹窗 + 只读 URL + 复制就地反馈 + 失败兜底 Toast → Task 2 ✓
- 局部 useState 开关 → Task 3(3b/3d)✓
- 删除多余 svg → Task 3 Step 4 ✓
- 测试策略(buildPlayUrl 单测 / SharePopover / PreviewPanel)→ Task 1/2/3 ✓
- 待运行时验证项(入口路径)→ Task 4 ✓

**2. Placeholder scan:** 各代码步骤均为完整可粘贴代码,无 TBD/TODO/“适当处理”。Task 4 为人工验证任务(无代码占位)。

**3. Type consistency:** `buildPlayUrl(publicId, versionSeq, entryPath?)` 在 Task 1 定义、Task 3 调用签名一致;`SharePopover({ url, onClose })` 在 Task 2 定义、Task 3 渲染一致;`figAsset.share` / `IconButton` / `Button` / `useRequestClose` 均沿用既有签名。
