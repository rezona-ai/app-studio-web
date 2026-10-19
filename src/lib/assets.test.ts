import { describe, expect, test } from 'vitest';
import { makeAsset, kindFromMime } from './assets';

describe('makeAsset', () => {
  test('默认值:类型/标签/来源/状态/位置', () => {
    const a = makeAsset('image');
    expect(a.kind).toBe('image');
    expect(a.label).toBe('Image');
    expect(a.source).toBe('generated');
    expect(a.status).toBe('ready');
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.key).toBe(a.id);
  });

  test('text 默认标签为 Text;可覆盖 label 与 position', () => {
    const a = makeAsset('text', { label: 'My note', position: { x: 10, y: 20 } });
    expect(a.label).toBe('My note');
    expect(a.position).toEqual({ x: 10, y: 20 });
    const d = makeAsset('text');
    expect(d.label).toBe('Text');
  });

  test('上传来源带 preview', () => {
    const a = makeAsset('image', { source: 'uploaded', preview: { dataUrl: 'd', src: 'd' } });
    expect(a.source).toBe('uploaded');
    expect(a.preview).toEqual({ dataUrl: 'd', src: 'd' });
  });
});

describe('kindFromMime', () => {
  test('按前缀映射,未知归 text', () => {
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('text/plain')).toBe('text');
    expect(kindFromMime('')).toBe('text');
  });
});
