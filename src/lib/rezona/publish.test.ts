import { expect, test } from 'vitest';
import {
  mapRezonaError, isUnavailable, newIdempotencyKey, mapCoverUploadError, defaultTarget, targetValue, targetFromValue,
} from './publish';

test('newIdempotencyKey 返回非空且两次不同', () => {
  const a = newIdempotencyKey(); const b = newIdempotencyKey();
  expect(a).toBeTruthy(); expect(a).not.toBe(b);
});

test('mapRezonaError 覆盖契约 §6 全表', () => {
  expect(mapRezonaError('UNAUTHORIZED')).toEqual({ messageKey: 'preview.rezona.err.unauthorized', resetIdempotency: false });
  expect(mapRezonaError('PROJECT_NOT_FOUND')).toEqual({ messageKey: 'preview.rezona.err.projectNotFound', resetIdempotency: false });
  expect(mapRezonaError('VERSION_NOT_FOUND')).toEqual({ messageKey: 'preview.rezona.err.versionNotFound', resetIdempotency: false });
  expect(mapRezonaError('REZONA_VERSION_NOT_BUILT')).toEqual({ messageKey: 'preview.rezona.err.notBuilt', resetIdempotency: false });
  expect(mapRezonaError('VALIDATION_ERROR')).toEqual({ messageKey: 'preview.rezona.err.validation', resetIdempotency: false });
  expect(mapRezonaError('REZONA_COVER_INVALID')).toEqual({ messageKey: 'preview.rezona.err.cover', resetIdempotency: false });
  expect(mapRezonaError('REZONA_PUBLISH_IN_PROGRESS')).toEqual({ messageKey: 'preview.rezona.err.inProgress', resetIdempotency: false });
  expect(mapRezonaError('REZONA_PUBLISH_FAILED')).toEqual({ messageKey: 'preview.rezona.err.publishFailed', resetIdempotency: false });
  expect(mapRezonaError('SOMETHING_UNKNOWN')).toEqual({ messageKey: 'preview.rezona.err.generic', resetIdempotency: false });
});

test('IDEMPOTENCY_CONFLICT:同键不同体,须换新幂等键再试', () => {
  expect(mapRezonaError('IDEMPOTENCY_CONFLICT')).toEqual({ messageKey: 'preview.rezona.err.idempotency', resetIdempotency: true });
});

test('不可用类:前两次给重试文案,第三次起给带 request_id 的联系支持文案(契约 §6)', () => {
  for (const code of ['REZONA_UNAVAILABLE', 'TIMEOUT', 'NETWORK']) {
    expect(mapRezonaError(code, 0, true).messageKey).toBe('preview.rezona.err.unavailable');
    expect(mapRezonaError(code, 1, true).messageKey).toBe('preview.rezona.err.unavailable');
    expect(mapRezonaError(code, 2, true).messageKey).toBe('preview.rezona.err.support');
    expect(mapRezonaError(code, 5, true).messageKey).toBe('preview.rezona.err.support');
  }
});

test('无 request_id(本地超时/断网没有信封)时,升级用不带 ID 的联系支持文案', () => {
  expect(mapRezonaError('TIMEOUT', 2).messageKey).toBe('preview.rezona.err.supportNoId');
  expect(mapRezonaError('NETWORK', 3, false).messageKey).toBe('preview.rezona.err.supportNoId');
  // 未升级阶段与是否有 ID 无关
  expect(mapRezonaError('TIMEOUT', 0).messageKey).toBe('preview.rezona.err.unavailable');
});

test('计数只认不可用类,其它码不参与递增', () => {
  expect(isUnavailable('REZONA_UNAVAILABLE')).toBe(true);
  expect(isUnavailable('TIMEOUT')).toBe(true);
  expect(isUnavailable('NETWORK')).toBe(true);
  expect(isUnavailable('REZONA_PUBLISH_FAILED')).toBe(false);
  expect(isUnavailable('VALIDATION_ERROR')).toBe(false);
});

test('累计次数不影响非不可用类的文案', () => {
  expect(mapRezonaError('VALIDATION_ERROR', 9).messageKey).toBe('preview.rezona.err.validation');
});

test('mapCoverUploadError:已知错误码映射专属文案,未知回落通用封面失败', () => {
  expect(mapCoverUploadError('UNSUPPORTED_COVER_TYPE')).toBe('preview.rezona.err.coverType');
  expect(mapCoverUploadError('EMPTY_COVER_UPLOAD')).toBe('preview.rezona.err.coverEmpty');
  expect(mapCoverUploadError('CANVAS_UPLOAD_TOO_LARGE')).toBe('preview.rezona.err.coverTooLarge');
  expect(mapCoverUploadError('WHATEVER')).toBe('preview.rezona.err.coverUpload');
});

test('REZONA_GAME_NOT_FOUND:目标已失效,须清空目标让用户重选(不自动回选,spec §2 #4)', () => {
  expect(mapRezonaError('REZONA_GAME_NOT_FOUND')).toEqual({
    messageKey: 'preview.rezona.err.gameNotFound', resetIdempotency: false, resetTarget: true,
  });
});

const game = (game_id: number) => ({
  game_id, share_url: '', version_ids: ['v1'], first_published_at: '', last_published_at: '',
});

test('defaultTarget:有已导入游戏默认选第一项(后端已按最近发布倒序),空列表回落创建', () => {
  expect(defaultTarget([game(456), game(312)])).toBe(456);
  expect(defaultTarget([])).toBe('new');
});

test('目标与 Select 字符串值互转,未选(null)不对应任何选项值', () => {
  expect(targetValue('new')).toBe('new');
  expect(targetValue(456)).toBe('456');
  expect(targetValue(null)).toBeNull();
  expect(targetFromValue('new')).toBe('new');
  expect(targetFromValue('456')).toBe(456);
});
