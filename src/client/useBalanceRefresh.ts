'use client';
import { useCallback } from 'react';
import { useStore } from '@/store';
import { useVisibilityGatedInterval } from './useVisibilityGatedInterval';

const BALANCE_INTERVAL = 15000;   // 在途消耗期的兜底节奏:比生成轮询宽松(余额非关键),又足以让数字持续跟进

// 消耗在途时的余额兜底刷新。主路径是消耗动作自身的三个漏斗(runGen / pollGenTasks / run.finished),
// 本 hook 只补漏斗覆盖不到的部分:一次 agent run 内的多次扣费(run.finished 前不会有任何漏斗触发)、
// 以及前端不可感知的后端侧消耗。空闲(无 run、无生成任务)时不建 interval —— 零额外请求。
export function useBalanceRefresh() {
  const running = useStore((s) => s.runStatus === 'running');
  const genCount = useStore((s) => s.genTasks.length);
  const refreshBalance = useStore((s) => s.refreshBalance);

  // tick 引用要稳定(是 effect 依赖);action 引用本身恒定,故只依赖它
  const tick = useCallback(() => { void refreshBalance(); }, [refreshBalance]);

  useVisibilityGatedInterval(running || genCount > 0, BALANCE_INTERVAL, tick);
}
