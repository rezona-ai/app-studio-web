import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { proxyFetch } from './proxy';

beforeEach(() => {
  process.env.PGC_BASE_URL = 'http://koubou.test';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('proxyFetch', () => {
  test('转发 headers(含 cookie),不注入 Authorization', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const f = fetch as ReturnType<typeof vi.fn>;

    await proxyFetch('POST', '/auth/ws-ticket', { headers: { cookie: 'session=abc' }, body: '{}' });

    expect(f).toHaveBeenCalledWith('http://koubou.test/game/koubou/auth/ws-ticket', expect.objectContaining({
      method: 'POST',
      headers: { cookie: 'session=abc' },
    }));
    const sentHeaders = f.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
  });

  test('上游网络错误(fetch 抛出)时返回 502 错误 envelope,而非抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));

    const res = await proxyFetch('POST', '/auth/ws-ticket', { body: '{}' });

    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = (await res.json()) as { success: boolean; message: string };
    expect(json.success).toBe(false);
    expect(typeof json.message).toBe('string');
    expect(json.message.length).toBeGreaterThan(0);
  });

  test('上游正常响应时原样返回,不被错误处理吞掉', async () => {
    const upstream = new Response('{"data":{"ticket":"abc"}}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(upstream)));

    const res = await proxyFetch('POST', '/auth/ws-ticket', { body: '{}' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { ticket: string } };
    expect(json.data.ticket).toBe('abc');
  });
});

describe('本地 Koubou 调试(KOUBOU_BASE_URL 覆盖)', () => {
  test('覆盖设置时直连该地址且不拼 /game/koubou 前缀', async () => {
    process.env.KOUBOU_BASE_URL = 'http://127.0.0.1:8000';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const f = fetch as ReturnType<typeof vi.fn>;
    await proxyFetch('POST', '/auth/ws-ticket', { body: '{}' });
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:8000/auth/ws-ticket');
    delete process.env.KOUBOU_BASE_URL;
  });

  test('覆盖为空串视同未设,仍走 PGC 基址 + 前缀', async () => {
    process.env.KOUBOU_BASE_URL = '';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const f = fetch as ReturnType<typeof vi.fn>;
    await proxyFetch('GET', '/sessions');
    expect(f.mock.calls[0][0]).toBe('http://koubou.test/game/koubou/sessions');
    delete process.env.KOUBOU_BASE_URL;
  });
});
