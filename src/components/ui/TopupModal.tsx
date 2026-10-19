'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { useTopupFlow } from '@/client/useTopupFlow';
import IconButton from '@/components/ui/IconButton';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { assetPath } from '@/lib/basePath';
import type { TopupPackage } from '@/lib/biz/types';
import {
  formatUsd, couponPercent, formatCountdown, creditsPerUsd, estimateCustomCredits,
} from '@/lib/topup';
import { triggerDimension } from '@/lib/subscription/plan-display';
import { formatCreditExact } from '@/lib/user-display';

// 充值弹窗(Figma 3625:38237 / 6180:109915):余额卡 + 首充券横幅 + 档位网格 + 结算条。
// 两条可达路径:顶档(Max)升购弹窗的「View all pricing options」,以及 Max 用户点预览区积分块
// (2026-08-12 手动入口回归)。故开关是自己的 topupModalOpen,埋点 trigger 取 store 里的真实来源。
// 支付/配置/倒计时逻辑共享 useTopupFlow。

// 自定义充值金额下限(美元):产品约束,低于该值不允许建单(Meegle 13559729)
const MIN_CUSTOM_USD = 5;

export default function TopupModal() {
  const setOpen = useStore((s) => s.setTopupModalOpen);
  const credit = useStore((s) => s.credit);
  const { closing, requestClose } = useRequestClose(() => setOpen(false), 200);
  const { t } = useTranslation();
  // 埋点 trigger 跟真实来源走(generate / low_balance / manual),不再恒 generate
  const trigger = triggerDimension(useStore((s) => s.topupTrigger));

  const [selected, setSelected] = useState<string | null>(null);   // 档位 id 或 'custom'
  const [customUsd, setCustomUsd] = useState('');

  const { options, loadFailed, reload, coupon, expiresMs, now, phase, recharge, cancelOrder } = useTopupFlow({
    trigger,
    requestClose,
    // 默认选中首档;重拉后已选档位若仍存在则保持,消失则回落首档
    onLoaded: (data) => setSelected((prev) => (
      prev != null && (prev === 'custom' || data.packages.some((p) => p.id === prev))
        ? prev
        : (data.packages[0]?.id ?? 'custom')
    )),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const packages = options?.packages ?? [];
  const selectedPkg = selected !== 'custom' ? packages.find((p) => p.id === selected) ?? null : null;
  const customAmt = Number.parseInt(customUsd, 10);
  const customValid = Number.isInteger(customAmt) && customAmt >= MIN_CUSTOM_USD;
  // 已输入但低于下限:结算条给出最低金额提示(空输入不提示,避免刚点开就报错观感)
  const customBelowMin = selected === 'custom' && customUsd !== '' && !customValid;
  const rate = creditsPerUsd(packages);
  const customCredits = customValid ? estimateCustomCredits(customAmt, rate) : null;

  // 结算条汇总:档位取后端报价字段;自定义金额无券后报价接口,只展示原价 + 估算积分(spec 决策 1)
  const summary = selectedPkg
    ? {
        strike: selectedPkg.discount_cents > 0 ? formatUsd(selectedPkg.amount_cents) : null,
        total: formatUsd(selectedPkg.discounted_amount_cents),
        credits: t('topup.credits', { n: selectedPkg.credits.toLocaleString('en-US') }),
      }
    : selected === 'custom' && customValid
      ? {
          strike: null,
          total: formatUsd(customAmt * 100),
          credits: customCredits != null ? t('topup.creditsEstimate', { n: customCredits.toLocaleString('en-US') }) : '',
        }
      : null;

  const ctaDisabled = !options || phase !== 'idle' || (selected === 'custom' ? !customValid : !selectedPkg);

  const onRecharge = () => {
    if (ctaDisabled) return;
    void recharge(selectedPkg
      ? { package_id: selectedPkg.id, idempotency_key: crypto.randomUUID() }
      : { amount_usd: customAmt, idempotency_key: crypto.randomUUID() });
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={t('topup.title')}
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[min(1077px,100%)] max-h-full flex-col gap-3 overflow-y-auto rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] p-8 shadow-[var(--shadow-popover)] scrollbar-auto"
      >
        {/* 头部:装饰性 "> " 前缀 + 标题(CSS uppercase,中文等语言 no-op)+ 关闭 */}
        <div className="flex w-full items-center justify-between">
          <span className="text-[10px] font-extrabold uppercase leading-3 text-[var(--color-primary)]">
            {'> '}{t('topup.title')}
          </span>
          <IconButton aria-label={t('common.close')} onClick={requestClose} className="size-8">
            <FigIcon src={figAsset.close} size={16} tone="primary" />
          </IconButton>
        </div>

        {/* 余额卡:取 spendable,与账户条同口径(理由见 BalanceData 注释)——
            同一次点击就能从升购窗切到这里,两处显示不同数字比什么都糟 */}
        <div className="relative w-full rounded-[16px] border-2 border-[var(--color-primary)] bg-[var(--color-shell)] px-8 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.18px] text-[var(--color-primary)]">
              {t('topup.balanceLabel')}
            </span>
            <span className="flex items-baseline gap-3 text-[var(--color-ink)]">
              <span className="text-[64px] font-extrabold leading-none">{formatCreditExact(credit?.spendable)}</span>
              <span className="text-[18px] leading-none">{t('topup.creditsUnit')}</span>
            </span>
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[var(--shadow-topup-balance)]" />
        </div>

        {/* 首充券横幅:仅有券时显示 */}
        {coupon && expiresMs != null && (
          <div className="relative flex w-full items-center gap-12 overflow-clip rounded-[16px] border border-[var(--color-line-strong)] px-12 py-[14px]">
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--color-promo-banner)]">
              <img
                alt=""
                src={assetPath('/figma/topup-banner.jpg')}
                className="size-full rounded-[inherit] object-cover opacity-80 mix-blend-soft-light"
              />
            </div>
            <p className="relative min-w-0 flex-1 text-[18px] font-semibold leading-7 tracking-[0.2808px] text-[var(--color-ink)]">
              {t('topup.couponLead')}{' • '}
              <span className="text-[var(--color-primary)]">
                {t('topup.couponOff', {
                  percent: couponPercent(coupon.pay_rate_bps),
                  max: formatUsd(coupon.max_discount_cents, { compact: true }),
                })}
              </span>
            </p>
            {/* 倒计时 chip:新稿(6180:109915)改为品牌橙实底 + 亮橙内高光,文字/图标恒白;旧稿的促销粉只留给 SAVE chip */}
            <div className="relative flex w-[209px] shrink-0 items-center justify-center gap-1 overflow-clip rounded-[12px] bg-[var(--color-primary)] px-4 py-2 text-white">
              <FigIcon src={figAsset.timer} size={20} tone="primary" />
              <span className="text-[18px] font-semibold leading-7 tracking-[0.2808px] tabular-nums">
                {formatCountdown(expiresMs - now)}
              </span>
              <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[var(--shadow-topup-timer)]" />
            </div>
          </div>
        )}

        {/* 档位网格:载入骨架 / 失败重试 / 数据卡片 + 自定义 */}
        {!options && !loadFailed && (
          <div className="flex w-full items-stretch gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[88px] min-w-0 flex-1 animate-pulse rounded-[16px] bg-[var(--color-fill)] motion-reduce:animate-none" />
            ))}
          </div>
        )}
        {loadFailed && (
          <div className="flex w-full flex-col items-center gap-3 rounded-[16px] border border-[var(--color-line-strong)] bg-[var(--color-shell)] py-8">
            <span className="text-[13px] text-[var(--color-muted)]">{t('topup.loadFailed')}</span>
            <button
              type="button"
              onClick={() => void reload()}
              className="h-9 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-fill)]"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {options && (
          <div className="flex w-full items-stretch gap-4">
            {packages.map((p) => (
              <PackageCard
                key={p.id}
                pkg={p}
                selected={selected === p.id}
                onSelect={() => setSelected(p.id)}
                saveLabel={p.discount_cents > 0 ? t('topup.save', { amount: formatUsd(p.discount_cents) }) : null}
                creditsLabel={t('topup.credits', { n: p.credits.toLocaleString('en-US') })}
              />
            ))}
            {/* 自定义档:选中后卡内换成整数美元输入 */}
            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setSelected('custom')}
                aria-pressed={selected === 'custom'}
                className={`relative flex h-full w-full flex-col items-center justify-center gap-2.5 overflow-clip rounded-[16px] p-5 transition-colors ${
                  selected === 'custom'
                    ? 'border-[1.5px] border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_15%,var(--color-shell))] shadow-[var(--shadow-topup-select)]'
                    : 'border border-dashed border-[var(--color-line-strong)] bg-[var(--color-shell)] hover:border-[var(--color-primary)]'
                }`}
              >
                {selected === 'custom' ? (
                  <span className="flex w-full items-baseline gap-1 text-[18px] font-semibold leading-7 tracking-[0.2808px] text-[var(--color-ink)]">
                    $
                    <input
                      autoFocus
                      value={customUsd}
                      onChange={(e) => setCustomUsd(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onClick={(e) => e.stopPropagation()}
                      inputMode="numeric"
                      placeholder={String(MIN_CUSTOM_USD)}
                      aria-label={t('topup.customAmountLabel')}
                      className="w-full min-w-0 bg-transparent font-semibold text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
                    />
                  </span>
                ) : (
                  <>
                    <FigIcon src={figAsset.plus} size={24} tone="primary" />
                    <span className="text-[18px] font-semibold leading-7 tracking-[0.2808px] text-[var(--color-ink)]">
                      {t('topup.customize')}
                    </span>
                  </>
                )}
                <CardGlow />
              </button>
            </div>
          </div>
        )}

        {/* 结算条 */}
        <div className="flex min-h-[68px] w-full items-center justify-between gap-4 rounded-[16px] bg-[var(--color-shell)] px-6 py-3">
          {phase === 'waiting' ? (
            <span className="min-w-0 text-[13px] leading-5 text-[var(--color-muted)]">{t('topup.waitingHint')}</span>
          ) : (
            <span className="flex min-w-0 items-center gap-3 whitespace-nowrap">
              {summary?.strike && (
                <span className="text-[18px] leading-none text-[var(--color-muted)] line-through">{summary.strike}</span>
              )}
              <span className="text-[32px] font-bold leading-none text-[var(--color-ink)]">{summary?.total ?? '—'}</span>
              {customBelowMin && (
                <span className="text-[13px] leading-5 text-[var(--color-muted)]">
                  {t('topup.customMin', { min: formatUsd(MIN_CUSTOM_USD * 100, { compact: true }) })}
                </span>
              )}
              {summary?.credits && (
                <span className="text-[14px] font-bold leading-4 tracking-[0.2394px] text-[var(--color-primary)]">{summary.credits}</span>
              )}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-2">
            {phase === 'waiting' && (
              <button
                type="button"
                onClick={() => void cancelOrder()}
                className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]"
              >
                {t('topup.cancelOrder')}
              </button>
            )}
            {/* 设计稿 6180:109915 的 CTA:橙底胶囊 + 恒定白字(--color-on-primary-strong),非 .btn-raised 体系。
                深字那条令牌留给橙底小徽章 —— 10px 大写在橙底上深字对比更高 */}
            <button
              type="button"
              autoFocus
              disabled={ctaDisabled}
              onClick={onRecharge}
              className="h-11 rounded-full bg-[var(--color-primary)] px-8 text-[13px] font-bold leading-4 tracking-[0.2223px] text-[var(--color-on-primary-strong)] transition-[transform,opacity,filter] duration-150 ease-out hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-30 motion-safe:active:scale-[0.97]"
            >
              {phase === 'idle' ? t('topup.rechargeNow') : phase === 'paid' ? t('topup.paid') : t('topup.waiting')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// 卡底品牌橙光斑:替代设计稿的模糊椭圆位图(Ellipse 931),纯 CSS 等效
function CardGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-[12px] top-[100px] h-[73px] w-[130px] rounded-full bg-[var(--color-primary)] opacity-35 blur-[40px]"
    />
  );
}

function PackageCard({
  pkg, selected, onSelect, saveLabel, creditsLabel,
}: {
  pkg: TopupPackage;
  selected: boolean;
  onSelect: () => void;
  saveLabel: string | null;
  creditsLabel: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`relative flex h-full w-full flex-col items-start gap-1 overflow-clip rounded-[16px] p-5 text-left transition-colors ${
          selected
            ? 'border-[1.5px] border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_15%,var(--color-shell))] shadow-[var(--shadow-topup-select)]'
            : 'border border-[var(--color-line-strong)] bg-[var(--color-shell)] hover:border-[var(--color-primary)]'
        }`}
      >
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          {pkg.discount_cents > 0 && (
            <span className="text-[12px] leading-4 tracking-[0.18px] text-[var(--color-muted)] line-through">
              {formatUsd(pkg.amount_cents, { compact: true })}
            </span>
          )}
          <span className="text-[18px] font-semibold leading-7 tracking-[0.2808px] text-[var(--color-ink)]">
            {formatUsd(pkg.discounted_amount_cents)}
          </span>
        </span>
        <span className="whitespace-nowrap text-[13px] font-bold leading-4 tracking-[0.2223px] text-[var(--color-primary)]">
          {creditsLabel}
        </span>
        <CardGlow />
      </button>
      {/* SAVE 徽标:骑卡顶边居中,促销粉恒定、文字恒白;点击穿透到卡片 */}
      {saveLabel && (
        <span className="pointer-events-none absolute -top-2 left-1/2 flex h-6 -translate-x-1/2 items-center whitespace-nowrap rounded-full bg-[var(--color-promo)] px-3 text-[12px] font-bold uppercase leading-4 tracking-[0.18px] text-white">
          {saveLabel}
        </span>
      )}
    </div>
  );
}
