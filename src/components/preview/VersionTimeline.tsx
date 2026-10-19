'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { formatCredit, formatCreditExact } from '@/lib/user-display';
import type { Version } from '@/store/types';

// 设计稿时间格式:17:35; 20/07/2026(24h);无效时间返回空串(不渲染 "Invalid Date")
export function formatVersionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${hh}:${mi}; ${dd}/${mm}/${d.getFullYear()}`;
}

export default function VersionTimeline() {
  const { t } = useTranslation();
  const versions = useStore((s) => s.versions);
  const creditsById = useStore((s) => s.versionCreditsById);
  const activeId = useStore((s) => s.activeVersionId);
  const setActive = useStore((s) => s.setActiveVersion);
  const toggleCompare = useStore((s) => s.toggleCompare);
  const compareOn = useStore((s) => s.compare.on);
  const compareWithId = useStore((s) => s.compare.withId);
  const setCompareWith = useStore((s) => s.setCompareWith);
  // 至少两个**可用**版本才可对比:构建中的行是 disabled 的,把它算进去会让 Compare 可点却选不动任何东西
  const canCompare = versions.filter((v) => v.status === 'ready').length >= 2;

  // hover 滑动游标:hoverIdx 记录当前 hover 行 index(定位高亮块);showHover 控制是否挂载。
  // 挂载即在目标行淡入(无飞入),行间移动时 translateY 平滑滑动,鼠标离开即卸载。
  const [hoverIdx, setHoverIdx] = useState(0);
  const [showHover, setShowHover] = useState(false);

  // 行序:最新在上(reverse)。构建中的版本由 listVersions 直接返回(status:'building'),
  // 这类行走构建中形制:转圈 dot、禁用、不响应 hover、不显示时间(createdAt 为空)。见 spec 2026-08-31。
  const rows: { v: Version; building: boolean }[] =
    [...versions].reverse().map((v) => ({ v, building: v.status !== 'ready' }));

  return (
    <div className="flex min-h-0 flex-[3] flex-col border-t border-[var(--color-line-strong)]">
      {/* Versions 头部 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line-strong)] px-3 py-3">
        <span className="text-[12px] font-semibold leading-4 tracking-[-0.12px] text-[var(--color-ink)]">{t('preview.versions')}</span>
        {/* Compare:空版本区不展示(对齐设计稿空态);有版本时按 canCompare(≥2)启用 */}
        {versions.length > 0 && (
          <button
            onClick={toggleCompare}
            disabled={!canCompare}
            aria-pressed={compareOn}
            className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-surface-2)] px-4 py-2 text-[12px] font-medium text-[var(--color-ink)] transition-[background-color,opacity,filter] duration-200 hover:bg-[var(--color-fill)] disabled:cursor-not-allowed disabled:opacity-30 ${compareOn ? 'bg-[var(--color-fill)] brightness-95' : ''}`}
          >
            <FigIcon src={figAsset.repeat} size={16} />
            {t('preview.compare')}
          </button>
        )}
      </div>

      {/* 竖向时间线:左轨道(圆点 + 贯穿连接线)+ 右内容(版本名 + 时间戳);超出滚动。
          relative 承载滑动高亮游标;px-2 给圆角卡片留两侧边距,行内 px-3 为内容内边距 */}
      <div
        className="scrollbar-auto relative flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1"
        onMouseLeave={() => setShowHover(false)}
      >
        {/* 滑动高亮游标:单块背景随 hover 行在行间平滑滑动(translateY 过渡),鼠标离开即卸载。
            置于按钮之前(同为 z-auto 定位元素,按 DOM 顺序绘制)故落在内容下层。行高恒 60px、两侧 inset-x-2 与行卡片对齐 */}
        {showHover && (
          <div
            aria-hidden
            className="anim-media-in pointer-events-none absolute inset-x-2 top-1 h-[60px] rounded-[12px] bg-[var(--color-fill)] transition-transform duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ transform: `translateY(${hoverIdx * 60}px)` }}
          />
        )}
        {rows.map(({ v, building }, i) => {
          const active = !building && v.id === activeId;
          const comparePicked = !building && compareOn && v.id === compareWithId;
          const isFirst = i === 0;
          const isLast = i === rows.length - 1;
          // 设计稿:圆点统一 24px 空心圆环(border-2),中心镂空透出面板 --color-shell 底色。
          // 构建中=品牌橙 spinner;激活=品牌橙描边;compare 对比对象=accent 蓝描边;其余=灰描边。均不填充。
          const dot = building
            ? <span className="size-6 animate-spin rounded-full border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)]" />
            : active
              ? <span className="size-6 rounded-full border-2 border-[var(--color-primary)]" />
              : comparePicked
                ? <span className="size-6 rounded-full border-2 border-[var(--color-primary)]" />
                : <span className="size-6 rounded-full border-2 border-[var(--color-line-strong)]" />;
          const time = formatVersionTime(v.createdAt);
          const spent = creditsById[v.id];

          return (
            <button
              key={v.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              disabled={building}
              // 进入某行即把游标移到该行并显示;进入构建中行则隐藏(该行不可 hover)
              onMouseEnter={() => { setShowHover(!building); if (!building) setHoverIdx(i); }}
              onClick={() => {
                if (building) return;
                // compare 模式:点非激活版本切换对比对象(不能与自己比较)
                if (compareOn) { if (v.id !== activeId) setCompareWith(v.id); }
                else setActive(v.id);
              }}
              // 设计稿:行常态扁平无底色,当前版本仅靠品牌橙圆环标识;hover 反馈改由上方滑动游标承载(本行不再各自铺底)。
              // relative 用于承载连接线绝对定位并使内容绘制在游标之上;px-3 为内容内边距。行距 60px 对齐设计稿圆心间距
              className="relative flex min-h-[60px] w-full items-center gap-2 px-3 text-left"
            >
              {/* 轨道列:24px 宽,连接线(圆心上下,连到 24px 圆环外缘即半径 12px;首项无上、尾项无下)+ 圆点居中 */}
              <span className="relative flex w-6 shrink-0 items-center justify-center self-stretch">
                {!isFirst && <span className="absolute left-1/2 top-0 h-[calc(50%-12px)] w-0.5 -translate-x-1/2 bg-[var(--color-line-strong)]" />}
                {!isLast && <span className="absolute bottom-0 left-1/2 h-[calc(50%-12px)] w-0.5 -translate-x-1/2 bg-[var(--color-line-strong)]" />}
                {dot}
              </span>
              {/* 内容:版本名(粗体)+ 该版本消耗积分(紧跟名字)+ 时间戳(右对齐 muted) */}
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[14px] font-semibold leading-5 tracking-[-0.28px] text-[var(--color-ink)]">{v.label}</span>
                  {/* 消耗积分:与账户条同语汇(品牌橙闪电 + 紧凑数字,精确值走 title)。
                      数来自 store 的 versionCreditsById(端点 /versions/credits),缺键 = 后端无该
                      口径/不编数,整块不渲染;0 是有效值(该版本确实没花钱),照常显示。
                      shrink-0 使版本名成为唯一让位者,窄宽度下数字不被截断 */}
                  {spent !== undefined && (
                    <span
                      title={t('preview.versionSpend', { n: formatCreditExact(spent) })}
                      className="flex shrink-0 items-center gap-0.5 text-[var(--color-primary)]"
                    >
                      <FigIcon src={figAsset.credit} size={12} tone="primary" />
                      <span className="text-[12px] font-bold leading-[18px]">{formatCredit(spent)}</span>
                    </span>
                  )}
                </span>
                {time && <span className="shrink-0 text-[12px] leading-[18px] tracking-[-0.1px] text-[var(--color-muted)]">{time}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
