import { afterEach, expect, test, vi } from 'vitest';
import { pgcApi, PgcError } from './client';
import type { RemixPolicyData } from './types';

const POLICY: RemixPolicyData = {
  enabled: true,
  source_code: 'mVFGYtHQ',
  source_version_id: 'v2',
  remix_url: 'https://lab.rezona.ai/game?remix=mVFGYtHQ',
  display_title: null,
  display_description: null,
};

function mockFetchOnce(data: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ success: true, code: 'OK', message: '', data, request_id: 'r1' }),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
function mockFetchError(status: number, code: string) {
  const spy = vi.fn().mockResolvedValue({
    ok: false, status,
    json: async () => ({ success: false, code, message: 'nope', data: null, request_id: 'r1' }),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
afterEach(() => vi.unstubAllGlobals());

test('get:GET 正确路径,解包 data', async () => {
  const spy = mockFetchOnce(POLICY);
  const res = await pgcApi.remixPolicy.get(42);
  expect(res).toEqual(POLICY);
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/remix-policy');
  expect(init.method).toBe('GET');
  expect(init.credentials).toBe('include');
});

test('set(开启):PATCH 带 enabled + version_id', async () => {
  const spy = mockFetchOnce(POLICY);
  await pgcApi.remixPolicy.set(42, { enabled: true, version_id: 'v2' });
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/remix-policy');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ enabled: true, version_id: 'v2' });
});

test('set(关闭):不带 version_id —— 契约里关闭时该字段可省,不传空串/null 免得撞 422', async () => {
  const spy = mockFetchOnce({ ...POLICY, enabled: false, source_version_id: null, remix_url: null });
  await pgcApi.remixPolicy.set(42, { enabled: false });
  const body = JSON.parse(spy.mock.calls[0][1].body);
  expect(body).toEqual({ enabled: false });
  expect('version_id' in body).toBe(false);
});

test('409 REMIX_SOURCE_NOT_READY 原样透出成 PgcError(调用方要按 code 出文案)', async () => {
  mockFetchError(409, 'REMIX_SOURCE_NOT_READY');
  await expect(pgcApi.remixPolicy.set(42, { enabled: true, version_id: 'v9' }))
    .rejects.toMatchObject({ code: 'REMIX_SOURCE_NOT_READY', status: 409 });
  await expect(pgcApi.remixPolicy.set(42, { enabled: true, version_id: 'v9' }))
    .rejects.toBeInstanceOf(PgcError);
});
