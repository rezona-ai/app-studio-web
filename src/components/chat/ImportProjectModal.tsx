'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import IconButton from '@/components/ui/IconButton';
import { figAsset, FigIcon } from '@/components/ui/figma';

// 支持的压缩包扩展名(与后端契约一致);大小不做前端预校验,413/422 由后端信封→Toast
const ACCEPT = '.zip,.tar,.tar.gz,.tgz';
const ARCHIVE_RE = /\.(tar\.gz|tgz|tar|zip)$/i;
// 去掉压缩扩展名作项目名(.tar.gz 双段优先);v3 起名称不可编辑,恒取文件名
const defaultName = (filename: string) => filename.replace(ARCHIVE_RE, '');

// 导入游戏弹窗 v3,四态:表单(选文件即上传) / 上传中(x→行内确认取消) / 落素材(x disabled) / 完成(1.2s 后自动关)。
// 关闭/取消统一收敛到右上角 x;导入态由 store.importArchiveStatus 单一驱动
export default function ImportProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const importProjectArchive = useStore((s) => s.importProjectArchive);
  const cancelImportArchive = useStore((s) => s.cancelImportArchive);
  const setError = useStore((s) => s.setError);
  const status = useStore((s) => s.importArchiveStatus);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const importing = status != null;
  const cancellable = status?.step === 'uploading';
  // 落素材与完成态不可关(项目已建成,让流程自然走完;done 由 action 延迟后 resolve 自动关)
  const closeDisabled = importing && !cancellable;
  const { closing, requestClose } = useRequestClose(onClose, 200);

  // 上传恰好完成的竞态:确认框失去意义,渲染期 guard 收起(仓库约定,不用 effect-setState)
  if (confirmingCancel && !cancellable) setConfirmingCancel(false);

  // 选定文件统一入口(点击选择与拖放共用):校验扩展名后立即上传;结束(含 done 停留)自动关闭,
  // 失败/取消 reject 则回表单态(Toast 由 action 分流,取消静默)
  const start = (f: File) => {
    if (!ARCHIVE_RE.test(f.name)) {
      setError({ code: 'IMPORT_BAD_TYPE', message: t('chat.importGame.dropRejected') });
      return;
    }
    void importProjectArchive(f, defaultName(f.name))
      .then(() => requestClose())
      .catch(() => setConfirmingCancel(false));
  };

  // x/Esc 统一意图:表单直接关;上传中先行内确认;其余阶段禁用(x disabled,Esc 忽略)
  const onCloseIntent = () => {
    const st = useStore.getState().importArchiveStatus;
    if (st == null) requestClose();
    else if (st.step === 'uploading') setConfirmingCancel(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseIntent(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // onCloseIntent 内部读 getState,无过期闭包;requestClose 稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCloseIntent 每渲染新建但行为恒定,不入 deps 防重复绑定
  }, [requestClose]);

  const stepText = status == null ? '' :
    status.step === 'uploading' ? (
      // 字节发完但请求未返回(代理转发尾巴+服务端解包):切「处理中」,避免挂死在 100% 的观感
      status.progress >= 1 ? t('chat.importGame.stepProcessing')
      : t('chat.importGame.stepUploading', { percent: Math.round(status.progress * 100) }))
    : status.step === 'creating' ? t('chat.importGame.stepCreating')
    : status.step === 'importing_assets' ? t('chat.importGame.stepImportingAssets', { done: status.done, total: status.total })
    : t('chat.importGame.importDone');

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={() => { if (!importing) requestClose(); }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('chat.importGame.title')}</span>
          <IconButton aria-label={t('common.close')} disabled={closeDisabled} onClick={onCloseIntent}>
            <FigIcon src={figAsset.close} size={20} />
          </IconButton>
        </div>

        {importing ? (
          status.step === 'done' ? (
            /* 完成态:√ + 导入已完成;停留由 action 承担,resolve 后自动退场 */
            <div className="flex flex-col items-center gap-3 py-8">
              <FigIcon src={figAsset.checkCircle} size={28} tone="primary" className="text-[var(--color-primary)]" />
              <span className="text-[13px] tracking-[-0.13px] text-[var(--color-ink)]">{stepText}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 size={24} className="animate-spin text-[var(--color-primary)]" />
              <span className="text-[13px] tracking-[-0.13px] text-[var(--color-muted)]">{stepText}</span>
            </div>
          )
        ) : (
          <>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) start(f);
              e.target.value = '';   // 允许再次选择同名文件(取消后重试同文件)
            }} />
            {/* 拖放区(拉高):虚线框+上传图标+提示+显式 Choose File 按钮(Figma 955-49013) */}
            <div
              role="button"
              tabIndex={0}
              aria-label={t('chat.importGame.chooseFile')}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) start(f);
              }}
              className={`flex h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-[12px] border border-dashed bg-[var(--color-fill)] px-3 transition-colors hover:border-[var(--color-primary)] ${dragOver ? 'border-[var(--color-primary)]' : 'border-[var(--color-line-2)]'}`}
            >
              <FigIcon src={figAsset.upload} size={24} />
              <span className="w-full truncate text-center text-[13px] tracking-[-0.13px] text-[var(--color-muted)]">{t('chat.importGame.chooseFile')}</span>
              {/* 恒色 CTA(同 .btn-raised 例外语义):品牌橙胶囊,文字恒深色,不随主题翻转 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                className="flex h-[32px] items-center rounded-[360px] bg-[var(--color-primary)] px-[32px] text-[15px] font-bold leading-[18px] tracking-[0.26px] text-[#171717] transition-transform motion-safe:active:scale-[0.97]"
              >
                {t('chat.importGame.chooseFileButton')}
              </button>
            </div>
          </>
        )}

        {importing && confirmingCancel && (
          /* 行内二次确认:就地出现在底部,不叠第二层模态 */
          <div className="flex items-center justify-end gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-ink)]">{t('chat.importGame.confirmCancelText')}</span>
            <button type="button" onClick={() => setConfirmingCancel(false)} className="h-10 shrink-0 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.keepImporting')}</button>
            <button type="button" onClick={() => { cancelImportArchive(); setConfirmingCancel(false); }} className="h-10 shrink-0 rounded-[10px] px-4 text-[13px] font-semibold text-[#e5484d] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.confirmCancel')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
