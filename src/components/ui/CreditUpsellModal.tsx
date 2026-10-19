'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { useSubscribeFlow, type UpsellTrigger } from '@/client/useSubscribeFlow';
import { useTopupFlow } from '@/client/useTopupFlow';
import IconButton from '@/components/ui/IconButton';
import PlanCard from '@/components/ui/PlanCard';
import UpsellHero from '@/components/ui/UpsellHero';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { SubscriptionPlan, SubscriptionPlansData, TopupPackage } from '@/lib/biz/types';
import { KIND_META, type AssetKind } from '@/lib/asset-kind';
import { nextTier, tierDisplayName, triggerDimension } from '@/lib/subscription/plan-display';
import { formatUsd } from '@/lib/topup';
import { formatCreditExact } from '@/lib/user-display';

// 触发式升购弹窗(设计稿 5952:84375 / 8047:165320 / 8047:167015)。
// hero 跟触发源、主体跟当前档位:
//   低档(free/starter/creator) → 高一级方案单卡 + 全宽升档 CTA
//   顶档(master)               → 三档积分充值卡 + 全宽充值 CTA(复用 useTopupFlow)
// free 实际由上层路由到 AllPlansModal(spec 约束 4),本组件对 free 仍能给出 Starter 卡,
// 故 nextTier 一条路径覆盖全部档位,无需 all_plans 分支。
//
// 本组件纯 props 驱动:plans 的拉取、失败重试、弹窗打开态归 store(T7 接线),
// 便于单测在不碰 store 的前提下覆盖四种档位与两种触发源。

export interface CreditUpsellModalProps {
  source: UpsellTrigger;
  /** 触发生成的资产类型;agent 侧触发拿不到,为 null 时进度卡退化成纯余额行 */
  kind: AssetKind | null;
  /** null = 套餐配置未就绪(载入中或失败),主体渲染失败态 + 重试 */
  plans: SubscriptionPlansData | null;
  onClose: () => void;
  onRetryPlans: () => void;
  onSeeAllPlans: () => void;
  onViewAllPricing: () => void;
}

export default function CreditUpsellModal({
  source, kind, plans, onClose, onRetryPlans, onSeeAllPlans, onViewAllPricing,
}: CreditUpsellModalProps) {
  const { t } = useTranslation();
  const { closing, requestClose } = useRequestClose(onClose, 200);
  const credit = useStore((s) => s.credit);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const target = plans ? nextTier(plans.current_tier) : null;
  const targetPlan = target ? plans?.plans.find((p) => p.tier === target) ?? null : null;
  // 只有顶档(nextTier 为 null)走充值。目标档缺失(后端少配一档)不在这里兜——上层 Gate 会
  // 判 targetMissing 并改开三档并排弹窗(终审 I4),故本组件拿到的 plans 必然含目标档。
  const isTopup = plans != null && target == null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={t(source === 'insufficient' ? 'upsell.descInsufficient' : 'upsell.descLowBalance', { n: formatCreditExact(credit?.balance) })}
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        // 稿宽 640(5952:84375 / 8047:167015)。hero 的宝箱落位与字标偏移全按 640 折算,
        // 壳一旦放宽,整个 hero 的缩放与文案位置就走样(2026-08-12 实测,曾误写 1169)
        className="modal-pop flex w-[min(640px,100%)] max-h-full flex-col overflow-y-auto rounded-[24px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] scrollbar-auto"
      >
        <UpsellHero variant={source === 'insufficient' ? 'insufficient' : 'lowBalance'}>
          <IconButton
            aria-label={t('common.close')}
            onClick={requestClose}
            className="absolute right-4 top-4 size-8 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <FigIcon src={figAsset.close} size={16} tone="primary" />
          </IconButton>
        </UpsellHero>

        <div className="flex w-full flex-col gap-4 px-8 pb-8 pt-4">
          <NeedCard kind={kind} balance={credit?.balance} />

          <p className="w-full text-center text-[16px] leading-6 tracking-[0.24px] text-[var(--color-muted)]">
            {t(source === 'insufficient' ? 'upsell.descInsufficient' : 'upsell.descLowBalance', {
              n: formatCreditExact(credit?.balance),
            })}
          </p>

          {plans == null && <PlansFallback onRetry={onRetryPlans} />}

          {isTopup && <TopupBody source={source} requestClose={requestClose} onViewAllPricing={onViewAllPricing} />}

          {plans != null && targetPlan != null && (
            <PlanBody
              plans={plans}
              plan={targetPlan}
              source={source}
              requestClose={requestClose}
              onSeeAllPlans={onSeeAllPlans}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// 进度卡:设计稿要「20 / 120 · 100 short」,但后端积分不足信号不携带所需积分数,
// 故只渲染能拿到的部分——资产类型 + 当前余额(spec 约束 9)。字段到位后在此补进度条。
function NeedCard({ kind, balance }: { kind: AssetKind | null; balance: number | undefined }) {
  const { t } = useTranslation();
  const meta = kind ? KIND_META[kind] : null;
  return (
    <div className="flex w-full items-center gap-4 rounded-[16px] bg-[var(--color-shell)] px-4 py-3">
      {meta && (
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: `color-mix(in srgb, ${meta.colorVar} 20%, transparent)` }}
        >
          <FigIcon src={meta.icon} size={20} tone="original" />
        </span>
      )}
      {kind && (
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-[var(--color-ink)]">
          {t(`canvas.assetKind.${kind}`)}
        </span>
      )}
      <span className={`text-[14px] font-bold leading-5 text-[var(--color-primary)] ${kind ? '' : 'flex-1 text-center'}`}>
        {t('upsell.balance', { n: formatCreditExact(balance) })}
      </span>
    </div>
  );
}

function PlansFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-[16px] border border-[var(--color-line-strong)] bg-[var(--color-shell)] py-8">
      <span className="text-[13px] text-[var(--color-muted)]">{t('topup.loadFailed')}</span>
      <button
        type="button"
        onClick={onRetry}
        className="h-9 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-fill)]"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}

function PlanBody({
  plans, plan, source, requestClose, onSeeAllPlans,
}: {
  plans: SubscriptionPlansData;
  plan: SubscriptionPlan;
  source: UpsellTrigger;
  requestClose: () => void;
  onSeeAllPlans: () => void;
}) {
  const { t } = useTranslation();
  const { phase, subscribe } = useSubscribeFlow({
    trigger: source,
    currentTier: plans.current_tier,
    requestClose,
  });
  const name = tierDisplayName(plan.tier);

  return (
    <>
      <PlanCard plan={plan} usageUnits={plans.usage_units} />

      <button
        type="button"
        onClick={onSeeAllPlans}
        className="mx-auto flex items-center gap-1 text-[14px] leading-[18px] tracking-[0.22px] text-[var(--color-ink)] transition-colors hover:text-[var(--color-primary)]"
      >
        {t('upsell.seeAllPlans')}
        <FigIcon src={figAsset.arrowRight} size={14} tone="primary" />
      </button>

      {/* 全宽 CTA:设计稿写「Upgrade - $2.99 first month」,但后端 intro_price_cents 恒 0,
          故回落常规年付月单价。后端把 intro 打开(>0)时这里换成首期价文案即可,不必改结构。 */}
      <button
        type="button"
        autoFocus
        disabled={phase !== 'idle'}
        onClick={() => void subscribe(plan.tier)}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-8 py-4 text-[16px] font-semibold leading-6 tracking-[0.24px] text-[var(--color-on-primary-strong)] transition-[transform,opacity,filter] duration-150 ease-out hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-30 motion-safe:active:scale-[0.99]"
      >
        {phase === 'active' ? t('upsell.ctaActive')
          : phase !== 'idle' ? t('topup.waiting')
            : t('upsell.cta', { name, price: formatUsd(plan.yearly_monthly_price_cents, { compact: true }) })}
      </button>
    </>
  );
}

// 顶档(Max)分支:沿用既有三档充值卡形态与 useTopupFlow;埋点 trigger 按真实触发源给
// (2026-08-12 前恒 generate,低余额触发也报成 generate,属口径错)
function TopupBody({ source, requestClose, onViewAllPricing }: { source: UpsellTrigger; requestClose: () => void; onViewAllPricing: () => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const { options, loadFailed, reload, phase, recharge, cancelOrder } = useTopupFlow({
    trigger: triggerDimension(source),
    requestClose,
    // 默认选中中间档(设计稿高亮中间档);不足两档回落首档,重拉后已选档位消失同样回落
    onLoaded: (data) => setSelected((prev) => (
      prev != null && data.packages.some((p) => p.id === prev)
        ? prev
        : (data.packages[1]?.id ?? data.packages[0]?.id ?? null)
    )),
  });

  const packages = options?.packages ?? [];
  const selectedPkg = packages.find((p) => p.id === selected) ?? null;
  // topup_allowed 是后端强校验项;顶档理论恒 true,false 时禁用 CTA 并说明,不静默下单
  const allowed = options?.topup_allowed !== false;
  const ctaDisabled = !options || !allowed || phase !== 'idle' || !selectedPkg;

  return (
    <>
      {!options && !loadFailed && (
        <div className="flex w-full items-stretch gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-[136px] min-w-0 flex-1 animate-pulse rounded-[16px] bg-[var(--color-fill)] motion-reduce:animate-none" />
          ))}
        </div>
      )}
      {loadFailed && <PlansFallback onRetry={() => void reload()} />}
      {options && (
        <div className="flex w-full items-stretch gap-3 pt-2">
          {packages.map((p, i) => (
            <TopupPackageCard
              key={p.id}
              pkg={p}
              selected={selected === p.id}
              onSelect={() => setSelected(p.id)}
              saveLabel={p.discount_cents > 0 ? t('topup.save', { amount: formatUsd(p.discount_cents) }) : null}
              creditsLabel={t('topup.credits', { n: p.credits.toLocaleString('en-US') })}
              exampleLines={i < 3 ? t(`insufficient.examples.p${i as 0 | 1 | 2}`) : null}
            />
          ))}
        </div>
      )}

      {!allowed && (
        <p className="w-full text-center text-[13px] leading-5 text-[var(--color-muted)]">{t('upsell.topupDisabled')}</p>
      )}

      <button
        type="button"
        onClick={onViewAllPricing}
        className="mx-auto flex items-center gap-1 text-[14px] leading-[18px] tracking-[0.22px] text-[var(--color-ink)] transition-colors hover:text-[var(--color-primary)]"
      >
        {t('insufficient.viewAll')}
        <FigIcon src={figAsset.arrowRight} size={14} tone="primary" />
      </button>

      <button
        type="button"
        autoFocus
        disabled={ctaDisabled}
        onClick={() => {
          if (ctaDisabled || !selectedPkg) return;
          void recharge({ package_id: selectedPkg.id, idempotency_key: crypto.randomUUID() });
        }}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-8 py-4 text-[16px] font-semibold leading-6 tracking-[0.24px] text-[var(--color-on-primary-strong)] transition-[transform,opacity,filter] duration-150 ease-out hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-30 motion-safe:active:scale-[0.99]"
      >
        {phase === 'paid' ? t('topup.paid') : phase !== 'idle' ? t('topup.waiting') : (
          <>
            {t('topup.rechargeNow')}
            {selectedPkg && (
              <span className="flex items-baseline gap-1.5">
                {' - '}
                {selectedPkg.discount_cents > 0 && (
                  <span className="line-through opacity-70">{formatUsd(selectedPkg.amount_cents, { compact: true })}</span>
                )}
                {formatUsd(selectedPkg.discounted_amount_cents)}
              </span>
            )}
          </>
        )}
      </button>
      {phase === 'waiting' && (
        <div className="flex w-full items-center justify-center gap-3">
          <span className="text-[13px] leading-5 text-[var(--color-muted)]">{t('topup.waitingHint')}</span>
          <button
            type="button"
            onClick={() => void cancelOrder()}
            className="h-8 shrink-0 rounded-[10px] px-3 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]"
          >
            {t('topup.cancelOrder')}
          </button>
        </div>
      )}
    </>
  );
}

function TopupPackageCard({
  pkg, selected, onSelect, saveLabel, creditsLabel, exampleLines,
}: {
  pkg: TopupPackage;
  selected: boolean;
  onSelect: () => void;
  saveLabel: string | null;
  creditsLabel: string;
  exampleLines: string | null;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`relative flex h-full w-full flex-col items-start gap-3 overflow-clip rounded-[16px] p-5 text-left transition-colors ${
          selected
            ? 'border-[1.5px] border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_15%,var(--color-shell))] shadow-[var(--shadow-topup-select)]'
            : 'border border-[var(--color-line-strong)] bg-[var(--color-shell)] hover:border-[var(--color-primary)]'
        }`}
      >
        <span className="flex flex-col items-start gap-1">
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            {pkg.discount_cents > 0 && (
              <span className="text-[14px] font-semibold leading-5 tracking-[0.22px] text-[var(--color-muted)] line-through">
                {formatUsd(pkg.amount_cents, { compact: true })}
              </span>
            )}
            <span className="text-[24px] font-semibold leading-9 tracking-[0.35px] text-[var(--color-ink)]">
              {formatUsd(pkg.discounted_amount_cents)}
            </span>
          </span>
          <span className="whitespace-nowrap text-[14px] font-bold leading-4 tracking-[0.2394px] text-[var(--color-primary)]">
            {creditsLabel}
          </span>
        </span>
        {exampleLines && (
          <span className="whitespace-pre-line text-[10px] leading-3 tracking-[0.15px] text-[var(--color-muted)]">
            {exampleLines}
          </span>
        )}
      </button>
      {saveLabel && (
        <span className="pointer-events-none absolute -top-3 right-6 flex h-6 items-center whitespace-nowrap rounded-full bg-[var(--color-promo)] px-3 text-[12px] font-bold uppercase leading-4 tracking-[0.18px] text-white">
          {saveLabel}
        </span>
      )}
    </div>
  );
}
