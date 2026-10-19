'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FigIcon, figAsset } from '@/components/ui/figma';
import { pillClass, Spinner, CollapseArrow } from './toolPill';

export default function ThinkingBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  // 跟随流式状态:流式中自动展开,结束自动收起(与工具卡一致);渲染期 guard setState,不用 effect(见项目 lint 约束)
  const [open, setOpen] = useState(streaming);
  const [prevStreaming, setPrevStreaming] = useState(streaming);
  if (prevStreaming !== streaming) {
    setPrevStreaming(streaming);
    setOpen(streaming);
  }
  // 流式输出且展开时自动滚动到底部,跟随最新思考内容
  useEffect(() => {
    if (streaming && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, streaming, open]);

  return (
    <div className={pillClass(open)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {/* 流式中=amber 转圈;完成=sparkle(中性灰,thinking 非成功/失败语义) */}
        {streaming ? (
          <Spinner />
        ) : (
          <span className="flex shrink-0"><FigIcon src={figAsset.sparkle} size={14} tone="secondary" /></span>
        )}
        <span className="font-medium">{t('chat.thinking')}</span>
        <CollapseArrow open={open} />
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="anim-collapse-in scrollbar-auto mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] text-[var(--color-muted)]"
        >
          {text}
        </div>
      )}
    </div>
  );
}
