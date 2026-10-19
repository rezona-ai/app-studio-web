import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveAssetUrl, buildSharePageUrl, assetProxyUrl } from './url';

afterEach(() => vi.unstubAllEnvs());

describe('resolveAssetUrl', () => {
  test('null/undefined → undefined', () => {
    expect(resolveAssetUrl(null)).toBeUndefined();
    expect(resolveAssetUrl(undefined)).toBeUndefined();
  });
  test('绝对地址原样返回', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://8.233.87.67');
    expect(resolveAssetUrl('http://x/y.png')).toBe('http://x/y.png');
  });
  test('相对地址补 base + /game/pgcserver 前缀(处理斜杠)', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://8.233.87.67/');
    expect(resolveAssetUrl('/preview/42/canvas/a.png')).toBe('http://8.233.87.67/game/pgcserver/preview/42/canvas/a.png');
  });
  test('未配置 base 时相对地址原样返回', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', '');
    expect(resolveAssetUrl('/preview/a.png')).toBe('/preview/a.png');
  });
});

describe('buildSharePageUrl', () => {
  test('本站 origin + basePath + /share/{code}/v{seq}', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
    expect(buildSharePageUrl('DaKkJMXU', 8)).toBe(`${window.location.origin}/game/share/DaKkJMXU/v8`);
  });
  test('根路径模式(无 basePath)', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    expect(buildSharePageUrl('abc', 1)).toBe(`${window.location.origin}/share/abc/v1`);
  });
  test('缺 publicId / seq(含 NaN)时返回 null', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
    expect(buildSharePageUrl(null, 8)).toBeNull();
    expect(buildSharePageUrl('abc', null)).toBeNull();
    expect(buildSharePageUrl('abc', Number.NaN)).toBeNull();
  });
});

describe('assetProxyUrl', () => {
  test('null/undefined → undefined', () => {
    expect(assetProxyUrl(null)).toBeUndefined();
    expect(assetProxyUrl(undefined)).toBeUndefined();
  });
  test('data: URL 原样返回(内联字节无需代理)', () => {
    expect(assetProxyUrl('data:model/gltf-binary;base64,AAAA')).toBe('data:model/gltf-binary;base64,AAAA');
  });
  test('绝对/相对地址 → 包成同源代理 /api/pgc/asset?url=<encoded>(规避 model-viewer fetch 跨域)', () => {
    expect(assetProxyUrl('https://devlab.rezona.ai/game/pgcserver/preview/229/canvas/a.glb')).toBe(
      '/api/pgc/asset?url=' + encodeURIComponent('https://devlab.rezona.ai/game/pgcserver/preview/229/canvas/a.glb'),
    );
    expect(assetProxyUrl('/preview/42/canvas/b.glb')).toBe(
      '/api/pgc/asset?url=' + encodeURIComponent('/preview/42/canvas/b.glb'),
    );
  });
});
