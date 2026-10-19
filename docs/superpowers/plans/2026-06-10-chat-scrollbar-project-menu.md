# 全局滚动条优化 + 项目菜单重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化对话窗口的全局滚动条样式（细、theme-aware、自动隐藏），并重构项目选择菜单（按钮高亮宽度、列表 max5、悬浮操作、原地改名、行内删除确认、独立创建弹窗）。

**Architecture:** 纯前端改动。滚动条用 `globals.css` 全局样式 + `.scrollbar-auto` 工具类。项目菜单 `ProjectMenu` 接口从 `onAction` 改为 `onCreate/onRename/onDelete` 回调，行内管理编辑/删除确认态；新增独立 `CreateGameModal` 弹窗复用 `GenerateForm` 范式；`ChatPanel` 接线并移除 `window.prompt`/`window.confirm`。

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 + Zustand；测试 vitest + @testing-library/react（`fireEvent`、`screen`，不引入 userEvent）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/app/globals.css` | 新增全局滚动条样式 + `.scrollbar-auto` 工具类（A） |
| `src/components/chat/ProjectMenu.tsx` | 重写：列表 max5 + 悬浮 pencil/trash + 原地改名 + 行内删除确认；接口改为 `onCreate/onRename/onDelete`（B2/B3） |
| `src/components/chat/ProjectMenu.test.tsx` | **新建**：ProjectMenu 行为测试 |
| `src/components/chat/CreateGameModal.tsx` | **新建**：创建游戏弹窗（B4） |
| `src/components/chat/CreateGameModal.test.tsx` | **新建**：CreateGameModal 行为测试 |
| `src/components/chat/ChatPanel.tsx` | 触发按钮宽度/高亮(B1)、接线创建弹窗 + rename/delete、消息区加 `.scrollbar-auto` |
| `src/components/chat/MentionPopover.tsx` | 滚动容器加 `.scrollbar-auto`（A 应用） |

执行前：本计划应在通过 `superpowers:using-git-worktrees` 创建的隔离 worktree 中实现。

---

## Task 1: 全局滚动条样式（A）

**Files:**
- Modify: `src/app/globals.css`（在文件末尾、`* { box-sizing: border-box; }` 之后追加）

纯 CSS，无单测，靠运行时人工核验（亮/暗主题各一次）。

- [ ] **Step 1: 追加滚动条样式**

在 `src/app/globals.css` 末尾（`* { box-sizing: border-box; }` 行之后）追加：

```css

/* 全局滚动条:细条 + 主题色 thumb + 透明槽(去掉深色下的白槽)。Firefox 用 scrollbar-* 属性 */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-line-2) transparent;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--color-line-2);
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover { background: var(--color-muted); }

/* 自动隐藏:thumb 默认透明,仅容器 hover 时显现(用于对话区/下拉菜单等重点滚动区) */
.scrollbar-auto { scrollbar-color: transparent transparent; }
.scrollbar-auto:hover { scrollbar-color: var(--color-line-2) transparent; }
.scrollbar-auto::-webkit-scrollbar-thumb { background: transparent; }
.scrollbar-auto:hover::-webkit-scrollbar-thumb { background: var(--color-line-2); }
.scrollbar-auto:hover::-webkit-scrollbar-thumb:hover { background: var(--color-muted); }
```

- [ ] **Step 2: 验证构建无误**

Run: `pnpm lint`
Expected: 无报错（CSS 改动不影响 lint，确认无语法误带入 ts）。

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: 全局滚动条改为细条+主题色+自动隐藏"
```

---

## Task 2: 触发按钮宽度与高亮态（B1）

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`（头部行容器与触发按钮，约 57-91 行）

纯样式改动，靠人工核验（hover/展开高亮只覆盖按钮本身、不拉满工具栏）。

- [ ] **Step 1: 行容器改 justify-between**

将 `src/components/chat/ChatPanel.tsx` 中：

```tsx
        <div className="flex items-center gap-2">
```

改为：

```tsx
        <div className="flex items-center justify-between gap-2">
```

- [ ] **Step 2: 触发按钮去 flex-1、加展开态高亮、名称限宽**

将触发按钮的 className：

```tsx
            className="flex min-w-0 flex-1 items-center gap-1 rounded-[10px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-fill)]"
```

改为（去掉 `flex-1`，追加 `menuOpen` 展开态底色）：

```tsx
            className={`flex min-w-0 items-center gap-1 rounded-[10px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-fill)] ${menuOpen ? 'bg-[var(--color-fill)]' : ''}`}
```

并将项目名 `<span>` 的 className：

```tsx
            <span className="ml-1 truncate text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
```

改为（加 `max-w-[140px]` 防止长名挤压主题切换按钮）：

```tsx
            <span className="ml-1 max-w-[140px] truncate text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
```

- [ ] **Step 3: 验证**

Run: `pnpm lint`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatPanel.tsx
git commit -m "style: 项目菜单触发按钮高亮固定为按钮宽度并加展开态"
```

---

## Task 3: 重写 ProjectMenu —— 列表 max5 + 悬浮操作 + 原地改名 + 行内删除确认（B2/B3）

**Files:**
- Test: `src/components/chat/ProjectMenu.test.tsx`（新建）
- Modify: `src/components/chat/ProjectMenu.tsx`（整体重写）

> 注意：本 Task 改变了 `ProjectMenu` 的 props 接口（移除 `onAction`，新增 `onCreate/onRename/onDelete`）。`ChatPanel` 的接线在 Task 5 完成；本 Task 结束时 `ChatPanel` 会暂时有类型错误，属预期，Task 5 修复。`pnpm test` 针对 ProjectMenu 测试文件可独立通过。

- [ ] **Step 1: 写失败测试**

新建 `src/components/chat/ProjectMenu.test.tsx`：

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProjectMenu from './ProjectMenu';
import type { ProjectData } from '@/lib/pgc/types';

const proj = (id: number, name: string): ProjectData => ({
  id, name, cover_url: null, current_version_id: null, status: 'active', created_at: '', updated_at: '',
});

function setup(over: Partial<Parameters<typeof ProjectMenu>[0]> = {}) {
  const props = {
    projects: [proj(1, 'Alpha'), proj(2, 'Beta')],
    currentId: 1,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  render(<ProjectMenu {...props} />);
  return props;
}

describe('ProjectMenu', () => {
  test('点击项目行调用 onSelect 并关闭', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Beta'));
    expect(p.onSelect).toHaveBeenCalledWith(2);
    expect(p.onClose).toHaveBeenCalled();
  });

  test('点击 Create new game 调用 onCreate', () => {
    const p = setup();
    fireEvent.click(screen.getByText(/Create new game/i));
    expect(p.onCreate).toHaveBeenCalled();
  });

  test('点改名进入输入态, 改值后 Enter 调用 onRename, 且不触发 onSelect', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    expect(p.onSelect).not.toHaveBeenCalled();
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRename).toHaveBeenCalledWith(1, 'Alpha 2');
  });

  test('改名为空或未变化时不调用 onRename', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRename).not.toHaveBeenCalled();
  });

  test('点删除显示行内确认, 仅确认后调用 onDelete', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Delete Beta'));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(p.onDelete).toHaveBeenCalledWith(2);
  });

  test('删除确认中点取消则不调用 onDelete', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Delete Beta'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(p.onDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/components/chat/ProjectMenu.test.tsx`
Expected: FAIL（旧 ProjectMenu 无 `onRename`/`onDelete`/`onCreate`，无 `Rename Alpha`/`Delete Beta` 标签，TypeScript/断言失败）。

- [ ] **Step 3: 整体重写 ProjectMenu.tsx**

用以下内容替换 `src/components/chat/ProjectMenu.tsx` 全文：

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { ProjectData } from '@/lib/pgc/types';
import { figAsset, FigIcon } from '@/components/ui/figma';

function Shortcut({ text }: { text: string }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--color-fill)] px-[4px] py-[2px] text-center text-[11px] font-medium leading-[16px] tracking-[-0.11px] text-[var(--color-muted)] shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),inset_0px_0.75px_0px_0px_#fcfcfc,inset_0px_-0.75px_0.5px_0px_rgba(0,0,0,0.25)]">
      {text}
    </span>
  );
}

export default function ProjectMenu({
  projects,
  currentId,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  projects: ProjectData[];
  currentId: number | null;
  onClose: () => void;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  // Esc:优先取消行内编辑/删除确认,否则关闭菜单
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId != null) setEditingId(null);
      else if (confirmId != null) setConfirmId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, confirmId, onClose]);

  const choose = (id: number) => { onSelect(id); onClose(); };
  const startRename = (p: ProjectData) => { setConfirmId(null); setDraft(p.name); setEditingId(p.id); };
  const saveRename = (p: ProjectData) => {
    const name = draft.trim();
    if (name && name !== p.name) onRename(p.id, name);
    setEditingId(null);
  };
  const startDelete = (id: number) => { setEditingId(null); setConfirmId(id); };
  const confirmDelete = (id: number) => { onDelete(id); setConfirmId(null); };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onClick={onClose} />
      <div className="absolute left-[10px] top-[calc(100%-1px)] z-50 flex w-[204px] flex-col items-start overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        {/* 项目列表:最多显示 5 个(max-h 188px),超出滚动 */}
        {projects.length > 0 && (
          <div className="scrollbar-auto flex max-h-[188px] w-full flex-col items-start overflow-auto p-[8px]">
            {projects.map((p) => {
              if (editingId === p.id) {
                return (
                  <input
                    key={p.id}
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(p); } }}
                    onBlur={() => saveRename(p)}
                    className="h-[36px] w-full rounded-[12px] bg-[var(--color-fill)] px-[8px] text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)] outline-none"
                  />
                );
              }
              if (confirmId === p.id) {
                return (
                  <div key={p.id} className="flex h-[36px] w-full items-center gap-[8px] rounded-[12px] bg-[var(--color-fill)] px-[8px]">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">Delete this game?</span>
                    <button type="button" onClick={() => setConfirmId(null)} className="shrink-0 rounded-[6px] px-[6px] py-[2px] text-[11px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)]">取消</button>
                    <button type="button" onClick={() => confirmDelete(p.id)} className="shrink-0 rounded-[6px] px-[6px] py-[2px] text-[11px] font-semibold text-[#e5484d] transition-colors hover:bg-[var(--color-surface-2)]">删除</button>
                  </div>
                );
              }
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p.id)}
                  className={`group flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)] ${p.id === currentId ? 'bg-[var(--color-fill)]' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
                    {p.name}
                  </span>
                  {/* 选中绿点:hover 时让位给操作按钮 */}
                  {p.id === currentId && (
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)] group-hover:hidden" />
                  )}
                  {/* hover 显现:改名 / 删除(用 span+role 避免 button 嵌套) */}
                  <span className="hidden shrink-0 items-center gap-[2px] group-hover:flex">
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Rename ${p.name}`}
                      onClick={(e) => { e.stopPropagation(); startRename(p); }}
                      className="grid size-[24px] place-items-center rounded-[6px] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <FigIcon src={figAsset.pencil} size={14} className="opacity-70" />
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Delete ${p.name}`}
                      onClick={(e) => { e.stopPropagation(); startDelete(p.id); }}
                      className="grid size-[24px] place-items-center rounded-[6px] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <FigIcon src={figAsset.trash} size={14} className="opacity-70" />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {/* Create new game:触发独立弹窗 */}
        <div className="flex w-full flex-col items-start border-t border-[var(--color-line)] p-[8px]">
          <button
            type="button"
            onClick={() => { onCreate(); onClose(); }}
            className="flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
              Create new game...
            </span>
            <Shortcut text="⌘N" />
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/components/chat/ProjectMenu.test.tsx`
Expected: PASS（6 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ProjectMenu.tsx src/components/chat/ProjectMenu.test.tsx
git commit -m "feat: 项目菜单支持悬浮改名/删除确认与5项滚动"
```

---

## Task 4: 新建 CreateGameModal 独立弹窗（B4）

**Files:**
- Test: `src/components/chat/CreateGameModal.test.tsx`（新建）
- Create: `src/components/chat/CreateGameModal.tsx`

- [ ] **Step 1: 写失败测试**

新建 `src/components/chat/CreateGameModal.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateGameModal from './CreateGameModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() }));
afterEach(() => vi.restoreAllMocks());

describe('CreateGameModal', () => {
  test('空名称时 Create 按钮禁用', () => {
    render(<CreateGameModal onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  test('输入名称回车调用 createProject(去空) 并关闭', async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    useStore.setState({ createProject } as never);
    render(<CreateGameModal onClose={onClose} />);
    const input = screen.getByPlaceholderText(/game name/i);
    fireEvent.change(input, { target: { value: '  My Game  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(createProject).toHaveBeenCalledWith('My Game');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('点击 Create 按钮提交', async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ createProject } as never);
    render(<CreateGameModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/game name/i), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(createProject).toHaveBeenCalledWith('X');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/components/chat/CreateGameModal.test.tsx`
Expected: FAIL（`CreateGameModal` 不存在，模块解析失败）。

- [ ] **Step 3: 实现 CreateGameModal.tsx**

新建 `src/components/chat/CreateGameModal.tsx`：

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import IconButton from '@/components/ui/IconButton';

// 创建游戏弹窗:复用 GenerateForm 卡片语言(圆角卡 + backdrop + Esc 关闭)
export default function CreateGameModal({ onClose }: { onClose: () => void }) {
  const createProject = useStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await createProject(name.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">Create new game</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          placeholder="Game name"
          className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">取消</button>
          <IconButton
            variant={canSubmit ? 'raised-active' : 'raised'}
            className="h-10 rounded-[10px] px-4 text-[13px] font-semibold"
            aria-label="Create"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? <Loader2 size={16} className="animate-spin text-white" /> : 'Create'}
          </IconButton>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/components/chat/CreateGameModal.test.tsx`
Expected: PASS（3 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/CreateGameModal.tsx src/components/chat/CreateGameModal.test.tsx
git commit -m "feat: 新增创建游戏独立弹窗组件"
```

---

## Task 5: ChatPanel 接线 + MentionPopover 滚动条（B3/B4 收尾 + A 应用）

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/components/chat/MentionPopover.tsx`

无独立单测（ChatPanel 无既有测试）；靠 `pnpm test` 全量 + `pnpm lint` + 人工核验。

- [ ] **Step 1: ChatPanel 调整 import**

将 `src/components/chat/ChatPanel.tsx` 顶部：

```tsx
import ProjectMenu from './ProjectMenu';
```

之后新增一行：

```tsx
import CreateGameModal from './CreateGameModal';
```

并删除这一行（不再使用 action 类型）：

```tsx
import type { ProjectMenuAction } from './ProjectMenu';
```

- [ ] **Step 2: 调整 state 与 store 选择器**

将：

```tsx
  const [menuOpen, setMenuOpen] = useState(false);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const currentName = projects.find((p) => p.id === currentProjectId)?.name ?? 'Project name';
```

改为（移除 `createProject` 选择器，新增 `createOpen` 状态）：

```tsx
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const currentName = projects.find((p) => p.id === currentProjectId)?.name ?? 'Project name';
```

- [ ] **Step 3: 删除 onMenuAction（连同 window.prompt/confirm）**

删除整段：

```tsx
  const onMenuAction = (action: ProjectMenuAction) => {
    if (action === 'create') {
      const name = window.prompt('新游戏名称', 'Untitled');
      if (name) void createProject(name);
    } else if (action === 'rename') {
      if (currentProjectId == null) return;
      const name = window.prompt('重命名项目', currentName);
      if (name) void renameProject(currentProjectId, name);
    } else if (action === 'delete') {
      if (currentProjectId == null) return;
      if (window.confirm(`确定删除「${currentName}」?`)) void deleteProject(currentProjectId);
    }
  };
```

- [ ] **Step 4: 更新 ProjectMenu 用法**

将：

```tsx
        {menuOpen && (
          <ProjectMenu
            projects={projects}
            currentId={currentProjectId}
            onClose={() => setMenuOpen(false)}
            onSelect={(id) => void selectProject(id)}
            onAction={onMenuAction}
          />
        )}
```

改为：

```tsx
        {menuOpen && (
          <ProjectMenu
            projects={projects}
            currentId={currentProjectId}
            onClose={() => setMenuOpen(false)}
            onSelect={(id) => void selectProject(id)}
            onCreate={() => setCreateOpen(true)}
            onRename={(id, name) => void renameProject(id, name)}
            onDelete={(id) => void deleteProject(id)}
          />
        )}
```

- [ ] **Step 5: 消息区加 scrollbar-auto**

将：

```tsx
      <div className="flex-1 overflow-auto px-3 py-3">
```

改为：

```tsx
      <div className="scrollbar-auto flex-1 overflow-auto px-3 py-3">
```

- [ ] **Step 6: 挂载 CreateGameModal**

在 `ChatPanel` 返回 JSX 中、`<Composer client={client} />` 之后、最外层 `</div>` 之前，新增：

```tsx
      {createOpen && <CreateGameModal onClose={() => setCreateOpen(false)} />}
```

- [ ] **Step 7: MentionPopover 滚动容器加 scrollbar-auto**

将 `src/components/chat/MentionPopover.tsx` 第 19 行：

```tsx
    <div className="absolute bottom-full mb-1 max-h-56 w-64 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
```

改为：

```tsx
    <div className="scrollbar-auto absolute bottom-full mb-1 max-h-56 w-64 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
```

- [ ] **Step 8: 全量验证**

Run: `pnpm test && pnpm lint`
Expected: 测试全过（含新增 ProjectMenu/CreateGameModal）、lint 无报错、无 TypeScript 错误。

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/ChatPanel.tsx src/components/chat/MentionPopover.tsx
git commit -m "feat: 接线创建弹窗与改名/删除回调,移除原生 prompt/confirm"
```

---

## Task 6: 人工核验（运行 app）

**Files:** 无（运行时核验）

- [ ] **Step 1: 启动 dev server**

Run: `pnpm dev`

- [ ] **Step 2: 逐项核验**

- 滚动条（A）：对话消息多到溢出时，滚动条为细条、无白槽；亮/暗主题各看一次；不滚动/不 hover 时自动隐藏。
- 触发按钮（B1）：hover 与菜单展开时底色只覆盖按钮本身，不拉满工具栏。
- 列表（B2）：项目 >5 个时列表出现滚动、最多露 5 项。
- 悬浮操作（B3）：hover 项目行右侧出现 pencil/trash；点 pencil 原地改名（Enter 保存、Esc 取消）；点 trash 出现行内「Delete this game? 取消/删除」，确认才删除。
- 创建弹窗（B4）：点 Create new game 弹出居中弹窗，输入名称回车/点 Create 创建并切换到新项目，Esc/点遮罩关闭。

- [ ] **Step 3: 收尾**

核验通过后按 `superpowers:finishing-a-development-branch` 决定合并/PR 方式。

---

## Self-Review

**1. Spec 覆盖：**
- A 全局滚动条 → Task 1 + Task 5(Step 5/7 应用) ✓
- B1 触发按钮宽度/高亮 → Task 2 ✓
- B2 列表一致性 + max5 滚动 → Task 3（max-h-[188px] + scrollbar-auto） ✓
- B3 悬浮操作 + 原地改名 + 行内删除确认 + 接口改造 → Task 3 + Task 5 ✓
- B4 独立创建弹窗 → Task 4 + Task 5(挂载) ✓

**2. Placeholder 扫描：** 无 TBD/TODO；所有步骤含完整代码与命令。

**3. 类型一致性：**
- `ProjectMenu` props（`onCreate/onRename/onDelete`）在 Task 3 定义、Task 5 接线一致。
- `CreateGameModal` props 仅 `onClose`，读取 store 的 `createProject`，Task 4 与 Task 5 挂载一致。
- 测试用 `ProjectData` 工厂含全部必填字段（id/name/cover_url/current_version_id/status/created_at/updated_at），与 `src/lib/pgc/types.ts` 一致。
