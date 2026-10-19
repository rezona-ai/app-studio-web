'use client';
import { useEffect, useState } from 'react';

// 进程内单例:N 个订阅者共用**一个** interval(spec 2026-08-04-canvas-task-visibility 约束 5 ——
// 不做每卡一个计时器)。没有订阅者时不存在定时器,空闲画布不每秒重渲。
let timer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<(now: number) => void>();

function subscribe(fn: (now: number) => void): () => void {
  subscribers.add(fn);
  if (!timer) {
    timer = setInterval(() => {
      const now = Date.now();
      for (const s of subscribers) s(now);
    }, 1000);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 每秒返回一次新的 Date.now();enabled=false 时不订阅(也就不会拉起定时器) */
export function useSecondTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    // 不在此处同步 setState 对齐:useState 的惰性初值已经是挂载那一刻的 Date.now(),
    // 再同步 set 一次只会触发一次级联渲染(eslint react-hooks 会报)
    return subscribe(setNow);
  }, [enabled]);
  return now;
}
