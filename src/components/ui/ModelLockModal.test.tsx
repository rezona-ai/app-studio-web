import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ModelLockModal from './ModelLockModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import type { CurrentTier, SubscriptionPlansData, SubscriptionTier } from '@/lib/biz/types';

// 下单链路由 useSubscribeFlow 单测覆盖,此处只验这张窗的形态与回调接线
vi.mock('@/lib/biz/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/biz/client')>()),
  bizApi: {
    createSubscription: vi.fn(async () => ({ id: 'sub-1', redirect_url: '' })),
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
  plans: [mkPlan('starter', 13200, 1200, 1000), mkPlan('creator', 88200, 4900, 4083), mkPlan('master', 198000, 9900, 8250)],
  usage_units: { nano_image: 32, seedance_video: 143 },
  welcome_credits: 100,
  welcome_credits_valid_days: 0,
});

const props = {
  plans: plansFor('free'),
  onClose: vi.fn(),
  onRetryPlans: vi.fn(),
  onSeeAllPlans: vi.fn(),
};

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() } as never);
  document.documentElement.dataset.theme = 'dark';
  vi.clearAllMocks();
});
afterEach(cleanup);

test('说明行是 Rez1 那句(主站文案)', () => {
  render(<ModelLockModal {...props} />);
  expect(screen.getByText('Rez1 is free for your first game. Subscribe to unlock every other model.')).toBeTruthy();
});

test('free 用户看到的单卡是 Starter(下一档),不是三档并排', () => {
  render(<ModelLockModal {...props} />);
  // 展示名经 CSS uppercase,DOM 文本仍是 Title case
  expect(screen.getAllByText(/^Starter$/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/^Creator$/)).toBeNull();
  expect(screen.queryByText(/^Max$/)).toBeNull();
});

test('卡面积分与等价行取自 plans,不写死', () => {
  render(<ModelLockModal {...props} />);
  expect(screen.getAllByText(/13,200/).length).toBeGreaterThan(0);
});

test('无 hero:不渲染 hero 的 WordArt 与位图(与截图一致)', () => {
  const { container } = render(<ModelLockModal {...props} />);
  // hero 的位图一律走 <img>,本弹窗除图标(经 CSS mask 的 span)外不该有位图
  expect(container.querySelector('img[src*="chest"]')).toBeNull();
  expect(screen.queryByText(/Insufficient/i)).toBeNull();
  expect(screen.queryByText(/Upgrade for more/i)).toBeNull();
});

test('不渲染余额进度卡(那块讲的是积分不够,与本弹窗无关)', () => {
  useStore.setState({ credit: { balance: 120, spendable: 120, held: 0 } } as never);
  render(<ModelLockModal {...props} />);
  expect(screen.queryByText(/credits left/i)).toBeNull();
});

test('See all plans 回调向上抛(仍由 Gate 开三档并排)', () => {
  render(<ModelLockModal {...props} />);
  act(() => { fireEvent.click(screen.getByText('See all plans')); });
  expect(props.onSeeAllPlans).toHaveBeenCalledTimes(1);
});

test('CTA 文案对齐主站:Upgrade - $12/mo(月付原价,不带档位名)', () => {
  render(<ModelLockModal {...props} />);
  expect(screen.getByRole('button', { name: 'Upgrade - $12/mo' })).toBeTruthy();
});

test('可享首期优惠时打首月价钩子(与主站 upgradeCtaCopy 同判据)', () => {
  const withIntro = plansFor('free');
  render(<ModelLockModal {...props} plans={{
    ...withIntro,
    intro_eligible: true,
    plans: withIntro.plans.map((p) => (p.tier === 'starter' ? { ...p, intro_price_cents: 960 } : p)),
  }} />);
  expect(screen.getByRole('button', { name: 'Upgrade - $9.60 first month' })).toBeTruthy();
});

test('intro_eligible 为 false 时不打首月价(后端四份配置恒 0,常态走月价)', () => {
  const p = plansFor('free');
  render(<ModelLockModal {...props} plans={{
    ...p,
    intro_eligible: false,
    plans: p.plans.map((x) => (x.tier === 'starter' ? { ...x, intro_price_cents: 960 } : x)),
  }} />);
  expect(screen.getByRole('button', { name: 'Upgrade - $12/mo' })).toBeTruthy();
});

test('CTA 走订阅流:点一下下单 Starter', async () => {
  const { bizApi } = await import('@/lib/biz/client');
  render(<ModelLockModal {...props} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: /Upgrade - / })); });
  await vi.waitFor(() => expect(bizApi.createSubscription).toHaveBeenCalled());
});

test('卡面是恒暗 paywall 卡(柠檬绿光泽不分档),权益首行高亮', () => {
  const { container } = render(<ModelLockModal {...props} />);
  expect(container.querySelector('.upsell-card-paywall')).toBeTruthy();
  const perk = screen.getByText('13,200 Credits / month');
  expect(perk.className).toContain('--upsell-perk-hi');
});

test('套餐配置缺失:渲染失败态 + 重试,不出死窗', () => {
  render(<ModelLockModal {...props} plans={null} />);
  act(() => { fireEvent.click(screen.getByText('Retry')); });
  expect(props.onRetryPlans).toHaveBeenCalledTimes(1);
});

test('Esc 关闭', () => {
  render(<ModelLockModal {...props} />);
  act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
  // 退场动画 200ms 后才回调,这里只验监听生效(不引真实计时器)
  expect(document.querySelector('[data-closing="true"]')).toBeTruthy();
});
