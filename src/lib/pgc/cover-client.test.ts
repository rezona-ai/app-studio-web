import { afterEach, expect, test, vi } from 'vitest';
import { uploadProjectCover, PgcError } from './client';

function mockFetchOnce(payload: { ok?: boolean; status?: number; env: unknown }) {
  const spy = vi.fn().mockResolvedValue({
    ok: payload.ok ?? true, status: payload.status ?? 200,
    json: async () => payload.env,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
afterEach(() => vi.unstubAllGlobals());

const project = {
  id: 42, public_id: 'mVFGYtHQ', name: 'G',
  cover_url: '/pv/mVFGYtHQ/assets/pgc-cover/cover.png?v=3a1c9f0e2b7d4a86',
  cover_source: 'user', current_version_id: 'v2', status: 'active',
  created_at: '', updated_at: '',
};

test('uploadProjectCover:POST multipart 到 /projects/{id}/cover,解包 ProjectData', async () => {
  const spy = mockFetchOnce({ env: { success: true, code: 'OK', message: '', data: project } });
  const file = new File(['png-bytes'], 'cover.png', { type: 'image/png' });
  const res = await uploadProjectCover(42, file);
  expect(res.cover_url).toContain('pgc-cover/cover.png?v=');
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/cover');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('include');
  // multipart:body 是 FormData 且字段名为 file;不得手写 Content-Type(边界串由浏览器生成)
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get('file')).toBe(file);
  expect(init.headers).toBeUndefined();
});

test('uploadProjectCover:非 PNG 等后端错误码转 PgcError', async () => {
  mockFetchOnce({ ok: false, status: 422, env: { success: false, code: 'UNSUPPORTED_COVER_TYPE', message: 'png only' } });
  const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
  await expect(uploadProjectCover(42, file)).rejects.toMatchObject(
    Object.assign(new PgcError('UNSUPPORTED_COVER_TYPE', 'png only', 422), {}),
  );
});
