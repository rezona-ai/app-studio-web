'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { useIsDark } from '@/client/useIsDark';
import { useRequestClose } from '@/client/useRequestClose';
import IconButton, { submitVariant } from '@/components/ui/IconButton';
import { isImeComposing } from '@/lib/keyboard';

// 创建游戏弹窗:复用 GenerateForm 卡片语言(圆角卡 + backdrop + Esc 关闭);进出场用 modal-* + 拦截关闭
export default function CreateGameModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createProject = useStore((s) => s.createProject);
  const dark = useIsDark();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = name.trim().length > 0 && !busy;
  const { closing, requestClose } = useRequestClose(onClose, 200);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await createProject(name.trim());
      requestClose();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 表单弹窗:仅在有输入(名称非空)时拦截遮罩点击,防误触丢输入;空表单点空白即关
  const dirty = name.trim().length > 0;

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={() => { if (!dirty) requestClose(); }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('chat.createGame.title')}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); void submit(); } }}
          placeholder={t('chat.createGame.placeholder')}
          className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={requestClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('common.cancel')}</button>
          <IconButton
            variant={submitVariant(canSubmit, dark)}
            className="h-10 rounded-[10px] px-4 text-[13px] font-semibold"
            aria-label={t('chat.createGame.create')}
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : t('chat.createGame.create')}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
