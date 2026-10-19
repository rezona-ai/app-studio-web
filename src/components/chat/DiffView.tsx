'use client';
import type { FileDiff, DiffLineKind } from '@/koubou/protocol';

const SYM: Record<DiffLineKind, string> = { add: '+', del: '-', context: ' ' };
const ROW: Record<DiffLineKind, string> = {
  add: 'bg-emerald-500/10 text-emerald-600',
  del: 'bg-red-500/10 text-red-600',
  context: 'text-[var(--color-muted)]',
};

// 紧凑彩色 diff:等宽逐行着色,横向可滚动;多 hunk 间淡分隔线
export default function DiffView({ diff }: { diff: FileDiff }) {
  return (
    <div className="mt-1 max-h-64 overflow-auto rounded-[8px] border border-[var(--color-line)] font-mono text-[12px] leading-5">
      {diff.hunks.map((h, hi) => (
        <div key={hi} className={hi > 0 ? 'border-t border-[var(--color-line)]' : ''}>
          {h.lines.map((ln, li) => (
            <div key={li} className={`flex px-2 ${ROW[ln.kind]}`}>
              <span className="select-none pr-2 opacity-60">{SYM[ln.kind]}</span>
              <span className="whitespace-pre">{ln.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
