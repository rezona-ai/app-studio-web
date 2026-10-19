'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import I18nProvider from '@/components/i18n/I18nProvider';
import LoadingScreen from '@/components/ui/LoadingScreen';
import ScreenNotice from '@/components/preview/ScreenNotice';
import ShareTopBar from './ShareTopBar';

// 对外分享页(/share/{code}/v{n})的外壳:顶栏 + 游戏 iframe。
// 独立文档、不接 store —— 上下文全部由 server 组件算好后作为 props 传进来。
// 形态与 FullscreenPreview 同源(那条是无顶栏的纯净全屏),差别只在这里多一条顶栏且**占位**不遮挡。
function ShareStage({
  gameUrl,
  remixHref,
  unavailable = false,
}: {
  gameUrl: string;
  /** null = 该游戏未开放 Remix,顶栏就不渲染那个按钮 */
  remixHref: string | null;
  /** pgc 5xx / 不可达:不渲染 iframe,给一句提示。顶栏照常 —— 打不开也得给访客留个出口 */
  unavailable?: boolean;
}) {
  const { t } = useTranslation();
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // 焦点交给游戏:本页除顶栏两个链接外没有别的可操作对象,而键盘事件默认落在顶层文档 ——
  // 不给的话用户得先点一下画面才能按键,页面上又没有任何提示要点(旧的顶层文档直出没这问题,
  // 不补就是功能回归)。**挂载即抢**而不是只在 onLoad 里抢:那一发在缓存命中时收不到(见下)。
  // focus() 属跨源可调的少数几个方法之一(同 postMessage/blur/close),不触发 SecurityError。
  useEffect(() => { frameRef.current?.contentWindow?.focus(); }, []);

  // 加载层的兜底撤除。层序已保证它盖不住游戏,但**撤不掉**仍是问题:一个 role="status" 的节点
  // 与无限 spinner 会整场留在无障碍树和合成器里,而「onLoad 收不到」恰恰是缓存命中时的常态路径。
  // 判据用 document.readyState 而非任意计时器:complete 意味着含 iframe 在内的子资源都已加载完,
  // 正好覆盖「iframe 早于 hydration 加载完」这一种;还没完成就等顶层的 load(iframe 完成才会触发)。
  useEffect(() => {
    const done = () => setFrameLoaded(true);
    if (document.readyState === 'complete') {
      // 排到下一帧而不是在 effect 里同步 setState(后者被 react-hooks 规则判为级联渲染)。
      // 差一帧,肉眼无别
      const id = requestAnimationFrame(done);
      return () => cancelAnimationFrame(id);
    }
    window.addEventListener('load', done, { once: true });
    return () => window.removeEventListener('load', done);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-surface-2)]">
      <ShareTopBar remixHref={remixHref} />
      <div className="relative min-h-0 flex-1">
        {unavailable ? (
          <ScreenNotice text={t('share.unavailable')} />
        ) : (
          <>
            {/* 加载层在 iframe **下面一层**(DOM 序在前,iframe 靠 relative 抬到其上)。
                这样即便 onLoad 丢了,游戏画上自己的底色就自然把它盖住 ——
                ⚠️ 不可改回「iframe opacity 由 frameLoaded 控制」:iframe 的 src 是 SSR 就有的,
                资源命中缓存时它会在 hydration **之前**加载完,而 load 事件不冒泡、React 是直接绑定,
                那一发就永远收不到 —— 表现是游戏其实已经跑起来了,却被加载层永久盖住(已踩)。
                onLoad 仍留着:能收到就顺手撤层,收不到也不影响可见性。 */}
            {!frameLoaded && (
              <LoadingScreen variant="soft" className="absolute inset-0" label={t('share.loading')} />
            )}
            <iframe
              ref={frameRef}
              src={gameUrl}
              title={t('share.frameTitle')}
              // 跨源子文档默认没有这些权限,须显式放行,否则游戏自带的全屏按钮 / 带声自动播放 /
              // 手柄会失效(相对旧的顶层文档直出的功能回归)
              allow="fullscreen; autoplay; gamepad"
              // 能收到就再抢一次焦点(此时游戏文档已就位,比挂载那一发更贴)并撤掉加载层
              onLoad={(e) => { setFrameLoaded(true); e.currentTarget.contentWindow?.focus(); }}
              className="relative h-full w-full border-0"
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function SharePage(props: {
  gameUrl: string;
  remixHref: string | null;
  unavailable?: boolean;
}) {
  return (
    <I18nProvider>
      <ShareStage {...props} />
    </I18nProvider>
  );
}
