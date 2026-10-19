'use client';
import { useTranslation } from 'react-i18next';
import { buttonClass } from '@/components/ui/Button';
import { STUDIO_GAME_HREF } from '@/lib/share-page';
import { Logo, Wordmark } from './BrandLogo';

// 分享页外壳的顶栏:左品牌、右两个出口(Remix / Create your game),此外什么都不放 ——
// 它的全部职责是把「玩到别人的游戏」转成「自己去做一个」,标题 / 作者 / 版本都会稀释这件事。
//
// 两个动作都是**跳地址**,故用 <a> 而非 <button>:可中键新开、可复制链接、读屏报「链接」。
// 样式共用 Button 的 buttonClass,不在这里照抄类串。
//
// 配色:Create your game 是主行动,用设计稿的品牌橙键帽 CTA(.btn-brand-key,恒浅橙不随主题翻);
// Remix 次级,用 .btn-raised(同样恒浅色,即白面深字)。两档都是既有类,顶栏不自造按钮样式。
export default function ShareTopBar({ remixHref }: {
  /** 该游戏开放 Remix 时的 fork 入口;**null 即不渲染这个按钮**(未开放 Remix 的游戏根本不提这回事) */
  remixHref: string | null;
}) {
  const { t } = useTranslation();

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 sm:h-[60px] sm:px-6">
      <a
        href={STUDIO_GAME_HREF}
        aria-label="Rezona Lab"
        // 与主站 lockup 一致:R 标恒品牌橙(识别锚点,不随主题翻),REZONA 字标走 --color-ink ——
        // 深色下即主站那身白,浅色下自动翻黑。恒白会在浅色主题里直接消失,而组件不写主题分支
        className="flex items-center gap-2 text-[var(--color-ink)] transition-opacity duration-150 hover:opacity-80"
      >
        <Logo size={24} className="text-[var(--color-primary)]" />
        {/* 窄屏只留 R 标:字标 123px 宽,和两个按钮挤在一行会先把按钮压没。
            高度不宜再往下压 —— 字标右端的 LAB 贴纸带三个小字母,18px 高就糊成一个橙点了 */}
        <Wordmark height={22} className="hidden sm:block" />
      </a>

      <div className="flex items-center gap-2">
        {remixHref && (
          <a href={remixHref} className={buttonClass('sm', 'raised')}>
            {t('share.remix')}
          </a>
        )}
        <a href={STUDIO_GAME_HREF} className={buttonClass('sm', 'brand-key')}>
          <span className="hidden sm:inline">{t('share.createGame')}</span>
          <span className="sm:hidden">{t('share.createGameShort')}</span>
        </a>
      </div>
    </header>
  );
}
