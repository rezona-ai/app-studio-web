'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';

// 预览设备切换:显示器 / 手机两档分段控件,样式语汇与 PreviewTabs 同款(浅底容器 + 选中态 line-strong 底)。
// 只决定舞台内游戏框的尺寸(见 GameFrame),不碰列宽 —— spec 2026-10-19-preview-mobile-device
export default function DeviceToggle({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const device = useStore((s) => s.previewDevice);
  const setPreviewDevice = useStore((s) => s.setPreviewDevice);
  const items = [
    { key: 'desktop' as const, label: t('preview.deviceDesktop'), icon: figAsset.deviceDesktop },
    { key: 'mobile' as const, label: t('preview.deviceMobile'), icon: figAsset.deviceMobile },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-[12px] bg-[var(--color-surface)] p-1">
      {items.map((it) => {
        const active = device === it.key;
        return (
          <Tooltip key={it.key} label={it.label}>
            <button
              type="button"
              aria-label={it.label}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => setPreviewDevice(it.key)}
              className={`inline-flex items-center justify-center rounded-[8px] px-3 py-1 transition-[background-color,color] duration-150 disabled:opacity-40 ${
                active
                  ? 'bg-[var(--color-line-strong)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <FigIcon src={it.icon} size={16} tone={active ? 'primary' : 'secondary'} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
