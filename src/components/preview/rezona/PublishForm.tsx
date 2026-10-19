'use client';
import { useRef } from 'react';
import { Info, Pencil, Rocket, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Switch from '@/components/ui/Switch';
import Select from '@/components/ui/Select';
import { userInitial } from '@/lib/user-display';
import type { CurrentUser, RezonaGameData } from '@/lib/pgc/types';
import {
  REZONA_TITLE_MAX, REZONA_SUMMARY_MAX, targetValue, targetFromValue, type PublishToggles, type PublishTarget,
} from '@/lib/rezona/publish';

export interface PublishFormValue { name: string; summary: string; toggles: PublishToggles }

// 发布目标选择(spec 2026-09-23):列表归弹窗壳拉取,本组件只展示。
// status 未到 ready 或 value 为 null 时 CTA 禁用——默认目标是「最近发布的游戏」,列表没到就放行会静默退化成创建
export interface TargetPicker {
  status: 'loading' | 'ready' | 'error';
  games: RezonaGameData[];
  value: PublishTarget;
  onChange: (target: Exclude<PublishTarget, null>) => void;
  onRetry: () => void;
  // 菜单展开态回报给弹窗壳:展开时 Esc 只该收菜单,不该连带关掉整个弹窗
  onMenuOpenChange?: (open: boolean) => void;
}

// 发布表单(Figma 8905:73023):描述文案 + 账号行 + 封面预览/上传 + 标题/简介 + 三开关 + ⓘ 告知 + 键帽 CTA。
// 稿上区块间距统一 8px,故外层是 gap-2。
//
// 三处与后端契约的偏离由 spec 2026-08-13 记录,勿"顺手修回":
// - 账号行显示的是**当前 lab 用户**(Rezona 账号在发布前拿不到,由后端发布时匹配/建号),只读、无换绑入口(契约 §4)。
// - Remixable 恒 false + disabled:稿上有这一行,但请求体不传 remixable(契约 §7),故不进 PublishToggles。
// - 告知区只留稿上那条 settings 说明;accountNotice / noRemixNotice 两条文案按稿去掉(i18n key 保留待回补)。
//
// 封面上传替换的是**项目级**封面,发布请求恒带 cover_ref: 'version_cover',此处不改变发布行为。
export default function PublishForm({
  picker, user, coverUrl, coverUploading, onUploadCover, value, onChange, versionReady, onSubmit,
}: {
  picker: TargetPicker;
  user?: CurrentUser | null;
  coverUrl?: string; coverUploading?: boolean; onUploadCover?: (file: File) => void;
  value: PublishFormValue; onChange: (v: PublishFormValue) => void; versionReady: boolean; onSubmit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const setToggle = (patch: Partial<PublishToggles>) =>
    onChange({ ...value, toggles: { ...value.toggles, ...patch } });
  // 稿上文字一律 Inter 的 normal 行高(≈1.21),而本站默认行高是 1.5——不逐个钉死行高,
  // 每个文本节点都会比稿高 3–7px,累积下来弹窗要高出 50 多 px(实测 824 vs 稿 770)。
  const label = 'text-[11px] font-bold uppercase leading-[13px] text-[var(--color-muted)]';
  const field = 'rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-fill)] text-[14px] font-semibold text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]';
  const toggleRow = (title: string, desc: string, checked: boolean, onToggle?: (v: boolean) => void) => (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14px] font-bold leading-[17px] text-[var(--color-ink)]">{title}</span>
        <span className="text-[12px] leading-[15px] text-[var(--color-muted)]">{desc}</span>
      </div>
      <Switch ariaLabel={title} checked={checked} disabled={!onToggle} onChange={(v) => onToggle?.(v)} />
    </div>
  );
  // userInfo 未就绪时不拼 '@'(会渲染成「@账户」这种半成品),直接落回通用称谓
  const name = user?.display_name?.trim() || user?.username?.trim();
  const userName = name ? `@${name}` : t('preview.account');
  const canSubmit = versionReady && picker.status === 'ready' && picker.value !== null;
  // 游戏名 + 已发布版本 + 最近发布日期:App 里可能重名,后两段兜底区分;名字缺失回落编号。
  // 单行 label 而非 Select 的双行 description:带 description 的菜单被写死 300×340(为模型列表设计),两三项时大片留白
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' });
  const targetOptions = [
    { value: 'new', label: t('preview.rezona.targetNew') },
    ...picker.games.map((g) => ({
      value: String(g.game_id),
      label: t('preview.rezona.targetGame', {
        name: g.game_name?.trim() || t('preview.rezona.targetGameUnnamed', { id: g.game_id }),
        versions: g.version_ids.join(t('preview.rezona.targetVersionSep')),
        date: dateFmt.format(new Date(g.last_published_at)),
      }),
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] leading-[16px] tracking-[0.18px] text-[var(--color-ink)]">{t('preview.rezona.intro')}</p>

      {/* 账号行:只读。头像用首字母占位(后端 /auth/me 不返回头像 URL,同 UserInfo.tsx) */}
      <div className="flex items-center gap-3 p-3">
        <span aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--color-line-2)] bg-[var(--color-fill)] text-[14px] font-semibold text-[var(--color-ink)]">
          {userInitial(user)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[20px] text-[var(--color-ink)]">
          {userName}
        </span>
      </div>

      {/* 发布目标:无发布历史时整行不渲染(与改造前一致);加载中 / 失败就地提示,CTA 同时禁用。
          目标被清空(失效须重选)时即使列表已空也要渲染,否则没有入口解除禁用 */}
      {picker.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t('preview.rezona.targetLabel')}</span>
          <span role="status" aria-label={t('common.loading')} className="skeleton-shimmer block h-10 rounded-[var(--radius-control)]" />
        </div>
      )}
      {picker.status === 'error' && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t('preview.rezona.targetLabel')}</span>
          <div className="flex h-10 items-center justify-between gap-2 rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-fill)] pl-3 pr-1">
            <span className="min-w-0 truncate text-[12px] text-[var(--color-muted)]">{t('preview.rezona.targetLoadFailed')}</span>
            <button type="button" onClick={picker.onRetry}
              className="h-8 shrink-0 rounded-[6px] px-3 text-[12px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]">
              {t('common.retry')}
            </button>
          </div>
        </div>
      )}
      {picker.status === 'ready' && (picker.games.length > 0 || picker.value === null) && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t('preview.rezona.targetLabel')}</span>
          <Select value={targetValue(picker.value)} options={targetOptions} variant="filled" direction="down" fullWidth
            ariaLabel={t('preview.rezona.targetLabel')} placeholder={t('preview.rezona.targetPlaceholder')}
            onChange={(v) => picker.onChange(targetFromValue(v))} onOpenChange={picker.onMenuOpenChange} />
        </div>
      )}

      {/* 封面预览 + 上传:缩略图与右侧按钮共用同一个 file input */}
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-extrabold uppercase leading-[12px] text-[var(--color-primary)]">{t('preview.rezona.previewLabel')}</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={coverUploading}
            onClick={() => fileRef.current?.click()}
            aria-label={t('preview.rezona.uploadCover')}
            className="relative grid size-[126px] shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-surface-2)]"
          >
            {coverUrl && <img src={coverUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover opacity-30" />}
            <span className="grid size-10 place-items-center rounded-full bg-[var(--color-fill)]">
              <Upload size={16} className="text-[var(--color-ink)]" />
            </span>
            {coverUploading && (
              <span className="absolute inset-0 grid place-items-center bg-black/40">
                <span role="status" aria-label={t('preview.rezona.coverUploading')}
                  className="block size-5 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-primary)]" />
              </span>
            )}
          </button>
          <label className={`flex h-8 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-4 text-[12px] leading-[16px] tracking-[0.18px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] ${coverUploading ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={16} />
            {coverUploading ? t('preview.rezona.coverUploading') : t('preview.rezona.uploadCover')}
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              className="hidden"
              disabled={coverUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // 允许连续选同一文件重复触发
                if (file && onUploadCover) onUploadCover(file);
              }}
            />
          </label>
        </div>
      </div>

      {/* 标题:稿上输入框右侧有一枚铅笔图标,纯装饰(原生 input 本身可点可聚焦) */}
      <label className="flex flex-col gap-2">
        <span className={label}>{t('preview.rezona.gameTitle')}</span>
        <span className="relative flex items-center">
          <input value={value.name} maxLength={REZONA_TITLE_MAX} placeholder={t('preview.rezona.titlePlaceholder')}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className={`h-11 w-full pl-3 pr-9 ${field}`} />
          <Pencil size={14} aria-hidden className="pointer-events-none absolute right-3 text-[var(--color-muted)]" />
        </span>
      </label>

      {/* 简介 */}
      <label className="flex flex-col gap-2">
        <span className={label}>{t('preview.rezona.briefIntro')}</span>
        <textarea value={value.summary} maxLength={REZONA_SUMMARY_MAX} placeholder={t('preview.rezona.briefPlaceholder')}
          onChange={(e) => onChange({ ...value, summary: e.target.value })}
          className={`h-[59px] resize-none px-3 py-2 ${field}`} />
      </label>

      <div className="h-px bg-[var(--color-line)]" />

      {/* 三开关:Remixable 无 onToggle → 恒 false 且置灰(后端恒发 false,请求体不传该字段) */}
      <div className="flex flex-col gap-2">
        {toggleRow(t('preview.rezona.public'), t('preview.rezona.publicDesc'), value.toggles.public,
          (v) => setToggle({ public: v }))}
        {toggleRow(t('preview.rezona.sync'), t('preview.rezona.syncDesc'), value.toggles.sync_to_community,
          (v) => setToggle({ sync_to_community: v }))}
        {toggleRow(t('preview.rezona.remixable'), t('preview.rezona.remixableDesc'), false)}
      </div>

      {/* 告知区:发布后不可改。10px 小字用 ink 而非 muted —— muted 在深色底上对比不足 */}
      <div className="flex items-start gap-1">
        <Info size={24} aria-hidden className="shrink-0 text-[var(--color-muted)]" />
        <p className="flex-1 text-[10px] leading-[12px] text-[var(--color-ink)]">{t('preview.rezona.settingsNote')}</p>
      </div>

      {/* 脚注即禁用原因,用 aria-describedby 挂到 CTA 上,读屏才读得到「为什么不能点」 */}
      <div className="flex flex-col gap-3 pt-2">
        <button type="button" onClick={onSubmit} disabled={!canSubmit} aria-describedby="rezona-cta-note"
          className="btn-brand-key flex h-8 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-bold leading-[16px] transition-[transform,filter] duration-150 ease-out disabled:cursor-not-allowed motion-safe:active:scale-[0.99]">
          <Rocket size={16} /> {t('preview.rezona.postCta')}
        </button>
        <span id="rezona-cta-note" className="text-center text-[11px] leading-[13px] text-[var(--color-muted)]">
          {versionReady ? t('preview.rezona.postFooter') : t('preview.rezona.notBuiltHint')}
        </span>
      </div>
    </div>
  );
}
