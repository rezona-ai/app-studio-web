'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRequestClose } from '@/client/useRequestClose';
import { useSubscribeFlow } from '@/client/useSubscribeFlow';
import IconButton from '@/components/ui/IconButton';
import PlanCardPaywall from '@/components/ui/PlanCardPaywall';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { SubscriptionPlan, SubscriptionPlansData } from '@/lib/biz/types';
import { formatUsd } from '@/lib/topup';
import { nextTier } from '@/lib/subscription/plan-display';

// 模型锁定弹窗(spec 2026-08-31-model-lock-modal-design)。形态与取值对齐主站
// rezona-lab 的 GameModelLockedPopup(= PaywallBody + hero={null}):
//   640 宽恒暗面板 · 无 hero(设计还没给,故**没有大标题**——主站标题是烘焙在 hero 图里的
//   艺术字,不是文本节点) · 说明行 · 单档卡(月付口径) · See all plans · 橙键帽 CTA。
//
// 整窗恒暗、色一律取 --upsell-* 令牌(与三档窗同一批稿面色);不摆余额与资产进度卡:
// 那两块讲的是「积分不够」,与本弹窗的「解锁其余模型」无关。
//
// 与主站的两处刻意差异(本项目没有定价页路由,见 spec):
//   ① CTA 直接走订阅流下单(主站是存 checkout intent 再跳 /studio/pricing);
//   ② See all plans 开本项目的三档并排弹窗(主站也是跳定价页)。

export interface ModelLockModalProps {
  /** null = 套餐配置未就绪(载入中或失败);载入中由上层 Gate 决定不渲染 */
  plans: SubscriptionPlansData | null;
  onClose: () => void;
  onRetryPlans: () => void;
  onSeeAllPlans: () => void;
}

export default function ModelLockModal({ plans, onClose, onRetryPlans, onSeeAllPlans }: ModelLockModalProps) {
  const { t } = useTranslation();
  const { closing, requestClose } = useRequestClose(onClose, 200);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 目标档 = 当前档的下一档(锁只在 free 生效,故常态是 Starter)。缺档不在这里兜:
  // 上层 Gate 判 targetMissing 后改开三档并排,本组件拿到的 plans 必然含目标档。
  const target = plans ? nextTier(plans.current_tier) : null;
  const targetPlan = target ? plans?.plans.find((p) => p.tier === target) ?? null : null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-[var(--upsell-scrim)] p-8 backdrop-blur-[6px]"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={t('upsell.descModelLocked')}
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        // 稿宽 640(主站 PAYWALL_MODAL_WIDTH);恒暗面板 + 0.5px 白描边,与三档窗同一套壳
        className="modal-pop relative flex w-[min(640px,100%)] max-h-full flex-col overflow-y-auto rounded-[24px] border-[0.5px] border-[var(--upsell-line)] bg-[var(--upsell-surface)] shadow-[var(--shadow-popover)] scrollbar-auto"
      >
        {/* 无 hero:关闭钮直接浮在面板右上角(主站同样由外壳补一枚真按钮,而不是图上的热区) */}
        <IconButton
          aria-label={t('common.close')}
          onClick={requestClose}
          className="absolute right-4 top-4 z-10 size-8 rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <FigIcon src={figAsset.close} size={16} tone="primary" />
        </IconButton>

        {/* 无 hero 时顶部要自己留出白,否则正文贴着面板上沿(主站 56px) */}
        <div className="flex w-full flex-col gap-3 px-8 pb-8 pt-14">
          <p className="w-full text-center text-[16px] leading-6 tracking-[0.015em] text-[var(--upsell-text-2)]">
            {t('upsell.descModelLocked')}
          </p>

          {plans == null && <PlansFallback onRetry={onRetryPlans} />}

          {plans != null && targetPlan != null && (
            <PlanBody plans={plans} plan={targetPlan} requestClose={requestClose} onSeeAllPlans={onSeeAllPlans} />
          )}
        </div>
      </div>
    </div>
  );
}

function PlanBody({
  plans, plan, requestClose, onSeeAllPlans,
}: {
  plans: SubscriptionPlansData;
  plan: SubscriptionPlan;
  requestClose: () => void;
  onSeeAllPlans: () => void;
}) {
  const { t } = useTranslation();
  const { phase, subscribe } = useSubscribeFlow({
    trigger: 'modelLocked',
    currentTier: plans.current_tier,
    requestClose,
  });

  // CTA 文案与主站 upgradeCtaCopy 同判据:可享首期优惠时打首月价钩子,否则退回常规月价。
  // dev 实测 intro 已开(starter 首月 $9.60),故常态走首月价分支;后端关掉 intro 时自动退回月价。
  const intro = plans.intro_eligible && plan.intro_price_cents != null && plan.intro_price_cents > 0
    ? plan.intro_price_cents
    : null;

  return (
    <>
      <PlanCardPaywall plan={plan} usageUnits={plans.usage_units} />

      <button
        type="button"
        onClick={onSeeAllPlans}
        className="mx-auto flex items-center gap-1 py-1 text-[14px] leading-[18px] tracking-[0.015em] text-[var(--upsell-text-2)] transition-opacity hover:opacity-80"
      >
        {t('upsell.seeAllPlans')}
      </button>

      <button
        type="button"
        autoFocus
        disabled={phase !== 'idle'}
        onClick={() => void subscribe(plan.tier)}
        className="upsell-key upsell-key-orange flex h-14 w-full items-center justify-center rounded-[8px] text-[16px] font-semibold leading-6 tracking-[0.015em] transition-[transform,opacity] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 motion-safe:active:scale-[0.99]"
      >
        {phase === 'active' ? t('upsell.ctaActive')
          : phase !== 'idle' ? t('topup.waiting')
            : intro != null
              ? t('upsell.ctaPaywallIntro', { price: formatUsd(intro, { compact: true }) })
              : t('upsell.ctaPaywall', { price: formatUsd(plan.monthly_price_cents, { compact: true }) })}
      </button>
    </>
  );
}

// 套餐配置未就绪时的失败态(载入中由上层决定不渲染)。恒暗版,不复用随主题翻的那份。
function PlansFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-[16px] border-[0.5px] border-[var(--upsell-line)] bg-[var(--upsell-panel)] py-8">
      <span className="text-[13px] text-[var(--upsell-text-muted)]">{t('topup.loadFailed')}</span>
      <button
        type="button"
        onClick={onRetry}
        className="h-9 rounded-[10px] px-4 text-[13px] font-medium text-[var(--upsell-text)] transition-opacity hover:opacity-80"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}
