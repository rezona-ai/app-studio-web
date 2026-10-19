'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import Segmented from '@/components/ui/Segmented';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';

const SPEEDS = [
  { value: '1', label: '1x' },
  { value: '2', label: '2x' },
  { value: '4', label: '4x' },
];

// 播放器骨架:provisioning 期占住 ReplayControls 的位置(标题实字,速度 tabs/skip/计数 shimmer 占位),
// 与真实控制条同构布局,就绪后原位替换无跳动
export function ReplayControlsSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('chat.replay.provisioning')}
      className="anim-media-in border-b border-[var(--color-line)] bg-[var(--color-surface-2)]"
    >
      <div className="flex h-12 items-center justify-between gap-3 px-3">
        <span className="text-[14px] font-semibold text-[var(--color-ink)]">{t('chat.replay.controls')}</span>
        <div className="skeleton-shimmer h-8 w-[156px] rounded-[10px]" />
        <div className="skeleton-shimmer size-8 rounded-[10px]" />
      </div>
      <div className="flex items-center gap-3 px-3 pb-3">
        <div className="skeleton-shimmer h-3 w-10 rounded-[6px]" />
        <div className="h-1 flex-1 rounded-full bg-[var(--color-fill)]" />
      </div>
    </div>
  );
}

// 回放控制条,对齐 Figma 3625-45183:
//   Camera Header(48px 行):Replay 标题 · 速度 tabs(1x/2x/4x) · skip-forward 按钮
//   Frame 2147236680(进度行):cur/total 计数 + 橙色进度条
// playing/skipping 才显示
export default function ReplayControls() {
  const { t } = useTranslation();
  const replay = useStore((s) => s.replay);
  const setReplaySpeed = useStore((s) => s.setReplaySpeed);
  const skipReplay = useStore((s) => s.skipReplay);
  if (!replay || (replay.phase !== 'playing' && replay.phase !== 'skipping')) return null;
  // 断点续播后队列只装「剩余事件」,cursor/total 从 0/剩余数计数;展示叠加续播基点
  // (resumeAfterSequence≈已播帧数,事件 sequence 稠密自增),否则刷新后进度看起来清零从头
  const base = replay.resumeAfterSequence ?? 0;
  const cur = base + replay.cursor;
  const total = base + replay.total;
  const pct = total > 0 ? Math.min(100, (cur / total) * 100) : 0;

  return (
    <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
      <div className="flex h-12 items-center justify-between gap-3 px-3">
        <span className="text-[14px] font-semibold text-[var(--color-ink)]">{t('chat.replay.controls')}</span>
        <div className="w-[156px]">
          <Segmented
            ariaLabel={t('chat.replay.speed')}
            value={String(replay.speed)}
            options={SPEEDS}
            onChange={(v) => setReplaySpeed((Number(v ?? '1') as 1 | 2 | 4))}
          />
        </div>
        <Tooltip label={t('chat.replay.skip')}>
          <IconButton
            variant="bordered"
            className="size-8 rounded-[10px]"
            aria-label={t('chat.replay.skip')}
            onClick={skipReplay}
          >
            <FigIcon src={figAsset.skipForward} size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="flex items-center gap-3 px-3 pb-3">
        <span className="text-[12px] font-bold tabular-nums tracking-[0.18px] text-[var(--color-muted)]">
          {t('chat.replay.progress', { cur, total })}
        </span>
        <div
          role="progressbar"
          aria-label={t('chat.replay.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={cur}
          className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-fill)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
