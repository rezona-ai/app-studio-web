import { describe, it, expect } from 'vitest';
import {
  formatUsd, couponPercent, formatCountdown, creditsPerUsd, estimateCustomCredits,
  isOrderPaid, isOrderClosed,
} from './topup';
import type { TopupPackage } from '@/lib/biz/types';

const pkg = (over: Partial<TopupPackage> = {}): TopupPackage => ({
  id: 'credits-10k', credits: 10000, amount_cents: 1000,
  discounted_amount_cents: 500, discount_cents: 500, currency: 'USD', ...over,
});

describe('formatUsd', () => {
  it('默认恒两位小数(现价/结算条)', () => {
    expect(formatUsd(500)).toBe('$5.00');
    expect(formatUsd(1750)).toBe('$17.50');
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('compact 整元去小数(卡片划线原价),非整元保留', () => {
    expect(formatUsd(1000, { compact: true })).toBe('$10');
    expect(formatUsd(1050, { compact: true })).toBe('$10.50');
  });
});

describe('couponPercent', () => {
  it('7000 bps(付 70%)→ 30% off', () => {
    expect(couponPercent(7000)).toBe(30);
  });
  it('非整百 bps 四舍五入', () => {
    expect(couponPercent(6666)).toBe(33);
  });
});

describe('formatCountdown', () => {
  it('小时可超 24(对齐设计稿 47:12:03)', () => {
    expect(formatCountdown(((47 * 3600 + 12 * 60 + 3) * 1000))).toBe('47:12:03');
  });
  it('分秒补零', () => {
    expect(formatCountdown(61_000)).toBe('00:01:01');
  });
  it('已过期一律 00:00:00', () => {
    expect(formatCountdown(-5)).toBe('00:00:00');
    expect(formatCountdown(0)).toBe('00:00:00');
  });
});

describe('creditsPerUsd / estimateCustomCredits', () => {
  it('以首档原价推每美元积分数', () => {
    expect(creditsPerUsd([pkg()])).toBe(1000); // 10000 credits / $10
  });
  it('档位为空或数据异常 → null(UI 隐藏估算)', () => {
    expect(creditsPerUsd([])).toBeNull();
    expect(creditsPerUsd([pkg({ amount_cents: 0 })])).toBeNull();
  });
  it('估算取整;非法金额 → null', () => {
    expect(estimateCustomCredits(7, 1000)).toBe(7000);
    expect(estimateCustomCredits(0, 1000)).toBeNull();
    expect(estimateCustomCredits(NaN, 1000)).toBeNull();
    expect(estimateCustomCredits(7, null)).toBeNull();
  });
});

describe('订单终态判定(枚举未文档化,只依赖已文档化字段)', () => {
  it('paid_at 非空即支付成功', () => {
    expect(isOrderPaid({ paid_at: '2026-07-13T00:00:00Z' })).toBe(true);
    expect(isOrderPaid({ paid_at: null })).toBe(false);
    expect(isOrderPaid({ paid_at: '' })).toBe(false);
    expect(isOrderPaid({})).toBe(false);
  });
  it('status=failed 即已关闭', () => {
    expect(isOrderClosed({ status: 'failed' })).toBe(true);
    expect(isOrderClosed({ status: 'pending' })).toBe(false);
  });
});
