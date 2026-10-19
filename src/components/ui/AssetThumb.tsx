'use client';
import { FigIcon } from './figma';
import { KIND_META } from '@/lib/asset-kind';
import { assetThumbSource } from '@/lib/asset-thumb';
import type { Asset } from '@/store/types';

/**
 * 铺满容器的资产缩略图:判据全在 `lib/asset-thumb.ts`(唯一来源),这里只负责三种渲染形态。
 * 容器自带尺寸与 `overflow-hidden`;`videoFrame` 用首帧封面而**不是**播放器
 * (与 VideoNode 同款 `#t=0.001`:不给 controls、muted、只 preload metadata)。
 *
 * `fallback` 决定「没有真实封面时」画什么,两种形态各有其对:
 *   `placeholder`(默认)—— 缩略图槽位(列表行、tile 网格):与画布卡同一张类型底图,
 *      槽位不能空着,而这些形态里名称在别处或只有 title。
 *   `icon` —— chip 形态(贴片 + 名称):占位图会让几个不同资产长成同一张脸,
 *      而 chip 本来就带名称,图标反而更快读出类型(既有 AssetChip 行为)。
 */
export default function AssetThumb({ asset, iconSize = 16, alt = '', fallback = 'placeholder' }: {
  asset: Asset; iconSize?: number; alt?: string; fallback?: 'placeholder' | 'icon';
}) {
  const thumb = assetThumbSource(asset);
  const cover = 'size-full object-cover';
  if (thumb.mode === 'image' && thumb.placeholder && fallback === 'icon') {
    return <FigIcon src={KIND_META[asset.kind].icon} size={iconSize} />;
  }
  if (thumb.mode === 'image') {
    return <img src={thumb.src} alt={alt} draggable={false} loading="lazy" decoding="async" className={cover} />;
  }
  if (thumb.mode === 'videoFrame') {
    return <video src={`${thumb.src}#t=0.001`} muted playsInline preload="metadata" className={cover} />;
  }
  return <FigIcon src={KIND_META[thumb.kind].icon} size={iconSize} />;
}
