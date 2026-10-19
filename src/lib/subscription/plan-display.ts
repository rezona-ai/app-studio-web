// 订阅档位的展示层纯逻辑:档位分流、年付折扣、等价行换算、展示名与 CTA 态。
// 全部无副作用便于单测;字段语义见 src/lib/biz/types.ts 与 spec 2026-08-11-subscription-upsell-modal。
import type { CurrentTier, SubscriptionPlan, SubscriptionTier } from '@/lib/biz/types';

// 档位由低到高;free 不是可售档位(不出现在 plans 数组里),但参与顺序比较
export const TIER_ORDER: readonly CurrentTier[] = ['free', 'starter', 'creator', 'master'];

// 弹窗触发源:两种被动(生成被拒 / 上一次生成后余额将尽)+ 一种主动(点预览区积分块)
// + modelLocked(新用户锁在 Rez1 时点了别的模型,见 spec 2026-08-28-new-user-model-gate-design)
export type UpsellSource = 'insufficient' | 'lowBalance' | 'manual' | 'modelLocked';

// 触发弹窗时展示什么:free 直接开完整订阅弹窗(三档并排),低档开单卡升档,顶档只能充值
export type UpsellVariant = 'all_plans' | 'plan' | 'topup';

export function upsellVariant(tier: CurrentTier): UpsellVariant {
  if (tier === 'free') return 'all_plans';
  if (tier === 'master') return 'topup';
  return 'plan';
}

// 高一级档位;顶档返回 null
export function nextTier(tier: CurrentTier): SubscriptionTier | null {
  const i = TIER_ORDER.indexOf(tier);
  const next = i >= 0 ? TIER_ORDER[i + 1] : undefined;
  return next != null && next !== 'free' ? next : null;
}

// 年付相对月付的折扣百分比(卡上 "N% OFF" 徽标)。
// fail-closed:价格缺失、非正、或年付月单价不便宜时返回 null 让 UI 隐藏徽标与划线——
// 宁可不展示,也不能因配置错误渲染出 "0% OFF" 或负折扣。
export function yearlyOffPercent(plan: Pick<SubscriptionPlan, 'monthly_price_cents' | 'yearly_monthly_price_cents'>): number | null {
  const { monthly_price_cents: monthly, yearly_monthly_price_cents: yearly } = plan;
  if (!(monthly > 0) || !(yearly > 0) || yearly >= monthly) return null;
  return Math.round((1 - yearly / monthly) * 100);
}

// 视频类的展示折算:后端只下发「每秒单价」,卡上展示的是条数,单条按 5 秒算。
// 这个假定只活在展示层(与主站 taluna-pricing 的 SECONDS_PER_VIDEO_CLIP 同口径),接口口径不变。
export const SECONDS_PER_VIDEO_CLIP = 5;

// 展示顺序固定(usage_units 是 JSON object,无序);tripo_3d 后端有下发但产品定不展示
export const USAGE_ROW_ORDER = ['nano_image', 'gpt_image', 'seedance_video', 'game'] as const;
export type UsageRowKey = (typeof USAGE_ROW_ORDER)[number];

export interface UsageRow { key: UsageRowKey; count: number }

// 「整月额度约等于多少次生成」:次数 = credits_per_month ÷ 单位单价,向下取整。
// 这套单价仅供展示、不参与实际计费(真实扣费按参数逐次算),故文案一律带 ≈。
// 不足一个展示单位的类别整行不渲染,因此各档行数 0~4 不定。
export function usageEquivalents(
  creditsPerMonth: number,
  usageUnits: Record<string, number>,
  // keys:只算指定类别(顺序按 USAGE_ROW_ORDER,不按传入顺序)。模型锁定弹窗用它对齐
  // 主站 UpgradeSection 的两条 USAGE_KEYS(nano_image + seedance_video)
  opts: { limit?: number; keys?: readonly UsageRowKey[] } = {},
): UsageRow[] {
  const rows: UsageRow[] = [];
  const wanted = opts.keys ? new Set<string>(opts.keys) : null;
  for (const key of USAGE_ROW_ORDER) {
    if (wanted && !wanted.has(key)) continue;
    const unit = usageUnits[key];
    // 单价缺失/非正数一律跳过:否则会算出 Infinity / NaN 摆到卡片上
    if (typeof unit !== 'number' || !(unit > 0)) continue;
    const per = key === 'seedance_video' ? unit * SECONDS_PER_VIDEO_CLIP : unit;
    const count = Math.floor(creditsPerMonth / per);
    if (count < 1) continue;
    rows.push({ key, count });
  }
  return opts.limit != null ? rows.slice(0, opts.limit) : rows;
}

// 展示名:后端枚举恒 starter/creator/master,设计稿对外叫 Starter/Creator/Max。
// 映射只在展示层做,不改后端取值(后端文档另有 Lite/Pro/Studio 一套命名,以设计稿为准)。
const TIER_DISPLAY_NAME: Record<SubscriptionTier, string> = {
  starter: 'Starter',
  creator: 'Creator',
  master: 'Max',
};

export function tierDisplayName(tier: SubscriptionTier): string {
  return TIER_DISPLAY_NAME[tier];
}

// 触发源 → 埋点 trigger 维度。两处上报(曝光与点击)必须用同一套字面值,
// 否则同一漏斗的两个事件无法按 trigger 关联(终审 I2)。
// 埋点 trigger 维度:三个入口各一个取值。manual 是 2026-08-12 加回的手动入口
// (预览区积分块),与前两个被动触发共用同一套曝光 / 点击事件,便于同表对比转化。
export type TriggerDimension = 'generate' | 'low_balance' | 'manual' | 'game_model_locked';

export function triggerDimension(source: UpsellSource): TriggerDimension {
  if (source === 'insufficient') return 'generate';
  if (source === 'lowBalance') return 'low_balance';
  // 字面值与主站 PaywallTrigger 的 'game_model_locked' 一致 —— 两端同一漏斗要能同表对比
  return source === 'modelLocked' ? 'game_model_locked' : 'manual';
}

// 卡片 CTA 态:本期只允许升档(降档/退订走主站会员管理页,见 spec 约束 7)
export type PlanCtaState = 'upgrade' | 'current' | 'included';

export function planCtaState(planTier: SubscriptionTier, currentTier: CurrentTier): PlanCtaState {
  const diff = TIER_ORDER.indexOf(planTier) - TIER_ORDER.indexOf(currentTier);
  if (diff > 0) return 'upgrade';
  return diff === 0 ? 'current' : 'included';
}
