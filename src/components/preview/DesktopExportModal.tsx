'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import {
  mapDesktopError, isDesktopTerminal, defaultDesktopName, sanitizeDesktopName,
  isValidDesktopName, formatPackageSize, desktopDownloadPath,
  DESKTOP_NAME_MAX, DESKTOP_POLL_INTERVAL_MS,
} from '@/lib/desktop-export';
// 耗时格式化(m:ss)无 apk 语义,复用而非再抄一份:两条链路都是「客户端从发起时刻计量」
import { formatBuildDuration } from '@/lib/apk-export';
import { apiPath } from '@/lib/basePath';
import { track, projectPublicId } from '@/lib/analytics';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { Version } from '@/store/types';

type Step = 'form' | 'building' | 'done' | 'failed';

// 导出为 Steam 内容包模态(spec 2026-08-26-export-steam-package):form → building → done | failed。
// 与 ApkExportModal 并列而非复用:那边是 apk-builds 端点族 + 签发免登录链 + 4MB 产物 + 扫码装机,
// 这边是 desktop-builds + 无签发端点 + 138MB 流式下载 + 无扫码意义(spec §与既有链路的关系)。
// 共用的只有视觉语汇:外壳沿用 modal-backdrop/modal-pop + portal 到 body(遮罩不关闭,防误触打断流程),
// 颜色全部映射语义令牌以随主题适配,橙色 CTA 文字恒白(--color-on-primary-strong,与 apk / Topup 同口径)。
// 路径段用项目 publicId(后端文档的 project_id 系笔误,与 apk 同);**不收数值 projectId** ——
// apk 那个只为图标上传服务,桌面链路无图标。
export default function DesktopExportModal({
  publicId, projectName, version, onClose,
}: {
  publicId: string; projectName: string; version: Version | null; onClose: () => void;
}) {
  const { t } = useTranslation();
  const setError = useStore((s) => s.setError);
  const { closing, requestClose } = useRequestClose(onClose, 200);

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState(() => defaultDesktopName(projectName));
  const [buildId, setBuildId] = useState<number | null>(null);
  const [failureText, setFailureText] = useState<string | null>(null);
  // 以下两项取自状态端点回执,不是本地推导
  const [packageSize, setPackageSize] = useState<number | null>(null);
  const [externalRefs, setExternalRefs] = useState(0);
  // 构建耗时:发起时刻快照 → 终态时定格(API 不回耗时,客户端计量)
  const buildStartRef = useRef(0);
  const [buildDuration, setBuildDuration] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // setup 里重置 true:StrictMode(dev)双调用先跑 cleanup 再跑 setup,只在 cleanup 置 false 会恒 false
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const nameInvalid = !isValidDesktopName(name);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 发起构建;失败回 form 并 Toast 已知错误(guard 之外的未知错误照抛)
  const submit = useCallback(async () => {
    if (!version || nameInvalid) return;
    // 先清旧作业态再进 building:否则轮询 effect 会拿上一次(失败)的 buildId 打旧作业(重试竞态)
    setFailureText(null); setBuildId(null); setPackageSize(null); setExternalRefs(0);
    setStep('building');
    buildStartRef.current = Date.now();
    track('game_export_submit', { target: 'steam', project_id: projectPublicId(), version_id: version.id });
    try {
      const d = await pgcApi.desktop.create(publicId, {
        version_id: `v${version.index}`,
        name: sanitizeDesktopName(name),
      });
      if (!mountedRef.current) return;
      // 终态(含幂等命中已完成的作业)统一交给轮询 effect 的首个立即 tick 处理,
      // 保证 package_size / external_ref_count 恒经 status 端点取到
      setBuildId(d.build_id);
    } catch (e) {
      if (!mountedRef.current) return;
      setStep('form');
      if (e instanceof PgcError) setError({ code: e.code, message: t(mapDesktopError(e.code)) });
      else throw e;
    }
  }, [publicId, version, name, nameInvalid, setError, t]);

  // building 期轮询:首次立即 tick(幂等命中已终态即时反映),此后按契约建议间隔推进至终态;
  // 仅瞬时错误(超时/断网/限流/5xx)继续下一轮,确定性错误停轮报失败;卸载/离开 building 即停。
  // **刻意无总超时**:契约没给构建耗时,凭空定阈值会把正在跑的作业误杀(spec 约束 4,已记待办)
  useEffect(() => {
    if (step !== 'building' || buildId == null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await pgcApi.desktop.status(publicId, buildId);
        if (!alive) return;
        setPackageSize(d.package_size ?? null);
        setExternalRefs(d.external_ref_count ?? 0);
        if (isDesktopTerminal(d.status)) {
          // succeeded 但产物未就绪是后端不一致态,下载必 409 → 按失败处理
          if (d.status === 'succeeded' && d.download_available) {
            setBuildDuration(formatBuildDuration(Date.now() - buildStartRef.current));
            setStep('done');
          } else {
            setFailureText(d.status === 'failed' ? (d.failure_category ?? null) : null);
            setStep('failed');
          }
          return;
        }
      } catch (e) {
        if (!alive) return;
        const transient = e instanceof PgcError && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500);
        if (!transient) {
          setError(e instanceof PgcError
            ? { code: e.code, message: t(mapDesktopError(e.code)) }
            : { code: 'DESKTOP_POLL_ERROR', message: t('preview.steam.err.generic') });
          setFailureText(null); setStep('failed');
          return;
        }
      }
      timer = setTimeout(() => void tick(), DESKTOP_POLL_INTERVAL_MS);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [step, buildId, publicId, setError, t]);

  // 下载:浏览器原生导航到本服务代理路径。**不用 blob** —— 138MB 契约明写不要整读进内存;
  // 代理流式直传 res.body,cookie 同源自动带(本地开发由代理层 DEV_COOKIE 兜住)
  const downloadHref = buildId != null ? apiPath(desktopDownloadPath(publicId, buildId)) : undefined;
  const sizeText = formatPackageSize(packageSize);

  // 设计令牌映射:标签 11px 粗体大写 muted;橙色 CTA 胶囊(rounded-24,文字恒白 —— 与 ApkExportModal /
  // TopupModal / CreditUpsellModal 的橙底 CTA 同口径,不写死 text-black)
  const labelCls = 'text-[11px] font-bold uppercase text-[var(--color-muted)]';
  const primaryBtnCls = 'flex w-full items-center justify-center rounded-[24px] bg-[var(--color-primary)] px-4 py-[10px] text-[13px] font-bold text-[var(--color-on-primary-strong)] transition-[transform,filter,opacity] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30';

  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing}>
      <div data-closing={closing}
        className="modal-pop flex w-[440px] flex-col gap-6 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-extrabold uppercase leading-[12px] tracking-[1.5px] text-[var(--color-primary)]">
            {`> ${t('preview.steam.badge')}`}
          </span>
          <button type="button" aria-label={t('common.close')} onClick={requestClose}
            className="grid size-6 place-items-center rounded-[6px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">
            <X size={16} />
          </button>
        </div>

        {step === 'form' && (
          <>
            <h2 className="text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">
              {t('preview.steam.title')}
            </h2>
            <div className="flex flex-col gap-2">
              <span className={labelCls}>{t('preview.steam.nameLabel')}</span>
              <label className={`flex items-center justify-between gap-2 rounded-[8px] border bg-[var(--color-fill)] p-3 focus-within:border-[var(--color-primary)] ${nameInvalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-line)]'}`}>
                <input value={name} maxLength={DESKTOP_NAME_MAX}
                  aria-label={t('preview.steam.nameLabel')}
                  placeholder={t('preview.steam.namePlaceholder')}
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
                  onChange={(e) => setName(e.target.value)} />
                <FigIcon src={figAsset.pencil} size={14} />
              </label>
              {/* 非法时行内说明取代常规提示:否则导出钮只是静默变灰,用户不知道卡在哪一格 */}
              <p className="text-[11px] leading-[16px] text-[var(--color-muted)]">
                {nameInvalid ? t('preview.steam.nameInvalid') : t('preview.steam.formHint')}
              </p>
            </div>
            {/* Steam 前置条件放在**发起前**:构建有真实成本且在途配额只有 2,
                让用户先知道「没 App ID 拿到 zip 也没法上传」比事后说有用 */}
            <p className="text-[11px] leading-[16px] text-[var(--color-muted)]">{t('preview.steam.appIdHint')}</p>
            <button type="button" className={primaryBtnCls}
              disabled={!version || nameInvalid}
              onClick={() => void submit()}>
              {t('preview.steam.start')}
            </button>
          </>
        )}

        {step === 'building' && (
          <div className="flex flex-col items-center gap-6 py-8">
            <span role="status" aria-label={t('preview.steam.building')}
              className="block size-16 animate-spin rounded-full border-4 border-[var(--color-line-2)] border-t-[var(--color-primary)]" />
            <p className="text-center text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">{t('preview.steam.building')}</p>
            {/* 幂等语义代替总超时:关掉弹窗不丢作业,同标题重导会接上(spec 约束 4) */}
            <p className="text-center text-[11px] leading-[16px] text-[var(--color-muted)]">{t('preview.steam.buildingHint')}</p>
          </div>
        )}

        {step === 'done' && buildId != null && (
          <>
            <h2 className="text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">{t('preview.steam.done')}</h2>
            {/* download 给显式文件名兜底:后端真发 Content-Disposition 时以它为准(同源下 CD 优先),
                但万一没发,空 download 会取 URL 末段 → 用户存下一个无扩展名、叫 download 的 138MB
                文件,Windows 双击打不开 */}
            <a href={downloadHref} download={`${sanitizeDesktopName(name) || 'game'}-steam-win64.zip`}
              onClick={() => track('game_desktop_download', { project_id: projectPublicId() })}
              className={primaryBtnCls}>
              {t('preview.steam.download')}
            </a>
            <div className="flex flex-col gap-[2px] text-[10px] leading-[12px] tracking-[0.15px] text-[var(--color-muted)]">
              {sizeText && <span>{t('preview.steam.sizeMeta', { size: sizeText })}</span>}
              {buildDuration && <span>{t('preview.steam.buildTimeMeta', { time: buildDuration })}</span>}
            </div>
            {/* 只提示不拦截:准入行为后端未拍板(契约明写拍板前前端不要硬拦截)。做成带图标的提示条而非
                一行灰字 —— 它是本页唯一需要用户回头处理的事,混在指路说明里会被略过 */}
            {externalRefs > 0 && (
              <div className="flex items-start gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-fill)] p-3 text-[11px] leading-[16px] text-[var(--color-ink)]">
                <FigIcon src={figAsset.warningSign} size={16} className="shrink-0" />
                <span>{t('preview.steam.externalRefHint', { n: externalRefs })}</span>
              </div>
            )}
            {/* 「上传到 Steam」区:与 aab 完成页的「上传到 Google Play」同构 —— 分隔行 + 三步。
                步骤只到「去看包内 README」为止:完整上传流程与 exe 名都以 README 为单一真相源(spec 约束 3),
                这里不重复;138MB 的 Electron 地板价说明并进第一步,免得用户以为几百 KB 的游戏出了问题 */}
            <div className="flex items-center gap-3">
              <span className="h-px min-w-0 flex-1 bg-[var(--color-line-2)]" />
              <span className="shrink-0 text-[13px] leading-[1.5] text-[var(--color-ink)]">{t('preview.steam.nextSteps')}</span>
              <span className="h-px min-w-0 flex-1 bg-[var(--color-line-2)]" />
            </div>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-[16px] text-[var(--color-muted)]">
              <li>{t('preview.steam.step1')}</li>
              <li>{t('preview.steam.step2')}</li>
              <li>{t('preview.steam.step3')}</li>
            </ol>
          </>
        )}

        {step === 'failed' && (
          <div className="flex flex-col gap-4">
            <p className="text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">{t('preview.steam.failed')}</p>
            <p className="text-[12px] leading-[18px] text-[var(--color-muted)]">{failureText || t('preview.steam.err.generic')}</p>
            <button type="button" className={primaryBtnCls} onClick={() => setStep('form')}>{t('preview.steam.retry')}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
