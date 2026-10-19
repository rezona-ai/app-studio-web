'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useExitTransition } from '@/client/useExitTransition';
import { resolveErrorMessage } from '@/i18n/errors';
import { FigIcon, figAsset } from './figma';

// 按 kind 映射状态图标与 accent 令牌(对齐 Figma 955-49756/49849/43601)。
// 恒浅色:文字/关闭/hover 底为 toast 专用固定色,不随主题翻转(类比 .btn-raised 例外)。
const TOAST_ICON = { error: figAsset.toastError, success: figAsset.toastSuccess, warning: figAsset.toastWarning } as const;
const TOAST_ACCENT = {
  error: 'var(--color-toast-error)',
  success: 'var(--color-toast-success)',
  warning: 'var(--color-toast-warning)',
} as const;

// 订阅 store.toast,展示一条 toast:进出场用 toast-pop(退场期间保留末次内容)。
// 自动消失 4s,但鼠标移入暂停计时、移出重新计 4s(避免用户阅读时被吞掉)。
// 定位:预览列底部居中。挂 Workspace 根做 viewport-fixed 保持 z-[100] 恒在最上(不被模态遮挡);
// 由 Workspace 传入左右内缩(左 = 对话栏占宽),使横向中心落在预览列。
export default function Toast({ leftInset = 0, rightInset = 0 }: { leftInset?: number; rightInset?: number }) {
  const { t } = useTranslation();
  const error = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);
  const { mounted, closing } = useExitTransition(!!error, 200);
  // 退场动画期间 error 已为 null:用 shown 保留末次非空内容供退场渲染。
  // 渲染期按 prop 调整 state(React 官方「adjust state during render」模式,非 effect)。
  const [shown, setShown] = useState(error);
  if (error && error !== shown) setShown(error);

  const [hovering, setHovering] = useState(false);

  // 鼠标悬停暂停自动消失(hovering 进 deps,移入不调度、移出重新调度全新一轮),避免用户阅读时被吞掉
  useEffect(() => {
    if (!error || hovering) return;
    const id = setTimeout(() => clearToast(), 4000);
    return () => clearTimeout(id);
  }, [error, hovering, clearToast]);

  if (!mounted || !shown) return null;
  const kind = shown.kind;
  const isError = kind === 'error';
  const accent = TOAST_ACCENT[kind];
  return (
    // 外框横跨预览列(left/right 内缩)、底部定位、居中承载;pointer-events-none 让空白区放行底层交互
    <div
      className="pointer-events-none fixed bottom-[100px] z-[100] flex justify-center px-4"
      style={{ left: leftInset, right: rightInset }}
    >
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        data-closing={closing}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        // 上限按视口而非外框:外框窄于卡片时跟着收缩会把卡片压成 min-content、文本逐字换行撑成一根竖条。
        // 按视口封顶后卡片恒 473,外框过窄时由 justify-center 对称溢出,消息始终完整可读。
        className="toast-pop pointer-events-auto flex w-[473px] max-w-[calc(100vw-32px)] items-center gap-4 rounded-[8px] py-3 pl-4 pr-3"
        style={{
          background: `color-mix(in srgb, ${accent} 10%, #ffffff)`,
          border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
        }}
      >
        <FigIcon src={TOAST_ICON[kind]} tone="original" size={24} className="shrink-0" />
        <p className="min-w-0 flex-1 break-words text-[14px] leading-[22px] tracking-[0.22px] text-[#262626]">
          {resolveErrorMessage(shown.code, shown.message, t, shown.params)}
        </p>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => clearToast()}
          className="grid size-6 shrink-0 place-items-center rounded-[8px] text-[#202020] transition-colors hover:bg-[rgba(0,0,0,0.06)] motion-safe:active:scale-[0.92]"
        >
          <FigIcon src={figAsset.close} tone="primary" size={24} />
        </button>
      </div>
    </div>
  );
}
