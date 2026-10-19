import { describe, it, expect } from 'vitest';
import { filePreviewKind } from './highlight';

describe('filePreviewKind', () => {
  it('图片扩展归 image', () => {
    for (const p of ['a.png', 'src/b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.ico', 'h.avif']) {
      expect(filePreviewKind(p)).toBe('image');
    }
  });

  it('视频扩展归 video', () => {
    for (const p of ['a.mp4', 'b.webm', 'c.mov', 'd.m4v', 'e.avi', 'f.mkv']) {
      expect(filePreviewKind(p)).toBe('video');
    }
  });

  it('音频扩展归 audio', () => {
    for (const p of ['a.mp3', 'b.wav', 'c.ogg', 'd.m4a', 'e.aac', 'f.flac']) {
      expect(filePreviewKind(p)).toBe('audio');
    }
  });

  it('glb/gltf 归 3d', () => {
    expect(filePreviewKind('hero.glb')).toBe('3d');
    expect(filePreviewKind('scene.GLTF')).toBe('3d');
  });

  it('已知二进制(字体/压缩包/wasm/pdf)归 binary', () => {
    for (const p of ['f.ttf', 'f.otf', 'f.woff', 'f.woff2', 'a.zip', 'a.gz', 'a.tar', 'a.bin', 'm.wasm', 'd.pdf']) {
      expect(filePreviewKind(p)).toBe('binary');
    }
  });

  it('svg 仍归 text(文本 XML,不当图片处理)', () => {
    expect(filePreviewKind('icon.svg')).toBe('text');
  });

  it('文本源码格式归 text', () => {
    for (const p of ['index.html', 'a.css', 'b.js', 'c.ts', 'd.json', 'e.md', 'f.txt']) {
      expect(filePreviewKind(p)).toBe('text');
    }
  });

  it('无扩展 / 未知扩展默认 text', () => {
    expect(filePreviewKind('Makefile')).toBe('text');
    expect(filePreviewKind('src/weird.xyzzy')).toBe('text');
    expect(filePreviewKind('noext')).toBe('text');
  });

  it('大小写不敏感', () => {
    expect(filePreviewKind('A.PNG')).toBe('image');
    expect(filePreviewKind('B.Mp4')).toBe('video');
  });
});
