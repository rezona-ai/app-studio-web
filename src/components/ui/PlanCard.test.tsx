import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanCard from './PlanCard';
import type { SubscriptionPlan, SubscriptionTier } from '@/lib/biz/types';

// 本组件现在只服务单卡升购弹窗(横向双栏、无 CTA);
// 完整订阅弹窗的纵向卡见 PlanCardDark.test.tsx。

const plan = (tier: SubscriptionTier, over: Partial<SubscriptionPlan> = {}): SubscriptionPlan => ({
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
  ...over,
});

const units = { nano_image: 32, gpt_image: 8, seedance_video: 143, game: 2000, tripo_3d: 120 };

describe('PlanCard(单卡升购弹窗的档位卡)', () => {
  test('价格来自 plans:划线取月付价、大号取年付月单价,OFF 百分比算出而非写死', () => {
    render(<PlanCard plan={plan('creator')} usageUnits={units} />);
    expect(screen.getByText('$49')).toBeTruthy();       // 划线月付价
    expect(screen.getByText('$40.83')).toBeTruthy();     // 年付折后月单价
    expect(screen.getByText('17% OFF')).toBeTruthy();    // 1 - 40.83/49 = 16.67% → 17%
  });

  test('年付月单价不便宜时不渲染划线与 OFF 徽标(配置异常 fail-closed)', () => {
    const { container } = render(<PlanCard
      plan={plan('creator', { monthly_price_cents: 4900, yearly_monthly_price_cents: 4900 })}
      usageUnits={units}
    />);
    expect(screen.queryByText(/% OFF/)).toBeNull();
    expect(container.querySelectorAll('.line-through')).toHaveLength(0);
    // 大号价照常渲染(它就是年付月单价),只是没有可比的原价可划
    expect(screen.getAllByText('$49')).toHaveLength(1);
  });

  test('Max 展示名是 Max(后端枚举 master 不变)', () => {
    render(<PlanCard plan={plan('master')} usageUnits={units} />);
    expect(screen.getByText('Max')).toBeTruthy();
    expect(screen.getByText('Best value')).toBeTruthy();
  });

  test('只出两行等价,不带「这些积分大约够」引导文案', () => {
    render(<PlanCard plan={plan('creator')} usageUnits={units} />);
    expect(screen.getAllByText(/^≈ /)).toHaveLength(2);
    expect(screen.queryByText(/these credits go as far as/)).toBeNull();
  });

  test('「每月固定 N 积分」与上方积分数同源(不复刻设计稿里两个不一致的数)', () => {
    render(<PlanCard plan={plan('creator')} usageUnits={units} />);
    expect(screen.getByText('88,200 credits/mo.')).toBeTruthy();
    expect(screen.getByText('Fixed amount of 88,200 credits/mo')).toBeTruthy();
  });

  test('卡内不渲染 CTA(单卡弹窗的 CTA 是卡外全宽按钮)', () => {
    render(<PlanCard plan={plan('creator')} usageUnits={units} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('权益首行注入积分数,后三行按档取静态文案(Max 第二行是「包含 Creator 全部权益」)', () => {
    render(<PlanCard plan={plan('master', { credits_per_month: 198000 })} usageUnits={units} />);
    expect(screen.getByText('198,000 Credits / month')).toBeTruthy();
    expect(screen.getByText('Everything in Creator')).toBeTruthy();
    expect(screen.getByText('12 parallel runs · top priority')).toBeTruthy();
  });
});
