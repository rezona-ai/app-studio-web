'use client';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Part, Status } from '@/store/types';
import { isTaskTool } from '@/koubou/protocol';
import { pillClass, ToolStatusIcon, CollapseArrow } from './toolPill';

type ToolPart = Extract<Part, { type: 'tool' }>;

// 组聚合状态:任一进行中 → generating;否则任一失败 → error;否则 ready(全完成)
function aggregateStatus(parts: ToolPart[]): Status {
  if (parts.some((p) => p.status === 'generating' || p.status === 'pending')) return 'generating';
  if (parts.some((p) => p.status === 'error')) return 'error';
  return 'ready';
}

function ToolGroupCard({ name, parts }: { name: string; parts: ToolPart[] }) {
  const { t } = useTranslation();
  const taskGroup = isTaskTool(name);
  const agg = aggregateStatus(parts);
  // 仅进行中默认展开,完成 / 失败均自动收起;渲染期 guard 跟随 agg 变化,不用 effect(同 ToolCard)
  const [open, setOpen] = useState(agg === 'generating');
  const [prevAgg, setPrevAgg] = useState(agg);
  if (prevAgg !== agg) {
    setPrevAgg(agg);
    setOpen(agg === 'generating');
  }
  return (
    <div className={pillClass(open)}>
      <button
        type="button"
        onClick={() => { if (!taskGroup) setOpen((o) => !o); }}
        aria-expanded={taskGroup ? undefined : open}
        className="flex w-full items-center gap-2 text-left"
      >
        <ToolStatusIcon status={agg} />
        <span className="font-medium">{taskGroup ? t('chat.tool.updatedPlan') : name}</span>
        <span className="text-[var(--color-muted)]">×{parts.length}</span>
        {!taskGroup && <CollapseArrow open={open} />}
      </button>
      {open && !taskGroup && (
        <div className="anim-collapse-in mt-1.5 space-y-1">
          {parts.map((p, i) => <GroupRow key={p.id || i} part={p} />)}
        </div>
      )}
    </div>
  );
}

// memo:parts 数组随消息不可变更新,引用不变即跳过流式期的无谓重渲
const ToolGroupCardMemo = memo(ToolGroupCard);
export default ToolGroupCardMemo;

// 单次调用一行:仅未完成(进行中/失败)才前置状态图标(完成不加,避免一排 品牌橙勾);后接参数
function GroupRow({ part }: { part: ToolPart }) {
  let argText = '';
  try { argText = part.input !== undefined ? JSON.stringify(part.input) : ''; } catch { argText = String(part.input); }
  return (
    <div className="flex items-start gap-2">
      {part.status !== 'ready' && <span className="mt-0.5 shrink-0"><ToolStatusIcon status={part.status} /></span>}
      <pre className="max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--color-fill)] px-2 py-1.5 text-[12px] text-[var(--color-muted)]">{argText.slice(0, 400) || '—'}</pre>
    </div>
  );
}
