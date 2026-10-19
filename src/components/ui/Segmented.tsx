'use client';
import { useTranslation } from 'react-i18next';

export type SegmentedOption = { value: string; label: string };

// 等分分段控件:一条圆角 track 内 N 段平分。受控、纯展示。
// withDefault:首段为「Default」段,选中即回传 undefined(语义=未设置,沿用服务端默认),
//   把高级面板「再点一次清空」这一隐藏交互显式化。
// 选中段用 ink 反色实心填充:此深色调色板里「更抬起」的中性面反而更暗,iOS 式更浅 thumb
//   不通用,故用主题稳定的强对比,修掉描边 chip 在深色下像被禁用的老问题。
export default function Segmented({
  value,
  options,
  onChange,
  withDefault = false,
  defaultLabel,
  ariaLabel,
}: {
  value: string | undefined;
  options: SegmentedOption[];
  onChange: (value: string | undefined) => void;
  withDefault?: boolean;
  defaultLabel?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  // Default 段用哨兵 key 与真实 option.value 区分(真实值里可能恰好有 'auto' 等)
  const segments: { key: string; label: string; val: string | undefined }[] = [
    ...(withDefault ? [{ key: '__default__', label: defaultLabel ?? t('common.default'), val: undefined }] : []),
    ...options.map((o) => ({ key: o.value, label: o.label, val: o.value as string | undefined })),
  ];
  const activeIndex = Math.max(0, segments.findIndex((s) => s.val === value));
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="relative flex w-full rounded-[10px] bg-[var(--color-fill)] p-0.5">
      {/* 选中滑块:绝对定位,按选中档平移(去 gap 等分,translateX 精确对齐) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[8px] bg-[var(--color-ink)] transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 4px) / ${segments.length})`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {segments.map((s) => {
        const active = s.val === value; // undefined===undefined → Default 段选中;否则值匹配
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active || undefined}
            onClick={() => onChange(s.val)}
            className={`relative z-10 min-w-0 flex-1 truncate rounded-[8px] px-1.5 py-1 text-center text-[12px] transition-colors duration-150 ${
              active ? 'font-medium text-[var(--color-surface)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
