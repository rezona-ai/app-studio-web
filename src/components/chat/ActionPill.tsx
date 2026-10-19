'use client';
import type { ButtonHTMLAttributes } from 'react';

// 对话内的操作 pill(描边圆角按钮,如「Packaged version」)
export default function ActionPill({
  label,
  className = '',
  ...props
}: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex w-fit items-center self-start rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-surface)] px-3.5 py-2 text-[14px] font-medium tracking-[-0.14px] text-[var(--color-ink)] transition hover:bg-[var(--color-fill)] ${className}`}
    >
      {label}
    </button>
  );
}
