'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import Button from '@/components/ui/Button';
import Switch from '@/components/ui/Switch';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import type { RemixPolicyData } from '@/lib/pgc/types';
import { remixToggleState } from '@/lib/remix-policy';
import { track, projectPublicId } from '@/lib/analytics';

// 分享弹窗:展示当前选中版本的公开游玩直链 + 一键复制。复用 CreateGameModal 模态范式(modal-* + Esc/点遮罩关闭)。
// 标题行右侧是项目级 Remix 开关(remix-policy),拨开即为**弹窗里这条链接的那个版本**开放 Remix
// (设计稿 2026-08-28-share-remix-toggle)。后端返回的 remix_url 刻意不进 UI:owner 只需要开 / 关这一个语义,
// 挂第二条链接只会让人发错。
export default function SharePopover({
  url, projectId, versionId, versionStatus, onClose,
}: {
  url: string;
  projectId: number | null;
  versionId: string | null;
  versionStatus: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setWarning = useStore((s) => s.setWarning);
  const setError = useStore((s) => s.setError);
  const setAuthRequired = useStore((s) => s.setAuthRequired);
  const { closing, requestClose } = useRequestClose(onClose, 200);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remix 策略:policy 恒是「后端事实」,pending 是在飞的乐观目标态(非 null = 有 PATCH 在飞)
  const [policy, setPolicy] = useState<RemixPolicyData | null>(null);
  const [policyLoading, setPolicyLoading] = useState(projectId != null);
  const [pending, setPending] = useState<boolean | null>(null);
  // 换项目先作废旧事实:本组件不带 key,projectId 变了不重挂,不清就会在新 GET 落地前
  // 拿旧项目的策略当真,开关可点、一点就按旧事实对新项目发 PATCH。
  // 渲染期一次性 guard setState(遵守仓库禁 effect-setState 约束,同 PreviewPanel 的 filesMounted)
  const [policyPid, setPolicyPid] = useState(projectId);
  if (policyPid !== projectId) {
    setPolicyPid(projectId);
    setPolicy(null);
    setPolicyLoading(projectId != null);
    setPending(null);
  }

  // 最新 projectId 的镜像:PATCH 的 await 之后据此丢弃过期响应(仓库约定「await 后必校验上下文」)
  const pidRef = useRef(projectId);
  useEffect(() => { pidRef.current = projectId; }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 卸载清理复制反馈定时器
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // 挂载即读当前 Remix 策略。读失败**不弹 Toast** —— 用户点的是「分享」,仅打开弹窗就红字刷屏太吵;
  // 开关转禁用 + 就地给一句说明即可。401 例外:置 authRequired 走全局登录门闸。
  // StrictMode(dev)双挂载:守卫(aborted)在每次 setup 内重置,重放的 effect 重新走一遍(GET 幂等)。
  useEffect(() => {
    if (projectId == null) return;
    let aborted = false;
    void (async () => {
      try {
        const data = await pgcApi.remixPolicy.get(projectId);
        if (!aborted) setPolicy(data);
      } catch (e) {
        if (aborted) return;
        setPolicy(null);
        if (e instanceof PgcError && e.status === 401) setAuthRequired();
      } finally {
        if (!aborted) setPolicyLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [projectId, setAuthRequired]);

  const toggle = remixToggleState({
    policy, pending, activeVersionId: versionId, activeStatus: versionStatus, loading: policyLoading,
  });

  // 开关拨动:乐观置位 → PATCH → 以回执覆盖;失败回滚到后端事实并弹 Toast。
  // 拨开恒绑**当前分享的版本**;拨关不带 version_id(契约里该字段仅开启时必填,传 null 会 422)。
  const setRemix = async (next: boolean) => {
    if (projectId == null || pending != null) return;
    if (next && !versionId) return;
    setPending(next);
    try {
      const data = await pgcApi.remixPolicy.set(projectId, next ? { enabled: true, version_id: versionId! } : { enabled: false });
      if (pidRef.current !== projectId) return; // 已换项目:过期回执不得覆盖新项目的策略视图
      setPolicy(data);
    } catch (e) {
      if (pidRef.current !== projectId) return;
      if (e instanceof PgcError && e.status === 401) setAuthRequired();
      else setError({ code: e instanceof PgcError ? e.code : 'REMIX_POLICY_FAILED', message: t('preview.remix.failed') });
    } finally {
      setPending(null); // 失败即回滚:渲染重新落回 policy(后端事实)
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track('game_link_copy', { game_id: projectPublicId(), project_id: projectPublicId() });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用(非 https / 无权限):走全局 Toast 提示手动复制
      setWarning({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually' });
    }
  };

  // 开关下方的一行小字:不能动的原因优先,其次「策略绑在别的版本」的提示(loading 期不出字,免得闪)
  const note = toggle.reason === 'notBuilt' ? t('preview.remix.notBuilt')
    : toggle.reason === 'unavailable' ? t('preview.remix.unavailable')
    : toggle.boundElsewhere ? t('preview.remix.boundElsewhere', { version: toggle.boundElsewhere })
    : null;

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={requestClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[420px] flex-col gap-4 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]"
      >
        {/* 标题行:左标题 + 右 Remix 开关(照 WorkbenchSharePopover 的 justify-between 范式) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="truncate text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('preview.shareGame')}</span>
            {projectId != null && (
              <div className="flex shrink-0 items-center gap-2.5">
                <span className="whitespace-nowrap text-[13px] tracking-[-0.14px] text-[var(--color-muted)]">{t('preview.remix.label')}</span>
                <Switch
                  checked={toggle.checked}
                  disabled={toggle.disabled}
                  onChange={(v) => void setRemix(v)}
                  ariaLabel={t('preview.remix.label')}
                />
              </div>
            )}
          </div>
          {note && <span className="text-[12px] leading-4 text-[var(--color-muted)]">{note}</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            autoFocus
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 min-w-0 flex-1 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[13px] tracking-[-0.14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
          />
          <Button type="button" aria-label={t('preview.copyLink')} className="h-11 shrink-0 px-4" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? t('preview.copied') : t('preview.copy')}
          </Button>
        </div>
      </div>
    </div>
  );
}
