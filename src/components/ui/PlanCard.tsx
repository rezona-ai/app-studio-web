'use client';
import { useTranslation } from 'react-i18next';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { SubscriptionPlan, SubscriptionTier } from '@/lib/biz/types';
import { formatUsd } from '@/lib/topup';
import { tierDisplayName, usageEquivalents, yearlyOffPercent } from '@/lib/subscription/plan-display';

// 订阅档位卡(单卡升购弹窗 5952:84375):左积分面板 / 右价格 + 权益;
// CTA 由弹窗提供全宽按钮,卡内不渲染。价格 / 积分 / 折扣 / 等价行全部来自 plans 响应,卡内无硬编码金额。
// 完整订阅弹窗(all-plans)的纵向卡已独立成恒暗的 PlanCardDark(2026-08-12 spec),本组件不再兼两职。

// 单卡弹窗只展示两行等价(设计稿两行)
const WIDE_USAGE_ROWS = 2;

// 卡面:Max 用促销粉渐变(设计稿 8372:178849),其余中性面
const TIER_SURFACE: Record<SubscriptionTier, string> = {
  starter: 'bg-[var(--color-shell)]',
  creator: 'bg-[var(--color-shell)]',
  master: 'bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-promo)_28%,var(--color-shell)),var(--color-shell))]',
};

export default function PlanCard({
  plan, usageUnits,
}: {
  plan: SubscriptionPlan;
  usageUnits: Record<string, number>;
}) {
  const { t } = useTranslation();
  const off = yearlyOffPercent(plan);
  const credits = plan.credits_per_month.toLocaleString('en-US');
  const rows = usageEquivalents(plan.credits_per_month, usageUnits, { limit: WIDE_USAGE_ROWS });

  const header = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[20px] uppercase leading-7 text-[var(--color-ink)]">
          {tierDisplayName(plan.tier)}
        </span>
        {/* 折扣徽标用促销粉(同既有 SAVE 徽标语义);RECOMMENDED / BEST VALUE 用品牌橙——
            设计稿这两个是蓝紫,但旧蓝令牌已全量迁移删除,按规范不再引入新色值 */}
        {off != null && (
          <span className="flex h-[18px] items-center rounded-full bg-[var(--color-promo)] px-2 text-[10px] font-bold uppercase leading-3 tracking-[0.15px] text-white">
            {t('plan.off', { p: off })}
          </span>
        )}
        {(plan.tier === 'creator' || plan.tier === 'master') && (
          <span className="flex h-[18px] items-center rounded-full bg-[var(--color-primary)] px-2 text-[10px] font-bold uppercase leading-3 tracking-[0.15px] text-[var(--color-on-primary)]">
            {t(plan.tier === 'creator' ? 'plan.recommended' : 'plan.bestValue')}
          </span>
        )}
      </div>
      <span className="text-[12px] leading-4 text-[var(--color-muted)]">{t(`plan.tagline.${plan.tier}`)}</span>
    </div>
  );

  const creditsPanel = (
    <div className="flex flex-col gap-2 rounded-[12px] bg-[var(--color-fill)] p-3">
      <span className="flex items-center gap-2">
        <FigIcon src={figAsset.sparkle} size={16} tone="primary" />
        <span className="text-[14px] font-bold leading-5 text-[var(--color-ink)]">
          {t('plan.credits', { n: credits })}
        </span>
      </span>
      <div className="flex flex-col gap-1 pl-6">
        {rows.map((r) => (
          <span key={r.key} className="text-[11px] leading-4 text-[var(--color-muted)]">
            {t(`plan.usage.${r.key}`, { n: r.count.toLocaleString('en-US') })}
          </span>
        ))}
      </div>
      {/* 「每月固定 N 积分」:语义是当期有效不结转;数值与上方同源,不复刻设计稿里两个不一致的数 */}
      <span className="flex items-center gap-2 rounded-[10px] border border-[var(--color-line-2)] px-3 py-2">
        <FigIcon src={figAsset.check} size={16} tone="secondary" />
        <span className="text-[11px] leading-4 text-[var(--color-muted)]">
          {t('plan.fixedAmount', { n: credits })}
        </span>
      </span>
    </div>
  );

  const price = (
    <div className="flex flex-wrap items-baseline gap-2">
      {off != null && (
        <span className="text-[20px] leading-7 text-[var(--color-promo)] line-through">
          {formatUsd(plan.monthly_price_cents, { compact: true })}
        </span>
      )}
      <span className="text-[32px] font-bold leading-10 text-[var(--color-ink)]">
        {formatUsd(plan.yearly_monthly_price_cents, { compact: true })}
      </span>
      <span className="text-[12px] leading-4 text-[var(--color-muted)]">{t('plan.perMonthAnnual')}</span>
    </div>
  );

  const perks = (
    <ul className="flex flex-col gap-1">
      {[
        t('plan.perks.credits', { n: credits }),
        t(`plan.perks.${plan.tier}.r2`),
        t(`plan.perks.${plan.tier}.r3`),
        t(`plan.perks.${plan.tier}.r4`),
      ].map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <FigIcon src={figAsset.check} size={16} tone={i === 0 ? 'primary' : 'secondary'} />
          <span className={`text-[12px] leading-4 ${i === 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-ink)]'}`}>
            {label}
          </span>
        </li>
      ))}
    </ul>
  );

  const shell = `relative flex flex-col overflow-clip rounded-[16px] border border-[var(--color-line-strong)] p-4 ${TIER_SURFACE[plan.tier]}`;

  return (
    <div className={`${shell} gap-4`} data-tier={plan.tier}>
      {header}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1">{creditsPanel}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {price}
          {perks}
        </div>
      </div>
    </div>
  );
}
