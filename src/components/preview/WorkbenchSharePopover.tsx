'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import Button from '@/components/ui/Button';
import Switch from '@/components/ui/Switch';
import { FigIcon, figAsset } from '@/components/ui/figma';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { track, projectPublicId } from '@/lib/analytics';

// 分享工作台弹窗:挂载即读取当前分享状态(pgc get)并默认开启分享,开/关由标题行右侧的开关承担——
// 拨开=以当前活跃 session 开启(pgc enable),拨关=停止分享(pgc disable),操作后弹窗不关闭、就地翻状态。
// 与「分享游戏」(只读单版本直链)区分:此处对方得到含对话的完整可编辑副本。复用 SharePopover 模态范式。
export default function WorkbenchSharePopover({
  projectId, sessionId, onClose,
}: { projectId: number; sessionId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const setWarning = useStore((s) => s.setWarning);
  const setError = useStore((s) => s.setError);
  const setAuthRequired = useStore((s) => s.setAuthRequired);
  const { closing, requestClose } = useRequestClose(onClose, 200);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'enabling' | 'disabling'>('idle');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 卸载清理复制反馈定时器
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // 落地一次分享状态回执(get / enable / disable 统一收口):同步 enabled + share_url
  const applyPolicy = (data: { enabled: boolean; share_url: string | null }) => {
    setEnabled(data.enabled);
    setShareUrl(data.share_url);
  };

  // 挂载即读取当前分享状态;点「分享」本身就是分享意图,后端未开启时默认自动开启(enable 幂等),
  // 用户拿到链接即可复制,仍可随后拨关。开启失败不乐观翻转开关,状态保持后端事实。
  // StrictMode(dev)双挂载:守卫(aborted)在每次 setup 内重置,重放的 effect 重新走一遍(get / enable 均幂等)。
  useEffect(() => {
    let aborted = false;
    void (async () => {
      let stage: 'get' | 'enable' = 'get';
      try {
        const data = await pgcApi.workbenchShare.get(projectId);
        if (aborted) return;
        applyPolicy(data);
        if (!data.enabled) {
          stage = 'enable';
          setBusy('enabling');
          const on = await pgcApi.workbenchShare.enable(projectId, sessionId);
          if (aborted) return;
          applyPolicy(on);
        }
      } catch (e) {
        if (aborted) return;
        // 401 = 未登录:置 authRequired 走全局登录门闸(useAuthGuard 消费),不弹红色报错
        if (e instanceof PgcError && e.status === 401) {
          setAuthRequired();
        } else {
          const fallback = stage === 'enable' ? 'WORKBENCH_SHARE_ENABLE_FAILED' : 'WORKBENCH_SHARE_GET_FAILED';
          setError({ code: e instanceof PgcError ? e.code : fallback, message: t('preview.workbenchShare.failed') });
        }
      } finally {
        if (!aborted) {
          setLoading(false);
          setBusy('idle');
        }
      }
    })();
    return () => { aborted = true; };
  }, [projectId, sessionId, setAuthRequired, setError, t]);

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      track('game_link_copy', { game_id: projectPublicId(), project_id: projectPublicId() });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用(非 https / 无权限):走全局 Toast 提示手动复制
      setWarning({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually' });
    }
  };

  // 开关拨动:拨开=以当前活跃 session 钉扎开启(enable 幂等)取回 share_url;
  // 拨关=停止分享(新打开的 link 不可 materialize,已 fork 出的副本不受影响)。
  // 失败时不乐观翻转开关,状态保持后端事实。
  const toggle = async (next: boolean) => {
    if (busy !== 'idle') return;
    setBusy(next ? 'enabling' : 'disabling');
    try {
      applyPolicy(next
        ? await pgcApi.workbenchShare.enable(projectId, sessionId)
        : await pgcApi.workbenchShare.disable(projectId));
    } catch (e) {
      if (e instanceof PgcError && e.status === 401) setAuthRequired();
      else setError({ code: e instanceof PgcError ? e.code : next ? 'WORKBENCH_SHARE_ENABLE_FAILED' : 'WORKBENCH_SHARE_DISABLE_FAILED', message: t('preview.workbenchShare.failed') });
    } finally {
      setBusy('idle');
    }
  };

  // 派生渲染态:是否有可复制链接 / 输入框文案
  const showUrl = enabled && !!shareUrl;
  const inputValue = loading || busy === 'enabling'
    ? t('preview.workbenchShare.preparing')
    : showUrl ? shareUrl! : t('preview.workbenchShare.closed');

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-[var(--color-scrim)] p-8" data-closing={closing} onClick={requestClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[480px] flex-col gap-3 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        {/* 无关闭按钮:Esc / 点遮罩关闭(与画布生成表单等轻量弹窗一致) */}
        {/* 标题行:左标题 + 右「Sharing off/on」文案 + 开关(loading 期开关禁用,不下判断) */}
        <div className="flex items-center justify-between gap-4">
          <span className="truncate text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[var(--color-ink)]">{t('preview.workbenchShare.title')}</span>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="whitespace-nowrap text-[13px] tracking-[-0.14px] text-[var(--color-muted)]">
              {enabled ? t('preview.workbenchShare.sharingOn') : t('preview.workbenchShare.sharingOff')}
            </span>
            <Switch
              checked={enabled}
              disabled={loading || busy !== 'idle'}
              onChange={(v) => void toggle(v)}
              ariaLabel={t('preview.workbenchShare.title')}
            />
          </div>
        </div>
        <span className="text-[13px] leading-5 tracking-[-0.14px] text-[var(--color-muted)]">{t('preview.workbenchShare.desc')}</span>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={inputValue}
            onFocus={(e) => e.currentTarget.select()}
            className={`h-10 min-w-0 flex-1 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[13px] tracking-[-0.14px] outline-none focus:border-[var(--color-primary)] ${showUrl ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}`}
          />
          <Button type="button" aria-label={t('preview.copyLink')} className="h-10 shrink-0 px-3.5 text-[13px]" disabled={!showUrl || busy !== 'idle'} onClick={() => void copy()}>
            <FigIcon src={copied ? figAsset.check : figAsset.copy} size={14} />
            {copied ? t('preview.copied') : t('preview.copy')}
          </Button>
        </div>
      </div>
    </div>
  );
}
