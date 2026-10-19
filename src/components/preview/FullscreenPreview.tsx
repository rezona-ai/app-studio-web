'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import I18nProvider from '@/components/i18n/I18nProvider';
import LoadingScreen from '@/components/ui/LoadingScreen';
import ScreenNotice from './ScreenNotice';
import { resolvePreviewUrl } from '@/lib/pgc/preview-url';

// 全屏预览页主体(路由 /full/{pid}/{vid}?seq={n})。独立文档、不接 store:
// 上下文只来自 URL,预览地址自己解析。关键点是「首帧就有加载态」——工作台点全屏时同步导航过来,
// 解析 REST 与游戏自身加载都被这层盖住,不再出现空白页签(设计稿 2026-08-03-fullscreen-preview-instant-loading)。
function FullscreenStage({ pid, vid, seq }: { pid: number; vid: string; seq: number | null }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    resolvePreviewUrl({ pid, vid, seq })
      .then((u) => { if (alive) { if (u) setUrl(u); else setFailed(true); } })
      // 独立文档没有 Toast 宿主,已知/未知失败一律收敛成页内提示(白屏才是最坏结果)
      .catch(() => { if (alive) setFailed(true); })
    return () => { alive = false; };
  }, [pid, vid, seq]);

  // 版本名只用 seq 拼(URL 不带自定义标题):加载文案是瞬时的,V{seq} 已足够定位
  const label = seq != null ? t('preview.loadingNamed', { name: `V${seq}` }) : t('preview.loading');

  return (
    // 纯净铺满:黑底 + 铺满视口的游戏,无顶栏无浮层(退出=关页签)
    <div className="fixed inset-0 overflow-hidden bg-black">
      {url && (
        <iframe
          src={url}
          title="preview"
          // 原先全屏是把游戏当顶层文档打开;改挂 iframe 后跨源子文档默认没有这些权限,
          // 须显式放行,否则游戏自带的全屏按钮 / 带声自动播放 / 手柄会失效(相对旧行为的回归)
          allow="fullscreen; autoplay; gamepad"
          // 焦点交给游戏:全屏页除了游戏没有别的可操作对象,而键盘事件默认落在顶层文档 ——
          // 不给的话用户得先点一下画面才能按键,页面上又没有任何提示要点。
          // focus() 属跨源可调的少数几个方法之一(同 postMessage/blur/close),不触发 SecurityError
          onLoad={(e) => { setFrameLoaded(true); e.currentTarget.contentWindow?.focus(); }}
          className={`h-full w-full border-0 transition-opacity duration-300 ${frameLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {failed ? (
        <ScreenNotice text={t('preview.unavailable')} />
      ) : (
        !frameLoaded && (
          <LoadingScreen
            variant="soft"
            className="absolute inset-0"
            label={label}
            // 首条带版本名保留「在加载哪个版本」的上下文,后接通用假进度(与右栏 GameFrame 同语汇)
            hints={[label, ...(t('preview.loadingHints', { returnObjects: true }) as string[])]}
          />
        )
      )}
    </div>
  );
}

export default function FullscreenPreview(props: { pid: number; vid: string; seq: number | null }) {
  return (
    <I18nProvider>
      <FullscreenStage {...props} />
    </I18nProvider>
  );
}
