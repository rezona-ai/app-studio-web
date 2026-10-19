import { describe, expect, test } from 'vitest';
import { resolveForwardCookie } from './cookie';

describe('resolveForwardCookie', () => {
  test('设置 DEV_COOKIE 且无请求 cookie → 用 DEV_COOKIE', () => {
    expect(resolveForwardCookie(null, 'session=dev')).toBe('session=dev');
  });

  test('设置 DEV_COOKIE 时合并请求 cookie(亲和 cookie 等追加在后)', () => {
    expect(resolveForwardCookie('GCLB=pod-a; other=1', 'session=dev')).toBe('session=dev; GCLB=pod-a; other=1');
  });

  test('同名键 DEV_COOKIE 优先,请求侧残留不覆盖鉴权', () => {
    expect(resolveForwardCookie('session=stale; GCLB=pod-a', 'session=dev')).toBe('session=dev; GCLB=pod-a');
  });

  test('DEV_COOKIE 多键时逐键去重合并', () => {
    expect(resolveForwardCookie('b=old; c=3', 'a=1; b=2')).toBe('a=1; b=2; c=3');
  });

  test('请求 cookie 空白段与多余分号容错', () => {
    expect(resolveForwardCookie(' ; GCLB=pod-a;; ', 'session=dev')).toBe('session=dev; GCLB=pod-a');
  });

  test('未设 DEV_COOKIE 时透传请求 cookie(trim)', () => {
    expect(resolveForwardCookie('  session=abc ', undefined)).toBe('session=abc');
  });

  test('无请求 cookie 且无 DEV_COOKIE → undefined', () => {
    expect(resolveForwardCookie(null, undefined)).toBeUndefined();
  });

  test('请求 cookie 为空白 → undefined', () => {
    expect(resolveForwardCookie('   ', undefined)).toBeUndefined();
  });

  test('DEV_COOKIE 为空白视为未设置,回落到请求 cookie', () => {
    expect(resolveForwardCookie('session=abc', '  ')).toBe('session=abc');
  });
});
