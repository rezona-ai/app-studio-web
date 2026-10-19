import { afterEach, describe, expect, test, vi } from 'vitest';
import { isShareCode, isShareVersion, buildGamePvUrl, buildRemixHref, STUDIO_GAME_HREF } from './share-page';

afterEach(() => vi.unstubAllEnvs());

describe('isShareCode', () => {
  test('六位以上字母数字为合法', () => {
    expect(isShareCode('DaKkJMXU')).toBe(true);
    expect(isShareCode('abc123')).toBe(true);
  });
  test('过短 / 含非字母数字 / 空一律非法', () => {
    expect(isShareCode('abc12')).toBe(false);
    expect(isShareCode('abc-123')).toBe(false);
    expect(isShareCode('../../etc')).toBe(false);
    expect(isShareCode('')).toBe(false);
  });
});

describe('isShareVersion', () => {
  test('v{n} 为合法', () => {
    expect(isShareVersion('v1')).toBe(true);
    expect(isShareVersion('v128')).toBe(true);
  });
  test('缺 v / 非数字 / 带路径分隔一律非法', () => {
    expect(isShareVersion('1')).toBe(false);
    expect(isShareVersion('vx')).toBe(false);
    expect(isShareVersion('v1/..')).toBe(false);
    expect(isShareVersion('')).toBe(false);
  });
});

describe('buildGamePvUrl', () => {
  test('pgc 公开基址 + /game/pgcserver 前缀 + 该版本 dist/index.html', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://lab.rezona.ai');
    expect(buildGamePvUrl('DaKkJMXU', 'v8')).toBe(
      'https://lab.rezona.ai/game/pgcserver/pv/DaKkJMXU/v8/dist/index.html',
    );
  });
  test('基址带尾斜杠时不产生双斜杠', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://lab.rezona.ai/');
    expect(buildGamePvUrl('abc123', 'v1')).toBe(
      'https://lab.rezona.ai/game/pgcserver/pv/abc123/v1/dist/index.html',
    );
  });
  // 缺 env 时产出相对路径,而本服务不服务 /game/pgcserver/*(代理只挂 /api/pgc/*)——
  // 即「配置缺失就是坏的」,这里只钉住不额外兜底这一决定,别把它读成「本地也能跑」
  test('未配置基址时产出相对路径(此即配置缺失,不伪装成可用)', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', '');
    expect(buildGamePvUrl('abc123', 'v1')).toBe('/game/pgcserver/pv/abc123/v1/dist/index.html');
  });
});

describe('buildRemixHref', () => {
  test('部署态带 basePath', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
    expect(buildRemixHref('DaKkJMXU')).toBe('/game/?remix=DaKkJMXU');
  });
  test('根路径模式(本地开发不设 basePath)', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    expect(buildRemixHref('abc123')).toBe('/?remix=abc123');
  });
});

describe('STUDIO_GAME_HREF', () => {
  // 主站与本应用同源但不在 /game 前缀下(主站挂 /studio),故这条**刻意不经 basePath** ——
  // 补了前缀反而会指到本应用自己的 /game/studio/game 这个不存在的路径。与 buildSignInUrl 同理。
  test('恒为主站 /studio/game,不随 basePath 变化', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
    expect(STUDIO_GAME_HREF).toBe('/studio/game');
  });
});
