'use client';
import { useEffect } from 'react';

// 可见性门控的定时轮询:后台标签页不打后端(纯浪费),转回可见由 visibilitychange 立即补一轮、不等下个间隔(审计 C2)。
// active 为 false 时连 interval 都不建立 —— 空闲态零请求。
// 由 useCanvasPolling(生成任务/版本构建)与 useBalanceRefresh(在途余额)共用,门控语义只此一份。
export function useVisibilityGatedInterval(active: boolean, intervalMs: number, tick: () => void) {
  useEffect(() => {
    if (!active) return;
    const run = () => {
      if (document.visibilityState !== 'hidden') tick();
    };
    const t = setInterval(run, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs, tick]);
}
