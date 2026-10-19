'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { selectActiveVersion } from '@/store/selectors';
import type { Version } from '@/store/types';
import { STAGE, FRAME } from './GameFrame';
import ScreenNotice from './ScreenNotice';
import LoadingScreen from '@/components/ui/LoadingScreen';

// 单侧对比屏:拉取版本预览地址;就绪前显示 shimmer loading,iframe 加载完成后淡入。
// 由父级以 version.id 作 key 重建,无需手动重置内部状态。
function CompareScreen({ version }: { version: Version | null }) {
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
    // 并排框各占半宽(减半 gap)、铺满容器高:桌面端游戏自适应,不再按移动竖屏定比例
    <div className={`${FRAME} relative h-full w-[calc(50%-5px)]`}>
      {url && (
        <iframe
          src={url}
          title={version?.label ?? 'preview'}
          onLoad={() => setFrameLoaded(true)}
          className={`h-full w-full transition-opacity duration-300 ${frameLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {!version ? (
        <ScreenNotice text={t('preview.selectToCompare')} />
      ) : failed ? (
        <ScreenNotice text={t('preview.unavailable')} />
      ) : (
        !frameLoaded && <LoadingScreen className="absolute inset-0" label={t('preview.loadingNamed', { name: version.label })} />
      )}
    </div>
  );
}

// 版本对比(Figma 62:1349):同一舞台内两个游戏框并排,左=激活(最新),右=对比版本
export default function CompareView() {
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const withId = useStore((s) => s.compare.withId);
  const left = selectActiveVersion(versions, activeId);
  const right = versions.find((v) => v.id === withId) ?? null;
  return (
    <div className={`${STAGE} gap-2.5 p-2`}>
      <CompareScreen key={left?.id ?? 'left-empty'} version={left} />
      <CompareScreen key={right?.id ?? 'right-empty'} version={right} />
    </div>
  );
}
