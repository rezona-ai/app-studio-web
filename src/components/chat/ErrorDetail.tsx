'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { DANGER_ICON_BTN_CLS } from './danger-bubble';

// 上游报错原文(设计稿 2026-08-25)。默认收起:主行给的是译文(人话),这里是完整原文,
// 供排障与复制。只挂**正式错误气泡** —— 重试进度是进行态,自愈期摊开异常栈等于让用户为
// 系统正在处理的事排障;原文并没丢,取消 / 次数耗尽时随 agentRetry 落成正式气泡再展示。
//
// 拆成「开关 + 正文」两件受控组件而非一个 <details>:开关要和 Try again / Switch model 并排在
// 同一条动作栏里,正文却要在动作栏**下方**整宽铺开 —— <details> 的正文只能长在 summary 底下,
// 塞进 flex 行里就挤在左半边(Nick 2026-09-03 对排版的反馈)。开合状态归气泡持有。

export function ErrorDetailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex shrink-0 items-center gap-0.5 rounded-[6px] py-[2px] pr-1.5 text-[12px] leading-4 text-[var(--color-danger)] opacity-80 transition-opacity hover:opacity-100"
    >
      {/* tone=primary 随 currentColor 变红:chevron 在 ICON_TONE 表里默认 secondary(恒灰),会和红字文案两个色 */}
      <FigIcon src={figAsset.chevronDown} size={14} tone="primary" className={`transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`} />
      {t('chat.error.detail')}
    </button>
  );
}

export default function ErrorDetail({ detail }: { detail: string }) {
  const { t } = useTranslation();

  const copy = async () => {
    const { setSuccess, setError } = useStore.getState();
    try {
      await navigator.clipboard.writeText(detail);
      setSuccess({ code: 'COPIED', message: '' });
    } catch {
      setError({ code: 'CLIPBOARD', message: '' });
    }
  };

  return (
    <div className="anim-collapse-in mt-1 flex items-start gap-1">
      <pre className="scrollbar-auto max-h-[30vh] min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-[var(--color-danger-fill)] p-2 font-[family-name:var(--font-mono)] text-[12px] leading-[18px] text-[var(--color-ink)]">
        {detail}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t('chat.error.copy')}
        className={DANGER_ICON_BTN_CLS}
      >
        <FigIcon src={figAsset.copy} size={14} />
      </button>
    </div>
  );
}
