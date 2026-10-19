import { describe, it, expect } from 'vitest';
import { resolveLocalPreviewRelPath, contentTypeFor, parseVersionDirNames } from './local-preview';

describe('resolveLocalPreviewRelPath', () => {
  it('合法段拼相对路径:{pid}/v{n}/dist/**', () => {
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'dist', 'index.html'])).toBe('535/v1/dist/index.html');
    expect(resolveLocalPreviewRelPath(['535', 'v12', 'dist', 'assets', 'a-B_1.js'])).toBe('535/v12/dist/assets/a-B_1.js');
  });

  it('形状不符返回 null(段数/项目号/版本段/dist 锚点)', () => {
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'dist'])).toBeNull();          // 缺文件段
    expect(resolveLocalPreviewRelPath(['abc', 'v1', 'dist', 'i.html'])).toBeNull(); // pid 非数字
    expect(resolveLocalPreviewRelPath(['535', '1', 'dist', 'i.html'])).toBeNull();  // 版本段缺 v
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'src', 'i.html'])).toBeNull();  // 只放行 dist
  });

  it('路径穿越/非法字符返回 null', () => {
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'dist', '..', 'secret'])).toBeNull();
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'dist', 'a/../../b'])).toBeNull();
    expect(resolveLocalPreviewRelPath(['..', 'v1', 'dist', 'i.html'])).toBeNull();
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'dist', ''])).toBeNull();
    expect(resolveLocalPreviewRelPath(['535', 'v1', 'dist', '.hidden'])).toBe('535/v1/dist/.hidden'); // 点开头文件放行(如 .vite 产物),仅拦 . / ..
  });
});

describe('contentTypeFor', () => {
  it('常见静态类型', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('a.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('a.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.glb')).toBe('model/gltf-binary');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });
});

describe('parseVersionDirNames', () => {
  it('仅取 v{n} 形目录并升序', () => {
    expect(parseVersionDirNames(['v2', 'current', 'v10', 'AGENTS.md', 'v1', 'vx', 'v'])).toEqual([1, 2, 10]);
  });
  it('空列表返回空', () => {
    expect(parseVersionDirNames([])).toEqual([]);
  });
});
