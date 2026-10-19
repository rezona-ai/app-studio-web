import { describe, expect, test } from 'vitest';
import { pickProxyHeaders } from './proxy-response';

describe('pickProxyHeaders', () => {
  test('透传 content-type / content-disposition', () => {
    const upstream = new Headers({
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="v1.zip"',
    });
    const out = pickProxyHeaders(upstream);
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('content-disposition')).toBe('attachment; filename="v1.zip"');
  });

  test('不透传 content-length(避免上游 gzip 压缩长度截断解压后的 body)', () => {
    const upstream = new Headers({ 'content-type': 'application/json', 'content-length': '474' });
    expect(pickProxyHeaders(upstream).get('content-length')).toBeNull();
  });

  test('不透传 content-encoding(body 已被 fetch 解压)', () => {
    const upstream = new Headers({ 'content-type': 'application/json', 'content-encoding': 'gzip' });
    expect(pickProxyHeaders(upstream).get('content-encoding')).toBeNull();
  });

  test('上游缺失的头不会被凭空补上', () => {
    const out = pickProxyHeaders(new Headers());
    expect(out.get('content-type')).toBeNull();
    expect(out.get('content-disposition')).toBeNull();
  });
});
