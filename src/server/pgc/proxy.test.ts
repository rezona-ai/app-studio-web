import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { proxyFetch } from './proxy';

function resp(status: number) {
  return { ok: status < 400, status, headers: new Headers(), body: null } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv('PGC_BASE_URL', 'http://h');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('proxyFetch', () => {
  test('拼 base+path+search 并透传 headers(含 cookie),不注入 Authorization', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(resp(200));
    await proxyFetch('GET', '/api/projects', { headers: { cookie: 'session=abc' }, search: '?page=1' });
    expect(f).toHaveBeenCalledWith('http://h/game/pgcserver/api/projects?page=1', expect.objectContaining({
      method: 'GET',
      headers: { cookie: 'session=abc' },
    }));
    const sentHeaders = f.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
  });

  test('原样返回上游响应,不做 401 重登', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(resp(401));
    const res = await proxyFetch('GET', '/api/projects');
    expect(res.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('上游 5xx 错误日志带上 request_id（链路关联）', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(resp(503));
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
    await proxyFetch('GET', '/api/projects', { requestId: 'rid-err' });
    spy.mockRestore();
    const errLog = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === 'bff_upstream_5xx');
    expect(errLog?.request_id).toBe('rid-err');
  });
});

describe('proxyFetch 流式 body', () => {
  test('body 为 ReadableStream → fetch 附 duplex: half', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: null });
    vi.stubGlobal('fetch', f);
    vi.stubEnv('PGC_BASE_URL', 'https://pgc.example');
    const stream = new ReadableStream<Uint8Array>();
    await proxyFetch('POST', '/api/projects/import', { body: stream });
    expect(f.mock.calls[0][1]).toMatchObject({ duplex: 'half', body: stream });
  });

  test('body 为 Buffer/undefined → 不附 duplex', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: null });
    vi.stubGlobal('fetch', f);
    vi.stubEnv('PGC_BASE_URL', 'https://pgc.example');
    await proxyFetch('POST', '/api/projects', { body: Buffer.from('{}') });
    expect(f.mock.calls[0][1]).not.toHaveProperty('duplex');
    await proxyFetch('GET', '/api/projects', {});
    expect(f.mock.calls[1][1]).not.toHaveProperty('duplex');
  });
});
