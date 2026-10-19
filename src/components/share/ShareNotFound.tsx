'use client';
import { useTranslation } from 'react-i18next';
import I18nProvider from '@/components/i18n/I18nProvider';
import ScreenNotice from '@/components/preview/ScreenNotice';
import ShareTopBar from './ShareTopBar';

// 分享链接失效时的 404 页(版本被删 / 未 build / 链接被改坏)。
// 与 5xx 错误态同形:顶栏照常,中间一句说明 —— 这条其实比 5xx 常见得多,更不该把访客
// 丢在 Next 默认那张无样式、无品牌、无出口的 404 上。
// 此处 code 未知(参数可能本就非法),故不给 Remix 入口。
function ShareNotFoundStage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-surface-2)]">
      <ShareTopBar remixHref={null} />
      <div className="relative min-h-0 flex-1">
        <ScreenNotice text={t('share.notFound')} />
      </div>
    </div>
  );
}

export default function ShareNotFound() {
  return (
    <I18nProvider>
      <ShareNotFoundStage />
    </I18nProvider>
  );
}
