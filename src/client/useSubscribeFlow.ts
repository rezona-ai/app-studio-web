'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { bizApi } from '@/lib/biz/client';
import type { CurrentTier, SubscriptionTier } from '@/lib/biz/types';
import { triggerDimension, type UpsellSource } from '@/lib/subscription/plan-display';
import { track } from '@/lib/analytics';

// 订阅下单与状态轮询(升档弹窗与完整订阅弹窗共用)。
// 与 useTopupFlow 平行但不合并:两者的建单接口、终态判据、成功语义都不同,
// 塞进一个 hook 会得到一堆 if (isSubscription) 分支。
//
// 计费周期固定年付(spec 约束 6):弹窗内不给月/年切换,要月付的用户去主站定价页。

// 成功态停留时长:弹窗内展示成功后再自动关闭(同充值链路的观感)
const DONE_CLOSE_DELAY_MS = 1_500;

export type SubscribePhase = 'idle' | 'creating' | 'waiting' | 'active';
// 触发源的权威定义在 lib/subscription/plan-display(纯逻辑层);这里保留旧名作别名,
// 免得所有弹窗的 props 类型跟着改名
export type UpsellTrigger = UpsellSource;

export function useSubscribeFlow({
  trigger,
  currentTier,
  requestClose,
  from = 'upsell',
}: {
  trigger: UpsellTrigger;
  currentTier: CurrentTier;
  requestClose: () => void;
  from?: 'upsell' | 'all_plans';
}) {
  const setError = useStore((s) => s.setError);
  const watchSubscribeOrder = useStore((s) => s.watchSubscribeOrder);
  // 轮询与成败副作用(Toast / loadUserInfo / plansCache 失效)全在 store:弹窗关掉、
  // 或点「See all plans」跳到另一个弹窗时,它们都还在(spec 2026-08-14-subscribe-order-watch)
  const watching = useStore((s) => s.subscribeOrder != null);
  const succeeded = useStore((s) => s.subscribeSucceeded);
  const { t } = useTranslation();

  // 建单请求在飞(纯本地);其余两态由 store 派生,故本 hook 不再持有订单 id
  const [creating, setCreating] = useState(false);
  const phase: SubscribePhase = creating ? 'creating' : succeeded ? 'active' : watching ? 'waiting' : 'idle';

  // phase 在 subscribe 里读:用 ref 取最新值,避免把它塞进 useCallback 依赖后
  // 每次状态变化都换掉回调身份(消费方会拿它做 onClick)
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const subscribe = useCallback(async (tier: SubscriptionTier) => {
    if (phaseRef.current !== 'idle') return;
    // trigger 必须与曝光事件同一套字面值(generate/low_balance),否则两个事件按 trigger 关联不上
    track('subscribe_click', { trigger: triggerDimension(trigger), tier: currentTier, target_tier: tier, billing_period: 'yearly', from });

    // 防弹窗拦截:在用户手势同步栈内先开占位窗,拿到收银台地址后再写入
    const cashier = window.open('', '_blank');
    setCreating(true);
    phaseRef.current = 'creating';
    const body = { tier, billing_period: 'yearly' as const, idempotency_key: crypto.randomUUID() };
    try {
      // free 是首次订阅(建新订阅行),已付费是升档(改现有订阅行)——两个接口不可互换
      const data = currentTier === 'free'
        ? await bizApi.createSubscription(body)
        : await bizApi.changeSubscription(body);
      // change 在 Waffo 免重新授权时**不下发** redirect_url(直接扣差价生效):
      // 此时必须关掉占位窗,否则用户面前留一个永远空白的标签页
      if (data.redirect_url) {
        if (cashier) cashier.location.href = data.redirect_url;
        else window.open(data.redirect_url, '_blank');   // 占位窗被拦截:再试一次直开
      } else {
        cashier?.close();
      }
      // 文案在这里译好交给 store:成败可能发生在弹窗关掉之后,那时已经没有 t() 可用
      watchSubscribeOrder({
        id: data.id, tier,
        messages: { active: t('subscription.activeToast'), closed: t('subscription.closedToast') },
      });
      setCreating(false);
      phaseRef.current = 'waiting';
    } catch (e) {
      cashier?.close();
      setCreating(false);
      phaseRef.current = 'idle';
      setError({
        code: e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'SUBSCRIBE_FAILED',
        message: t('subscription.createFailedToast'),
      });
    }
  }, [currentTier, trigger, from, setError, t]);

  // 支付轮询已不在这里:它随弹窗卸载而死,而关窗 / 跳「See all plans」都不受 phase 约束。
  // 现在登记进 store 由 useSubscribeWatch 驱动,成败副作用也在 store(见 actions.ts 的 pollSubscribeOrder)。

  // 成功态停留后自动关窗;卸载或离开 active 态清理计时器
  useEffect(() => {
    if (phase !== 'active') return;
    const id = setTimeout(requestClose, DONE_CLOSE_DELAY_MS);
    return () => clearTimeout(id);
  }, [phase, requestClose]);

  return { phase, subscribe };
}
