'use client';
import { useTranslation } from 'react-i18next';

export default function PostingStep() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 py-10">
      <span role="status" aria-label={t('preview.rezona.posting')}
        className="block size-8 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-primary)]" />
      <span className="text-[18px] font-semibold text-[var(--color-ink)]">{t('preview.rezona.posting')}</span>
    </div>
  );
}
