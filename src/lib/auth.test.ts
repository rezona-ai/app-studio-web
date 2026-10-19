import { describe, expect, test } from 'vitest';
import { isLocalhost, buildSignInUrl } from './auth';

describe('isLocalhost', () => {
  test('本地开发各形态为 true', () => {
    expect(isLocalhost('localhost')).toBe(true);
    expect(isLocalhost('127.0.0.1')).toBe(true);
    expect(isLocalhost('0.0.0.0')).toBe(true);
    expect(isLocalhost('::1')).toBe(true);
    expect(isLocalhost('app.localhost')).toBe(true);
  });
  test('IPv6 回环按浏览器实际报的带方括号形态判定', () => {
    // location.hostname 对 http://[::1]:5173 报的是 '[::1]'(含方括号),裸 '::1' 永远不出现,
    // 所以只认裸形态等于这条分支从来没生效过——本地跑 IPv6 会被跳去 sign-in 并死循环。
    expect(isLocalhost('[::1]')).toBe(true);
  });
  test('环境域名为 false', () => {
    expect(isLocalhost('devlab.rezona.ai')).toBe(false);
    expect(isLocalhost('lab.rezona.ai')).toBe(false);
  });
});

describe('buildSignInUrl', () => {
  test('拼接 origin + /studio/sign-in,redirect 经 encodeURIComponent', () => {
    const url = buildSignInUrl('https://devlab.rezona.ai', 'https://devlab.rezona.ai/game?project=8');
    expect(url).toBe('https://devlab.rezona.ai/studio/sign-in?redirect=https%3A%2F%2Fdevlab.rezona.ai%2Fgame%3Fproject%3D8');
  });
  test('sign-in 在主站 /studio 下,不带本应用 basePath', () => {
    const url = buildSignInUrl('https://devlab.rezona.ai', 'https://devlab.rezona.ai/game');
    expect(url.startsWith('https://devlab.rezona.ai/studio/sign-in?redirect=')).toBe(true);
  });
});
