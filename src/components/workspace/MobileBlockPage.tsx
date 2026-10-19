'use client';
import { useTranslation } from 'react-i18next';
import I18nProvider from '@/components/i18n/I18nProvider';
import { FigIcon, figAsset } from '@/components/ui/figma';

// 移动端硬拦截提醒页:UA 判定命中(server 分发)或 iPadOS 客户端补判命中时全屏渲染,
// 替代整个工作台。自带 I18nProvider——server 分发路径外层没有 provider。
function Content() {
  const { t } = useTranslation();
  return (
    <main className="grid h-dvh place-items-center bg-[var(--color-surface-2)] px-8">
      <div className="anim-media-in flex flex-col items-center gap-4 text-center">
        {/* FigIcon 无 alt prop(original 语调下内部固定 alt=""),logo 本身无独立无障碍语义,省略即可 */}
        <FigIcon src={figAsset.logo} size={48} tone="original" />
        <h1 className="text-[18px] font-semibold text-[var(--color-ink)]">{t('mobileBlock.title')}</h1>
        <p className="max-w-[320px] text-[14px] leading-relaxed text-[var(--color-muted)]">{t('mobileBlock.desc')}</p>
      </div>
    </main>
  );
}

export default function MobileBlockPage() {
  return (
    <I18nProvider>
      <Content />
    </I18nProvider>
  );
}
