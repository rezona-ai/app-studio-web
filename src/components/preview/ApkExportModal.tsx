'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { pgcApi, uploadCanvasItem, PgcError } from '@/lib/pgc/client';
import {
  mapApkError, isApkTerminal, defaultApkName, formatBuildDuration, buildApkRequest,
  isValidPackageName, isValidVersionName, isValidVersionCode,
  APK_NAME_MAX, APK_POLL_INTERVAL_MS, AAB_VERSION_NAME_MAX, PACKAGE_NAME_MAX,
  DEFAULT_VERSION_NAME, DEFAULT_VERSION_CODE,
} from '@/lib/apk-export';
import type { ApkOutputFormat } from '@/lib/pgc/types';
import { qrSvg } from '@/lib/rezona/qr';
import { track, projectPublicId } from '@/lib/analytics';
import { resolveAssetUrl } from '@/lib/pgc/url';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { Version } from '@/store/types';

type Step = 'form' | 'building' | 'done' | 'failed';

// 导出为 Android 应用模态(Figma 4857:45122 表单 / 4857:45104 打包中 / 4857:45176 完成):
// form → building → done | failed。发起构建后按契约建议 3.5s 轮询状态;卸载即停
// (构建服务端继续,重开重提交幂等命中同一作业)。外壳沿用 RezonaPublishModal 范式
// (modal-backdrop/modal-pop + portal 到 body,遮罩不关闭防误触打断流程)。
// 设计稿为深色定稿,颜色全部映射语义令牌以随主题适配;橙色 CTA 文字恒黑(同 .btn-raised 例外)。
// projectId(数值)仅供画布图标上传;APK 三端点路径段一律走 publicId(后端文档的 project_id 系笔误)
// 两种产物格式(apk 侧载 / aab 传自己的 Google Play)共用这一套外壳与轮询:后端是同一套 apk-builds
// 端点,差异只在表单三个 aab 必填字段与 done 页(bundle 装不进手机,故无扫码区,改回显包名)。
// format 由**菜单入口**定(两个独立菜单项),模态内不再能切 —— 一次打开只做一种产物
export default function ApkExportModal({
  projectId, publicId, projectName, version, format, onClose,
}: {
  projectId: number; publicId: string; projectName: string; version: Version | null;
  format: ApkOutputFormat; onClose: () => void;
}) {
  const { t } = useTranslation();
  const setError = useStore((s) => s.setError);
  const userInfo = useStore((s) => s.userInfo);
  const { closing, requestClose } = useRequestClose(onClose, 200);

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState(() => defaultApkName(projectName));
  // aab 三必填。包名**不预填服务端派生值**:那是 Rezona 命名空间,首次上传 Play 后永久不可改、
  // 全 Play 唯一,填错只能弃用重开应用 —— 预填等于诱导用户把我们的命名空间烧进他自己的应用。
  // 但**用户自己上次为本项目填过的值**要记住并回填:同一应用的后续版本必须用同一个 applicationId,
  // 每次凭记忆重敲是这条链路唯一不可逆的错误点(见 store.packageNameByProject)
  const rememberedPackage = useStore((s) => s.packageNameByProject[String(projectId)] ?? '');
  const rememberPackageName = useStore((s) => s.rememberPackageName);
  const [packageName, setPackageName] = useState(rememberedPackage);
  const [versionName, setVersionName] = useState(DEFAULT_VERSION_NAME);
  // 字符串态:输入框允许中间态(空串 / 前导零),提交前经 isValidVersionCode 收口
  const [versionCodeInput, setVersionCodeInput] = useState(String(DEFAULT_VERSION_CODE));
  // 应用图标:上传成画布图片 item,构建请求带 icon_item_id(契约唯一图标来源);缺省服务端用默认图标
  const [iconItemId, setIconItemId] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [buildId, setBuildId] = useState<number | null>(null);
  const [failureText, setFailureText] = useState<string | null>(null);
  const [networked, setNetworked] = useState(false);
  // 以下三项是**服务端回的实际烧进产物的值**,不是表单输入:versionCode 计数器只升不降,
  // 可能顶高用户填的值;done 页回显一律用这份
  const [builtVersionCode, setBuiltVersionCode] = useState<number | null>(null);
  const [builtFormat, setBuiltFormat] = useState<ApkOutputFormat | null>(null);
  const [builtPackageName, setBuiltPackageName] = useState<string | null>(null);
  const [builtVersionName, setBuiltVersionName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 构建耗时:发起时间快照 → 终态时定格(完成卡 Build time 行;API 不回耗时,客户端计量)
  const buildStartRef = useRef(0);
  const [buildDuration, setBuildDuration] = useState<string | null>(null);
  // 免登录能力式下载链接:本地下载与扫码共用一条(download-link 端点签发,每次轮换 token)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // 下载链签发的作业令牌:重新提交即 ++,作废在飞的上一次签发。只守 mountedRef 不够 ——
  // 慢回来的旧签发会把新作业的链接覆盖掉。当前 UI 下 done 页没有再次提交的入口,故这条路径
  // 暂不可达(测试也构造不出),留作防回归:日后 done 页一旦加「重新导出」就会立刻用上
  const mintSeq = useRef(0);
  // setup 里重置 true:StrictMode(dev)双调用先跑 cleanup 再跑 setup,只在 cleanup 置 false 会恒 false
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // 卸载清理复制反馈定时器
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // aab 表单闸门:三项都合法才放行(不合法不发请求,不靠后端 422 兜底)
  const packageInvalid = packageName.trim() !== '' && !isValidPackageName(packageName);
  const versionNameInvalid = !isValidVersionName(versionName);
  const versionCodeInvalid = !isValidVersionCode(Number(versionCodeInput));
  const aabReady = isValidPackageName(packageName)
    && isValidVersionName(versionName)
    && isValidVersionCode(Number(versionCodeInput));

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 上传应用图标 → 画布图片 item(会同时出现在画布,契约即如此设计)
  const uploadIcon = useCallback(async (file: File) => {
    setIconUploading(true);
    try {
      const item = await uploadCanvasItem(projectId, file);
      if (!mountedRef.current) return;
      setIconItemId(item.item_id);
      setIconUrl(resolveAssetUrl(item.thumbnail_url ?? item.url ?? null) ?? null);
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof PgcError) setError({ code: e.code, message: t('preview.apk.err.iconUpload') });
      else throw e;
    } finally {
      if (mountedRef.current) setIconUploading(false);
    }
  }, [projectId, setError, t]);

  // 签发下载链接(进入 done 时调用):owner 签发免登录能力链,每次轮换 token 失效旧链
  const mintLink = useCallback(async (id: number) => {
    const seq = ++mintSeq.current;
    // 先清空旧链接:新 mint 提交即失效旧 token,期间不展示已作废的二维码/下载按钮
    setDownloadUrl(null);
    try {
      const d = await pgcApi.apk.createDownloadLink(publicId, id);
      if (!mountedRef.current || seq !== mintSeq.current) return;
      setDownloadUrl(d.download_url);
    } catch (e) {
      if (!mountedRef.current || seq !== mintSeq.current) return;
      if (e instanceof PgcError) setError({ code: e.code, message: t('preview.apk.err.link') });
      else throw e; // 非预期错误(编程错误/异常响应)不静默
    }
  }, [publicId, setError, t]);

  // 发起构建;失败回 form 并 Toast 已知错误(guard 之外的未知错误照抛)
  const submit = useCallback(async () => {
    if (!version) return;
    // 先清旧作业态再进 building:否则轮询 effect 会拿上一次(失败)的 buildId 打旧作业(重试竞态)
    setFailureText(null); setDownloadUrl(null); setBuildId(null);
    mintSeq.current++;            // 同上:重新提交后,上一次签发的链接不再属于当前作业
    setStep('building');
    buildStartRef.current = Date.now();
    track('game_export_submit', { target: format, project_id: projectPublicId(), version_id: version.id });
    // 记住包名:发起构建的这一刻才写(用户已确认过的值),不在每次键入时写半截串
    if (format === 'aab') rememberPackageName(projectId, packageName);
    try {
      const d = await pgcApi.apk.create(publicId, buildApkRequest({
        versionId: `v${version.index}`,
        name: name.trim() || defaultApkName(projectName),
        format,
        iconItemId,
        packageName,
        versionName,
        versionCode: Number(versionCodeInput),
      }));
      if (!mountedRef.current) return;
      // 终态(含 succeeded 幂等命中)统一交给轮询 effect 的首个立即 tick 处理,
      // 保证 networked/version_code 恒经 status 端点取到
      setBuildId(d.build_id);
    } catch (e) {
      if (!mountedRef.current) return;
      setStep('form');
      if (e instanceof PgcError) setError({ code: e.code, message: t(mapApkError(e.code)) });
      else throw e;
    }
  }, [publicId, projectId, projectName, version, name, iconItemId, format, packageName, versionName, versionCodeInput, rememberPackageName, setError, t]);

  // building 期轮询:首次立即 tick(幂等命中已终态即时反映),此后 3.5s 间隔推进至终态;
  // 仅瞬时错误(超时/断网/限流/5xx)继续下一轮,确定性错误停轮询报失败;卸载/离开 building 即停
  useEffect(() => {
    if (step !== 'building' || buildId == null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await pgcApi.apk.status(publicId, buildId);
        if (!alive) return;
        setNetworked(d.networked === true);
        setBuiltVersionCode(d.version_code ?? null);
        setBuiltFormat(d.output_format ?? null);
        setBuiltPackageName(d.package_name ?? null);
        setBuiltVersionName(d.version_name ?? null);
        if (isApkTerminal(d.status)) {
          // succeeded 但产物未就绪是后端不一致态,签发必 404 → 按失败处理
          if (d.status === 'succeeded' && d.download_available) {
            setBuildDuration(formatBuildDuration(Date.now() - buildStartRef.current));
            setStep('done');
            void mintLink(buildId);
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
          setError(e instanceof PgcError ? { code: e.code, message: t(mapApkError(e.code)) } : { code: 'APK_POLL_ERROR', message: t('preview.apk.err.generic') });
          setFailureText(null); setStep('failed');
          return;
        }
      }
      timer = setTimeout(() => void tick(), APK_POLL_INTERVAL_MS);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [step, buildId, publicId, mintLink, setError, t]);

  // 下载二维码:把 QR SVG 打包成文件触发下载(链上内容即下载链接)
  const downloadQr = useCallback(() => {
    if (!downloadUrl) return;
    const qr = qrSvg(downloadUrl);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${qr.size + 4} ${qr.size + 4}"><rect x="-2" y="-2" width="${qr.size + 4}" height="${qr.size + 4}" fill="#fff"/><path d="${qr.path}" fill="#000"/></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${name.trim() || 'apk'}-qr.svg`; a.click();
    URL.revokeObjectURL(url);
  }, [downloadUrl, name]);

  // 包名一键复制:填进 Play Console 时必须与产物完全一致,凭记忆手敲是本链路唯一不可逆的错误
  const shownPackage = builtPackageName ?? packageName.trim();
  const copyPackage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shownPackage);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用(非 https / 无权限):走全局 Toast 提示手动复制
      setError({ code: 'CLIPBOARD', message: t('preview.apk.err.copy') });
    }
  }, [shownPackage, setError, t]);

  // done 页按**作业实际的**产物格式渲染:契约明写客户端据 output_format 判断下载到的是什么、
  // 扩展名该是什么;老后端不回该字段时回落入口选定的格式
  const doneFormat = builtFormat ?? format;
  // 扫码只对 apk 有意义(手机装不了 bundle),故仅 apk 走 QR 编码
  const qr = doneFormat === 'apk' && downloadUrl ? qrSvg(downloadUrl) : null;

  // 设计令牌映射:标签 11px 粗体大写 muted;橙色 CTA 胶囊(rounded-24,文字恒白 —— 与
  // TopupModal / CreditUpsellModal 的橙底 CTA 同口径,不写死 text-black)
  const labelCls = 'text-[11px] font-bold uppercase text-[var(--color-muted)]';
  const primaryBtnCls = 'flex w-full items-center justify-center rounded-[24px] bg-[var(--color-primary)] px-4 py-[10px] text-[13px] font-bold text-[var(--color-on-primary-strong)] transition-[transform,filter,opacity] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30';
  // 96px 圆形图标位(表单预览 + 完成卡共用)
  const iconCircle = (size: number) => (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)]`} style={{ width: size, height: size }}>
      {iconUrl
        ? <img src={iconUrl} alt="" className="size-full object-cover" />
        : <FigIcon src={figAsset.image} size={48} tone="secondary" />}
    </div>
  );

  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing}>
      <div data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-6 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-extrabold uppercase leading-[12px] tracking-[1.5px] text-[var(--color-primary)]">
            {`> ${t('preview.apk.badge')}`}
          </span>
          <button type="button" aria-label={t('common.close')} onClick={requestClose}
            className="grid size-6 place-items-center rounded-[6px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">
            <X size={16} />
          </button>
        </div>

        {step === 'form' && (
          <>
            <h2 className="text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">
              {format === 'aab' ? t('preview.apk.titleAab') : t('preview.apk.title')}
            </h2>
            {/* 设计稿 4857:45123 更新:APP ICON 区块移到 GAME TITLE 之前,图标与 Upload 钮间距 24px */}
            <div className="flex flex-col gap-2">
              <span className={labelCls}>{t('preview.apk.iconLabel')}</span>
              <div className="flex items-center gap-6">
                {iconCircle(96)}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadIcon(f); e.target.value = ''; }} />
                <button type="button" disabled={iconUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-raised flex flex-1 items-center justify-center gap-2 rounded-[24px] px-4 py-[8px] text-[13px] font-bold transition-[transform,filter,opacity] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30">
                  {iconUploading
                    ? <span role="status" aria-label={t('common.uploading')} className="block size-4 animate-spin rounded-full border-2 border-current/25 border-t-current" />
                    : <FigIcon src={figAsset.upload} size={16} />}
                  {t('preview.apk.upload')}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={labelCls}>{t('preview.apk.nameLabel')}</span>
              <label className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-fill)] p-3 focus-within:border-[var(--color-primary)]">
                <input value={name} maxLength={APK_NAME_MAX}
                  aria-label={t('preview.apk.nameLabel')}
                  placeholder={t('preview.apk.namePlaceholder')}
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
                  onChange={(e) => setName(e.target.value)} />
                <FigIcon src={figAsset.pencil} size={14} />
              </label>
            </div>
            {format === 'aab' && (
              <>
                <div className="flex flex-col gap-2">
                  <span className={labelCls}>{t('preview.apk.packageLabel')}</span>
                  <label className={`flex items-center rounded-[8px] border bg-[var(--color-fill)] p-3 focus-within:border-[var(--color-primary)] ${packageInvalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-line)]'}`}>
                    <input value={packageName} spellCheck={false} autoCapitalize="none" maxLength={PACKAGE_NAME_MAX}
                      aria-label={t('preview.apk.packageLabel')}
                      placeholder={t('preview.apk.packagePlaceholder')}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
                      onChange={(e) => setPackageName(e.target.value)} />
                  </label>
                  <p className="text-[11px] leading-[16px] text-[var(--color-muted)]">
                    {packageInvalid ? t('preview.apk.packageInvalid') : t('preview.apk.packageWarn')}
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className={labelCls}>{t('preview.apk.versionNameLabel')}</span>
                    <label className={`flex items-center rounded-[8px] border bg-[var(--color-fill)] p-3 focus-within:border-[var(--color-primary)] ${versionNameInvalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-line)]'}`}>
                      <input value={versionName} maxLength={AAB_VERSION_NAME_MAX}
                        aria-label={t('preview.apk.versionNameLabel')}
                        className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--color-ink)] outline-none"
                        onChange={(e) => setVersionName(e.target.value)} />
                    </label>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className={labelCls}>{t('preview.apk.versionCodeLabel')}</span>
                    <label className={`flex items-center rounded-[8px] border bg-[var(--color-fill)] p-3 focus-within:border-[var(--color-primary)] ${versionCodeInvalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-line)]'}`}>
                      <input value={versionCodeInput} inputMode="numeric" maxLength={10}
                        aria-label={t('preview.apk.versionCodeLabel')}
                        className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-[var(--color-ink)] outline-none"
                        onChange={(e) => setVersionCodeInput(e.target.value.replace(/[^0-9]/g, ''))} />
                    </label>
                  </div>
                </div>
                {/* 非法时行内说明取代常规提示:否则导出钮只是静默变灰,用户不知道卡在哪一格 */}
                <p className="-mt-2 text-[11px] leading-[16px] text-[var(--color-muted)]">
                  {versionNameInvalid ? t('preview.apk.versionNameInvalid')
                    : versionCodeInvalid ? t('preview.apk.versionCodeInvalid')
                      /* 用户自有 Play 应用的号段历史本服务看不见,发小了 Play 直接拒收 */
                      : t('preview.apk.versionCodeHint')}
                </p>
              </>
            )}
            <div className="flex flex-col gap-3 pt-2">
              <button type="button" className={primaryBtnCls}
                disabled={!version || !name.trim() || iconUploading || (format === 'aab' && !aabReady)}
                onClick={() => void submit()}>
                {t('preview.apk.start')}
              </button>
              <p className="text-center text-[11px] text-[var(--color-muted)]">{t('preview.apk.formHint')}</p>
            </div>
          </>
        )}

        {step === 'building' && (
          <div className="flex flex-col items-center gap-6 py-12">
            <span role="status" aria-label={t('preview.apk.building')}
              className="block size-16 animate-spin rounded-full border-4 border-[var(--color-line-2)] border-t-[var(--color-primary)]" />
            <p className="text-center text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">{t('preview.apk.building')}</p>
          </div>
        )}

        {step === 'done' && buildId != null && (
          <>
            <h2 className="text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">{t('preview.apk.done')}</h2>
            {/* 本地下载:免登录能力链(服务端 Content-Disposition 触发下载);签发中禁用 */}
            <a href={downloadUrl ?? undefined} aria-disabled={!downloadUrl}
              onClick={() => track('game_apk_download', { target: 'local', project_id: projectPublicId() })}
              className={`${primaryBtnCls} ${downloadUrl ? '' : 'pointer-events-none opacity-50'}`}>
              {/* 两种格式共用「Download」:扩展名由服务端 Content-Disposition 决定,按钮上写死 .aab 是噪音 */}
              {t('preview.apk.download')}
            </a>
            <div className="flex items-start gap-2">
              {iconCircle(96)}
              <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
                <p className="truncate text-[16px] font-semibold leading-[24px] tracking-[0.24px] text-[var(--color-ink)]">{name}</p>
                {userInfo && (
                  <p className="truncate text-[12px] leading-[16px] tracking-[0.18px] text-[var(--color-muted)]">
                    {userInfo.display_name || userInfo.username}
                  </p>
                )}
                <div className="mt-auto flex flex-col gap-[2px] text-[10px] leading-[12px] tracking-[0.15px] text-[var(--color-muted)]">
                  {builtVersionCode != null && (
                    <span>
                      {doneFormat === 'aab'
                        ? t('preview.apk.versionMetaAab', { name: builtVersionName ?? versionName, code: builtVersionCode })
                        : t('preview.apk.versionMeta', { code: builtVersionCode })}
                    </span>
                  )}
                  {buildDuration && <span>{t('preview.apk.buildTimeMeta', { time: buildDuration })}</span>}
                </div>
              </div>
            </div>
            {networked && <p className="text-[11px] leading-[16px] text-[var(--color-muted)]">{t('preview.apk.networkedHint')}</p>}

            {doneFormat === 'aab' ? (
              <>
                {/* 分隔行:两侧细线 + 「上传到 Google Play」—— bundle 装不进手机,故此处不是扫码区 */}
                <div className="flex items-center gap-3">
                  <span className="h-px min-w-0 flex-1 bg-[var(--color-line-2)]" />
                  <span className="shrink-0 text-[13px] leading-[1.5] text-[var(--color-ink)]">{t('preview.apk.playSection')}</span>
                  <span className="h-px min-w-0 flex-1 bg-[var(--color-line-2)]" />
                </div>
                {/* 包名回显 + 一键复制:Play Console 建应用时必须完全一致,首次上传后永久不可改 */}
                {shownPackage && (
                  <div className="flex items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-fill)] p-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--color-ink)]">{shownPackage}</span>
                    {/* hover 底色不能用 --color-fill:容器本身就是它,悬停时毫无变化 */}
                    <button type="button" onClick={() => void copyPackage()}
                      className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-bold text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]">
                      {copied ? t('preview.copied') : t('preview.copy')}
                    </button>
                  </div>
                )}
                <ol className="flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-[16px] text-[var(--color-muted)]">
                  <li>{t('preview.apk.playStep1')}</li>
                  <li>{t('preview.apk.playStep2')}</li>
                  <li>{t('preview.apk.playStep3')}</li>
                </ol>
              </>
            ) : (
              <>
                {/* 分隔行:两侧细线 + 「在手机上下载」(Figma 4857:45210) */}
                <div className="flex items-center gap-3">
                  <span className="h-px min-w-0 flex-1 bg-[var(--color-line-2)]" />
                  <span className="shrink-0 text-[13px] leading-[1.5] text-[var(--color-ink)]">{t('preview.apk.phoneDivider')}</span>
                  <span className="h-px min-w-0 flex-1 bg-[var(--color-line-2)]" />
                </div>

                {/* 扫码下载:同一条免登录链接编成二维码(Figma 4857:45214);签发中显示 spinner */}
                {/* QR 与右列 Download QR 按钮底对齐:QR self-end 贴行底,右列仅留顶部 padding */}
                <div className="flex items-start gap-2">
                  <div className="grid size-[141px] shrink-0 self-end place-items-center overflow-hidden rounded-[8px] border-2 border-[var(--color-line)] bg-white p-[8px]">
                    {qr ? (
                      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="size-full" aria-hidden="true">
                        <path d={qr.path} fill="#000" />
                      </svg>
                    ) : (
                      <span role="status" aria-label={t('common.loading')}
                        className="block size-6 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-primary)]" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 self-stretch pt-1">
                    <p className="text-[14px] leading-[18px] text-[var(--color-ink)]">{t('preview.apk.scanHint')}</p>
                    <p className="text-[10px] italic leading-[12px] text-[var(--color-muted)]">{t('preview.apk.linkNote')}</p>
                    <button type="button" disabled={!downloadUrl} onClick={downloadQr}
                      className="btn-raised flex w-full items-center justify-center gap-2 rounded-[24px] px-4 py-[8px] text-[13px] font-bold transition-[transform,filter,opacity] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30">
                      <FigIcon src={figAsset.download} size={16} />
                      {t('preview.apk.downloadQr')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {step === 'failed' && (
          <div className="flex flex-col gap-4">
            <p className="text-[24px] font-extrabold leading-[1.2] text-[var(--color-ink)]">{t('preview.apk.failed')}</p>
            <p className="text-[12px] leading-[18px] text-[var(--color-muted)]">{failureText || t('preview.apk.err.generic')}</p>
            <button type="button" className={primaryBtnCls} onClick={() => setStep('form')}>{t('preview.apk.retry')}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
