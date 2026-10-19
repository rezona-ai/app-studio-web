import { useEffect, useRef, useState } from 'react';

// open 变 false 时:先置 closing 播放退场,延时 ms 后才真正卸载(mounted=false)。
// reduced-motion 下退场延时视为 0(瞬卸,不空等)。data-closing 进出场约定抽成可复用 hook。
export function useExitTransition(open: boolean, ms: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 退场状态机:本 hook 的职责就是按 open 随时间变化驱动 mounted/closing(延时卸载),
    // 必须在 effect 内 setState,非可在渲染期派生的状态,故此处豁免 set-state-in-effect。
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上:退场状态机需在 effect 中置位
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return; // 本就未挂载,无需退场
    const reduce = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    timer.current = setTimeout(() => { setMounted(false); setClosing(false); }, reduce ? 0 : ms);
  }, [open, ms, mounted]);

  // 卸载清理定时器
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { mounted, closing };
}
