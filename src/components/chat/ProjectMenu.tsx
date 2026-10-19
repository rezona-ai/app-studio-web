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

// 行内加载指示:复用全站 spinner 惯例(border + animate-spin);size 16 与改名/删除图标一致
function Spinner({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]"
    />
  );
}

// 回调可能返回 void(旧签名/测试)或 Promise(真实 action):仅 thenable 时才进加载态,不打扰同步返回
function isPromise(v: unknown): v is Promise<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
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
  onImport,
}: {
  projects: ProjectData[];
  currentId: number | null;
  onClose: () => void;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onBackToStudio: () => void;
  onRename: (id: number, name: string) => void | Promise<unknown>;
  onDelete: (id: number) => void | Promise<unknown>;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const finishedRef = useRef<number | null>(null);
  // 请求在途加载态:改名/删除各自记录处理中的项目 id(改名另存新名用于行内显示)
  const [pendingRenameId, setPendingRenameId] = useState<number | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

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
    setEditingId(null);
    if (!name || name === p.name) return;
    // 请求在途显示加载态(store 更新在 await 之后,故有真实窗口);promise settle 后清除
    const ret = onRename(p.id, name);
    if (isPromise(ret)) {
      setPendingName(name);
      setPendingRenameId(p.id);
      void ret.finally(() => setPendingRenameId((cur) => (cur === p.id ? null : cur)));
    }
  };
  // 取消改名:标记 finished 以阻止卸载时 onBlur 触发保存
  const cancelRename = (p: ProjectData) => { finishedRef.current = p.id; setEditingId(null); };
  const startDelete = (id: number) => { setEditingId(null); setConfirmId(id); };
  const confirmDelete = (id: number) => {
    setConfirmId(null);
    // 删除在途显示加载态,行仍在;成功后 store 移除该项目(行消失),失败(Toast)则清除加载态复原
    const ret = onDelete(id);
    if (isPromise(ret)) {
      setPendingDeleteId(id);
      void ret.finally(() => setPendingDeleteId((cur) => (cur === id ? null : cur)));
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div className="anim-pop-in origin-top-left absolute left-[10px] top-[calc(100%-1px)] z-50 flex w-[240px] flex-col items-start overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        {/* 操作组(设计稿置顶):Create new game / Back to Studio */}
        <div className="flex w-full flex-col items-start gap-1 p-[8px]">
          <button
            type="button"
            onClick={() => { onCreate(); onClose(); }}
            className="flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
              {t('chat.createGame.menu')}
            </span>
            <Shortcut text="⌘N" />
          </button>
          <button
            type="button"
            onClick={() => { onImport(); onClose(); }}
            className="flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
              {t('chat.importGame.menu')}
            </span>
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
        {/* 项目列表:分隔线 + 最多显示 5 个(max-h 188px),超出滚动;隐藏滚动条,每项全宽 */}
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
              if (pendingRenameId === p.id) {
                return (
                  <div key={p.id} className="flex h-[36px] w-full shrink-0 items-center gap-[8px] rounded-[12px] bg-[var(--color-fill)] px-[8px] py-[6px]">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">{pendingName}</span>
                    <Spinner label={t('chat.project.renaming')} />
                  </div>
                );
              }
              if (pendingDeleteId === p.id) {
                return (
                  <div key={p.id} className="flex h-[36px] w-full shrink-0 items-center gap-[8px] rounded-[12px] bg-[var(--color-fill)] px-[8px] py-[6px]">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-muted)]">{p.name}</span>
                    <Spinner label={t('chat.project.deleting')} />
                  </div>
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
                  {/* 选中橙点(Figma primary/main #f97316):hover 时让位给操作按钮 */}
                  {p.id === currentId && (
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-primary)] group-hover:hidden" />
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
                        <FigIcon src={figAsset.pencil} size={16} />
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
                        <FigIcon src={figAsset.trash} size={16} />
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
