import { describe, test, expect, vi, afterEach } from 'vitest';
import { buildFullscreenUrl } from './fullscreen-url';

afterEach(() => { vi.unstubAllEnvs(); });

describe('buildFullscreenUrl', () => {
  test('basePath + /full/{pid}/{vid}?seq={n}', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
    expect(buildFullscreenUrl(535, { id: 'ver_9', index: 3 })).toBe('/game/full/535/ver_9?seq=3');
  });

  test('根路径模式(无 basePath)', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    expect(buildFullscreenUrl(7, { id: 'ver_1', index: 1 })).toBe('/full/7/ver_1?seq=1');
  });

  test('缺 pid / version 时返回 null(调用方据此禁用按钮)', () => {
    expect(buildFullscreenUrl(null, { id: 'ver_9', index: 3 })).toBeNull();
    expect(buildFullscreenUrl(535, null)).toBeNull();
  });

  test('vid 做 URL 编码,不让异常字符逃出路径段', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    expect(buildFullscreenUrl(1, { id: 'a/b?c', index: 2 })).toBe('/full/1/a%2Fb%3Fc?seq=2');
  });
});
