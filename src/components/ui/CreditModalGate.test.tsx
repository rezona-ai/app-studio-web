import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import CreditModalGate from './CreditModalGate';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import type { CurrentTier, SubscriptionPlansData, SubscriptionTier } from '@/lib/biz/types';

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackAndWait: vi.fn() }));

const getSubscriptionPlans = vi.fn();
vi.mock('@/lib/biz/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/biz/client')>()),
  bizApi: {
    getSubscriptionPlans: (...a: unknown[]) => getSubscriptionPlans(...a),
    getTopupOptions: vi.fn(async () => ({ enabled: true, currency: 'USD', coupon: null, topup_allowed: true, packages: [] })),
    getTopupOrder: vi.fn(), closeTopupOrder: vi.fn(), createWaffoOrder: vi.fn(),
    createSubscription: vi.fn(), changeSubscription: vi.fn(), getSubscriptionOrder: vi.fn(),
  },
}));

const mkPlan = (tier: SubscriptionTier) => ({
  tier,
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
});

const plansFor = (current: CurrentTier, tiers: SubscriptionTier[] = ['starter', 'creator', 'master']): SubscriptionPlansData => ({
  currency: 'USD',
  current_tier: current,
  intro_eligible: false,
  plans: tiers.map(mkPlan),
  usage_units: { nano_image: 32, gpt_image: 8 },
  welcome_credits: 100,
  welcome_credits_valid_days: 0,
});

beforeEach(() => {
  getSubscriptionPlans.mockReset();
  track.mockReset();
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    creditModalOpen: 'insufficient',
    credit: { balance: 12, held: 0, spendable: 12 },
    loadUserInfo: vi.fn(async () => {}), setError: vi.fn(), setSuccess: vi.fn(),
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

// 档位卡的 CTA(每张卡一个);三档并排出三个,单卡弹窗的卡内不渲染 CTA
const planCtas = () => screen.queryAllByRole('button', { name: /^(Get |Upgrade to |Current plan$|Included$)/ });
const isAllPlans = () => planCtas().length >= 3;

describe('CreditModalGate(按档位分流)', () => {
  test('配置未到位期间什么都不渲染(不先开一个再切)', () => {
    getSubscriptionPlans.mockReturnValue(new Promise(() => {}));   // 永不 resolve
    const { container } = render(<CreditModalGate />);
    expect(container.firstChild).toBeNull();
  });

  test('free → 三档并排(WELCOME BACK hero)', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('free'));
    render(<CreditModalGate />);
    await waitFor(() => expect(document.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy());
    expect(isAllPlans()).toBe(true);
  });

  test('starter → Creator 单卡(宝箱 hero)', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('starter'));
    render(<CreditModalGate />);
    await waitFor(() => expect(document.querySelector('[data-hero="insufficient"]')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Upgrade to Creator/ })).toBeTruthy();
    expect(isAllPlans()).toBe(false);
  });

  test('creator → Max 单卡', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('creator'));
    render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Upgrade to Max/ })).toBeTruthy());
  });

  test('master → 积分充值分支(view-all 链而非 see-all-plans)', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('master'));
    render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByRole('button', { name: /View all pricing options/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /See all plans/ })).toBeNull();
  });

  // 终审 I4:目标档不在 plans[] 时,单卡弹窗会渲染成没有任何 CTA 的死弹窗
  test('目标档缺失(后端少配一档)回落三档并排,不出无 CTA 的死弹窗', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('starter', ['starter', 'master']));
    render(<CreditModalGate />);
    // upgradeForMore hero 只有 AllPlansModal 会渲染,是弹窗身份的可靠判据
    await waitFor(() => expect(document.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy());
    // 下发几档就渲染几张卡(此处 2 档),且每张都有 CTA —— 不会出现无出路的死弹窗
    expect(planCtas()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Upgrade to Creator/ })).toBeNull();
  });

  test('拉取失败 → 弹窗内失败态 + 重试', async () => {
    getSubscriptionPlans.mockRejectedValue(new Error('boom'));
    render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByText(/Failed to load/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  test('creditModalOpen 为 false 时不渲染', () => {
    useStore.setState({ creditModalOpen: false } as never);
    const { container } = render(<CreditModalGate />);
    expect(container.firstChild).toBeNull();
    expect(getSubscriptionPlans).not.toHaveBeenCalled();
  });

  // 终审 I5:Gate 随 creditModalOpen 条件挂载,关窗即卸载。缓存必须活过卸载,
  // 否则每次触发都要重等一个往返、期间空屏。
  test('缓存活过关窗:第二次触发不再请求,立刻出弹窗', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('starter'));
    const first = render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Upgrade to Creator/ })).toBeTruthy());
    expect(getSubscriptionPlans).toHaveBeenCalledTimes(1);
    first.unmount();                                   // 关窗

    render(<CreditModalGate />);                        // 再次触发
    expect(screen.getByRole('button', { name: /Upgrade to Creator/ })).toBeTruthy();   // 无需 await
    expect(getSubscriptionPlans).toHaveBeenCalledTimes(1);
  });

  // 终审 I1:variant 参与去重 stamp,点 See all plans 会再报一条;不带 tier/variant 两条完全一样
  test('曝光埋点带 tier 与 variant;换 variant 才再报,payload 可区分', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('starter'));
    render(<CreditModalGate />);
    await waitFor(() => expect(track).toHaveBeenCalledWith('out_of_credits_show', {
      trigger: 'generate', tier: 'starter', variant: 'plan',
    }));
    expect(track.mock.calls.filter((c) => c[0] === 'out_of_credits_show')).toHaveLength(1);

    screen.getByRole('button', { name: /See all plans/ }).click();
    await waitFor(() => expect(track).toHaveBeenCalledWith('out_of_credits_show', {
      trigger: 'generate', tier: 'starter', variant: 'all_plans',
    }));
  });

  test('lowBalance 触发上报 low_balance 维度(与点击事件同一套字面值)', async () => {
    useStore.setState({ creditModalOpen: 'lowBalance' } as never);
    getSubscriptionPlans.mockResolvedValue(plansFor('creator'));
    render(<CreditModalGate />);
    await waitFor(() => expect(track).toHaveBeenCalledWith('out_of_credits_show', {
      trigger: 'low_balance', tier: 'creator', variant: 'plan',
    }));
  });
});

// 手动入口(2026-08-12 回归)的分流与被动触发**不同**:非 Max 一律三档并排,
// Max 去完整充值弹窗(6180:109915)而不是升购弹窗里的三档充值卡。
describe('CreditModalGate(手动触发的分流)', () => {
  beforeEach(() => { useStore.setState({ creditModalOpen: 'manual' } as never); });

  test.each(['free', 'starter', 'creator'] as CurrentTier[])('%s 手动点 → 三档并排(不是单卡)', async (tier) => {
    getSubscriptionPlans.mockResolvedValue(plansFor(tier));
    render(<CreditModalGate />);
    await waitFor(() => expect(document.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy());
    expect(isAllPlans()).toBe(true);
    expect(screen.queryByRole('button', { name: /View all pricing options/ })).toBeNull();
  });

  test('master 手动点 → 转交完整充值弹窗,自身不再渲染升购弹窗', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('master'));
    const { container } = render(<CreditModalGate />);
    await waitFor(() => expect(useStore.getState().topupModalOpen).toBe(true));
    // 来源透传给充值弹窗的埋点(不再恒 generate)
    expect(useStore.getState().topupTrigger).toBe('manual');
    // 自身关闭:不能同时挂两个 z-40 弹窗
    expect(useStore.getState().creditModalOpen).toBe(false);
    expect(container.querySelector('[data-hero]')).toBeNull();
  });

  test('曝光埋点带 manual 维度', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('creator'));
    render(<CreditModalGate />);
    await waitFor(() => expect(track).toHaveBeenCalledWith('out_of_credits_show', {
      trigger: 'manual', tier: 'creator', variant: 'all_plans',
    }));
  });

  test('拉取失败仍给失败态 + 重试(不把入口卡死)', async () => {
    getSubscriptionPlans.mockRejectedValue(new Error('boom'));
    render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByText(/Failed to load/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

// 模型锁定分流(spec 2026-08-31):free 在 upsellVariant 表里是 all_plans,
// 这组用例守住「modelLocked 必须先被截住、且能回落」这条口径。
describe('CreditModalGate(模型锁定)', () => {
  beforeEach(() => { useStore.setState({ creditModalOpen: 'modelLocked' } as never); });

  test('free + modelLocked → 无 hero 的 Starter 单卡,而不是三档并排', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('free'));
    render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByText(/Rez1 is free for your first game/)).toBeTruthy());
    expect(isAllPlans()).toBe(false);
    expect(document.querySelector('[data-hero]')).toBeNull();
    expect(screen.getByRole('button', { name: /Upgrade - / })).toBeTruthy();
  });

  test('曝光埋点报 game_model_locked + plan(不混进 all_plans)', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('free'));
    render(<CreditModalGate />);
    await waitFor(() => expect(track).toHaveBeenCalledWith('out_of_credits_show', {
      trigger: 'game_model_locked', tier: 'free', variant: 'plan',
    }));
  });

  test('点 See all plans → 回落三档并排', async () => {
    getSubscriptionPlans.mockResolvedValue(plansFor('free'));
    render(<CreditModalGate />);
    await waitFor(() => expect(screen.getByRole('button', { name: /See all plans/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /See all plans/ })); });
    await waitFor(() => expect(isAllPlans()).toBe(true));
  });

  test('目标档缺失 → 回落三档并排,不出无 CTA 的死弹窗', async () => {
    // 少配 starter:free 的下一档缺失。此时卡数不足 3,故按 hero 判形态(三档窗恒 upgradeForMore hero)
    getSubscriptionPlans.mockResolvedValue(plansFor('free', ['creator', 'master']));
    render(<CreditModalGate />);
    await waitFor(() => expect(document.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy());
    expect(screen.queryByText(/Rez1 is free for your first game/)).toBeNull();
  });
});
