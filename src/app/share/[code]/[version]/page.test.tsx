import { afterEach, describe, expect, test, vi } from 'vitest';

// 隔离上游与 Next 的 notFound():只验证「参数 / 上游状态 → 出什么页」这层分发
vi.mock('@/server/pgc/share-page', () => ({ fetchVersionStatus: vi.fn(), fetchRemixAvailable: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

import { fetchVersionStatus, fetchRemixAvailable } from '@/server/pgc/share-page';
import { notFound } from 'next/navigation';
import SharePage from '@/components/share/SharePage';
import SharePageRoute from './page';

const mockStatus = vi.mocked(fetchVersionStatus);
const mockRemix = vi.mocked(fetchRemixAvailable);

function params(code: string, version: string) {
  return { params: Promise.resolve({ code, version }) };
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('分享页 /share/[code]/[version]', () => {
  test('合法参数 + 版本可播 → 渲染外壳,并把 Remix 可用性透传下去', async () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://lab.rezona.ai');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
    mockStatus.mockResolvedValue('ok');
    mockRemix.mockResolvedValue(true);

    const el = await SharePageRoute(params('DaKkJMXU', 'v8'));

    expect(el.type).toBe(SharePage); // 只断言 props 的话,渲染成别的组件也照绿
    expect(el.props).toMatchObject({
      gameUrl: 'https://lab.rezona.ai/game/pgcserver/pv/DaKkJMXU/v8/dist/index.html',
      remixHref: '/game/?remix=DaKkJMXU',
      unavailable: false,
    });
  });

  test('未开放 Remix → remixHref 传 null,顶栏据此不渲染该按钮(页照出)', async () => {
    mockStatus.mockResolvedValue('ok');
    mockRemix.mockResolvedValue(false);
    const el = await SharePageRoute(params('DaKkJMXU', 'v8'));
    expect(el.props).toMatchObject({ remixHref: null, unavailable: false });
  });

  test('版本不存在 / 未 build → 404', async () => {
    mockStatus.mockResolvedValue('notFound');
    mockRemix.mockResolvedValue(false);
    await expect(SharePageRoute(params('DaKkJMXU', 'v9'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  test('上游 5xx / 不可达 → 不是 404,而是带顶栏的错误页', async () => {
    mockStatus.mockResolvedValue('upstream');
    mockRemix.mockResolvedValue(false);
    const el = await SharePageRoute(params('DaKkJMXU', 'v8'));
    expect(el.props).toMatchObject({ unavailable: true });
  });

  test('非法 code / version → 404,且一次上游都不打', async () => {
    await expect(SharePageRoute(params('bad code!', 'v8'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(SharePageRoute(params('DaKkJMXU', '8'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(SharePageRoute(params('abc', 'v8'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(3);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockRemix).not.toHaveBeenCalled();
  });
});
