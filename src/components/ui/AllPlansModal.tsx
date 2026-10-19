'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { useSubscribeFlow, type UpsellTrigger } from '@/client/useSubscribeFlow';
import IconButton from '@/components/ui/IconButton';
import PlanCardDark from '@/components/ui/PlanCardDark';
import UpsellHero from '@/components/ui/UpsellHero';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { SubscriptionPlansData } from '@/lib/biz/types';
import { formatCreditExact } from '@/lib/user-display';

// 完整订阅弹窗(设计稿 9433:70184):UPGRADE FOR MORE hero + 说明行 + 三档并排。
// 两条入口:free 用户被触发时直接开这张(2026-08-11 spec 约束 4),以及单卡弹窗的「See all plans」。
// 整窗**恒暗**(不随 data-theme 翻),色一律取 --upsell-* 令牌(2026-08-12 spec 约束 1)。
// hero 与说明行都**不跟触发源走**:hero 恒 UPGRADE FOR MORE,说明行恒转化口径那句
// (2026-08-12 spec 约束 4)——这张窗的语义是「摆出全部档位」,不是「解释这次为什么失败」。
// 只允许升档:当前档 CTA 置「Current plan」、更低档置「Included」,均禁用;
// 降档 / 退订走主站会员管理页,不塞进升购弹窗。

export interface AllPlansModalProps {
  source: UpsellTrigger;
  /** null = 套餐配置未就绪(载入中或失败) */
  plans: SubscriptionPlansData | null;
  onClose: () => void;
  onRetryPlans: () => void;
}

export default function AllPlansModal({ source, plans, onClose, onRetryPlans }: AllPlansModalProps) {
  const { t } = useTranslation();
  const { closing, requestClose } = useRequestClose(onClose, 200);
  const credit = useStore((s) => s.credit);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const desc = t('upsell.descAllPlans', { n: formatCreditExact(credit?.balance) });

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-[var(--upsell-scrim)] p-16 backdrop-blur-[6px]"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={desc}
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex max-h-full w-[min(1106px,100%)] flex-col gap-4 overflow-y-auto rounded-[24px] border-[0.5px] border-[var(--upsell-line)] bg-[var(--upsell-surface)] scrollbar-auto"
      >
        <UpsellHero variant="upgradeForMore">
          <IconButton
            aria-label={t('common.close')}
            onClick={requestClose}
            className="absolute right-4 top-4 size-8 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <FigIcon src={figAsset.close} size={16} tone="primary" />
          </IconButton>
        </UpsellHero>

        <p className="w-full px-8 text-center text-[16px] leading-6 tracking-[0.24px] text-[var(--upsell-text-2)]">
          {desc}
        </p>

        <div className="flex w-full px-8 pb-8">
          {plans == null
            ? <Fallback onRetry={onRetryPlans} />
            : <PlanGrid plans={plans} source={source} requestClose={requestClose} onRetryPlans={onRetryPlans} />}
        </div>
      </div>
    </div>
  );
}

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-[20px] bg-[var(--upsell-panel)] py-8">
      <span className="text-[13px] text-[var(--upsell-text-muted)]">{t('topup.loadFailed')}</span>
      <button
        type="button"
        onClick={onRetry}
        className="h-9 rounded-[10px] px-4 text-[13px] font-medium text-[var(--upsell-text)] transition-colors hover:bg-[var(--upsell-panel)]"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}

function PlanGrid({
  plans, source, requestClose, onRetryPlans,
}: {
  plans: SubscriptionPlansData;
  source: UpsellTrigger;
  requestClose: () => void;
  onRetryPlans: () => void;
}) {
  const { phase, subscribe } = useSubscribeFlow({
    trigger: source,
    currentTier: plans.current_tier,
    requestClose,
    from: 'all_plans',
  });

  // 配置异常导致档位为空时给失败态,不渲染空网格
  if (plans.plans.length === 0) return <Fallback onRetry={onRetryPlans} />;

  return (
    <div className="flex w-full items-stretch gap-3">
      {plans.plans.map((p) => (
        <PlanCardDark
          key={p.tier}
          plan={p}
          usageUnits={plans.usage_units}
          currentTier={plans.current_tier}
          onSubscribe={(tier) => void subscribe(tier)}
          busy={phase !== 'idle'}
        />
      ))}
    </div>
  );
}
