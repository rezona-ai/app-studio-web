'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HANDLE_H, HANDLE_W, tension } from '@/lib/edge-handle';

const RELEASE_MS = 320; // 脱手回弹时长
const BACK = 1.2; // easeOutBack 的过冲系数
export const DENT_MIN = -0.08; // 内凹下限:再深会把轮廓往边栏里吸

// easeOutBack 是 0→1 的**进度**,末段会冲过 1
const easeOutBack = (p: number) => 1 + (BACK + 1) * (p - 1) ** 3 + BACK * (p - 1) ** 2;

/**
 * 脱手回弹在进度 p 处**还剩多少形变**:从满形变收回 0,
 * 进度冲过 1 的那一段于是让它变负 = 反向内凹(夹在下限内)。
 * 直接乘进度会让形变在脱手瞬间归零、根本没有回弹 —— 故拆成纯函数由单测钉死。
 */
export const recoilAt = (p: number) => Math.max(1 - easeOutBack(p), DENT_MIN);

/** 液体的当前形状:牵引点 + 形变强度 */
export type LiquidShape = { tx: number; ty: number; strength: number };

const REST: LiquidShape = { tx: HANDLE_W, ty: HANDLE_H / 2, strength: 0 };

/**
 * 折叠把手的液体粘连跟随(设计稿 2026-08-18-edge-handle-liquid-follow)。
 *
 * 指针进入把手本体后转牵引态,在 window 上**只读** pointermove 取坐标。
 * 牵引点 1:1 跟手、**不做惯性** —— 形变一旦滞后于指针,指针就会落在轮廓外,
 * 「粘着就点得到」这条硬要求立刻失效;液体感全部做进形状,惯性只留给脱手回弹。
 */
export function useLiquidFollow() {
  const [shape, setShape] = useState<LiquidShape | null>(null);

  const rect = useRef<DOMRect | null>(null); // 牵引开始时取一次:每帧 getBoundingClientRect 会强制回流
  const side = useRef<'left' | 'right'>('left');
  const target = useRef({ dx: 0, dy: 0 });
  const cur = useRef<LiquidShape>(REST);
  const raf = useRef<number | null>(null);
  const released = useRef<number | null>(null); // 脱手时刻,之后改由时间驱动回弹

  const onMove = useCallback((e: PointerEvent) => {
    const r = rect.current;
    if (!r) return;
    // 「反方向」= 离开边栏的那一侧:左把手往右为正,右把手往左为正
    target.current = {
      dx: side.current === 'left' ? e.clientX - r.right : r.left - e.clientX,
      dy: e.clientY - (r.top + r.bottom) / 2,
    };
  }, []);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    window.removeEventListener('pointermove', onMove);
    rect.current = null;
    cur.current = REST;
    released.current = null;
    setShape(null);
  }, [onMove]);

  const tickRef = useRef<FrameRequestCallback>(() => {});

  const tick = useCallback<FrameRequestCallback>(
    (now) => {
      raf.current = requestAnimationFrame(tickRef.current);

      if (released.current !== null) {
        const p = Math.min((now - released.current) / RELEASE_MS, 1);
        if (p >= 1) {
          stop();
          return;
        }
        cur.current = { ...cur.current, strength: recoilAt(p) };
        setShape(cur.current);
        return;
      }

      const aim = tension(target.current.dx, target.current.dy);
      if (!aim) {
        // 张力拉不住了:停掉指针监听转入回弹,此后指针再怎么动都不接回来 ——
        // 否则在画布上晃悠会反复粘上又脱开,变成视觉噪音
        window.removeEventListener('pointermove', onMove);
        released.current = now;
        return;
      }
      // 拉扯期恒满强度、牵引点直接跟手:任何滞后都会让指针跑到轮廓外
      const next = { ...aim, strength: 1 };
      if (next.tx !== cur.current.tx || next.ty !== cur.current.ty || cur.current.strength !== 1) {
        cur.current = next;
        setShape(next);
      }
    },
    [onMove, stop],
  );
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const onPointerEnter = useCallback(
    (e: React.PointerEvent<HTMLElement>, from: 'left' | 'right') => {
      // 降低动态:整套不启动 —— 光靠 CSS 媒体查询关不掉 pointermove 与 rAF
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (raf.current !== null) return; // 已在牵引态
      rect.current = e.currentTarget.getBoundingClientRect();
      side.current = from;
      target.current = { dx: 0, dy: 0 };
      cur.current = REST;
      released.current = null;
      setShape(REST);
      window.addEventListener('pointermove', onMove, { passive: true });
      raf.current = requestAnimationFrame(tick);
    },
    [onMove, tick],
  );

  useEffect(() => stop, [stop]); // 卸载兜底:监听与 rAF 一并清掉

  return { shape, onPointerEnter, stop };
}
