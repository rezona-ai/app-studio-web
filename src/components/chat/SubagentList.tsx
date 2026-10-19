'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FigIcon, figAsset } from '@/components/ui/figma';
import type { SubagentCard } from '@/lib/subagent-tasks';
import { isTerminalStatus } from '@/lib/subagent-tasks';
import { RowArrow } from './toolPill';
import Markdown from './Markdown';

// 状态图标:与任务清单行同一 16px 槽位、同一语汇(品牌橙勾 / 橙转圈 / muted 静态弧),
// 只多出 failed 一档用 danger 色警示。data-status 供视觉档位与测试对齐
export function SubagentStatusIcon({ status }: { status: SubagentCard['status'] }) {
  if (status === 'completed') {
    return (
      <span data-status={status} className="flex w-4 shrink-0 justify-center text-[var(--color-primary)]">
        <FigIcon src={figAsset.checkCircle} size={14} tone="primary" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span data-status={status} className="flex w-4 shrink-0 justify-center text-[var(--color-danger)]">
        <FigIcon src={figAsset.warningSign} size={14} tone="primary" />
      </span>
    );
  }
  // 其余四档同形静态/转动弧:仅 running 转圈(paused 是「暂停」,转圈会说谎);
  // pending 与两种结束态一律 muted
  const active = status === 'running';
  const orange = active || status === 'paused';
  // 弧外必须套一层等大的裁切槽:旋转后的外接盒最大 16·√2≈22.6px,会被算进外层限高
  // overflow-y-auto 列表的 scrollable overflow —— 每转过 90° 滚动条出现/收起一次,
  // 列表内容宽跟着抖 11px,右侧的类型标 / 折叠箭头随之横跳(肉眼即闪烁)。
  // 弧是盒内内切圆、旋转映射回自身,裁掉盒外溢出视觉无损。
  return (
    <span className="flex size-4 shrink-0 items-center justify-center overflow-clip">
      <span
        data-status={status}
        aria-hidden="true"
        className={`inline-block size-4 shrink-0 rounded-full border-[1.5px] border-b-transparent ${
          orange ? 'border-[var(--color-primary)]' : 'border-[var(--color-line-2)]'
        } ${active ? 'motion-safe:animate-spin' : ''}`}
      />
    </span>
  );
}

// 终态词:completed 不挂词(勾即说明一切);合成态的措辞跟 run.finished.status 走,
// 绝不写成「已停止」——那是 wire 终态,只能来自后端
function statusWord(card: SubagentCard, t: (k: string) => string): string | null {
  if (card.status === 'stopped') return t('chat.subagents.statusStopped');
  if (card.status === 'failed') return t('chat.subagents.statusFailed');
  if (card.status !== 'ended_without_terminal') return null;
  if (card.sealReason === 'interrupted') return t('chat.subagents.sealInterrupted');
  if (card.sealReason === 'failed') return t('chat.subagents.sealFailed');
  return t('chat.subagents.sealUnknown');
}

function SubagentRow({ card }: { card: SubagentCard }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const terminal = isTerminalStatus(card.status);
  // 还在跑且无产出时没什么可读的,不给可点的假象
  const expandable = terminal || !!card.summary || !!card.error;
  const word = statusWord(card, t);
  const head = (
    <>
      <SubagentStatusIcon status={card.status} />
      <span className={`min-w-0 flex-1 truncate font-mono text-[12px] leading-4 ${
        terminal ? 'text-[var(--color-muted)]' : 'text-[var(--color-ink)]'
      }`}>
        {card.description}
      </span>
      {/* 子代理不加类型标(主要场景);后台 shell 与未知类型都按后台命令呈现 */}
      {card.kind !== 'agent' && (
        <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{t('chat.subagents.kindBash')}</span>
      )}
      {word && (
        <span className={`shrink-0 text-[11px] ${
          card.status === 'failed' ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]'
        }`}>
          {word}
        </span>
      )}
    </>
  );
  return (
    <li className="flex flex-col gap-1">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t('chat.subagents.toggleRow')}
          className="flex w-full items-center gap-3 text-left"
        >
          {head}
          <RowArrow open={open} />
        </button>
      ) : (
        <div className="flex items-center gap-3">{head}</div>
      )}
      {/* 活体行:TaskProgressMessage 只实时下发,重连后这一行会丢(可接受降级) */}
      {!terminal && card.lastToolName && (
        <span className="pl-7 text-[11px] leading-4 text-[var(--color-muted)]">
          {t('chat.subagents.doing', { tool: card.lastToolName })}
        </span>
      )}
      {open && (
        <div className="scrollbar-auto max-h-[160px] overflow-y-auto pl-7 pr-1 text-[12px] text-[var(--color-ink)]">
          {card.summary
            ? <Markdown text={card.summary} />
            : card.error
              ? <span className="text-[var(--color-danger)]">{card.error}</span>
              : <span className="text-[var(--color-muted)]">{t('chat.subagents.noSummary')}</span>}
          {card.error && card.summary && (
            <span className="mt-1 block text-[var(--color-danger)]">{card.error}</span>
          )}
          {card.outputFile && (
            <span className="mt-1 block truncate font-mono text-[11px] text-[var(--color-muted)]" title={card.outputFile}>
              {card.outputFile}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// 子代理 / 后台命令卡片列表。与任务清单共用计划卡卡壳,由 PlanCard 按 Segmented 选段渲染。
// 纯展示组件(卡片从 props 进),状态机在 lib/subagent-tasks.ts
export default function SubagentList({ cards }: { cards: SubagentCard[] }) {
  return (
    <ul aria-live="polite" className="scrollbar-auto mt-4 flex max-h-[200px] flex-col gap-3 overflow-y-auto px-2">
      {cards.map((card) => <SubagentRow key={card.taskId} card={card} />)}
    </ul>
  );
}
