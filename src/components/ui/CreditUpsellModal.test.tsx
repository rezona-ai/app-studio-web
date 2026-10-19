import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CreditUpsellModal from './CreditUpsellModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import type { CurrentTier, SubscriptionPlansData, SubscriptionTier } from '@/lib/biz/types';

// 充值分支会经 useTopupFlow 打 biz;订阅分支的下单由 useSubscribeFlow 单测覆盖,此处只验渲染分流
vi.mock('@/lib/biz/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/biz/client')>()),
  bizApi: {
    getTopupOptions: vi.fn(async () => ({
      enabled: true, currency: 'USD', coupon: null, topup_allowed: true,
      packages: [
        { id: 'p1', credits: 10000, amount_cents: 1000, discounted_amount_cents: 500, discount_cents: 500, currency: 'USD' },
        { id: 'p2', credits: 25000, amount_cents: 2500, discounted_amount_cents: 1000, discount_cents: 1500, currency: 'USD' },
        { id: 'p3', credits: 50000, amount_cents: 5000, discounted_amount_cents: 2000, discount_cents: 3000, currency: 'USD' },
      ],
    })),
    getTopupOrder: vi.fn(),
    closeTopupOrder: vi.fn(),
    createWaffoOrder: vi.fn(),
    createSubscription: vi.fn(),
    changeSubscription: vi.fn(),
    getSubscriptionOrder: vi.fn(),
  },
}));

const mkPlan = (tier: SubscriptionTier, credits: number, monthly: number, yearlyMonthly: number) => ({
  tier,
  monthly_price_cents: monthly,
  yearly_price_cents: monthly * 10,
  yearly_monthly_price_cents: yearlyMonthly,
  credits_per_month: credits,
  intro_price_cents: 0,
  currency: 'USD',
  entitlements: {
    watermark_free: true, commercial_license: 'full', premium_models: true,
    concurrent_jobs: 5, queue_priority: 'priority', topup_allowed: true,
  },
});

const plansFor = (current: CurrentTier): SubscriptionPlansData => ({
  currency: 'USD',
  current_tier: current,
  intro_eligible: false,
  plans: [
    mkPlan('starter', 18000, 1200, 1000),
    mkPlan('creator', 88200, 4900, 4083),
    mkPlan('master', 198000, 9900, 8250),
  ],
  usage_units: { nano_image: 32, gpt_image: 8, seedance_video: 143, game: 2000 },
  welcome_credits: 100,
  welcome_credits_valid_days: 0,
});

const props = {
  source: 'insufficient' as const,
  kind: '3d' as const,
  plans: plansFor('starter'),
  onClose: vi.fn(),
  onRetryPlans: vi.fn(),
  onSeeAllPlans: vi.fn(),
  onViewAllPricing: vi.fn(),
};

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    credit: { balance: 20, held: 0, spendable: 20 },
    loadUserInfo: vi.fn(async () => {}),
    setError: vi.fn(), setSuccess: vi.fn(),
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('CreditUpsellModal(触发式升购弹窗)', () => {
  // 用例名不写「满箱稿」:两张新素材未导出,此处验的是变体标与字标跟触发源(终审 I3b)
  test('hero 变体与字标跟触发源', () => {
    // 字标是贴纸结构(描边副本 + 渐变层),取可见的渐变层
    const a = render(<CreditUpsellModal {...props} source="insufficient" />);
    expect(document.querySelector('[data-hero="insufficient"]')).toBeTruthy();
    expect(document.querySelector('.hero-wordart')?.textContent).toBe('Insufficient');
    a.unmount();

    render(<CreditUpsellModal {...props} source="lowBalance" />);
    expect(document.querySelector('[data-hero="lowBalance"]')).toBeTruthy();
    expect(document.querySelector('.hero-wordart')?.textContent).toBe('Almost out of');
  });

  // 设计稿 5952:84375 的全宽 CTA 是白字;深字那条令牌留给橙底小徽章
  test('全宽升档 CTA 是橙底白字', () => {
    render(<CreditUpsellModal {...props} plans={plansFor('starter')} />);
    const cta = screen.getByRole('button', { name: /Upgrade to Creator/ });
    expect(cta.className).toContain('--color-on-primary-strong');
    expect(cta.className).not.toContain('var(--color-on-primary)');
  });

  test('说明行跟触发源', () => {
    const a = render(<CreditUpsellModal {...props} source="insufficient" />);
    expect(screen.getByText(/Not enough credits for this generation/)).toBeTruthy();
    a.unmount();
    render(<CreditUpsellModal {...props} source="lowBalance" />);
    expect(screen.getByText(/unlock the full creator toolkit/)).toBeTruthy();
  });

  test('Starter 用户看到 Creator 单卡与升档 CTA(价格取年付月单价)', () => {
    render(<CreditUpsellModal {...props} plans={plansFor('starter')} />);
    expect(screen.getByText('Creator')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upgrade to Creator — \$40\.83\/mo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /See all plans/ })).toBeTruthy();
  });

  test('Creator 用户看到 Max 单卡', () => {
    render(<CreditUpsellModal {...props} plans={plansFor('creator')} />);
    expect(screen.getByText('Max')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upgrade to Max — \$82\.50\/mo/ })).toBeTruthy();
  });

  test('free 用户(上层通常路由到 all-plans)在本组件里回落 Starter 卡,不出空弹窗', () => {
    render(<CreditUpsellModal {...props} plans={plansFor('free')} />);
    expect(screen.getByText('Starter')).toBeTruthy();
  });

  test('Max 用户走积分充值分支:三档充值卡 + view-all 链,不出方案卡', async () => {
    render(<CreditUpsellModal {...props} plans={plansFor('master')} />);
    expect(await screen.findByText('10,000 credits')).toBeTruthy();
    expect(screen.getByRole('button', { name: /View all pricing options/ })).toBeTruthy();
    expect(screen.queryByText('See all plans')).toBeNull();
  });

  test('进度卡:带资产类型时出类型名 + 余额;agent 侧无类型时退化成纯余额行', () => {
    const a = render(<CreditUpsellModal {...props} kind="3d" />);
    expect(screen.getByText('3D')).toBeTruthy();
    expect(screen.getAllByText('20 credits left').length).toBeGreaterThan(0);
    a.unmount();

    render(<CreditUpsellModal {...props} kind={null} />);
    expect(screen.queryByText('3D')).toBeNull();
    expect(screen.getAllByText('20 credits left').length).toBeGreaterThan(0);
  });

  test('套餐配置未就绪:主体给失败态 + 重试,不渲染方案卡', () => {
    render(<CreditUpsellModal {...props} plans={null} />);
    expect(screen.getByText(/Failed to load/)).toBeTruthy();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(props.onRetryPlans).toHaveBeenCalled();
  });

  test('see-all-plans 与 view-all-pricing 各自回调上层(弹窗切换归 store)', async () => {
    const a = render(<CreditUpsellModal {...props} plans={plansFor('creator')} />);
    screen.getByRole('button', { name: /See all plans/ }).click();
    expect(props.onSeeAllPlans).toHaveBeenCalled();
    a.unmount();

    render(<CreditUpsellModal {...props} plans={plansFor('master')} />);
    (await screen.findByRole('button', { name: /View all pricing options/ })).click();
    expect(props.onViewAllPricing).toHaveBeenCalled();
  });
});
