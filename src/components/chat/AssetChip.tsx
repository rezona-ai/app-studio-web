'use client';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssetKind } from '@/lib/asset-kind';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';
import { FigIcon } from '@/components/ui/figma';
import Tooltip from '@/components/ui/Tooltip';
import { KIND_META } from '@/lib/asset-kind';
import UiAssetThumb from '@/components/ui/AssetThumb';

// 资产引用 chip 展示型基座:图标贴片 + 标签,可选 hover 浮现的移除按钮
export function Chip({
  icon,
  label,
  onRemove,
  removeLabel,
}: {
  icon: ReactNode;
  label: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const { t } = useTranslation();
  // removeLabel 默认值不能在 prop 默认参数里调 hook,故在函数体内用 ?? 回落
  const resolvedRemoveLabel = removeLabel ?? t('chat.asset.remove');
  return (
    <span className="group inline-flex h-10 w-fit max-w-full items-center gap-2 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-surface)] py-1 pl-1 pr-3">
      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--color-fill)]">
        {icon}
      </span>
      <span className="truncate text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)]">{label}</span>
      {onRemove && (
        <Tooltip label={resolvedRemoveLabel}>
          <button
            type="button"
            onClick={onRemove}
            aria-label={resolvedRemoveLabel}
            // 始终占位(grid 常驻 + size-5 固定宽),仅用 visibility 切显隐:避免 hover 时按钮入场撑宽 chip 触发换行;visibility:hidden 同时屏蔽点击
            className="-mr-1 invisible grid size-5 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition hover:bg-[var(--color-fill)] group-hover:visible"
          >
            {/* 用几何对称的 SVG 叉号(同 MediaLightbox):裸 × 字形按基线排版在行盒内不居中,SVG 才能被 place-items-center 真正居中 */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
      )}
    </span>
  );
}

// 媒体缩略图基元:图片直接 <img>;视频复用首帧封面(#t=0.001,同 VideoNode);其余(音频/3D/文档)回退类型图标
// 需放在相对定位的方形贴片容器内使用
export function MediaThumb({ kind, src, iconSize = 16 }: { kind: AssetKind; src?: string; iconSize?: number }) {
  const cover = 'absolute inset-0 size-full object-cover';
  if (src && kind === 'image') return <img src={src} alt="" loading="lazy" decoding="async" className={cover} />;
  if (src && kind === 'video') return <video src={`${src}#t=0.001`} muted playsInline preload="metadata" className={cover} />;
  return <FigIcon src={KIND_META[kind].icon} size={iconSize} />;
}

// 资产缩略图:判据统一走 lib/asset-thumb(与画布卡、资产列表同一份),故直接用 ui 基元。
// 查不到资产时(chip 只有 key)没有 kind 可依据,退图像图标 —— 与改动前同款回退
export function AssetThumb({ asset }: { asset?: Asset }) {
  // chip 形态:无真实封面退类型图标(见 ui/AssetThumb 的 fallback 注释)
  return asset ? <UiAssetThumb asset={asset} fallback="icon" /> : <FigIcon src={KIND_META.image.icon} size={16} />;
}

// 对话内/组合框的资产引用 chip:按 key 查 store,复用资产封面,否则回退类型图标
export default function AssetChip({ assetKey, onRemove }: { assetKey: string; onRemove?: () => void }) {
  const { t } = useTranslation();
  const asset = useStore((s) => s.assets.find((a) => a.key === assetKey));
  return <Chip onRemove={onRemove} removeLabel={t('chat.asset.removeReference')} label={asset?.label ?? assetKey} icon={<AssetThumb asset={asset} />} />;
}
