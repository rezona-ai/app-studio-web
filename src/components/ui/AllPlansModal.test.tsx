import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AllPlansModal from './AllPlansModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import type { CurrentTier, SubscriptionPlansData, SubscriptionTier } from '@/lib/biz/types';

vi.mock('@/lib/biz/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/biz/client')>()),
  bizApi: { createSubscription: vi.fn(), changeSubscription: vi.fn(), getSubscriptionOrder: vi.fn() },
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

const plansFor = (current: CurrentTier, tiers = ['starter', 'creator', 'master'] as SubscriptionTier[]): SubscriptionPlansData => ({
  currency: 'USD',
  current_tier: current,
  intro_eligible: false,
  plans: tiers.map((tr) => (
    tr === 'starter' ? mkPlan('starter', 18000, 1200, 1000)
      : tr === 'creator' ? mkPlan('creator', 88200, 4900, 4083)
        : mkPlan('master', 198000, 9900, 8250)
  )),
  usage_units: { nano_image: 32, gpt_image: 8, seedance_video: 143, game: 2000 },
  welcome_credits: 100,
  welcome_credits_valid_days: 0,
});

const props = {
  source: 'insufficient' as const,
  plans: plansFor('free'),
  onClose: vi.fn(),
  onRetryPlans: vi.fn(),
};

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    credit: { balance: 13, held: 0, spendable: 13 },
    loadUserInfo: vi.fn(async () => {}),
    setError: vi.fn(), setSuccess: vi.fn(),
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('AllPlansModal(完整订阅弹窗)', () => {
  test('hero 恒用 UPGRADE FOR MORE,与触发源无关', () => {
    const a = render(<AllPlansModal {...props} source="insufficient" />);
    expect(document.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy();
    a.unmount();
    render(<AllPlansModal {...props} source="lowBalance" />);
    expect(document.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy();
  });

  test('说明行也不跟触发源:两种 source 都是转化口径那句', () => {
    const a = render(<AllPlansModal {...props} source="insufficient" />);
    expect(screen.getByText(/You still have 13 credits left/)).toBeTruthy();
    expect(screen.queryByText(/Not enough credits for this generation/)).toBeNull();
    a.unmount();
    render(<AllPlansModal {...props} source="lowBalance" />);
    expect(screen.getByText(/You still have 13 credits left/)).toBeTruthy();
  });

  test('free 用户:三档并排且全部可升', () => {
    render(<AllPlansModal {...props} plans={plansFor('free')} />);
    expect(screen.getByRole('button', { name: 'Get Starter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upgrade to Creator' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get Max' })).toBeTruthy();
    for (const name of ['Get Starter', 'Upgrade to Creator', 'Get Max']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  test('Creator 用户:更低档 Included、当前档 Current plan,均禁用;只有 Max 可点', () => {
    render(<AllPlansModal {...props} plans={plansFor('creator')} />);
    const included = screen.getByRole('button', { name: 'Included' }) as HTMLButtonElement;
    const current = screen.getByRole('button', { name: 'Current plan' }) as HTMLButtonElement;
    const up = screen.getByRole('button', { name: 'Get Max' }) as HTMLButtonElement;
    expect(included.disabled).toBe(true);
    expect(current.disabled).toBe(true);
    expect(up.disabled).toBe(false);
  });

  test('Max 用户:三档全不可点(降档不在本弹窗做)', () => {
    render(<AllPlansModal {...props} plans={plansFor('master')} />);
    const buttons = screen.getAllByRole('button').filter((b) => b.textContent !== 'Close');
    const plansBtns = buttons.filter((b) => ['Included', 'Current plan'].includes(b.textContent ?? ''));
    expect(plansBtns).toHaveLength(3);
    for (const b of plansBtns) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  test('套餐未就绪 / 档位为空:失败态 + 重试,不渲染空网格', () => {
    const a = render(<AllPlansModal {...props} plans={null} />);
    expect(screen.getByText(/Failed to load/)).toBeTruthy();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(props.onRetryPlans).toHaveBeenCalled();
    a.unmount();

    render(<AllPlansModal {...props} plans={plansFor('free', [])} />);
    expect(screen.getByText(/Failed to load/)).toBeTruthy();
  });

  test('点升档 CTA 走订阅链路(free → subscribe)', async () => {
    const { bizApi } = await import('@/lib/biz/client');
    (bizApi.createSubscription as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ id: 's1', redirect_url: 'https://waffo/x', status: 'pending' });
    vi.stubGlobal('open', vi.fn(() => ({ location: { href: '' }, close: vi.fn() })));
    render(<AllPlansModal {...props} plans={plansFor('free')} />);
    screen.getByRole('button', { name: 'Upgrade to Creator' }).click();
    await vi.waitFor(() => expect(bizApi.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'creator', billing_period: 'yearly' }),
    ));
    vi.unstubAllGlobals();
  });
});
