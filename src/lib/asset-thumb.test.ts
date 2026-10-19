import { describe, expect, test } from 'vitest';
import { assetThumbSource } from './asset-thumb';
import { generatingPlaceholderPath } from './asset-kind';
import type { AssetKind } from './asset-kind';
import type { Asset, AssetPreviewData } from '@/store/types';

const asset = (kind: AssetKind, preview?: AssetPreviewData): Asset => ({
  id: 'a', key: 'a', label: 'A', kind, source: 'generated',
  status: 'ready', position: { x: 0, y: 0 }, ...(preview ? { preview } : {}),
});

describe('assetThumbSource(缩略图来源的唯一判据,逐类型与画布卡对齐)', () => {
  test('image:dataUrl 优先于 src,当图渲染', () => {
    expect(assetThumbSource(asset('image', { src: 'http://x/a.png', dataUrl: 'data:image/png;base64,AA' })))
      .toEqual({ mode: 'image', src: 'data:image/png;base64,AA' });
    expect(assetThumbSource(asset('image', { src: 'http://x/a.png' })))
      .toEqual({ mode: 'image', src: 'http://x/a.png' });
  });

  test('image 无 preview:退类型占位图(与画布 GeneratingPlaceholder 同一张)', () => {
    expect(assetThumbSource(asset('image'))).toEqual({ mode: 'image', src: generatingPlaceholderPath('image'), placeholder: true });
  });

  test('video 有 poster:用 poster 当图,不碰媒体流', () => {
    expect(assetThumbSource(asset('video', { src: 'http://x/a.mp4', poster: 'http://x/a.jpg' })))
      .toEqual({ mode: 'image', src: 'http://x/a.jpg' });
  });

  test('video 无 poster:走首帧(与 VideoNode 同款),**不得**把媒体流交给 <img>', () => {
    expect(assetThumbSource(asset('video', { src: 'http://x/a.mp4' })))
      .toEqual({ mode: 'videoFrame', src: 'http://x/a.mp4' });
  });

  test('video 什么都没有:退类型占位图', () => {
    expect(assetThumbSource(asset('video'))).toEqual({ mode: 'image', src: generatingPlaceholderPath('video'), placeholder: true });
  });

  test('3d:poster 优先,无 poster 退 3d 占位图(与 ThreeDNode 一致,glb 绝不当图)', () => {
    expect(assetThumbSource(asset('3d', { src: 'http://x/a.glb', poster: 'http://x/a.jpg' })))
      .toEqual({ mode: 'image', src: 'http://x/a.jpg' });
    expect(assetThumbSource(asset('3d', { src: 'http://x/a.glb' })))
      .toEqual({ mode: 'image', src: generatingPlaceholderPath('3d'), placeholder: true });
  });

  test('audio:恒退音频占位图(画布是播放器,列表行放不下)', () => {
    expect(assetThumbSource(asset('audio', { src: 'http://x/a.mp3' })))
      .toEqual({ mode: 'image', src: generatingPlaceholderPath('audio'), placeholder: true });
  });

  // text 是唯一没有类型占位图的类型(PLACEHOLDER_SRC 不含它,GenErrorBody 也对它跳过底图),
  // 故它是 icon 分支存在的**唯一**理由
  test('text:退类型图标(无类型占位图,且正文缩略无意义)', () => {
    expect(assetThumbSource(asset('text', { text: '很长的正文' }))).toEqual({ mode: 'icon', kind: 'text' });
  });

  test('生成中 / 失败的卡:不拿预览冒充产物,一律退类型占位图(对齐画布两个 Body)', () => {
    const generating: Asset = { ...asset('image', { src: 'http://x/old.png' }), status: 'generating' };
    expect(assetThumbSource(generating)).toEqual({ mode: 'image', src: generatingPlaceholderPath('image'), placeholder: true });
    const failed: Asset = { ...asset('video', { poster: 'http://x/old.jpg' }), status: 'error' };
    expect(assetThumbSource(failed)).toEqual({ mode: 'image', src: generatingPlaceholderPath('video'), placeholder: true });
    const failedText: Asset = { ...asset('text'), status: 'error' };
    expect(assetThumbSource(failedText)).toEqual({ mode: 'icon', kind: 'text' });
  });
});
