'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { userInitial, formatCredit, formatCreditExact } from '@/lib/user-display';
import LanguageMenu from './LanguageMenu';

// 预览区账户条右侧(Figma 1527:33329/33334):credit(品牌橙闪电 + 数字 + 单位)+ 首字母头像。
// 后端 /auth/me 不返回头像 URL,故以首字母作占位头像;userInfo/credit 未就绪时显示 "0"/"?"。
// 数字取 spendable(理由见 lib/pgc/types.ts 的 BalanceData 注释)。
export default function UserInfo() {
  const { t } = useTranslation();
  const userInfo = useStore((s) => s.userInfo);
  const credit = useStore((s) => s.credit);
  const setCreditModalOpen = useStore((s) => s.setCreditModalOpen);
  // 等待态判据全部来自 store:本入口发起的那次(manual)且套餐配置还没到位。
  // 被动触发开着弹窗时不算——那不是本入口发起的,积分块照常可点。
  const pending = useStore((s) => s.creditModalOpen === 'manual' && s.plansCache == null);
  const initial = userInitial(userInfo);
  const name = userInfo?.display_name || userInfo?.username || t('preview.account');
  return (
    // ml-auto 推到账户条右端、min-w-0 允许整体收缩:极窄时仅 credit 数字截断,不挤占语言下拉/头像,
    // 与账户条容器的 gap 一起结构性保证 credit 永不顶到左侧分享按钮(宽度无界的数字已由 formatCredit 紧凑化)。
    <div className="ml-auto flex min-w-0 items-center gap-3">
      {/* credit:闪电图标 + 数字恒品牌橙(--color-primary,不随主题翻);单位文字随主题 ink。
          数字紧凑显示(K/M/B),完整值由 title 悬停给出;min-w-0 + truncate 使数字为唯一可让位者。
          **整块可点 = 手动入口**(2026-08-12 回归):这里只置来源,开哪个弹窗由 CreditModalGate
          按 plans.current_tier 决定。首次点击要等一个套餐配置往返,期间禁用 + 转圈,
          既给反馈又防重复点;缓存命中时不进这个态,点了瞬开。 */}
      <button
        type="button"
        onClick={() => setCreditModalOpen('manual')}
        disabled={pending}
        data-loading={pending || undefined}
        aria-label={t('preview.creditEntry')}
        aria-busy={pending}
        title={formatCreditExact(credit?.spendable)}
        className="flex min-w-0 items-center gap-1 rounded-[10px] px-1.5 py-0.5 transition-colors hover:bg-[var(--color-fill)] disabled:cursor-progress"
      >
        <span className="inline-flex shrink-0 text-[var(--color-primary)]">
          {pending
            ? <span className="size-[14px] animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            : <FigIcon src={figAsset.credit} size={14} tone="primary" />}
        </span>
        <span className="min-w-0 truncate text-[14px] font-bold leading-6 text-[var(--color-primary)]">
          {formatCredit(credit?.spendable)}
        </span>
        <span className="shrink-0 text-[12px] leading-[18px] tracking-[0.18px] text-[var(--color-ink)]">{t('preview.credit')}</span>
      </button>
      {/* 语言下拉:切换同步回写主站 rezonalab-config(设计稿 credit 与头像之间) */}
      <span className="shrink-0">
        <LanguageMenu />
      </span>
      {/* 首字母头像 */}
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--color-line-2)] bg-[var(--color-fill)] text-[13px] font-semibold text-[var(--color-ink)]"
        aria-label={name}
      >
        {initial}
      </span>
    </div>
  );
}
