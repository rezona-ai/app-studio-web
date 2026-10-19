'use client';
import { useState, useRef, useEffect, useLayoutEffect, isValidElement, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

const OPEN_DELAY = 350; // hover 打开延时(ms),防止扫过时闪烁

type Side = 'top' | 'bottom';
type Pos = { x: number; y: number; placement: Side };

export default function Tooltip({
  label,
  side = 'top',
  transparent = false,
  children,
}: {
  label?: string;
  side?: Side;
  // 触发元素为 absolute 定位时设 true:包裹层用 display:contents 退出布局,
  // 避免它作为行内级兄弟在块级节点后留下幽灵行盒(strut),撑高卡片/媒体容器。
  // 触发元素仍以最近的定位祖先为包含块,定位不变。
  transparent?: boolean;
  children: ReactElement;
}) {
  // 文案单一真相源:优先显式 label,否则回退子元素 aria-label
  const text =
    label ??
    (isValidElement(children)
      ? (children.props as { 'aria-label'?: string })['aria-label']
      : undefined);

  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // 卸载时清理定时器
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // 打开期间:滚动 / 滚轮 / 按下即关闭(画布平移、列表滚动时避免气泡滞留在旧位置)
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('pointerdown', close, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('pointerdown', close, true);
    };
  }, [pos]);

  // 渲染后按气泡实际宽度做水平 clamp,确保不溢出视口(useLayoutEffect 在绘制前生效,无闪烁)
  useLayoutEffect(() => {
    if (!pos) return;
    const b = bubbleRef.current;
    if (!b) return;
    const w = b.offsetWidth;
    const margin = 8;
    const left = Math.min(Math.max(pos.x - w / 2, margin), window.innerWidth - w - margin);
    b.style.left = `${left}px`;
  }, [pos]);

  if (!text) return children; // 无文案来源:直接透传,不包裹

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // 测量「第一个子元素」而非外包 span:兼容 absolute 定位的触发(外包 span 处于流内、尺寸为 0)
      const node = (wrapRef.current?.firstElementChild ?? wrapRef.current) as HTMLElement | null;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const placement: Side = side === 'top' && r.top < 40 ? 'bottom' : side;
      const y = placement === 'top' ? r.top : r.bottom;
      setPos({ x: r.left + r.width / 2, y, placement });
    }, OPEN_DELAY);
  };
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPos(null);
  };

  return (
    <span
      ref={wrapRef}
      className={transparent ? 'contents' : 'inline-flex'}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            ref={bubbleRef}
            aria-hidden="true"
            // 外层只负责定位(含 placement 位移)+ inline-block 使宽度收缩为内层气泡宽度(clamp 测量用),
            // 内层做进场动画,二者 transform 互不覆盖
            style={{
              position: 'fixed',
              top: pos.y,
              left: pos.x, // 初值,useLayoutEffect 会按实际宽度 clamp
              transform: pos.placement === 'top' ? 'translateY(calc(-100% - 8px))' : 'translateY(8px)',
            }}
            className="pointer-events-none z-[100] inline-block"
          >
            <span
              aria-hidden="true"
              className="anim-pop-in block max-w-[240px] whitespace-nowrap rounded-[8px] border border-[var(--color-line)] bg-[var(--color-pop)] px-2 py-1 text-[12px] font-medium text-[var(--color-ink)] shadow-[var(--shadow-popover)]"
              style={{ transformOrigin: pos.placement === 'top' ? 'center bottom' : 'center top' }}
            >
              {text}
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
