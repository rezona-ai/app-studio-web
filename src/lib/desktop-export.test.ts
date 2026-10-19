import { afterEach, expect, test, vi } from 'vitest';
import {
  isValidDesktopName, sanitizeDesktopName, defaultDesktopName, isDesktopTerminal,
  formatPackageSize, mapDesktopError, desktopDownloadPath,
  DESKTOP_NAME_MAX, DESKTOP_POLL_INTERVAL_MS,
} from './desktop-export';

// spec: docs/superpowers/specs/2026-08-26-export-steam-package.md
// 关注点:name 校验与后端 422 口径逐条对齐、体积格式化、错误码映射、下载路径拼接

test('轮询间隔落在契约建议的 2–5s 区间内', () => {
  expect(DESKTOP_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
  expect(DESKTOP_POLL_INTERVAL_MS).toBeLessThanOrEqual(5000);
});

test('isValidDesktopName:空 / 纯空白 / 纯控制字符一律拒(后端剔控制字符后为空即 422)', () => {
  expect(isValidDesktopName('')).toBe(false);
  expect(isValidDesktopName('   ')).toBe(false);
  expect(isValidDesktopName('\x01\x02')).toBe(false);
});

test('isValidDesktopName:九个非法字符逐一拒(Windows 文件名保留字符,后端 422)', () => {
  for (const ch of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
    expect(isValidDesktopName(`Game${ch}Demo`), `应拒 ${ch}`).toBe(false);
  }
});

test('isValidDesktopName:以点结尾拒(Windows 不接受尾点目录名)', () => {
  expect(isValidDesktopName('Game.')).toBe(false);
  expect(isValidDesktopName('Game..')).toBe(false);
  // 点在中间是合法的
  expect(isValidDesktopName('Game.v2')).toBe(true);
});

test('isValidDesktopName:长度上限 64,超出即拒', () => {
  expect(isValidDesktopName('a'.repeat(DESKTOP_NAME_MAX))).toBe(true);
  expect(isValidDesktopName('a'.repeat(DESKTOP_NAME_MAX + 1))).toBe(false);
});

test('isValidDesktopName:中文显示名合法(exe 名由后端取 ASCII 部分派生,与校验无关)', () => {
  expect(isValidDesktopName('史莱姆点点乐 Demo')).toBe(true);
  expect(isValidDesktopName('史莱姆点点乐')).toBe(true);
});

test('sanitizeDesktopName:剔控制字符 + trim,**不做 ASCII 提取**', () => {
  expect(sanitizeDesktopName('  史莱姆点点乐 Demo  ')).toBe('史莱姆点点乐 Demo');
  expect(sanitizeDesktopName('Ga\x00me\x1f')).toBe('Game');
  // 这条是 spec 约束 3 的守护:前端一旦被人加上「取 ASCII 部分」的派生,这里立刻红
  expect(sanitizeDesktopName('史莱姆点点乐 Demo')).not.toBe('Demo');
});

test('defaultDesktopName:空白回落 Game,超长截 64', () => {
  expect(defaultDesktopName(undefined)).toBe('Game');
  expect(defaultDesktopName('   ')).toBe('Game');
  expect(defaultDesktopName('Pixel Dungeon')).toBe('Pixel Dungeon');
  expect(defaultDesktopName('a'.repeat(80))).toBe('a'.repeat(DESKTOP_NAME_MAX));
});

test('isDesktopTerminal:仅 succeeded / failed 是终态', () => {
  expect(isDesktopTerminal('queued')).toBe(false);
  expect(isDesktopTerminal('building')).toBe(false);
  expect(isDesktopTerminal('succeeded')).toBe(true);
  expect(isDesktopTerminal('failed')).toBe(true);
});

test('formatPackageSize:按 MB 一位小数;null 透传 null', () => {
  expect(formatPackageSize(144_703_488)).toBe('138.0 MB');
  expect(formatPackageSize(0)).toBe('0.0 MB');
  expect(formatPackageSize(null)).toBe(null);
  expect(formatPackageSize(undefined)).toBe(null);
});

test('mapDesktopError:八个契约错误码各有专属文案,未知码回落通用', () => {
  expect(mapDesktopError('DESKTOP_EXPORT_DISABLED')).toBe('preview.steam.err.disabled');
  expect(mapDesktopError('DESKTOP_VERSION_NOT_BUILDABLE')).toBe('preview.steam.err.notBuildable');
  expect(mapDesktopError('DESKTOP_PACKAGE_TOO_LARGE')).toBe('preview.steam.err.tooLarge');
  expect(mapDesktopError('DESKTOP_BUILD_WORKER_UNAVAILABLE')).toBe('preview.steam.err.workerUnavailable');
  expect(mapDesktopError('DESKTOP_BUILD_NOT_READY')).toBe('preview.steam.err.notReady');
  expect(mapDesktopError('DESKTOP_BUILD_NOT_FOUND')).toBe('preview.steam.err.notFound');
  expect(mapDesktopError('DESKTOP_BUILD_QUOTA_EXCEEDED')).toBe('preview.steam.err.quotaExceeded');
  expect(mapDesktopError('IDEMPOTENCY_CONFLICT')).toBe('preview.steam.err.idempotencyConflict');
  expect(mapDesktopError('SOMETHING_ELSE')).toBe('preview.steam.err.generic');
});

test('desktopDownloadPath:代理前缀与上游 /api 段都要在(漏一段就 404 且静默)', () => {
  expect(desktopDownloadPath('pub7', 42)).toBe('/api/pgc/api/projects/pub7/desktop-builds/42/download');
  // /api/pgc 是本服务代理挂载点,/api/projects 才是上游 pgc 的真实路径 —— 与 client.ts 的
  // downloadVersion(`${PREFIX}/api/projects/...`)同一范式。这条断言就是那次漏段的回归守护
  expect(desktopDownloadPath('pub7', 42)).toContain('/api/pgc/api/projects/');
  // 不含 basePath / 不含 PGC 裸域:补前缀是 apiPath 的职责(见 src/lib/basePath.ts)
  expect(desktopDownloadPath('pub7', 42)).not.toMatch(/^https?:/);
});

test('isValidDesktopName:Windows 保留设备名拒(契约文档没列,只有后端 schema 有)', () => {
  for (const n of ['CON', 'con', 'Aux', 'NUL', 'com1', 'LPT9', 'Con.Demo', 'nul.exe']) {
    expect(isValidDesktopName(n), `应拒 ${n}`).toBe(false);
  }
  // 只按第一段判,保留名做前缀的正常标题不该被牵连
  expect(isValidDesktopName('Console Wars')).toBe(true);
  expect(isValidDesktopName('Comet')).toBe(true);
  expect(isValidDesktopName('com10')).toBe(true);
});

test('mapDesktopError:后端 name 校验的 VALIDATION_ERROR 有专属文案,不落进 generic', () => {
  expect(mapDesktopError('VALIDATION_ERROR')).toBe('preview.steam.err.nameRejected');
});

test('defaultDesktopName:超长按码位截断,不切断代理对', () => {
  const emoji = '\u{1F600}';                       // 单字符 = 2 个 UTF-16 码元
  const long = emoji.repeat(40);                    // 40 字符 / 80 码元
  const out = defaultDesktopName(long);
  expect(Array.from(out)).toHaveLength(40);         // 未超上限,整串保留
  // 关键:不得出现孤立代理项(后端拼幂等键时 encode 会抛 → 500)
  expect(out).toBe(long);
  const over = emoji.repeat(70);                    // 70 字符,超 64
  expect(Array.from(defaultDesktopName(over))).toHaveLength(64);
  expect(defaultDesktopName(over)).toBe(emoji.repeat(64));
});

test('预填开箱即合法:项目名含非法字符 / 尾点 / 撞保留名时不该一开弹窗就红框', () => {
  // 光标一进来就是灰 CTA + 红框、而用户一个字都没输入 —— 预填要自己先合法
  expect(isValidDesktopName(defaultDesktopName('Slime Clicker: Demo'))).toBe(true);
  expect(defaultDesktopName('Slime Clicker: Demo')).toBe('Slime Clicker Demo');
  expect(defaultDesktopName('Game v1.0.')).toBe('Game v1.0');
  expect(defaultDesktopName('Rock/Paper')).toBe('RockPaper');
  // 撞保留名退回 Game(而不是给一个必然 422 的预填)
  expect(defaultDesktopName('CON')).toBe('Game');
  expect(defaultDesktopName('nul.exe')).toBe('Game');
  // 截断后新冒出的尾点也要削掉
  expect(isValidDesktopName(defaultDesktopName('a'.repeat(63) + '.tail'))).toBe(true);
  // 但**不放宽** isValidDesktopName 的口径:用户手动输入非法值仍须被拒
  expect(isValidDesktopName('Slime Clicker: Demo')).toBe(false);
});

afterEach(() => { vi.restoreAllMocks(); });

test('下载直链与 pgcApi.desktop.status 共用一份路径口径(两处各写一份曾漂成 404)', async () => {
  // 动态 import 避免把带副作用的 client 拉进本文件其余纯逻辑用例
  const { pgcApi } = await import('./pgc/client');
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ success: true, code: '0', message: '', data: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  await pgcApi.desktop.status('pub7', 42);
  const url = String(fetchSpy.mock.calls[0][0]);
  // status 打到哪,下载就该是同一条路径加 /download —— 这条断言把两处口径焊在一起
  expect(desktopDownloadPath('pub7', 42)).toBe(`${url}/download`);
});
