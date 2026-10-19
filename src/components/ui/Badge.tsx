'use client';
import type { ReactNode } from 'react';

export default function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-live)] px-2 py-0.5 text-[11px] font-medium text-white">
      {children}
    </span>
  );
}
