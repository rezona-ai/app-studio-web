'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';

interface MessageActionsProps {
  copyText: string;
  onEdit?: () => void;
  variant: 'hover' | 'turn';
}

export default function MessageActions({ copyText, onEdit, variant }: MessageActionsProps) {
  const { t } = useTranslation();
  const setWarning = useStore((s) => s.setWarning);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用或被拒绝时复用全局 Warning Toast，不在消息区另造反馈通道。
      setWarning({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually' });
    }
  };

  return (
    <div
      className={variant === 'hover'
        ? 'pointer-events-none absolute right-0 top-full flex items-center gap-0.5 pt-1 opacity-0 transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none'
        : 'flex h-8 items-center gap-0.5 px-1'}
    >
      <Tooltip label={t(copied ? 'chat.message.copied' : 'chat.message.copy')}>
        <IconButton
          type="button"
          className="size-8 rounded-[8px]"
          aria-label={t(copied ? 'chat.message.copied' : 'chat.message.copy')}
          onClick={() => void copy()}
        >
          <FigIcon src={copied ? figAsset.check : figAsset.copy} size={15} />
        </IconButton>
      </Tooltip>
      {onEdit && (
        <Tooltip label={t('chat.message.edit')}>
          <IconButton
            type="button"
            className="size-8 rounded-[8px]"
            aria-label={t('chat.message.edit')}
            onClick={onEdit}
          >
            <FigIcon src={figAsset.pencil} size={15} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}
