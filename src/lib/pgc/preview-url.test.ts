import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolvePreviewUrl } from './preview-url';
import { pgcApi } from './client';

vi.mock('./client', () => ({
  pgcApi: { previewVersion: vi.fn() },
}));

const api = vi.mocked(pgcApi);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('resolvePreviewUrl', () => {
  test('本地 Koubou 调试且有 seq:返回 local-preview 直链,不打 PGC', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOUBOU_BASE_URL', 'http://127.0.0.1:8000');
    const url = await resolvePreviewUrl({ pid: 535, vid: 'ver_9', seq: 3 });
    expect(url).toBe('/api/local-preview/535/v3/dist/index.html');
    expect(api.previewVersion).not.toHaveBeenCalled();
  });

  test('本地 Koubou 调试但缺 seq:拼不出快照目录,回落 PGC preview 端点', async () => {
    vi.stubEnv('NEXT_PUBLIC_KOUBOU_BASE_URL', 'http://127.0.0.1:8000');
    api.previewVersion.mockResolvedValue({ preview_url: 'https://pgc.local/pv/x/v3/dist/index.html' });
    const url = await resolvePreviewUrl({ pid: 535, vid: 'ver_9', seq: null });
    expect(url).toBe('https://pgc.local/pv/x/v3/dist/index.html');
    expect(api.previewVersion).toHaveBeenCalledWith(535, 'ver_9');
  });

  test('默认走 PGC preview 端点', async () => {
    api.previewVersion.mockResolvedValue({ preview_url: 'https://cdn.example/v1/index.html' });
    const url = await resolvePreviewUrl({ pid: 7, vid: 'ver_1' });
    expect(url).toBe('https://cdn.example/v1/index.html');
    expect(api.previewVersion).toHaveBeenCalledWith(7, 'ver_1');
  });

  test('REST 失败照抛(由调用方决定 Toast 还是页内提示)', async () => {
    api.previewVersion.mockRejectedValue(new Error('boom'));
    await expect(resolvePreviewUrl({ pid: 7, vid: 'ver_1' })).rejects.toThrow('boom');
  });
});
