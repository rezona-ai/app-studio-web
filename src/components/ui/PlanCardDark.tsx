'use client';
import { useTranslation } from 'react-i18next';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { SubscriptionPlan, SubscriptionTier } from '@/lib/biz/types';
import { formatUsd } from '@/lib/topup';
import {
  planCtaState, tierDisplayName, usageEquivalents, yearlyOffPercent, type PlanCtaState,
} from '@/lib/subscription/plan-display';

// 完整订阅弹窗(all-plans)的档位卡,设计稿 9433:70184。
// 与单卡弹窗的 PlanCard 分开:那张随主题翻、横向双栏;这张**恒暗**、纵向,是促销面。
// 两者只共用 plan-display.ts 的数据映射,样式互不牵连(见 2026-08-12 spec 约束 2)。
//
// 卡面 / 徽标 / 键帽 / 划线四组样式都在 globals.css 里是**真类**,不用 bg-[var(--x)] 这类
// 任意值工具类 —— 旧实现 Creator 档 CTA 填充丢失就是这条链路上出的问题。

const TIER_SURFACE: Record<SubscriptionTier, string> = {
  starter: 'upsell-card-starter',
  creator: 'upsell-card-creator',
  master: 'upsell-card-master',
};

const TIER_KEY: Record<SubscriptionTier, string> = {
  starter: 'upsell-key-starter',
  creator: 'upsell-key-creator',
  master: 'upsell-key-master',
};

export default function PlanCardDark({
  plan, usageUnits, currentTier, onSubscribe, busy = false,
}: {
  plan: SubscriptionPlan;
  usageUnits: Record<string, number>;
  currentTier: Parameters<typeof planCtaState>[1];
  onSubscribe?: (tier: SubscriptionTier) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const off = yearlyOffPercent(plan);
  const credits = plan.credits_per_month.toLocaleString('en-US');
  const rows = usageEquivalents(plan.credits_per_month, usageUnits);
  const ctaState = planCtaState(plan.tier, currentTier);

  const perks = [
    t('plan.perks.credits', { n: credits }),
    t(`plan.perks.${plan.tier}.r2`),
    t(`plan.perks.${plan.tier}.r3`),
    t(`plan.perks.${plan.tier}.r4`),
  ];

  return (
    <div
      data-tier={plan.tier}
      className={`relative flex min-w-0 flex-1 flex-col overflow-clip rounded-[20px] ${TIER_SURFACE[plan.tier]}`}
    >
      {/* 卡面顶部白色高光,纯装饰层 */}
      <div aria-hidden className="upsell-card-sheen pointer-events-none absolute inset-0 rounded-[20px]" />

      {/* 上半块吸收卡内剩余高度,内部再由积分面板吸收 —— 三张卡的等价行条数不同
          (Starter 3 条 / 其余 4 条),不这么撑的话价格行与 CTA 会逐卡错位 */}
      <div data-block="top" className="relative flex flex-1 flex-col gap-3 px-4 pt-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-[6px] gap-y-1">
            <span className="font-display text-[20px] uppercase leading-7 tracking-[-1.2px] text-[var(--upsell-text)]">
              {tierDisplayName(plan.tier)}
            </span>
            {off != null && (
              <span className="upsell-badge upsell-badge-off"><span>{t('plan.off', { p: off })}</span></span>
            )}
            {(plan.tier === 'creator' || plan.tier === 'master') && (
              <span className="upsell-badge upsell-badge-blue">
                <span>{t(plan.tier === 'creator' ? 'plan.recommended' : 'plan.bestValue')}</span>
              </span>
            )}
          </div>
          <span className="text-[12px] leading-[18px] text-[var(--upsell-text-muted)]">
            {t(`plan.tagline.${plan.tier}`)}
          </span>
        </div>

        <div data-panel="credits" className="flex flex-1 flex-col gap-3 rounded-[12px] bg-[var(--upsell-panel)] p-3">
          <div data-fill="usage" className="flex flex-1 flex-col gap-[6px]">
            <span className="flex items-center gap-2 text-[var(--upsell-text)]">
              <FigIcon src={figAsset.sparkle} size={16} tone="primary" />
              <span className="text-[14px] font-bold leading-5 tracking-[0.1px]">
                {t('plan.credits', { n: credits })}
              </span>
            </span>
            <div className="flex flex-col pl-7 text-[12px] leading-4 tracking-[0.18px] text-[var(--upsell-text-muted)]">
              <span>{t('plan.goesAsFar')}</span>
              {rows.map((r) => (
                <span key={r.key}>{t(`plan.usage.${r.key}`, { n: r.count.toLocaleString('en-US') })}</span>
              ))}
            </div>
          </div>
          {/* 「每月固定 N 积分」:语义是当期有效不结转;数值与上方同源 */}
          <span className="flex h-[38px] items-center justify-center gap-2 rounded-[8px] border border-[var(--upsell-panel)] px-[9px] text-[var(--upsell-text-muted)]">
            <FigIcon src={figAsset.check} size={16} tone="primary" />
            <span className="text-[12px] leading-[18px]">{t('plan.fixedAmount', { n: credits })}</span>
          </span>
        </div>

        {/* 价格行:三段同基线一行排(稿上如此)。339px 卡宽下 en 文案刚好放得下——
            间距收到 2px、后缀不加字距就是为这 6px 余量;更长的语言(de/fr)放不下时
            由 flex-wrap 把后缀整体挪到下一行,不会把句子从中间劈开。 */}
        <div className="flex flex-wrap items-end gap-x-[2px]">
          {off != null && (
            <span className="upsell-strike whitespace-nowrap text-[19px] font-semibold leading-[29px] text-[var(--upsell-promo)]">
              {formatUsd(plan.monthly_price_cents, { compact: true })}
            </span>
          )}
          <span className="whitespace-nowrap text-[32px] font-semibold leading-none text-[var(--upsell-text)]">
            {formatUsd(plan.yearly_monthly_price_cents, { compact: true })}
          </span>
          <span className="whitespace-nowrap pb-[2px] text-[12px] leading-4 text-[var(--upsell-text-muted)]">
            {t('plan.perMonthAnnual')}
          </span>
        </div>
      </div>

      <div className="relative flex flex-col gap-4 px-3 pb-6 pt-3">
        <div className="rounded-[12px] border border-[var(--upsell-panel)] bg-[var(--upsell-panel)] p-px">
          <PlanKey
            state={ctaState}
            tier={plan.tier}
            busy={busy}
            label={
              ctaState === 'current' ? t('plan.cta.current')
                : ctaState === 'included' ? t('plan.cta.included')
                  // 主推档(Creator)文案用「升级到 X」,其余用「获取 X」——与设计稿一致
                  : t(plan.tier === 'creator' ? 'plan.cta.upgrade' : 'plan.cta.get', { name: tierDisplayName(plan.tier) })
            }
            onClick={() => onSubscribe?.(plan.tier)}
          />
        </div>

        <ul className="flex flex-col gap-1">
          {perks.map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-1 ${i === 0 ? 'text-[var(--upsell-perk-hi)]' : 'text-[var(--upsell-text)]'}`}
            >
              <FigIcon src={figAsset.check} size={16} tone="primary" />
              <span className="text-[12px] leading-4 tracking-[0.18px]">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PlanKey({
  state, tier, label, busy, onClick,
}: {
  state: PlanCtaState;
  tier: SubscriptionTier;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  // 只允许升档:当前档与更低档一律禁用(降档/退订走主站会员管理页)
  const disabled = state !== 'upgrade' || busy;
  const fill = state === 'upgrade' ? TIER_KEY[tier] : 'upsell-key-off';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`upsell-key h-12 w-full rounded-[10px] text-[14px] font-bold leading-4 tracking-[0.24px] transition-[filter,transform] duration-150 ease-out hover:brightness-105 disabled:cursor-not-allowed disabled:hover:brightness-100 motion-safe:active:scale-[0.98] ${fill}`}
    >
      {label}
    </button>
  );
}
