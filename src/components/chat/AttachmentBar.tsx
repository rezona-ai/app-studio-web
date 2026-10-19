'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { resolveMentionRefs } from '@/lib/refs';
import AssetChip, { Chip, MediaThumb } from './AssetChip';

// 草稿待发送区:@ 资产引用(从草稿派生,与正文内 @key 单一真相)+ 上传附件(按 kind 缩略图 + 上传/错误态)
export default function AttachmentBar() {
  const { t } = useTranslation();
  const draft = useStore((s) => s.composer.draft);
  const attachments = useStore((s) => s.composer.attachments);
  const assets = useStore((s) => s.assets);
  const removeRef = useStore((s) => s.removeRef);
  const removeChatAttachment = useStore((s) => s.removeChatAttachment);
  const refs = resolveMentionRefs(draft, assets);
  if (refs.length === 0 && attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {refs.map((r) => (
        <AssetChip key={r} assetKey={r} onRemove={() => removeRef(r)} />
      ))}
      {attachments.map((a) => (
        <Chip
          key={a.id}
          label={a.name}
          removeLabel={t('chat.attachment.remove')}
          onRemove={() => removeChatAttachment(a.id)}
          icon={
            a.status === 'uploading' ? (
              <span
                className="size-4 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]"
                role="status"
                aria-label={t('chat.attachment.uploading')}
              />
            ) : a.status === 'error' ? (
              <span className="text-[12px] font-semibold text-[var(--color-primary)]" aria-label={t('chat.attachment.uploadFailed')}>!</span>
            ) : (
              <MediaThumb kind={a.kind} src={a.url} />
            )
          }
        />
      ))}
    </div>
  );
}
