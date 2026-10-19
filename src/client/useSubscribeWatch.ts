'use client';
import { useCallback } from 'react';
import { useStore } from '@/store';
import { useVisibilityGatedInterval } from './useVisibilityGatedInterval';

const SUBSCRIBE_INTERVAL = 3000;   // 与旧的弹窗内轮询同节奏(支付回来后要尽快判定)

// 在飞订阅单的轮询驱动。状态在 store(见 spec 2026-08-14-subscribe-order-watch),故用户关掉
// 弹窗、或点「See all plans」跳到另一个弹窗,轮询都不受影响。
//
// 可见性门控在这条路径上是**升级不是退化**:此刻用户多半在收银台标签页(本页 hidden),
// 门控让 hidden 期间不打后端,切回可见立即补一轮 —— 比盲目每 3s 打一次更省,且回来那一刻就判定。
export function useSubscribeWatch() {
  const watching = useStore((s) => s.subscribeOrder != null);
  const pollSubscribeOrder = useStore((s) => s.pollSubscribeOrder);

  // tick 引用要稳定(是 effect 依赖);tick 时再读一次现值,防 interval 存活期内单已收
  const tick = useCallback(() => {
    if (useStore.getState().subscribeOrder) void pollSubscribeOrder();
  }, [pollSubscribeOrder]);

  useVisibilityGatedInterval(watching, SUBSCRIBE_INTERVAL, tick);
}
