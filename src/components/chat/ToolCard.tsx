'use client';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Part } from '@/store/types';
import type { MediaItem } from '@/koubou/protocol';
import { isTaskTool } from '@/koubou/protocol';
import { basename } from '@/lib/media-import';
import { mediaThumb, type MediaThumbSource } from '@/lib/chat/media-thumb';
import { KIND_META, generatingPlaceholderPath, type GeneratingAssetKind } from '@/lib/asset-kind';
import { useStore } from '@/store';
import DiffView from './DiffView';
import { pillClass, ToolStatusIcon, CollapseArrow } from './toolPill';
import { FigIcon } from '@/components/ui/figma';
import AudioPlayer from '@/components/ui/AudioPlayer';

function ToolCard({ part }: { part: Extract<Part, { type: 'tool' }> }) {
  const { t } = useTranslation();
  const running = part.status === 'generating';
  // 仅运行中默认展开(展开后显示发起调用的参数);完成 / 失败均自动折叠,用户仍可手动切换
  const [open, setOpen] = useState(running);
  // 跟随状态切换:仅在 status 变化时自动调整展开态,不覆盖用户手动操作
  const [prevStatus, setPrevStatus] = useState(part.status);
  if (prevStatus !== part.status) {
    setPrevStatus(part.status);
    setOpen(running);
  }

  // 任务工具:主呈现在 PlanCard,消息流只留时序痕迹 → 极简 pill,不暴露入参、不可展开
  if (isTaskTool(part.name)) {
    return (
      <div className={pillClass(false)}>
        <span className="flex items-center gap-2">
          <ToolStatusIcon status={part.status} />
          <span className="font-medium">{t('chat.tool.updatedPlan')}</span>
        </span>
      </div>
    );
  }

  const diff = part.diff;
  const fileName = diff ? (diff.filePath.split('/').pop() || diff.filePath) : '';

  let argText = '';
  try { argText = part.input !== undefined ? JSON.stringify(part.input) : ''; } catch { argText = String(part.input); }

  // 可折叠正文:有 diff 时 diff 即正文(隐藏参数);否则仅展示参数(工具结果 result 只作中间处理、不展示;媒体不参与折叠,始终可见)
  const hasBody = Boolean(diff) || Boolean(argText);
  // 有下方内容(展开正文 或 始终可见的媒体)→ 卡片角;纯单行 → 全圆胶囊
  const showsBelow = (open && hasBody) || Boolean(part.media?.length);

  return (
    <div className={pillClass(showsBelow)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <ToolStatusIcon status={part.status} />
        <span className="font-medium">{part.name}</span>
        {diff && (
          <>
            <span className="min-w-0 truncate text-[var(--color-muted)]" title={diff.filePath}>{fileName}</span>
            <span className="shrink-0 text-[11px] text-emerald-600">+{diff.additions}</span>
            <span className="shrink-0 text-[11px] text-red-600">-{diff.deletions}</span>
            {diff.userModified && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-600">{t('chat.tool.userEdited')}</span>
            )}
          </>
        )}
        {hasBody && <CollapseArrow open={open} />}
      </button>
      {/* 可折叠正文:展开时挂载并下滑淡入(折叠即时卸载);仅 diff / 参数,工具结果 result 不展示;媒体始终可见,不参与折叠 */}
      {open && hasBody && (
        <div className="anim-collapse-in mt-1.5 space-y-2">
          {diff && <DiffView diff={diff} />}
          {/* 参数=送进工具的「投入」:压进凹槽、保持暗 muted */}
          {!diff && argText && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium tracking-[0.04em] text-[var(--color-muted)]">{t('chat.tool.input')}</div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--color-fill)] px-2 py-1.5 text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400)}</pre>
            </div>
          )}
        </div>
      )}
      {part.media && part.media.length > 0 && <MediaGroup items={part.media} />}
    </div>
  );
}

// memo:part 是不可变更新,引用不变即跳过;流式期避免随 ChatPanel 每 delta 重渲
export default memo(ToolCard);

// 进带的一项:kind 已窄化到有类型占位图的四类(text/doc 在 MediaGroup 处已滤掉)
interface ShownMedia { item: MediaItem; thumb: MediaThumbSource & { kind: GeneratingAssetKind } }

// 一轮产出的多资产:≥2 件时横向缩略图带(每格带类型徽章)+ 带下方常驻展开位(默认首项);
// 单件仍全尺寸常驻。带与 pill 头部控制 diff/参数的 chevron 相互独立(自持选中态)。
function MediaGroup({ items }: { items: MediaItem[] }) {
  // 3D 的缩略图只能从画布同名资产的 poster 反查(见 mediaThumb 注释),故需订阅 assets。
  // 带 media 的工具卡一轮里只有寥寥几张,扇出可接受(不同于逐条渲染的 MessageItem)。
  const assets = useStore((s) => s.assets);
  const [active, setActive] = useState(0);
  // 可展示 = 可内联的媒体类型(text/doc 无内联形态)且能内联播放(previewUrl)或有缩略图(画布 poster);
  // 皆无则不进带,避免留下点不开的死格
  const shown = items
    .map((item) => ({ item, thumb: mediaThumb(item, assets) }))
    .filter((m): m is ShownMedia => m.thumb.kind !== 'text' && (!!m.item.previewUrl || !!m.thumb.src));
  if (shown.length === 0) return null;
  if (shown.length === 1) return <div className="mt-2" data-testid="media-inline"><MediaItemView item={shown[0].item} thumb={shown[0].thumb} /></div>;
  const current = shown[Math.min(active, shown.length - 1)];
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {shown.map(({ item, thumb }, i) => (
          <MediaThumbCell key={i} item={item} thumb={thumb} selected={i === active} onSelect={() => setActive(i)} />
        ))}
      </div>
      {/* 展开位独占整行:音频控件在此才有正常宽度(旧折叠态把它塞进 w-fit 按钮里被挤成 0 宽) */}
      <div className="anim-media-in" data-testid="media-inline" key={current.item.path}>
        <MediaItemView item={current.item} thumb={current.thumb} />
      </div>
    </div>
  );
}

// 缩略图带单格:方形封面(无图回退类型占位图)+ 右下角类型徽章;选中转 品牌橙描边 + 柔光
function MediaThumbCell({ item, thumb, selected, onSelect }: ShownMedia & { selected: boolean; onSelect: () => void }) {
  const name = basename(item.path);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={name}
      aria-pressed={selected}
      title={name}
      className={`relative size-16 shrink-0 overflow-hidden rounded-[10px] border bg-[var(--color-fill)] transition motion-safe:active:scale-[0.92] ${
        selected
          ? 'border-[var(--color-primary)] shadow-[0_0_0_3px_var(--color-primary-soft)]'
          : 'border-[var(--color-line-2)] hover:border-[var(--color-line)]'
      }`}
    >
      {/* 无真实缩略图(视频/音频恒无、3D 快照未就绪)一律回退类型占位图,与画布生成卡同一套视觉 */}
      <img
        src={thumb.src ?? generatingPlaceholderPath(thumb.kind)}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      {/* 类型徽章:类型色描边的小贴片,混合资产里一眼分得出图/视/音/3D */}
      <span
        className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-[6px] border bg-[var(--color-pop)]"
        style={{ borderColor: KIND_META[thumb.kind].colorVar, color: KIND_META[thumb.kind].colorVar }}
      >
        <FigIcon src={KIND_META[thumb.kind].icon} size={12} />
      </span>
    </button>
  );
}

// 单项资产的内联预览。3D 不挂 model-viewer(消息流成本高,细节以画布为准),
// 只放 PGC 产出的模型快照(thumb.src),未就绪回退类型占位图。
function MediaItemView({ item, thumb }: ShownMedia) {
  if (thumb.kind === '3d') {
    // 快照未就绪(资产刚落画布)回退类型占位图,与画布 3D 卡同一处理
    return <img src={thumb.src ?? generatingPlaceholderPath('3d')} alt={basename(item.path)} loading="lazy" decoding="async" className="max-h-48 rounded-[8px]" />;
  }
  if (!item.previewUrl) return null;
  if (thumb.kind === 'video') return <video src={item.previewUrl} controls preload="metadata" className="max-h-48 rounded-[8px]" />;
  // 音频用自绘播放器(原生 controls 各浏览器样式不一,与设计语汇冲突);对话里用凹槽底,不套类型色
  if (thumb.kind === 'audio') return <AudioPlayer src={item.previewUrl} className="rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 py-2" />;
  return <img src={item.previewUrl} alt={basename(item.path)} loading="lazy" decoding="async" className="max-h-48 rounded-[8px]" />;
}
