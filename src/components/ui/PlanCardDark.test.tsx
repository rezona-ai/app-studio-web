import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanCardDark from './PlanCardDark';
import type { SubscriptionPlan, SubscriptionTier } from '@/lib/biz/types';

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

describe('PlanCardDark(完整订阅弹窗的恒暗档位卡)', () => {
  test('价格数据驱动:划线取月付价、大号取年付月单价、OFF 百分比算出', () => {
    render(<PlanCardDark plan={plan('creator')} usageUnits={units} currentTier="starter" />);
    expect(screen.getByText('$49')).toBeTruthy();
    expect(screen.getByText('$40.83')).toBeTruthy();
    expect(screen.getByText('17% OFF')).toBeTruthy();
  });

  test('年付不便宜时不渲染划线与 OFF 徽标(配置异常 fail-closed)', () => {
    const { container } = render(<PlanCardDark
      plan={plan('creator', { yearly_monthly_price_cents: 4900 })}
      usageUnits={units} currentTier="starter"
    />);
    expect(screen.queryByText(/% OFF/)).toBeNull();
    expect(container.querySelectorAll('.upsell-strike')).toHaveLength(0);
  });

  test('等价行出全部(最多 4 行)并带引导文案;Fixed amount 与上方积分同源', () => {
    render(<PlanCardDark plan={plan('creator')} usageUnits={units} currentTier="starter" />);
    expect(screen.getAllByText(/^≈ /)).toHaveLength(4);
    expect(screen.getByText(/these credits go as far as/)).toBeTruthy();
    expect(screen.getByText('88,200 credits/mo.')).toBeTruthy();
    expect(screen.getByText('Fixed amount of 88,200 credits/mo')).toBeTruthy();
  });

  test('权益首行注入积分数,后三行按档取静态文案', () => {
    render(<PlanCardDark plan={plan('master', { credits_per_month: 198000 })} usageUnits={units} currentTier="creator" />);
    expect(screen.getByText('198,000 Credits / month')).toBeTruthy();
    expect(screen.getByText('Everything in Creator')).toBeTruthy();
  });

  test('只允许升档:更高档可点、当前档与更低档禁用', () => {
    const onSubscribe = vi.fn();
    const up = render(<PlanCardDark plan={plan('master')} usageUnits={units} currentTier="creator" onSubscribe={onSubscribe} />);
    const upBtn = screen.getByRole('button');
    expect(upBtn.textContent).toBe('Get Max');
    expect((upBtn as HTMLButtonElement).disabled).toBe(false);
    upBtn.click();
    expect(onSubscribe).toHaveBeenCalledWith('master');
    up.unmount();

    const cur = render(<PlanCardDark plan={plan('creator')} usageUnits={units} currentTier="creator" />);
    expect(screen.getByRole('button').textContent).toBe('Current plan');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    cur.unmount();

    render(<PlanCardDark plan={plan('starter')} usageUnits={units} currentTier="creator" />);
    expect(screen.getByRole('button').textContent).toBe('Included');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  test('下单进行中 CTA 禁用(防重复点击)', () => {
    render(<PlanCardDark plan={plan('master')} usageUnits={units} currentTier="creator" busy />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  test('卡面与键帽 CTA 走 globals.css 的真类,不用任意值工具类(旧实现 Creator 填充丢失的坑)', () => {
    const { container: c1 } = render(<PlanCardDark plan={plan('creator')} usageUnits={units} currentTier="free" />);
    expect(c1.querySelector('[data-tier="creator"]')?.className).toContain('upsell-card-creator');
    expect(screen.getByRole('button').className).toContain('upsell-key-creator');

    const { container: c2 } = render(<PlanCardDark plan={plan('master')} usageUnits={units} currentTier="free" />);
    expect(c2.querySelector('[data-tier="master"]')?.className).toContain('upsell-card-master');
    expect(screen.getAllByRole('button')[1]?.className).toContain('upsell-key-master');
  });

  // 等价行 Starter 只有 3 条、Creator/Max 有 4 条,面板不撑高的话三卡价格行会错位(Nick 实测)。
  // jsdom 量不出真实高度,故锁结构:面板与其内的等价行区都要能吸收剩余空间,chip 贴面板底。
  test('积分面板吸收剩余空间,使三卡的 chip 与价格行落在同一水平线', () => {
    const { container } = render(<PlanCardDark plan={plan('starter')} usageUnits={units} currentTier="free" />);
    const panel = container.querySelector('[data-panel="credits"]');
    expect(panel?.className).toContain('flex-1');
    expect(container.querySelector('[data-panel="credits"] [data-fill="usage"]')?.className).toContain('flex-1');
    // 上半块也要 flex-1,否则面板没有可吸收的空间
    expect(container.querySelector('[data-block="top"]')?.className).toContain('flex-1');
  });

  test('禁用态的键帽退成中性面(不套档位填充)', () => {
    render(<PlanCardDark plan={plan('starter')} usageUnits={units} currentTier="creator" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('upsell-key-off');
    expect(btn.className).not.toContain('upsell-key-starter');
  });

  test('主推徽标:Creator 为 Recommended、Max 为 Best value,Starter 无', () => {
    const c = render(<PlanCardDark plan={plan('creator')} usageUnits={units} currentTier="free" />);
    expect(screen.getByText('Recommended')).toBeTruthy();
    c.unmount();

    const m = render(<PlanCardDark plan={plan('master')} usageUnits={units} currentTier="free" />);
    expect(screen.getByText('Best value')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
    m.unmount();

    render(<PlanCardDark plan={plan('starter')} usageUnits={units} currentTier="free" />);
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryByText('Best value')).toBeNull();
  });
});
