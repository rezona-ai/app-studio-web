import { describe, expect, test } from 'vitest';
import { resolveAssetProxyTarget } from './asset-target';

const BASE = 'http://8.233.87.67';

describe('resolveAssetProxyTarget', () => {
  test('相对路径拼到 base + /game/pgcserver(处理多余斜杠)', () => {
    expect(resolveAssetProxyTarget('/preview/42/a.glb', BASE)).toBe('http://8.233.87.67/game/pgcserver/preview/42/a.glb');
    expect(resolveAssetProxyTarget('preview/a.glb', BASE + '/')).toBe('http://8.233.87.67/game/pgcserver/preview/a.glb');
  });

  test('同源绝对地址放行(prefix 已在路径内,仅校验同源)', () => {
    expect(resolveAssetProxyTarget('http://8.233.87.67/game/pgcserver/preview/a.glb', BASE)).toBe('http://8.233.87.67/game/pgcserver/preview/a.glb');
  });

  test('跨源绝对地址拒绝(SSRF 防护)', () => {
    expect(resolveAssetProxyTarget('http://169.254.169.254/latest/meta-data', BASE)).toBeNull();
    expect(resolveAssetProxyTarget('http://evil.com/x', BASE)).toBeNull();
  });

  test('base 未配置时拒绝', () => {
    expect(resolveAssetProxyTarget('/preview/a.glb', '')).toBeNull();
  });

  test('非法 URL 拒绝', () => {
    expect(resolveAssetProxyTarget('http://[bad', BASE)).toBeNull();
  });
});
