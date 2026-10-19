// 空窗期骨架屏:run 运行中但助手尚无可见内容时,展示错落微光占位行
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const BARS = ['90%', '75%', '55%'];

function Bars({ widths }: { widths: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {widths.map((w) => (
        <div
          key={w}
          data-testid="skeleton-bar"
          className="skeleton-shimmer h-3.5 rounded-[6px]"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

export default function MessageSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('chat.skeleton.generating')} className="mb-5">
      <Bars widths={BARS} />
    </div>
  );
}

// 回放 provisioning 加载:消息区正中 品牌橙轨道环 + 假进度文案轮播(每 900ms 顺序切换,停在最后一条);
// 播放器条骨架见 ReplayControls 的 ReplayControlsSkeleton,两者合成「播放器在就位」的整体语境
export function ReplaySkeleton() {
  const { t } = useTranslation();
  const hints = t('chat.replay.provisioningHints', { returnObjects: true }) as string[];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (hints.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1 >= hints.length ? (clearInterval(timer), i) : i + 1));
    }, 900);
    return () => clearInterval(timer);
  }, [hints.length]);
  const hint = hints[Math.min(idx, hints.length - 1)] ?? t('chat.replay.provisioning');
  return (
    <div
      role="status"
      aria-label={t('chat.replay.provisioning')}
      className="anim-media-in flex h-full flex-col items-center justify-center gap-2.5"
    >
      <span aria-hidden className="size-7 animate-spin rounded-full border-2 border-[var(--color-primary-soft)] border-t-[var(--color-primary)]" />
      {/* key 换条即触发单条淡入 */}
      <span key={hint} className="anim-media-in text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]">
        {hint}
      </span>
    </div>
  );
}
