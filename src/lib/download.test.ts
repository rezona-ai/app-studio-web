import { describe, expect, test } from 'vitest';
import { versionArchiveName } from './download';

describe('versionArchiveName', () => {
  test('项目名-版本号.zip', () => {
    expect(versionArchiveName('My Game', 'v3')).toBe('My Game-v3.zip');
  });
  test('净化项目名非法字符并折叠空白', () => {
    expect(versionArchiveName('a/b:c*?  d', 'v1')).toBe('a_b_c_ d-v1.zip');
  });
  test('项目名缺失/净化后为空 → 仅版本号', () => {
    expect(versionArchiveName(undefined, 'v2')).toBe('v2.zip');
    expect(versionArchiveName('  ///  ', 'v2')).toBe('v2.zip');
  });
});

