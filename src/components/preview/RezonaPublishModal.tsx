'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { pgcApi, uploadProjectCover, PgcError } from '@/lib/pgc/client';
import {
  newIdempotencyKey, mapRezonaError, isUnavailable, mapCoverUploadError, defaultTarget, REZONA_TITLE_MAX, type PublishTarget,
} from '@/lib/rezona/publish';
import { resolveAssetUrl } from '@/lib/pgc/url';
import { track, projectPublicId } from '@/lib/analytics';
import type { Version } from '@/store/types';
import type { RezonaGameData } from '@/lib/pgc/types';
import PublishForm, { type PublishFormValue, type TargetPicker } from './rezona/PublishForm';
import PostingStep from './rezona/PostingStep';
import PublishedStep from './rezona/PublishedStep';

type Step = 'form' | 'posting' | 'published';

// Rezona 发布模态:填表 → 发布中 → 发布成功。账号匹配/建号由服务端在发布时完成,
// 前端不再有绑定态与扫码步骤(设计稿 docs/.../2026-08-12-rezona-publish-direct-design.md)。
// 外壳沿用 SharePopover 范式(modal-backdrop/modal-pop)。
export default function RezonaPublishModal({
  projectId, projectName, version, onClose,
}: { projectId: number; projectName: string; version: Version; onClose: () => void }) {
  const { t } = useTranslation();
  const setError = useStore((s) => s.setError);
  // 账号行显示的是当前 lab 用户(Rezona 账号发布前拿不到);PublishForm 保持纯展示件,由本壳注入
  const userInfo = useStore((s) => s.userInfo);
  const { closing, requestClose } = useRequestClose(onClose, 200);

  const [step, setStep] = useState<Step>('form');
  const [shareUrl, setShareUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null); // 用户上传的项目封面(仅展示,不进发布请求)
  const [coverUploading, setCoverUploading] = useState(false);
  // 名字默认取当前项目名(即用户看到的游戏名,Bug 13360684);PGC 版本常无 title、映射层会兜底成
  // 'GAME' 字面量,故项目名优先,版本游戏名仅作项目名缺失时的回落。
  // maxLength 只拦用户输入,程序预填的名字可能超限,需显式截断。
  const [form, setForm] = useState<PublishFormValue>(() => ({
    name: (projectName || version.game.title || '').slice(0, REZONA_TITLE_MAX),
    summary: '',
    toggles: { public: true, sync_to_community: true },
  }));
  // 弹窗打开时生成一次(useState 惰性初始化,不像 useRef(newIdempotencyKey()) 那样每次渲染白算一个 UUID);
  // 同一次发布意图重试复用同一个 key,仅 IDEMPOTENCY_CONFLICT 时换新(契约 §7)
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  // 本次弹窗内累计的「不可用」失败次数(非不可用错误不参与累加,成功清零):
  // 契约 §6 要求第 3 次起改口径为联系支持,不劝用户一直点。关掉弹窗重开即重新计数,属可接受的宽松边界。
  const unavailableFails = useRef(0);
  const mountedRef = useRef(true);
  // setup 里重置 true:StrictMode(dev)双调用会先跑 cleanup(置 false)再跑 setup,
  // 若只在 cleanup 置 false 会导致挂载后恒为 false → 后续 await 后守卫全部提前返回。
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // 发布目标(spec 2026-09-23):打开即拉本项目已导入的游戏,就绪前 CTA 禁用。
  // 默认目标只在首次拿到列表时套用一次;目标失效(REZONA_GAME_NOT_FOUND)后的重拉保持 null,逼用户明确重选
  const [games, setGames] = useState<RezonaGameData[]>([]);
  const [gamesStatus, setGamesStatus] = useState<TargetPicker['status']>('loading');
  const [target, setTarget] = useState<PublishTarget>(null);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const defaultPending = useRef(true);
  const loadGames = useCallback(async () => {
    setGamesStatus('loading');
    try {
      const { items } = await pgcApi.rezona.listGames(projectId);
      if (!mountedRef.current) return;
      setGames(items);
      if (defaultPending.current) { defaultPending.current = false; setTarget(defaultTarget(items)); }
      setGamesStatus('ready');
    } catch (e) {
      if (!mountedRef.current) return;
      setGamesStatus('error');
      // pgc() 已把超时 / 断网归一成 PgcError,剩下的只可能是 bug:置失败态后照抛,不吞
      if (!(e instanceof PgcError)) throw e;
    }
  }, [projectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载即拉外部数据,loading 态由请求驱动,无法在渲染期派生
  useEffect(() => { void loadGames(); }, [loadGames]);
  // 换目标 = 新发布意图:game_id 参与后端幂等指纹,同 key 换目标会撞 IDEMPOTENCY_CONFLICT(契约 §7)
  const changeTarget = useCallback((next: Exclude<PublishTarget, null>) => {
    if (next === target) return;
    setTarget(next);
    setIdemKey(newIdempotencyKey());
  }, [target]);

  // Esc 关闭;目标菜单展开时让它自行收起(Select 内部处理),不连带关弹窗(同 GenerateForm)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !targetMenuOpen) requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, targetMenuOpen]);

  // 上传自定义封面 = 替换项目级封面(POST /projects/{id}/cover,PR #272);
  // 发布仍恒带 version_cover —— Rezona 侧封面由后端后续迭代支持(产品确认的预期行为)。
  const uploadCover = useCallback(async (file: File) => {
    setCoverUploading(true);
    try {
      const p = await uploadProjectCover(projectId, file);
      if (!mountedRef.current) return;
      setCoverUrl(resolveAssetUrl(p.cover_url) ?? null);
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof PgcError) setError({ code: e.code, message: t(mapCoverUploadError(e.code)) });
      else setError({ code: 'REZONA_COVER_UPLOAD_FAILED', message: t('preview.rezona.err.coverUpload') });
    } finally {
      if (mountedRef.current) setCoverUploading(false);
    }
  }, [projectId, setError, t]);

  // 发布
  const submit = useCallback(async () => {
    if (target === null) return; // CTA 已禁用,此处只为收窄类型
    track('game_export_submit', {
      target: 'rezona', project_id: projectPublicId(), version_id: version.id, rezona_mode: target === 'new' ? 'create' : 'update',
    });
    // 菜单展开时键盘 Tab 到 CTA 也能提交(遮罩只挡指针):表单随 posting 卸载,Select 来不及回报收起,
    // 这里不复位的话展开态残留为 true,之后 Esc 永远让给一个已不存在的菜单
    setTargetMenuOpen(false);
    setStep('posting');
    try {
      const res = await pgcApi.rezona.publish(projectId, {
        // 创建时不带 game_id 键,保持旧请求 JSON 形状
        ...(target !== 'new' && { game_id: target }),
        version_id: `v${version.index}`,
        name: (form.name.trim() || projectName || version.game.title).slice(0, REZONA_TITLE_MAX),
        summary: form.summary.trim(),
        cover_ref: 'version_cover',
        public: form.toggles.public,
        sync_to_community: form.toggles.sync_to_community,
        idempotency_key: idemKey,
      });
      if (!mountedRef.current) return;
      unavailableFails.current = 0;
      setShareUrl(res.share_url); setStep('published');
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof PgcError) {
        // ≥500 且无业务信封(resolveEnvelope 只能给出 HTTP_ERROR)一律按「上游不可达」处理:
        // 本服务 pgc 代理不可达时路由层不兜底,对外是**裸 500**(见 src/server/pgc/proxy.ts 的注释),
        // LB 侧则可能是 502/503。不在边界归一的话这些都落进通用文案且不计数,契约 §6 的递增收口永不触发。
        const code = e.code === 'HTTP_ERROR' && e.status >= 500 ? 'REZONA_UNAVAILABLE' : e.code;
        const ux = mapRezonaError(code, unavailableFails.current, e.requestId != null);
        if (isUnavailable(code)) unavailableFails.current += 1;
        // 上报归一后的 code:文案由它选出,同源才不会被 Toast 的 ERROR_KEYS 按原 code 反向改写
        setError({ code, message: t(ux.messageKey, { requestId: e.requestId ?? '' }) });
        if (ux.resetIdempotency) setIdemKey(newIdempotencyKey()); // 同 key 不同体 → 换新 key 原地重试
        if (ux.resetTarget) { setTarget(null); void loadGames(); } // 目标失效:清空 + 重拉,不自动回选
        setStep('form');
      } else { setStep('form'); throw e; }
    }
  }, [projectId, projectName, version, form, idemKey, target, loadGames, setError, t]);

  // portal 到 body:本组件挂在 Preview overlay(z-20)内,其 z-index 形成局部 stacking context,
  // 弹窗的 z-40 只在其中生效,外层比较时整体压在分隔条(z-30)之下 → 竖线透视(Bug 13352126)
  // 发布中误触遮罩会打断流程,一律不由遮罩关闭(Esc/✕ 仍可关)
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing}>
      <div data-closing={closing}
        className="modal-pop flex max-h-[85vh] w-[400px] flex-col overflow-y-auto scrollbar-none rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        {/* 字标按稿(8905:73026)是纯文本、无 `> ` 前缀,与 ApkExportModal 的写法刻意不同 */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-extrabold uppercase leading-[16px] text-[var(--color-primary)]">
            {t('preview.rezona.badge')}
          </span>
          {/* -my-1:稿上字标行只有 16 高(close 图标 16),但按钮要留 24 的点击区——
              负外边距让多出的 8px 不参与布局,行高与稿一致 */}
          <button type="button" aria-label={t('common.close')} onClick={requestClose}
            className="-my-1 grid size-6 place-items-center rounded-[6px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">
            <X size={16} />
          </button>
        </div>
        {step === 'form' && (
          <PublishForm picker={{
            status: gamesStatus, games, value: target, onChange: changeTarget,
            onRetry: () => void loadGames(), onMenuOpenChange: setTargetMenuOpen,
          }} user={userInfo} coverUrl={coverUrl ?? version.cover} coverUploading={coverUploading}
            onUploadCover={(file) => void uploadCover(file)} value={form} onChange={setForm}
            versionReady={version.status === 'ready'} onSubmit={() => void submit()} />
        )}
        {step === 'posting' && <PostingStep />}
        {step === 'published' && <PublishedStep shareUrl={shareUrl} />}
      </div>
    </div>,
    document.body,
  );
}
