'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { useSubscriptionPlans } from '@/client/useSubscriptionPlans';
import AllPlansModal from '@/components/ui/AllPlansModal';
import CreditUpsellModal from '@/components/ui/CreditUpsellModal';
import ModelLockModal from '@/components/ui/ModelLockModal';
import { nextTier, triggerDimension, upsellVariant } from '@/lib/subscription/plan-display';
import { track } from '@/lib/analytics';

// 升购弹窗路由:弹窗种类由 plans.current_tier 决定,故必须先拿到套餐配置再决定渲染哪一个。
// **被动触发**(insufficient / lowBalance):
//   free                     → AllPlansModal(三档并排)
//   starter / creator        → CreditUpsellModal(高一级单卡)
//   master                   → CreditUpsellModal(积分充值分支)
//   单卡的「See all plans」  → AllPlansModal
// **手动触发**(manual,点预览区积分块;2026-08-12 回归)分流不同——手动点是「我想看方案」
// 而不是「我这次做不成」,故不给单卡:
//   free / starter / creator → AllPlansModal
//   master                   → 转交完整充值弹窗 TopupModal(6180:109915,含自定义金额档)
//
// 配置未到位时**什么都不渲染**(而不是先开一个再切):free 与低档开的是两个不同弹窗、
// hero 也不同,先开后切会看到弹窗当场换脸。首次触发因此晚一个请求往返,
// 之后走 store 缓存即时开窗(拉取与缓存见 client/useSubscriptionPlans)。
//
// 本组件只做路由与埋点,不碰网络:IO 与竞态控制归 client 层(CLAUDE.md 分层原则)。

export default function CreditModalGate() {
  const source = useStore((s) => s.creditModalOpen);
  const kind = useStore((s) => s.creditModalKind);
  const allPlansOpen = useStore((s) => s.allPlansOpen);
  const setCreditModalOpen = useStore((s) => s.setCreditModalOpen);
  const setAllPlansOpen = useStore((s) => s.setAllPlansOpen);
  const setTopupModalOpen = useStore((s) => s.setTopupModalOpen);

  const { plans, failed, reload } = useSubscriptionPlans(source !== false);

  // 曝光埋点:拿到档位后才知道弹的是哪一种,故在这里上报而非各弹窗内部
  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!source || plans == null) return;
    // 手动触发不看 upsellVariant(那张表是被动触发的分流):非顶档恒 all_plans,顶档去充值。
    // modelLocked 同样不看那张表:free 在表里是 all_plans,而它实际弹的是单档卡(见下方分流),
    // 埋点报错 variant 会让下游把两种窗的曝光混在一起。
    const variant = source === 'manual'
      ? (plans.current_tier === 'master' ? 'topup' : 'all_plans')
      : allPlansOpen ? 'all_plans'
        : source === 'modelLocked' ? 'plan'
          : upsellVariant(plans.current_tier);
    const stamp = `${source}|${variant}`;
    if (shownRef.current === stamp) return;
    shownRef.current = stamp;
    // stamp 含 variant,故点「See all plans」会再报一条——那是另一种曝光,必须带上 variant
    // 与 tier 才区分得开,否则下游看到两条一模一样的记录(终审 I1)
    track('out_of_credits_show', { trigger: triggerDimension(source), tier: plans.current_tier, variant });
  }, [source, plans, allPlansOpen]);

  useEffect(() => { if (!source) shownRef.current = null; }, [source]);

  // 手动 + 顶档:本组件没有可展示的升购内容,转交完整充值弹窗并关掉自己
  // (两者同为 z-40,不能并存)。放 effect 而非渲染期,避免在渲染中改别人的 state。
  const handOffToTopup = source === 'manual' && plans?.current_tier === 'master';
  useEffect(() => {
    if (!handOffToTopup) return;
    setCreditModalOpen(false);
    setTopupModalOpen(true, 'manual');
  }, [handOffToTopup, setCreditModalOpen, setTopupModalOpen]);

  if (!source) return null;
  if (handOffToTopup) return null;

  // 配置还没到位:失败态交给弹窗自己渲染(带重试),载入中则先不出现
  if (plans == null && !failed) return null;

  const close = () => setCreditModalOpen(false);
  const variant = plans == null ? 'plan' : upsellVariant(plans.current_tier);
  // 配置异常:该升的档不在 plans[] 里(后端少配了一档)。此时单卡弹窗无卡可渲染,
  // 会给出一个只有 hero + 说明行、没有任何 CTA 的死弹窗(终审 I4),故回落三档并排。
  const target = plans ? nextTier(plans.current_tier) : null;
  const targetMissing = plans != null && target != null && !plans.plans.some((p) => p.tier === target);

  // 模型锁定:形态对齐主站 —— 无 hero 的单档卡(spec 2026-08-31-model-lock-modal-design)。
  // 放在 all_plans 分流之**前**:free 档在 upsellVariant 里恒 all_plans,不先截住就永远走不到这张窗。
  // 点了「See all plans」(allPlansOpen)或缺目标档(targetMissing)仍回落三档并排,不出死窗。
  if (source === 'modelLocked' && !allPlansOpen && !targetMissing) {
    return (
      <ModelLockModal
        plans={plans}
        onClose={close}
        onRetryPlans={() => void reload()}
        onSeeAllPlans={() => setAllPlansOpen(true)}
      />
    );
  }

  // 手动触发到这里必然是非顶档(顶档已在上面转交充值弹窗),一律三档并排
  if (allPlansOpen || source === 'manual' || variant === 'all_plans' || targetMissing) {
    return <AllPlansModal source={source} plans={plans} onClose={close} onRetryPlans={() => void reload()} />;
  }

  return (
    <CreditUpsellModal
      source={source}
      kind={kind}
      plans={plans}
      onClose={close}
      onRetryPlans={() => void reload()}
      onSeeAllPlans={() => setAllPlansOpen(true)}
      onViewAllPricing={() => {
        // 顶档的「View all pricing options」落到完整充值弹窗(含自定义金额档),
        // 那是 TopupModal 现在唯一的可达路径(手动入口已去掉)。
        setCreditModalOpen(false);
        setTopupModalOpen(true);
      }}
    />
  );
}
