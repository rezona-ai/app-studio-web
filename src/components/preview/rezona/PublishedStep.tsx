'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import Button from '@/components/ui/Button';

// 发布成功:✓ + 标题 + share_url + 复制(复用 SharePopover 剪贴板容错范式)。
export default function PublishedStep({ shareUrl }: { shareUrl: string }) {
  const { t } = useTranslation();
  const setWarning = useStore((s) => s.setWarning);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setWarning({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually' });
    }
  };
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <FigIcon src={figAsset.checkCircle} size={48} tone="original" />
      <span className="text-[20px] font-semibold text-[var(--color-ink)]">{t('preview.rezona.publishedTitle')}</span>
      <div className="flex w-full items-center gap-2">
        <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[13px] text-[var(--color-ink)] outline-none" />
        <Button type="button" aria-label={t('preview.copyLink')} className="h-11 shrink-0 px-4" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? t('preview.copied') : t('preview.copy')}
        </Button>
      </div>
    </div>
  );
}
