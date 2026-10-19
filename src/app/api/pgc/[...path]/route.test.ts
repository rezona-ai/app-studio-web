import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// 隔离上游转发与日志：route 只负责解析/注入 x-request-id + 记一条访问日志。
vi.mock('@/server/pgc/proxy', () => ({ proxyFetch: vi.fn() }));

import { GET, POST, PUT } from './route';
import { proxyFetch } from '@/server/pgc/proxy';

/** 构造最小 NextRequest 替身（只覆盖 handle 用到的成员）。 */
function mockReq(
  headers: Record<string, string>,
  method = 'GET',
  search = '',
): NextRequest {
  return {
    method,
    headers: { get: (k: string): string | null => headers[k.toLowerCase()] ?? null },
    body: new ReadableStream<Uint8Array>(),
    // 流式化后 handle() 绝不该再整包缓冲；哨兵确保回归时立刻报错。
    arrayBuffer: async (): Promise<ArrayBuffer> => { throw new Error('不应整包缓冲'); },
    nextUrl: { search },
  } as unknown as NextRequest;
}

/** 带体流式请求替身：与 mockReq 的区别仅在语义标注，供流式透传用例使用。 */
function mockStreamReq(headers: Record<string, string>, method = 'POST'): NextRequest {
  const body = new ReadableStream<Uint8Array>();
  return {
    method,
    headers: { get: (k: string): string | null => headers[k.toLowerCase()] ?? null },
    body,
    arrayBuffer: async (): Promise<ArrayBuffer> => { throw new Error('不应整包缓冲'); },
    nextUrl: { search: '' },
  } as unknown as NextRequest;
}

function ctx(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

function upstream(status: number): Response {
  return { status, headers: new Headers(), body: null } as unknown as Response;
}

const proxyMock = proxyFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  proxyMock.mockClear();
  proxyMock.mockResolvedValue(upstream(200));
});
afterEach(() => vi.restoreAllMocks());

describe('pgc proxy route — x-request-id 透传', () => {
  test('入站合法 x-request-id 透传给上游转发头', async () => {
    await GET(mockReq({ 'x-request-id': 'req-1' }), ctx(['api', 'projects']));
    expect(proxyMock).toHaveBeenCalledWith(
      'GET',
      '/api/projects',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-request-id': 'req-1' }),
        requestId: 'req-1',
      }),
    );
  });

  test('入站无 x-request-id 时生成并注入非空值', async () => {
    await GET(mockReq({}), ctx(['api', 'x']));
    const init = proxyMock.mock.calls[0][2] as { headers: Record<string, string>; requestId: string };
    expect(init.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.requestId).toBe(init.headers['x-request-id']);
  });

  test('入站畸形 x-request-id(含分号)被弃用，注入生成值', async () => {
    await GET(mockReq({ 'x-request-id': 'evil;\ninject' }), ctx(['api', 'x']));
    const init = proxyMock.mock.calls[0][2] as { headers: Record<string, string> };
    expect(init.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('转发头名是小写 x-request-id', async () => {
    await GET(mockReq({ 'x-request-id': 'req-2' }), ctx(['api', 'x']));
    const init = proxyMock.mock.calls[0][2] as { headers: Record<string, string> };
    expect(Object.keys(init.headers)).toContain('x-request-id');
  });

  test('POST 带 body 时 requestId 仍正确注入', async () => {
    await POST(mockReq({ 'x-request-id': 'req-3', 'content-type': 'application/json' }, 'POST'), ctx(['api', 'x']));
    const init = proxyMock.mock.calls[0][2] as { headers: Record<string, string>; requestId: string };
    expect(init.requestId).toBe('req-3');
    expect(init.headers['x-request-id']).toBe('req-3');
  });

  test('记一条带 request_id 的访问日志（前端侧链路起点）', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
    await GET(mockReq({ 'x-request-id': 'req-log' }), ctx(['api', 'projects']));
    spy.mockRestore();
    const reqLog = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === 'request');
    expect(reqLog).toBeDefined();
    expect(reqLog?.request_id).toBe('req-log');
    expect(reqLog?.status).toBe(200);
  });
});

describe('pgc proxy route — 带体请求流式透传', () => {
  test('POST 把 req.body 流原样交给 proxyFetch(不缓冲)', async () => {
    const req = mockStreamReq({ 'content-type': 'multipart/form-data; boundary=x' });
    await POST(req, ctx(['api', 'projects', 'import']));
    expect(proxyMock).toHaveBeenCalledWith(
      'POST',
      '/api/projects/import',
      expect.objectContaining({ body: (req as unknown as { body: ReadableStream }).body }),
    );
  });

  test('PUT 被导出并把带体请求转发给 pgc(防 405:workbench-share enable 走 PUT)', async () => {
    const req = mockStreamReq({ 'content-type': 'application/json' }, 'PUT');
    await PUT(req, ctx(['api', 'projects', '574', 'workbench-share']));
    expect(proxyMock).toHaveBeenCalledWith(
      'PUT',
      '/api/projects/574/workbench-share',
      expect.objectContaining({ body: (req as unknown as { body: ReadableStream }).body }),
    );
  });
});
