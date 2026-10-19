import { expect, test } from 'vitest';
import { mediaThumb } from './media-thumb';
import type { MediaItem } from '@/koubou/protocol';
import type { Asset } from '@/store/types';

const item = (over: Partial<MediaItem>): MediaItem =>
  ({ kind: 'image', path: 'current/src/assets/hero.png', previewUrl: 'https://k/assets/hero.png', ...over });

const asset = (over: Partial<Asset>): Asset =>
  ({ id: 'a1', key: 'a1', label: 'x', kind: '3d', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, ...over });

test('image → 直接用 previewUrl', () => {
  expect(mediaThumb(item({}), [])).toEqual({ kind: 'image', src: 'https://k/assets/hero.png' });
});

test('video → previewUrl 是媒体流不是图,只回 kind(调用方回退类型占位图)', () => {
  expect(mediaThumb(item({ kind: 'video', path: 'a/intro.mp4', previewUrl: 'https://k/intro.mp4' }), [])).toEqual({ kind: 'video' });
});

test('video → 画布同名资产有封面(thumbnail_url)时用它当缩略图', () => {
  const assets = [asset({ kind: 'video', preview: { src: 'https://pgc/canvas/intro.mp4', poster: 'https://pgc/canvas/intro.cover.webp' } })];
  expect(mediaThumb(item({ kind: 'video', path: 'a/intro.mp4', previewUrl: 'https://k/intro.mp4' }), assets)).toEqual({
    kind: 'video', src: 'https://pgc/canvas/intro.cover.webp',
  });
});

test('3D → previewUrl 是 glb 不可当图,按文件名反查画布资产的 poster', () => {
  const assets = [asset({ preview: { src: 'https://pgc/canvas/ship.glb', poster: 'https://pgc/canvas/ship.preview.webp' } })];
  expect(mediaThumb(item({ kind: 'model3d', path: 'current/src/assets/ship.glb', previewUrl: 'https://k/ship.glb' }), assets)).toEqual({
    kind: '3d', src: 'https://pgc/canvas/ship.preview.webp',
  });
});

test('3D → 画布无同名资产时只回 kind,不回 glb 直链', () => {
  expect(mediaThumb(item({ kind: 'model3d', path: 'a/ship.glb', previewUrl: 'https://k/ship.glb' }), [])).toEqual({ kind: '3d' });
});

test('3D → 同名资产存在但没有 poster(缩略图尚未产出)时只回 kind', () => {
  const assets = [asset({ preview: { src: 'https://pgc/canvas/ship.glb' } })];
  expect(mediaThumb(item({ kind: 'model3d', path: 'a/ship.glb', previewUrl: 'https://k/ship.glb' }), assets)).toEqual({ kind: '3d' });
});

test('audio → previewUrl 不是图,但音频可内联播放,src 留空由调用方回退类型图标', () => {
  expect(mediaThumb(item({ kind: 'audio', path: 'a/bgm.mp3', previewUrl: 'https://k/bgm.mp3' }), [])).toEqual({ kind: 'audio' });
});

test('无 previewUrl 的图片 → 只回 kind', () => {
  expect(mediaThumb(item({ previewUrl: null }), [])).toEqual({ kind: 'image' });
});

test('反查按 basename 比对,画布资产用 dataUrl 时也能命中', () => {
  const assets = [asset({ preview: { dataUrl: 'https://pgc/canvas/ship.glb', poster: 'https://pgc/p.webp' } })];
  expect(mediaThumb(item({ kind: '3d', path: 'a/ship.glb', previewUrl: null }), assets)).toEqual({ kind: '3d', src: 'https://pgc/p.webp' });
});

test('反查忽略 query/hash(签名直链)', () => {
  const assets = [asset({ preview: { src: 'https://pgc/canvas/ship.glb?sig=abc', poster: 'https://pgc/p.webp' } })];
  expect(mediaThumb(item({ kind: 'model3d', path: 'a/ship.glb', previewUrl: null }), assets)).toEqual({ kind: '3d', src: 'https://pgc/p.webp' });
});
