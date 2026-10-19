import { describe, it, expect } from 'vitest';
import {
  mapApkError, isApkTerminal, defaultApkName, formatBuildDuration, APK_POLL_INTERVAL_MS,
  isValidPackageName, isValidVersionName, isValidVersionCode, buildApkRequest,
  DEFAULT_VERSION_NAME, VERSION_CODE_MAX, AAB_VERSION_NAME_MAX, PACKAGE_NAME_MAX,
} from './apk-export';

describe('mapApkError', () => {
  it('已知错误码映射到专属 i18n key', () => {
    expect(mapApkError('APK_EXPORT_DISABLED')).toBe('preview.apk.err.disabled');
    expect(mapApkError('APK_VERSION_NOT_BUILDABLE')).toBe('preview.apk.err.notBuildable');
    expect(mapApkError('APK_PACKAGE_TOO_LARGE')).toBe('preview.apk.err.tooLarge');
    expect(mapApkError('APK_BUILD_WORKER_UNAVAILABLE')).toBe('preview.apk.err.workerUnavailable');
    expect(mapApkError('APK_BUILD_NOT_READY')).toBe('preview.apk.err.notReady');
    expect(mapApkError('APK_OUTPUT_FORMAT_UNAVAILABLE')).toBe('preview.apk.err.formatUnavailable');
  });
  it('未知错误码回落通用 key', () => {
    expect(mapApkError('SOMETHING_ELSE')).toBe('preview.apk.err.generic');
    expect(mapApkError('NETWORK')).toBe('preview.apk.err.generic');
  });
});

describe('isApkTerminal', () => {
  it('succeeded/failed 为终态,queued/building 非终态', () => {
    expect(isApkTerminal('succeeded')).toBe(true);
    expect(isApkTerminal('failed')).toBe(true);
    expect(isApkTerminal('queued')).toBe(false);
    expect(isApkTerminal('building')).toBe(false);
  });
});

describe('defaultApkName', () => {
  it('取项目名并截 64,空白回落 Game', () => {
    expect(defaultApkName('My Game')).toBe('My Game');
    expect(defaultApkName('x'.repeat(80))).toBe('x'.repeat(64));
    expect(defaultApkName('   ')).toBe('Game');
    expect(defaultApkName(undefined)).toBe('Game');
  });
});

describe('formatBuildDuration', () => {
  it('毫秒格式化为 m:ss,秒数补零,负值钳 0', () => {
    expect(formatBuildDuration(151_000)).toBe('2:31');
    expect(formatBuildDuration(5_400)).toBe('0:05');
    expect(formatBuildDuration(0)).toBe('0:00');
    expect(formatBuildDuration(-100)).toBe('0:00');
  });
});

it('轮询间隔落在契约建议的 3–5s', () => {
  expect(APK_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(3000);
  expect(APK_POLL_INTERVAL_MS).toBeLessThanOrEqual(5000);
});

describe('isValidPackageName', () => {
  it('小写点分段 ≥2 段为合法', () => {
    expect(isValidPackageName('com.acme.game')).toBe(true);
    expect(isValidPackageName('app.madewith.game90000376')).toBe(true);
    expect(isValidPackageName('a.b')).toBe(true);
    expect(isValidPackageName('com.acme.my_game2')).toBe(true);
  });
  it('单段/大写/连续点/首尾点/数字开头段/非法字符为不合法', () => {
    expect(isValidPackageName('game')).toBe(false);            // 只有一段
    expect(isValidPackageName('Com.Acme.Game')).toBe(false);   // 大写
    expect(isValidPackageName('com..game')).toBe(false);       // 连续点
    expect(isValidPackageName('.com.game')).toBe(false);       // 首点
    expect(isValidPackageName('com.game.')).toBe(false);       // 尾点
    expect(isValidPackageName('1com.game')).toBe(false);       // 首段数字开头
    // Android applicationId 要求**每一段**都以字母开头,不只首段 —— 放行会被后端 422,
    // 而 VALIDATION_ERROR 没有专属映射,用户只会看到通用失败文案,指不到包名字段上
    expect(isValidPackageName('com.2048game')).toBe(false);
    expect(isValidPackageName('com.acme.9lives')).toBe(false);
    expect(isValidPackageName('com._x')).toBe(false);          // 段以下划线开头
    expect(isValidPackageName('a.0')).toBe(false);
    expect(isValidPackageName('com.acme.my-game')).toBe(false); // 连字符
    expect(isValidPackageName('com acme.game')).toBe(false);   // 空格
    expect(isValidPackageName('')).toBe(false);
  });
  it('前后空白不算不合法(提交前 trim)', () => {
    expect(isValidPackageName('  com.acme.game  ')).toBe(true);
  });
  it('超过 Play 的 applicationId 长度上限不合法', () => {
    const atMax = `a.${'b'.repeat(PACKAGE_NAME_MAX - 2)}`;
    expect(atMax).toHaveLength(PACKAGE_NAME_MAX);
    expect(isValidPackageName(atMax)).toBe(true);
    expect(isValidPackageName(`${atMax}b`)).toBe(false);
  });
});

describe('isValidVersionName', () => {
  it('清洗后 1..50 合法', () => {
    expect(isValidVersionName('1.0.0')).toBe(true);
    expect(isValidVersionName('x'.repeat(AAB_VERSION_NAME_MAX))).toBe(true);
  });
  it('空白与超长不合法', () => {
    expect(isValidVersionName('')).toBe(false);
    expect(isValidVersionName('   ')).toBe(false);
    expect(isValidVersionName('x'.repeat(AAB_VERSION_NAME_MAX + 1))).toBe(false);
  });
});

describe('isValidVersionCode', () => {
  it('1..2100000000 的整数合法,边界外与非整数不合法', () => {
    expect(isValidVersionCode(1)).toBe(true);
    expect(isValidVersionCode(VERSION_CODE_MAX)).toBe(true);
    expect(isValidVersionCode(0)).toBe(false);
    expect(isValidVersionCode(-1)).toBe(false);
    expect(isValidVersionCode(VERSION_CODE_MAX + 1)).toBe(false);
    expect(isValidVersionCode(1.5)).toBe(false);
    expect(isValidVersionCode(Number.NaN)).toBe(false);
  });
});

describe('buildApkRequest', () => {
  const base = { versionId: 'v3', name: '  像素地牢  ', iconItemId: 'img-1' };

  it('apk 分支不带 output_format / version_name / version_code 三键(它们参与幂等身份)', () => {
    const body = buildApkRequest({ ...base, format: 'apk', packageName: '', versionName: '1.0.0', versionCode: 7 });
    expect(body).toEqual({ version_id: 'v3', name: '像素地牢', icon_item_id: 'img-1' });
    expect('output_format' in body).toBe(false);
    expect('version_name' in body).toBe(false);
    expect('version_code' in body).toBe(false);
    expect('package_name' in body).toBe(false);
  });

  it('无图标时不带 icon_item_id', () => {
    const body = buildApkRequest({ versionId: 'v1', name: 'G', format: 'apk', iconItemId: null });
    expect(body).toEqual({ version_id: 'v1', name: 'G' });
  });

  it('aab 分支带全三字段并 trim', () => {
    const body = buildApkRequest({
      ...base, format: 'aab', packageName: '  com.acme.game ', versionName: ' 1.2.3 ', versionCode: 12,
    });
    expect(body).toEqual({
      version_id: 'v3', name: '像素地牢', icon_item_id: 'img-1',
      output_format: 'aab', package_name: 'com.acme.game', version_name: '1.2.3', version_code: 12,
    });
  });

  it('name 空白回落 defaultApkName 并截 64', () => {
    expect(buildApkRequest({ versionId: 'v1', name: '   ', format: 'apk' }).name).toBe('Game');
    expect(buildApkRequest({ versionId: 'v1', name: 'y'.repeat(90), format: 'apk' }).name).toBe('y'.repeat(64));
  });
});

it('版本名默认值是语义版本(交付用户自传 Play 的推荐形态)', () => {
  expect(DEFAULT_VERSION_NAME).toBe('1.0.0');
});
