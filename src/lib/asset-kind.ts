// 资产类型(原 agent-protocol/messages,迁来此处作为唯一来源)
export type AssetKind = 'image' | 'video' | 'audio' | '3d' | 'text';

import { figAsset } from '@/components/ui/figma';
import { assetPath } from '@/lib/basePath';

// 资产类型的 UI 元数据:类型色变量 / 图标(徽章/图例文案已迁至 i18n canvas.assetKind.*)
export const KIND_META: Record<AssetKind, { colorVar: string; icon: string }> = {
  image: { colorVar: 'var(--color-image)', icon: figAsset.image },
  video: { colorVar: 'var(--color-video)', icon: figAsset.video },
  audio: { colorVar: 'var(--color-audio)', icon: figAsset.audio },
  '3d': { colorVar: 'var(--color-3d)', icon: figAsset.threeD },
  text: { colorVar: 'var(--color-text)', icon: figAsset.text },
};

// 无真实预览时的类型占位图(生成中骨架 / 缩略图回退共用);经 assetPath 保证部署在 /game 下也可达
export type GeneratingAssetKind = Exclude<AssetKind, 'text'>;
const PLACEHOLDER_SRC: Record<GeneratingAssetKind, string> = {
  image: '/assets/generating/image.jpg',
  video: '/assets/generating/video.jpg',
  audio: '/assets/generating/audio.jpg',
  '3d': '/assets/generating/3d.jpg',
};
export function generatingPlaceholderPath(kind: GeneratingAssetKind): string {
  return assetPath(PLACEHOLDER_SRC[kind]);
}

export const KIND_ORDER: AssetKind[] = ['image', 'video', 'audio', '3d', 'text'];
