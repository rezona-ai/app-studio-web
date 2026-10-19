import { afterEach, expect, test, vi } from 'vitest';
import { pgcApi } from './client';

function mockFetchOnce(data: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ success: true, code: 'OK', message: '', data, request_id: 'r1' }),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
afterEach(() => vi.unstubAllGlobals());

test('publish:POST 正确路径 + body,解包 data', async () => {
  const spy = mockFetchOnce({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  const body = { version_id: 'v3', name: 'G', cover_ref: 'version_cover' as const, public: true, sync_to_community: true };
  const res = await pgcApi.rezona.publish(42, body);
  expect(res.share_url).toBe('https://rezona.app/p/x');
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/rezona/publish');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toMatchObject(body);
  expect(init.credentials).toBe('include');
});

test('publish 用 60s 专用超时(后端 30s 出站上界的一倍余量),不跟着 SLOW 转 5 分钟', async () => {
  mockFetchOnce({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  const spy = vi.spyOn(AbortSignal, 'timeout');
  await pgcApi.rezona.publish(42, { version_id: 'v3', name: 'G', public: true, sync_to_community: true });
  expect(spy).toHaveBeenCalledWith(60_000);
  spy.mockRestore();
});

test('listGames:GET 项目级已导入游戏列表,解包 data', async () => {
  const items = [{ game_id: 456, game_name: 'Pixel Chess', share_url: 'https://web.rezona.ai/share/game/456', version_ids: ['v1', 'v2'],
    first_published_at: '2026-09-20T08:00:00Z', last_published_at: '2026-09-21T09:00:00Z' }];
  const spy = mockFetchOnce({ items });
  const res = await pgcApi.rezona.listGames(42);
  expect(res.items).toEqual(items);
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/rezona/games');
  expect(init.method).toBe('GET');
});

test('绑定态/扫码端点已随契约下线,客户端不再暴露', () => {
  // 后端删端点后再调只会拿 404;此处锁住「前端已彻底没有这些调用」。listGames 是 2026-09-23 新增的发布目标列表
  expect(pgcApi.rezona).toEqual({ publish: expect.any(Function), listGames: expect.any(Function) });
});
