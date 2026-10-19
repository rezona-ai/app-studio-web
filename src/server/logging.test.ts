import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type DdTracerLike,
  isLogSkippedPath,
  logRequest,
  logger,
  resolveRequestId,
  traceCorrelation,
} from './logging';

// 捕获 process.stdout.write，断言输出的单行 JSON 结构。
function captureStdout(fn: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

afterEach(() => vi.restoreAllMocks());

describe('logRequest', () => {
  test('正常请求记 info 级、含 requestId/status/durationMs', () => {
    const [log] = captureStdout(() =>
      logRequest({ method: 'GET', path: '/game', status: 200, durationMs: 42, requestId: 'rid-1' }),
    );
    expect(log.msg).toBe('request');
    expect(log.level).toBe('info');
    expect(log.severity).toBe('INFO');
    expect(log.status).toBe(200);
    expect(log.durationMs).toBe(42);
    // KTD5：输出 JSON key 对齐 pgc 的 request_id（不再用 camelCase requestId），
    // 让 Cloud Logging 按字段名跨前端↔pgc 两服务一次检索。
    expect(log.request_id).toBe('rid-1');
    expect(log.requestId).toBeUndefined();
  });

  test('5xx 请求标 level:error', () => {
    const [log] = captureStdout(() =>
      logRequest({ method: 'POST', path: '/game/api/x', status: 502, durationMs: 7, requestId: 'rid-2' }),
    );
    expect(log.level).toBe('error');
    expect(log.severity).toBe('ERROR');
  });
});

describe('logger.error（上游错误日志）', () => {
  test('含 upstream/status/durationMs 字段', () => {
    const [log] = captureStdout(() =>
      logger.error('bff_upstream_5xx', { upstream: 'pgc', method: 'GET', path: '/v1/x', status: 503, durationMs: 12 }),
    );
    expect(log.msg).toBe('bff_upstream_5xx');
    expect(log.level).toBe('error');
    expect(log.upstream).toBe('pgc');
    expect(log.status).toBe(503);
  });
});

describe('resolveRequestId', () => {
  test('复用入站 x-request-id 字符串', () => {
    expect(resolveRequestId('abc-123')).toBe('abc-123');
  });
  test('数组头取第一个', () => {
    expect(resolveRequestId(['first', 'second'])).toBe('first');
  });
  test('缺失时生成非空 UUID', () => {
    const id = resolveRequestId(undefined);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
  // KTD4：入站 x-request-id 客户端可控，采纳前做 charset+length 校验，
  // 畸形值弃用并生成新 UUID，防污染前端/pgc 日志。
  test('合法 128 字符边界值复用', () => {
    const ok = 'a'.repeat(128);
    expect(resolveRequestId(ok)).toBe(ok);
  });
  test('超长入站值(>128)弃用并生成 UUID', () => {
    const long = 'a'.repeat(129);
    const id = resolveRequestId(long);
    expect(id).not.toBe(long);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
  test('含非白名单字符(分号/控制字符)弃用并生成 UUID', () => {
    expect(resolveRequestId('bad;value')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('line\nbreak')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('has space')).toMatch(/^[0-9a-f-]{36}$/);
  });
  test('数组里畸形头也校验', () => {
    expect(resolveRequestId(['bad;'])).toMatch(/^[0-9a-f-]{36}$/);
  });
  test('合法值含点/下划线/连字符正常复用', () => {
    expect(resolveRequestId('a.b_c-1')).toBe('a.b_c-1');
  });
});

describe('isLogSkippedPath', () => {
  test('跳过 _next 静态与 favicon', () => {
    expect(isLogSkippedPath('/_next/static/chunk.js')).toBe(true);
    expect(isLogSkippedPath('/favicon.ico')).toBe(true);
  });
  test('业务路径不跳过', () => {
    expect(isLogSkippedPath('/game')).toBe(false);
    expect(isLogSkippedPath('/game/api/projects')).toBe(false);
  });
});

describe('traceCorrelation（APM 日志-trace 关联）', () => {
  const fakeTracer = (span: unknown): DdTracerLike =>
    ({ scope: () => ({ active: () => span as never }) }) as DdTracerLike;

  test('无 tracer → 空对象', () => {
    expect(traceCorrelation(null)).toEqual({});
  });

  test('有活跃 span → 带 dd.trace_id / dd.span_id', () => {
    const tracer = fakeTracer({ context: () => ({ toTraceId: () => 'trace-1', toSpanId: () => 'span-1' }) });
    expect(traceCorrelation(tracer)).toEqual({ 'dd.trace_id': 'trace-1', 'dd.span_id': 'span-1' });
  });

  test('无活跃 span → 空对象', () => {
    expect(traceCorrelation(fakeTracer(null))).toEqual({});
  });

  test('取值抛异常 → 空对象（绝不打断日志）', () => {
    const tracer = fakeTracer({
      context: () => {
        throw new Error('boom');
      },
    });
    expect(traceCorrelation(tracer)).toEqual({});
  });
});

describe('日志在 APM 未启用时不带 dd 字段（默认路径不变）', () => {
  test('未设 DD_TRACE_ENABLED 时 logRequest 输出无 dd.trace_id', () => {
    expect(process.env.DD_TRACE_ENABLED).not.toBe('true');
    const [log] = captureStdout(() =>
      logRequest({ method: 'GET', path: '/game', status: 200, durationMs: 1, requestId: 'rid-x' }),
    );
    expect(log['dd.trace_id']).toBeUndefined();
    expect(log['dd.span_id']).toBeUndefined();
  });
});
