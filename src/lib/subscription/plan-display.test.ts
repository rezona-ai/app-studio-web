import { describe, it, expect } from 'vitest';
import type { SubscriptionPlan } from '@/lib/biz/types';
import {
  upsellVariant, nextTier, yearlyOffPercent, usageEquivalents, tierDisplayName, planCtaState,
  triggerDimension, SECONDS_PER_VIDEO_CLIP,
} from './plan-display';

// 最小档位夹具:只钉本模块读到的字段,其余按后端形状补默认值
const plan = (over: Partial<SubscriptionPlan> = {}): SubscriptionPlan => ({
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
  ...over,
});

describe('upsellVariant / nextTier(档位分流)', () => {
  it('free 开完整订阅弹窗,starter/creator 开单卡,master 开积分充值', () => {
    expect(upsellVariant('free')).toBe('all_plans');
    expect(upsellVariant('starter')).toBe('plan');
    expect(upsellVariant('creator')).toBe('plan');
    expect(upsellVariant('master')).toBe('topup');
  });

  it('nextTier 逐级向上,master 到顶返回 null', () => {
    expect(nextTier('free')).toBe('starter');
    expect(nextTier('starter')).toBe('creator');
    expect(nextTier('creator')).toBe('master');
    expect(nextTier('master')).toBeNull();
  });
});

describe('yearlyOffPercent(年付折扣徽标)', () => {
  it('按月付价与年付月单价算出百分比并取整', () => {
    // 后端当前配置三档同为「年付省 2 个月」= 16.67% → 17%
    expect(yearlyOffPercent(plan({ monthly_price_cents: 4900, yearly_monthly_price_cents: 4083 }))).toBe(17);
    expect(yearlyOffPercent(plan({ monthly_price_cents: 1200, yearly_monthly_price_cents: 1000 }))).toBe(17);
    expect(yearlyOffPercent(plan({ monthly_price_cents: 9900, yearly_monthly_price_cents: 8250 }))).toBe(17);
  });

  it('数据异常一律 null(不展示负折扣或零折扣徽标)', () => {
    expect(yearlyOffPercent(plan({ monthly_price_cents: 0 }))).toBeNull();
    expect(yearlyOffPercent(plan({ yearly_monthly_price_cents: 0 }))).toBeNull();
    // 年付月单价 >= 月付价:配置错了,不能渲染成 "0% OFF" 或负数
    expect(yearlyOffPercent(plan({ monthly_price_cents: 4900, yearly_monthly_price_cents: 4900 }))).toBeNull();
    expect(yearlyOffPercent(plan({ monthly_price_cents: 4900, yearly_monthly_price_cents: 5200 }))).toBeNull();
  });
});

describe('usageEquivalents(等价行换算)', () => {
  const units = { nano_image: 32, gpt_image: 8, seedance_video: 143, game: 2000, tripo_3d: 120 };

  it('按固定顺序产出,tripo_3d 有下发但不展示', () => {
    const rows = usageEquivalents(88200, units);
    expect(rows.map((r) => r.key)).toEqual(['nano_image', 'gpt_image', 'seedance_video', 'game']);
  });

  it('视频按单条 5 秒折算成条数,其余按单价直除,一律向下取整', () => {
    const rows = usageEquivalents(88200, units);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.count]));
    expect(SECONDS_PER_VIDEO_CLIP).toBe(5);
    expect(by.nano_image).toBe(Math.floor(88200 / 32));
    expect(by.seedance_video).toBe(Math.floor(88200 / (143 * 5)));
    expect(by.game).toBe(Math.floor(88200 / 2000));
  });

  it('买不起一个展示单位的类别整行不渲染(低额度只剩便宜的那几行)', () => {
    // 100 分:nano 3 张、gpt 12 张,视频(143×5=715)与游戏(2000)都买不起
    expect(usageEquivalents(100, units).map((r) => r.key)).toEqual(['nano_image', 'gpt_image']);
    // 20 分:只够最便宜的 gpt 图
    expect(usageEquivalents(20, units).map((r) => r.key)).toEqual(['gpt_image']);
  });

  it('单价缺失或非正数的类别跳过,不产出 Infinity/NaN 行', () => {
    expect(usageEquivalents(88200, { nano_image: 0, gpt_image: -1 })).toEqual([]);
    expect(usageEquivalents(88200, {})).toEqual([]);
  });

  it('limit 在过滤之后截断(单卡弹窗只要两行)', () => {
    expect(usageEquivalents(88200, units, { limit: 2 }).map((r) => r.key))
      .toEqual(['nano_image', 'gpt_image']);
  });
  it('keys 只算指定类别,顺序仍按 USAGE_ROW_ORDER(模型锁定弹窗要 nano+video 两条)', () => {
    const units = { nano_image: 39, gpt_image: 8, seedance_video: 21, game: 18720 };
    const rows = usageEquivalents(13200, units, { keys: ['nano_image', 'seedance_video'] });
    expect(rows.map((r) => r.key)).toEqual(['nano_image', 'seedance_video']);
  });

});

describe('tierDisplayName / planCtaState', () => {
  it('master 展示为 Max(后端枚举不变)', () => {
    expect(tierDisplayName('starter')).toBe('Starter');
    expect(tierDisplayName('creator')).toBe('Creator');
    expect(tierDisplayName('master')).toBe('Max');
  });

  it('三个入口各自的埋点维度(手动入口 2026-08-12 加回)', () => {
    expect(triggerDimension('insufficient')).toBe('generate');
    expect(triggerDimension('lowBalance')).toBe('low_balance');
    expect(triggerDimension('manual')).toBe('manual');
    expect(triggerDimension('modelLocked')).toBe('game_model_locked');
  });

  it('只允许升档:高于当前档可点,等于为当前档,低于为已含', () => {
    expect(planCtaState('creator', 'starter')).toBe('upgrade');
    expect(planCtaState('creator', 'creator')).toBe('current');
    expect(planCtaState('starter', 'creator')).toBe('included');
    // free 用户三档全可升
    expect(planCtaState('starter', 'free')).toBe('upgrade');
    expect(planCtaState('master', 'free')).toBe('upgrade');
  });
});
