'use client';

// 可复用开关(Figma switch 1743:31418):轨道 39×24,滑块 20;开态 accent 底,关/禁用走中性令牌。
// role=switch + aria-checked;disabled 降透明 + not-allowed;位移过渡加 motion-safe。
export default function Switch({
  checked, onChange, disabled = false, ariaLabel,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`relative inline-flex h-6 w-[39px] shrink-0 items-center rounded-full motion-safe:transition-colors motion-safe:duration-150 ${
        checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-line-2)]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow-[var(--shadow-btn)] motion-safe:transition-transform motion-safe:duration-150 ${
          checked ? 'translate-x-[17px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
