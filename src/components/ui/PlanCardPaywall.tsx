'use client';
import { useTranslation } from 'react-i18next';
import type { SubscriptionPlan } from '@/lib/biz/types';
import { formatUsd } from '@/lib/topup';
import { tierDisplayName, usageEquivalents } from '@/lib/subscription/plan-display';

// 模型锁定弹窗的单档卡,取值对齐主站 paywall 的 UpgradeSection(rezona-lab
// features/studio/paywall/upgrade-section.tsx):恒暗、横向双栏、**月付口径**
// —— 不出现划线原价 / 20% OFF / billed annually,那些是三档窗的促销语汇。
//
// 与随主题翻的 PlanCard、三档窗的 PlanCardDark 并列第三张:三者只共用 plan-display.ts
// 的数据映射,样式互不牵连(沿用 2026-08-12 spec 约束 2 的分工)。

// 换算行取主站 UpgradeSection 的两条 USAGE_KEYS —— 不能只取展示顺序前两条:
// 本项目 USAGE_ROW_ORDER 第二条是 gpt_image,那样卡上第二行会变成 ChatGPT images(实测)
const USAGE_KEYS = ['nano_image', 'seedance_video'] as const;

export default function PlanCardPaywall({
  plan, usageUnits,
}: {
  plan: SubscriptionPlan;
  usageUnits: Record<string, number>;
}) {
  const { t } = useTranslation();
  const credits = plan.credits_per_month.toLocaleString('en-US');
  const rows = usageEquivalents(plan.credits_per_month, usageUnits, { keys: USAGE_KEYS });

  // 权益四行:首行(积分)高亮青,其余白。句式按档静态取(见 i18n plan.perks 注释)
  const perks = [
    t('plan.perks.credits', { n: credits }),
    t(`plan.perks.${plan.tier}.r2`),
    t(`plan.perks.${plan.tier}.r3`),
    t(`plan.perks.${plan.tier}.r4`),
  ];

  return (
    <div data-tier={plan.tier} className="upsell-card-paywall flex w-full flex-col rounded-[20px]">
      <div className="flex flex-col gap-1 px-4 pt-4">
        <div className="flex items-center gap-1.5">
          <span className="font-display text-[20px] uppercase leading-7 text-[var(--upsell-text)]">
            {tierDisplayName(plan.tier)}
          </span>
          {(plan.tier === 'creator' || plan.tier === 'master') && (
            <span className="upsell-badge upsell-badge-blue">
              <span>{t(plan.tier === 'creator' ? 'plan.recommended' : 'plan.bestValue')}</span>
            </span>
          )}
        </div>
        <span className="text-[12px] leading-4 tracking-[0.015em] text-[var(--upsell-text-muted)]">
          {t(`plan.tagline.${plan.tier}`)}
        </span>
      </div>

      <div className="flex items-end justify-between">
        {/* 左栏:积分面板。minHeight 不能写死 height —— 换算文案折行会溢出圆角背景压到价格上(主站踩过) */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex min-h-[136px] flex-col gap-1.5 rounded-[12px] bg-[var(--upsell-panel)] p-3">
            <span className="text-[14px] font-bold leading-5 text-[var(--upsell-text)]">
              {t('plan.creditsPlain', { n: credits })}
            </span>
            {rows.length > 0 && (
              <div className="flex flex-col gap-1">
                {rows.map((r) => (
                  <span key={r.key} className="pl-7 text-[12px] leading-4 text-[var(--upsell-text-muted)]">
                    {t(`plan.usage.${r.key}`, { n: r.count.toLocaleString('en-US') })}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右栏:价格 + 权益 */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-end gap-1">
            <span className="text-[32px] font-semibold tracking-[0.0147em] text-[var(--upsell-text)]">
              {formatUsd(plan.monthly_price_cents, { compact: true })}
            </span>
            <span className="text-[12px] leading-[18px] text-[var(--upsell-text-muted)]">{t('plan.perMonth')}</span>
          </div>
          <div className="flex flex-col gap-1">
            {perks.map((p, i) => (
              <span
                key={p}
                className={`text-[12px] leading-4 ${i === 0 ? 'text-[var(--upsell-perk-hi)]' : 'text-[var(--upsell-text)]'}`}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
