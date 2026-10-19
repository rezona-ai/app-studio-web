'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type PreviewDevice } from '@/store';
import type { Version } from '@/store/types';
import LoadingScreen from '@/components/ui/LoadingScreen';
import ScreenNotice from './ScreenNotice';

// 预览舞台(Figma 62:1349):单预览与对比共用,框需在有限宽高内收缩,故 flex-1 + cqh 约束;深背景(Surface/01)
// 舞台基类不含内边距:单预览(GameFrame)零边距严格贴合;对比(CompareView)自行补 p-2。
export const STAGE = 'relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--color-canvas)] [container-type:size]';
// 圆角框:对比视图(内嵌小岛外观)与单预览的移动档共用;单预览桌面档是满幅方角贴合容器
export const FRAME = 'overflow-hidden rounded-[10px] bg-black';

// 单预览按设备档出框尺寸(spec 2026-10-19-preview-mobile-device)。只换 class、不换元素类型 ——
// iframe 留在同一个 DOM 节点里,切档不重载游戏、不丢运行态。
// - desktop:满幅方角,宽度封顶「舞台高 × 16/9」(超过即横向拉伸失真;两栏化后预览列吃满剩余宽度,
//   上限只能放在舞台内,超宽时两侧露舞台底色,见 spec 2026-10-19-remove-asset-canvas §3.1)
// - mobile:竖屏 282:519(设计稿移动预览框比例),宽 = min(舞台宽, 舞台高 × 282/519) 再按比例定高;
//   舞台补 p-3 —— cqh 取的是 size 容器的内容盒,内边距不会让框溢出
const STAGE_PAD: Record<PreviewDevice, string> = { desktop: '', mobile: 'p-3' };
const FRAME_BY_DEVICE: Record<PreviewDevice, string> = {
  desktop: 'relative h-full w-full max-w-[calc(100cqh*16/9)] overflow-hidden bg-black',
  mobile: `relative w-[min(100%,calc(100cqh*282/519))] aspect-[282/519] ${FRAME}`,
};

// 单预览:拉取版本预览地址,就绪前显示全局加载动画,iframe 加载完成后淡入;拉取失败显示提示。
// 由父级以 version.id + refreshNonce 作 key 重建,无需手动重置内部状态。
export default function GameFrame({ version, device = 'desktop' }: { version: Version | null; device?: PreviewDevice }) {
  const { t } = useTranslation();
  const previewVersionById = useStore((s) => s.previewVersionById);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    if (!version) return;
    let alive = true;
    void previewVersionById(version.id).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, [version, previewVersionById]);

  return (
    <div className={`${STAGE} ${STAGE_PAD[device]}`} data-device={device}>
      <div className={FRAME_BY_DEVICE[device]}>
        {url && (
          <iframe
            src={url}
            title="preview"
            onLoad={() => setFrameLoaded(true)}
            className={`h-full w-full transition-opacity duration-300 ${frameLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </div>
      {/* 加载 / 失败层直挂 STAGE(relative),inset-0 铺满舞台 */}
      {failed ? (
        <ScreenNotice text={t('preview.unavailable')} />
      ) : (
        !frameLoaded && (
          <LoadingScreen
            variant="soft"
            className="absolute inset-0"
            label={version ? t('preview.loadingNamed', { name: version.label }) : t('preview.loading')}
            // 首条带版本名保留「在加载哪个版本」的上下文,后接通用假进度
            hints={[
              ...(version ? [t('preview.loadingNamed', { name: version.label })] : []),
              ...(t('preview.loadingHints', { returnObjects: true }) as string[]),
            ]}
          />
        )
      )}
    </div>
  );
}
