'use client';
/* eslint-disable react-hooks/set-state-in-effect --
   与 useTopupFlow 同源的豁免理由:挂载即拉配置,触发时需同步置失败态,
   否则失败态要等一帧才出现、期间弹窗是空的。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { bizApi } from '@/lib/biz/client';

// 订阅套餐配置的读取(与 useTopupFlow 平行):网络 IO 与竞态控制归 client 层,
// 弹窗组件只消费结果——原先这段写在 CreditModalGate 组件里,跨了分层(终审 I7)。
//
// 结果落 store 的瞬态 plansCache 而非 hook 局部 state:升购弹窗随 creditModalOpen
// 条件挂载,关窗即卸载,局部 state 会跟着丢 → 每次触发都要重新等一个往返、期间空屏。
// 放 store 后同一会话内二次触发即时开窗(终审 I5;这也是 plan 决策 1 的原方案)。
//
// 只放缓存字段、不把「先 await 配置再决定开哪个弹窗」搬进 store:那会让同步的
// guard() 变成 async,代价扩散到所有生成路径。

export function useSubscriptionPlans(active: boolean) {
  const plans = useStore((s) => s.plansCache);
  const setPlansCache = useStore((s) => s.setPlansCache);
  const [failed, setFailed] = useState(false);

  // 最后一次请求胜出(重试可能与自动拉取并发)
  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setFailed(false);
    try {
      const data = await bizApi.getSubscriptionPlans();
      if (seq !== reqSeq.current) return;
      setPlansCache(data);
    } catch {
      if (seq !== reqSeq.current) return;
      setFailed(true);
    }
  }, [setPlansCache]);

  // 打开即拉;已有缓存直接用,不重复请求
  useEffect(() => {
    if (!active || plans != null || failed) return;
    void load();
  }, [active, plans, failed, load]);

  return { plans, failed, reload: load };
}
