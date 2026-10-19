import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bizApi, BizError } from './client';

// biz-api 无信封:2xx 裸 JSON 即 data;非 2xx 尽力取 {code,message},取不到回落 HTTP_ERROR
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('bizApi(裸 JSON 信封处理)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('2xx 直接返回 body(无 data 包装)', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { enabled: false, currency: 'USD', coupon: null, packages: [] }));
    const opts = await bizApi.getTopupOptions();
    expect(opts.enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/biz/credits/topup/options', expect.objectContaining({ credentials: 'include' }));
  });

  it('非 2xx 抛 BizError,尽力提取 code/message(代理 502 信封)', async () => {
    fetchMock.mockResolvedValue(jsonRes(502, { code: 'UPSTREAM_UNAVAILABLE', message: 'biz-api 服务不可用' }));
    await expect(bizApi.getTopupOptions()).rejects.toMatchObject({
      name: 'BizError', code: 'UPSTREAM_UNAVAILABLE', status: 502,
    });
  });

  it('非 JSON 错误体回落 HTTP_ERROR + 状态码', async () => {
    fetchMock.mockResolvedValue(new Response('bad gateway', { status: 500 }));
    const err = await bizApi.getTopupOrder('o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BizError);
    expect((err as BizError).code).toBe('HTTP_ERROR');
    expect((err as BizError).message).toBe('HTTP 500');
  });

  it('建单 POST 带 JSON body;查单 id 经 URL 编码', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { id: 'o1', redirect_url: 'https://waffo.example/cashier', status: 'pending' }));
    await bizApi.createWaffoOrder({ package_id: 'credits-10k', idempotency_key: 'k1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/biz/credits/topup/waffo', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ package_id: 'credits-10k', idempotency_key: 'k1' }),
    }));
    await bizApi.getTopupOrder('o 1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/biz/credits/topup/order?id=o%201', expect.anything());
  });
});

describe('bizApi 订阅域', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('套餐列表 GET /subscription/plans,current_tier 与 plans 同源解出', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, {
      currency: 'USD',
      current_tier: 'starter',
      intro_eligible: false,
      plans: [{
        tier: 'creator',
        monthly_price_cents: 4900,
        yearly_price_cents: 49000,
        yearly_monthly_price_cents: 4083,
        credits_per_month: 88200,
        intro_price_cents: 0,
        currency: 'USD',
        entitlements: {
          watermark_free: true, commercial_license: 'full', premium_models: true,
          concurrent_jobs: 5, queue_priority: 'priority', topup_allowed: true,
        },
      }],
      usage_units: { nano_image: 32, seedance_video: 143 },
      welcome_credits: 100,
      welcome_credits_valid_days: 0,
    }));
    const data = await bizApi.getSubscriptionPlans();
    expect(data.current_tier).toBe('starter');
    expect(data.plans[0].yearly_monthly_price_cents).toBe(4083);
    expect(data.usage_units.seedance_video).toBe(143);
    expect(fetchMock).toHaveBeenCalledWith('/api/biz/subscription/plans', expect.objectContaining({
      method: 'GET', credentials: 'include',
    }));
  });

  it('首次订阅 POST /subscription/subscribe 带 tier + billing_period + 幂等键', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, {
      id: 's1', merchant_subscription_id: 'm1', redirect_url: 'https://waffo.example/auth', status: 'pending',
    }));
    const data = await bizApi.createSubscription({ tier: 'starter', billing_period: 'yearly', idempotency_key: 'k1' });
    expect(data.redirect_url).toBe('https://waffo.example/auth');
    expect(fetchMock).toHaveBeenCalledWith('/api/biz/subscription/subscribe', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tier: 'starter', billing_period: 'yearly', idempotency_key: 'k1' }),
    }));
  });

  it('升档 POST /subscription/change;Waffo 免重新授权时不下发 redirect_url', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { id: 's1', direction: 'upgrade', status: 'active' }));
    const data = await bizApi.changeSubscription({ tier: 'creator', billing_period: 'yearly', idempotency_key: 'k2' });
    expect(data.direction).toBe('upgrade');
    expect(data.redirect_url).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/biz/subscription/change', expect.objectContaining({ method: 'POST' }));
  });

  it('订阅查单 GET /subscription/order,id 经 URL 编码', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { id: 's 1', tier: 'creator', status: 'active' }));
    const data = await bizApi.getSubscriptionOrder('s 1');
    expect(data.status).toBe('active');
    expect(fetchMock).toHaveBeenCalledWith('/api/biz/subscription/order?id=s%201', expect.anything());
  });

  it('订阅接口非 2xx 同样归一为 BizError(未登录 401)', async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { code: 'UNAUTHORIZED', message: '未登录' }));
    await expect(bizApi.createSubscription({ tier: 'creator', billing_period: 'yearly', idempotency_key: 'k3' }))
      .rejects.toMatchObject({ name: 'BizError', code: 'UNAUTHORIZED', status: 401 });
  });
});
