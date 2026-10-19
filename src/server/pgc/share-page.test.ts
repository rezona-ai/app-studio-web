import { afterEach, describe, expect, test, vi } from 'vitest';

// 隔离上游:只验证状态码 → 语义的映射,不真打 pgc
vi.mock('@/server/pgc/proxy', () => ({ proxyFetch: vi.fn() }));
import { proxyFetch } from '@/server/pgc/proxy';
import { fetchRemixAvailable, fetchVersionStatus } from './share-page';

const mockProxy = vi.mocked(proxyFetch);

afterEach(() => vi.clearAllMocks());

describe('响应体处置', () => {
  // undici 下未消费的 body 会把连接扣在 in-flight 直到 GC —— 这是扇出最高的公开路由,
  // 漏一个 cancel 就是连接池泄漏。两条取数都必须消费掉自己不读的正文。
  test('两条取数都消费掉不读的响应体', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    mockProxy.mockResolvedValue({ status: 200, body: { cancel } } as unknown as Response);
    await fetchVersionStatus('DaKkJMXU', 'v8');
    await fetchRemixAvailable('DaKkJMXU');
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  test('cancel 失败不影响判定,也不外抛', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('already locked'));
    mockProxy.mockResolvedValue({ status: 200, body: { cancel } } as unknown as Response);
    await expect(fetchVersionStatus('DaKkJMXU', 'v8')).resolves.toBe('ok');
  });
});

describe('fetchVersionStatus', () => {
  test('200 → ok,且请求打在该版本的 dist/index.html 上', async () => {
    mockProxy.mockResolvedValue(new Response('<html></html>', { status: 200 }));
    await expect(fetchVersionStatus('DaKkJMXU', 'v8')).resolves.toBe('ok');
    expect(mockProxy).toHaveBeenCalledWith('GET', '/pv/DaKkJMXU/v8/dist/index.html');
  });

  test('404(未 build / 未知版本) → notFound', async () => {
    mockProxy.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(fetchVersionStatus('DaKkJMXU', 'v9')).resolves.toBe('notFound');
  });

  test('其余 4xx 也归 notFound(沿用旧直出路由「非 200 且非 5xx 即 404」的口径)', async () => {
    mockProxy.mockResolvedValue(new Response('no', { status: 403 }));
    await expect(fetchVersionStatus('DaKkJMXU', 'v8')).resolves.toBe('notFound');
  });

  test('5xx → upstream', async () => {
    mockProxy.mockResolvedValue(new Response('err', { status: 503 }));
    await expect(fetchVersionStatus('DaKkJMXU', 'v8')).resolves.toBe('upstream');
  });

  test('不可达(抛错) → upstream', async () => {
    mockProxy.mockRejectedValue(new Error('conn refused'));
    await expect(fetchVersionStatus('DaKkJMXU', 'v8')).resolves.toBe('upstream');
  });
});

describe('fetchRemixAvailable', () => {
  test('200 → true,且打的是公开端点(root_prefix 直挂,不在 /api 下)', async () => {
    mockProxy.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(fetchRemixAvailable('DaKkJMXU')).resolves.toBe(true);
    expect(mockProxy).toHaveBeenCalledWith('GET', '/remix/DaKkJMXU');
  });

  test('404 REMIX_NOT_AVAILABLE(未开启 / 非法 code / 源软删) → false', async () => {
    mockProxy.mockResolvedValue(new Response('{"code":"REMIX_NOT_AVAILABLE"}', { status: 404 }));
    await expect(fetchRemixAvailable('DaKkJMXU')).resolves.toBe(false);
  });

  test('5xx → false(降级):顶栏能不能点是次要的,不能因此把游戏挡在门外', async () => {
    mockProxy.mockResolvedValue(new Response('err', { status: 500 }));
    await expect(fetchRemixAvailable('DaKkJMXU')).resolves.toBe(false);
  });

  test('不可达(抛错) → false,不外抛', async () => {
    mockProxy.mockRejectedValue(new Error('conn refused'));
    await expect(fetchRemixAvailable('DaKkJMXU')).resolves.toBe(false);
  });
});
