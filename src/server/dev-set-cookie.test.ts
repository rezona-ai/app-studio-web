import { describe, expect, test } from 'vitest';
import { appendDevSetCookies, rewriteSetCookieForDev } from './dev-set-cookie';

describe('appendDevSetCookies', () => {
  test('设 DEV_COOKIE 时逐条重写回传', () => {
    const upstream = new Headers();
    upstream.append('set-cookie', 'GCLB=pod-a; Domain=.rezona.ai; Secure');
    upstream.append('set-cookie', 'x=1; Path=/');
    const out = new Headers();
    appendDevSetCookies(out, upstream, 'session=dev');
    expect(out.getSetCookie()).toEqual(['GCLB=pod-a', 'x=1; Path=/']);
  });

  test('未设 DEV_COOKIE(生产)不回传', () => {
    const upstream = new Headers();
    upstream.append('set-cookie', 'GCLB=pod-a');
    const out = new Headers();
    appendDevSetCookies(out, upstream, undefined);
    expect(out.getSetCookie()).toEqual([]);
  });
});

describe('rewriteSetCookieForDev', () => {
  test('去 Domain:上游域 cookie 落成 localhost host-only', () => {
    expect(rewriteSetCookieForDev('GCLB=pod-a; Domain=.rezona.ai; Path=/')).toBe('GCLB=pod-a; Path=/');
  });

  test('去 Secure:本地 http 下浏览器才收', () => {
    expect(rewriteSetCookieForDev('GCLB=pod-a; Path=/; Secure; HttpOnly')).toBe('GCLB=pod-a; Path=/; HttpOnly');
  });

  test('SameSite=None 改 Lax(None 必须配 Secure,去 Secure 后须一并降级)', () => {
    expect(rewriteSetCookieForDev('GCLB=pod-a; SameSite=None; Secure')).toBe('GCLB=pod-a; SameSite=Lax');
  });

  test('SameSite=Strict/Lax 原样保留', () => {
    expect(rewriteSetCookieForDev('a=1; SameSite=Strict')).toBe('a=1; SameSite=Strict');
  });

  test('值含等号与其余属性原样透传', () => {
    expect(rewriteSetCookieForDev('t=a=b; Max-Age=3600; Path=/; domain=x.y; secure'))
      .toBe('t=a=b; Max-Age=3600; Path=/');
  });
});
