# Project Info 菜单对齐 Figma 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将左栏项目切换菜单 `ProjectMenu` 重构为设计稿结构：操作组（Create new game ⌘N / Back to Studio）置顶、分隔线、项目列表在下，当前项指示点改青色。

**Architecture:** 纯 UI 重排。`ProjectMenu` 保持表现层（受控回调），新增 `onBackToStudio` 回调 prop 由 `ChatPanel` 注入（`window.location.href='/'` 跳出 basePath）。复用既有令牌 `--color-teal`，不改 `globals.css`。

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4（CSS 变量令牌）/ react-i18next / Vitest + Testing Library。

## Global Constraints

- 禁硬编码色值：一律 `var(--color-*)`（本次复用既有 `--color-teal: #1fd4cf`，不新增 token）。
- 图标走 `FigIcon` + `figAsset`；按钮不新建组件；动效复用 `.anim-pop-in`。
- i18n 六语（en/zh/fr/ru/ja/vi），en 为真相源；新增文案六套齐。
- 注释 / commit message 用中文；commit message 末尾附 `Claude-Session: https://claude.ai/code/session_01131HJiR5dQRMiGVvC5ZAer`。
- 不加 Duplicate；不接入全局 `⌘N` 键盘监听（仅视觉标签）。
- 工作目录为 worktree：`.claude/worktrees/feat+project-info-redesign`（Edit/Write 用该路径，勿误写主仓）。

---

### Task 1: i18n 新增 `chat.project.backToStudio`（六语）

**Files:**
- Modify: `src/i18n/locales/en.ts`（`chat.project` 段，约 37-40 行）
- Modify: `src/i18n/locales/zh.ts` / `fr.ts` / `ru.ts` / `ja.ts` / `vi.ts`（各自 `chat.project` 段）

**Interfaces:**
- Produces: 翻译 key `chat.project.backToStudio`，`t()` 在测试环境返回 en 文案 `Back to Studio`。

- [ ] **Step 1: 改 en.ts**

将
```ts
    project: {
      rename: 'Rename {{name}}',
      delete: 'Delete {{name}}',
    },
```
改为
```ts
    project: {
      rename: 'Rename {{name}}',
      delete: 'Delete {{name}}',
      backToStudio: 'Back to Studio',
    },
```

- [ ] **Step 2: 其余五语同位置各加一行**

在每个 locale 的 `chat.project` 段（紧随 `delete` 之后）加入：

| 文件 | 新增行 |
|---|---|
| `zh.ts` | `backToStudio: '返回工作室',` |
| `fr.ts` | `backToStudio: 'Retour au Studio',` |
| `ru.ts` | `backToStudio: 'Назад в Студию',` |
| `ja.ts` | `backToStudio: 'スタジオに戻る',` |
| `vi.ts` | `backToStudio: 'Quay lại Studio',` |

> 若某 locale 的 `project` 段字段与 en 不完全同构（缺 rename/delete），仍只需补 `backToStudio` 一行，保持与 en 键集一致。

- [ ] **Step 3: 类型 / 结构校验**

Run: `pnpm exec tsc --noEmit`
Expected: PASS（若 locale 有 `satisfies typeof en` 之类约束，六语齐全则通过；缺任一则报缺键，据报补齐）。

- [ ] **Step 4: 提交**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/zh.ts src/i18n/locales/fr.ts src/i18n/locales/ru.ts src/i18n/locales/ja.ts src/i18n/locales/vi.ts
git commit -m "feat: i18n 新增 chat.project.backToStudio(六语)

Claude-Session: https://claude.ai/code/session_01131HJiR5dQRMiGVvC5ZAer"
```

---

### Task 2: ProjectMenu 结构重排 + Back to Studio + ChatPanel 接线（TDD）

**Files:**
- Test: `src/components/chat/ProjectMenu.test.tsx`
- Modify: `src/components/chat/ProjectMenu.tsx`（整体重排）
- Modify: `src/components/chat/ChatPanel.tsx`（`<ProjectMenu>` 处新增 `onBackToStudio`）

**Interfaces:**
- Consumes: `t('chat.project.backToStudio')`（Task 1），`--color-teal`（既有令牌）。
- Produces: `ProjectMenu` props 新增 `onBackToStudio: () => void`（必填）。

- [ ] **Step 1: 写失败测试**

在 `ProjectMenu.test.tsx` 的 `setup()` 默认 props 中新增 `onBackToStudio: vi.fn(),`（放在 `onCreate` 之后）：

```ts
    onCreate: vi.fn(),
    onBackToStudio: vi.fn(),
```

并在 `describe('ProjectMenu', ...)` 末尾追加三例：

```ts
  test('操作组(Create/Back to Studio)在项目列表之前', () => {
    setup();
    const create = screen.getByText(/Create new game/i);
    const alpha = screen.getByText('Alpha');
    // create 在 alpha 之前 → alpha 相对 create 为 FOLLOWING(4)
    expect(create.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('点击 Back to Studio 调用 onBackToStudio 并关闭', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Back to Studio'));
    expect(p.onBackToStudio).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  test('不含 Duplicate 项', () => {
    setup();
    expect(screen.queryByText(/Duplicate/i)).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ProjectMenu.test.tsx`
Expected: FAIL —「Back to Studio」找不到 / `onBackToStudio` 类型缺失。

- [ ] **Step 3: 重写 `ProjectMenu.tsx`**

整体替换为（操作组置顶 + Back to Studio + 青点 `--color-teal` + 新 prop）：

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectData } from '@/lib/pgc/types';
import { isImeComposing } from '@/lib/keyboard';
import { figAsset, FigIcon } from '@/components/ui/figma';
import Tooltip from '@/components/ui/Tooltip';

function Shortcut({ text }: { text: string }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--color-fill)] px-[4px] py-[2px] text-center text-[11px] font-medium leading-[16px] tracking-[-0.11px] text-[var(--color-muted)] shadow-[var(--shadow-shortcut)]">
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
  onBackToStudio,
  onRename,
  onDelete,
}: {
  projects: ProjectData[];
  currentId: number | null;
  onClose: () => void;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onBackToStudio: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const finishedRef = useRef<number | null>(null);

  // Esc:优先取消行内编辑/删除确认,否则关闭菜单
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId != null) return; // 编辑态 Esc 由 input 自身处理(见 onKeyDown)
      if (confirmId != null) setConfirmId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, confirmId, onClose]);

  const choose = (id: number) => { onSelect(id); onClose(); };
  const startRename = (p: ProjectData) => { finishedRef.current = null; setConfirmId(null); setDraft(p.name); setEditingId(p.id); };
  // 提交改名:用 finishedRef 去重,Enter 与卸载时的 onBlur 只会真正保存一次
  const commitRename = (p: ProjectData) => {
    if (finishedRef.current === p.id) return;
    finishedRef.current = p.id;
    const name = draft.trim();
    if (name && name !== p.name) onRename(p.id, name);
    setEditingId(null);
  };
  // 取消改名:标记 finished 以阻止卸载时 onBlur 触发保存
  const cancelRename = (p: ProjectData) => { finishedRef.current = p.id; setEditingId(null); };
  const startDelete = (id: number) => { setEditingId(null); setConfirmId(id); };
  const confirmDelete = (id: number) => { onDelete(id); setConfirmId(null); };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div className="anim-pop-in origin-top-left absolute left-[10px] top-[calc(100%-1px)] z-50 flex w-[204px] flex-col items-start overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        {/* 操作组(设计稿置顶):Create new game / Back to Studio */}
        <div className="flex w-full flex-col items-start gap-1 p-[8px]">
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
          <button
            type="button"
            onClick={() => { onBackToStudio(); onClose(); }}
            className="flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
              {t('chat.project.backToStudio')}
            </span>
          </button>
        </div>
        {/* 项目列表:分隔线 + 最多显示 5 个(max-h 188px),超出滚动;隐藏滚动条 */}
        {projects.length > 0 && (
          <div className="scrollbar-none flex max-h-[188px] w-full flex-col items-start gap-1 overflow-auto border-t border-[var(--color-line)] p-[8px]">
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); commitRename(p); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(p); }
                    }}
                    onBlur={() => commitRename(p)}
                    className="h-[36px] w-full shrink-0 rounded-[12px] bg-[var(--color-fill)] px-[8px] text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)] outline-none"
                  />
                );
              }
              if (confirmId === p.id) {
                return (
                  <div key={p.id} className="flex h-[36px] w-full shrink-0 items-center gap-[8px] rounded-[12px] bg-[var(--color-fill)] px-[8px]">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">{t('chat.deleteGameConfirm')}</span>
                    <button type="button" onClick={() => setConfirmId(null)} className="shrink-0 rounded-[6px] px-[6px] py-[2px] text-[11px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)]">{t('common.cancel')}</button>
                    <button type="button" onClick={() => confirmDelete(p.id)} className="shrink-0 rounded-[6px] px-[6px] py-[2px] text-[11px] font-semibold text-[#e5484d] transition-colors hover:bg-[var(--color-surface-2)]">{t('common.delete')}</button>
                  </div>
                );
              }
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p.id)}
                  className={`group flex h-[36px] w-full shrink-0 items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)] ${p.id === currentId ? 'bg-[var(--color-fill)]' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
                    {p.name}
                  </span>
                  {/* 选中青点(Figma primary/main):hover 时让位给操作按钮 */}
                  {p.id === currentId && (
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-teal)] group-hover:hidden" />
                  )}
                  {/* hover 显现:改名 / 删除(用 span+role 避免 button 嵌套) */}
                  <span className="hidden shrink-0 items-center gap-[2px] group-hover:flex">
                    <Tooltip>
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={t('chat.project.rename', { name: p.name })}
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
                        aria-label={t('chat.project.delete', { name: p.name })}
                        onClick={(e) => { e.stopPropagation(); startDelete(p.id); }}
                        className="grid size-[24px] place-items-center rounded-[6px] transition-colors hover:bg-[var(--color-surface-2)]"
                      >
                        <FigIcon src={figAsset.trash} size={14} className="opacity-70" />
                      </span>
                    </Tooltip>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: `ChatPanel.tsx` 注入 `onBackToStudio`**

在 `<ProjectMenu ... />`（约 124-132 行）的 `onCreate` 之后加：

```tsx
            onCreate={() => setCreateOpen(true)}
            onBackToStudio={() => {
              // 刻意不经 apiPath():跳出 /game basePath,回到父级 Taluna Studio 根路径
              window.location.href = '/';
            }}
            onRename={(id, name) => void renameProject(id, name)}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ProjectMenu.test.tsx`
Expected: PASS（11 例：原 8 + 新 3）。

- [ ] **Step 6: 类型 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/components/chat/ProjectMenu.tsx src/components/chat/ChatPanel.tsx src/components/chat/ProjectMenu.test.tsx
git commit -m "feat: Project Info 菜单操作组置顶+Back to Studio,当前项青点(对齐 Figma)

Claude-Session: https://claude.ai/code/session_01131HJiR5dQRMiGVvC5ZAer"
```

---

## Self-Review

- **Spec coverage**：菜单重排(Task 2 S3)、Back to Studio 项+行为(S3/S4)、无 Duplicate(测试 S1)、青点复用 --color-teal(S3)、i18n 六语(Task 1)、测试(Task 2 S1)——全覆盖。
- **Placeholder scan**：无 TBD/TODO;所有步骤含实测代码 / 命令 / 期望。
- **Type consistency**：`onBackToStudio: () => void` 在 ProjectMenu props、setup 默认、ChatPanel 注入三处一致。
- **验收**：`pnpm exec vitest run src/components/chat/ProjectMenu.test.tsx`、`tsc --noEmit`、`lint` 全绿;人工核对视觉与 node `1527-28576` 一致。
