'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'ghost' | 'bordered' | 'raised' | 'raised-active' | 'danger';

// 提交类 CTA 的填充变体:可用态用高对比填充(浅色稿=深 raised-active、深色稿=浅 raised),
// 禁用态用低对比填充。即深色模式下「可用/禁用」的明暗与浅色模式相反。
export function submitVariant(active: boolean, dark: boolean): 'raised' | 'raised-active' {
  return active !== dark ? 'raised-active' : 'raised';
}

const VARIANT: Record<Variant, string> = {
  ghost: 'text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  bordered: 'border border-[var(--color-line-2)] text-[var(--color-ink)] hover:bg-[var(--color-fill)]',
  raised: 'btn-raised',
  'raised-active': 'btn-raised-active',
  // 破坏性动作(关闭分享/删除等):danger 语义色文字 + 柔光 hover 底,统一走本变体不再各处自写
  danger: 'text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]',
};

export default function IconButton({
  variant = 'ghost',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      {...props}
      className={`grid place-items-center rounded-[10px] transition-[transform,background-color,opacity,filter] duration-150 ease-out motion-safe:active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-30 ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
