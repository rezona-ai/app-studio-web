'use client';
import { useStore } from '@/store';
import { canMention } from '@/lib/refs';
import { AssetThumb } from './AssetChip';

export default function MentionPopover({
  query,
  onPick,
}: {
  query: string;
  onPick: (key: string) => void;
}) {
  const assets = useStore((s) => s.assets);
  // 候选仅列可提及资产(就绪且有后端预览地址);不硬截断,超出高度交给容器滚动区(max-h-56 + overflow-auto)承载
  const list = assets
    .filter(canMention)
    .filter((a) => (a.key + a.label).toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="anim-pop-in origin-bottom-left scrollbar-auto absolute bottom-full mb-1 flex max-h-56 w-64 flex-col gap-0.5 overflow-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
      {list.length === 0 ? (
        <div className="px-2 py-1.5 text-sm leading-5 text-[var(--color-muted)]">
          {assets.length === 0
            ? 'No assets yet — files the agent generates or you attach will show up here'
            : 'No matches'}
        </div>
      ) : (
        list.map((a) => (
          <button
            key={a.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(a.key);
            }}
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-fill)]"
          >
            {/* 缩略图贴片与 AssetChip 同款:方形圆角 + 资产封面/类型图标 */}
            <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--color-fill)]">
              <AssetThumb asset={a} />
            </span>
            <span className="truncate">{a.label}</span>
          </button>
        ))
      )}
    </div>
  );
}
