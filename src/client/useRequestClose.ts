import { useCallback, useEffect, useRef, useState } from 'react';

// 拦截关闭:先置 closing 播放退场动画,延时 ms 后才调用真正的 onClose(由其卸载组件)。
// reduced-motion 下延时视为 0(瞬关)。data-closing 进出场约定抽成可复用 hook 供各模态共用。
export function useRequestClose(onClose: () => void, ms: number): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (timer.current) return; // 已在退场,忽略重复触发
    const reduce = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setClosing(false);
      onClose();
    }, reduce ? 0 : ms);
  }, [onClose, ms]);

  // 卸载清理定时器
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { closing, requestClose };
}
