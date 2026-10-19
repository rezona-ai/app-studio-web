'use client';
import { useEffect, useRef, useState } from 'react';

// 可调常量:节奏手感都在这里
export const TYPEWRITER = {
  TICK_MS: 24,   // 定时器周期
  MIN_STEP: 1,   // 每 tick 最少揭示字数
  MAX_STEP: 12,  // 每 tick 最多揭示字数(封顶单次渐显块,约 500 字/秒追赶上限)
  CATCHUP: 8,    // 自适应追赶除数(越小追得越快)
  FADE_MS: 280,  // 渐显时长 / chunk 毕业阈值
} as const;

export interface TypeChunk { id: number; text: string }
export interface TypewriterView { head: string; tail: TypeChunk[] }

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// 本 tick 揭示到的下标:不跨越段落空行(\n\n),保证每个 chunk 恒为单段落
function stepEnd(target: string, shown: number, rawStep: number): number {
  if (target.startsWith('\n\n', shown)) return shown + 2; // 正落在段界:单独吞掉这对换行,保证推进
  const to = Math.min(shown + rawStep, target.length);
  const nn = target.slice(shown, to).indexOf('\n\n');
  return nn === -1 ? to : shown + nn; // 截到段界前,下个 tick 再吞段界
}

export function useTypewriter(target: string, active: boolean): TypewriterView {
  // 惰性初始化:matchMedia 只在挂载时查一次
  const [reduced] = useState(() => prefersReducedMotion());

  const targetRef = useRef(target);
  const activeRef = useRef(active);
  // 同步最新入参到 ref(在 effect 中写,不在 render 期写),供定时器闭包读取
  useEffect(() => {
    targetRef.current = target;
    activeRef.current = active;
  });

  // 动画路径内部游标
  const headLenRef = useRef(0);
  const chunksRef = useRef<Array<TypeChunk & { bornTick: number }>>([]);
  const tickRef = useRef(0);
  const idRef = useRef(0);
  const sigRef = useRef('');

  const [view, setView] = useState<TypewriterView>(() =>
    // 首挂即非流式(历史/非流式) → 全量;流式 → 空,等定时器逐字揭示
    active ? { head: '', tail: [] } : { head: target, tail: [] },
  );

  // 动画主循环:仅在"首挂即流式且非降低动态"时启动
  useEffect(() => {
    if (reduced || !activeRef.current) return;

    // 重置游标:防止 StrictMode 双调用 effect 时残留上一轮的中间状态
    headLenRef.current = 0;
    chunksRef.current = [];
    tickRef.current = 0;
    idRef.current = 0;
    sigRef.current = '';

    const GRAD = Math.ceil(TYPEWRITER.FADE_MS / TYPEWRITER.TICK_MS);
    const shown = () =>
      headLenRef.current + chunksRef.current.reduce((n, c) => n + c.text.length, 0);

    const h = setInterval(() => {
      const t = targetRef.current;
      tickRef.current += 1;
      const now = tickRef.current;

      // 1) 旧 chunk 毕业:超过渐显窗口的尾段折叠进 head
      while (chunksRef.current.length && now - chunksRef.current[0].bornTick >= GRAD) {
        headLenRef.current += chunksRef.current.shift()!.text.length;
      }

      // 2) 揭示新字:自适应步长 + 段界 snap
      const cur = shown();
      const backlog = t.length - cur;
      if (backlog > 0) {
        const raw = Math.min(
          TYPEWRITER.MAX_STEP,
          Math.max(TYPEWRITER.MIN_STEP, Math.ceil(backlog / TYPEWRITER.CATCHUP)),
        );
        const end = stepEnd(t, cur, raw);
        const text = t.slice(cur, end);
        if (text) chunksRef.current.push({ id: idRef.current++, text, bornTick: now });
      }

      // 3) 仅在变化时推送视图(避免无谓重渲染)
      const head = t.slice(0, headLenRef.current);
      const tail = chunksRef.current.map(({ id, text }) => ({ id, text }));
      const sig = head + '\x00' + tail.map((c) => c.id).join(',');
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setView({ head, tail });
      }

      // 4) 收尾:非流式且已打完且无尾段 → 停表
      if (!activeRef.current && shown() >= t.length && chunksRef.current.length === 0) {
        clearInterval(h);
      }
    }, TYPEWRITER.TICK_MS);

    return () => clearInterval(h);
  }, [reduced]);

  // 降低动态:直接派生全量(无打字/渐显),无需 state/effect
  return reduced ? { head: target, tail: [] } : view;
}
