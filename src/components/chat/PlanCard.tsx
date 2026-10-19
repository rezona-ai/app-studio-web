'use client';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useExitTransition } from '@/client/useExitTransition';
import { FigIcon, figAsset } from '@/components/ui/figma';
import Segmented from '@/components/ui/Segmented';
import { isTerminalStatus } from '@/lib/subagent-tasks';
import { CollapseArrow } from './toolPill';
import SubagentList, { SubagentStatusIcon } from './SubagentList';
import type { PlanTaskStatus } from '@/koubou/protocol';

// 状态图标(设计稿 2841:62478):completed=品牌橙勾 14px;in_progress=品牌橙转圈 16px;
// pending=同形静态弧 muted(mock 未区分后两态,按语义补:仅当前项转动)
function PlanStatusIcon({ status }: { status: PlanTaskStatus }) {
  if (status === 'completed') {
    return (
      <span className="flex w-4 shrink-0 justify-center text-[var(--color-primary)]">
        <FigIcon src={figAsset.checkCircle} size={14} tone="primary" />
      </span>
    );
  }
  const active = status === 'in_progress';
  // 等大裁切槽的理由同 SubagentStatusIcon:旋转外接盒会撑出限高列表的 scrollable overflow,
  // 招来滚动条反复出现/收起、行内右侧内容横跳
  return (
    <span className="flex size-4 shrink-0 items-center justify-center overflow-clip">
      <span
        aria-hidden="true"
        className={`inline-block size-4 shrink-0 rounded-full border-[1.5px] border-b-transparent ${
          active
            ? 'border-[var(--color-primary)] motion-safe:animate-spin'
            : 'border-[var(--color-line-2)]'
        }`}
      />
    </span>
  );
}

// planner 计划卡:固定悬浮在 Composer 上方,双段容器 —— agent 任务清单(TaskCreate/TaskUpdate)
// 与子代理 / 后台命令卡片(Task*Message 生命周期)共用同一卡壳,两段都有内容时头部出 Segmented。
// 折叠态只留标题行 + mono 进度计数 + 当前执行中的一行;展开态严格按 mock(标题 + 行,无计数)。
// forwardRef 暴露根节点:ChatPanel 据此测高,给消息滚动区补等高底部内边距,避免末条消息被悬浮卡遮挡。
const PlanCard = forwardRef<HTMLDivElement>(function PlanCard(_props, ref) {
  const { t } = useTranslation();
  const tasks = useStore((s) => s.tasks);
  const cards = useStore((s) => s.subagents.cards);
  const planView = useStore((s) => s.planView);
  const setPlanView = useStore((s) => s.setPlanView);
  const collapsed = useStore((s) => s.planCollapsed);
  const togglePlanCollapsed = useStore((s) => s.togglePlanCollapsed);
  const runStatus = useStore((s) => s.runStatus);
  const hasTasks = tasks.length > 0;
  const hasCards = cards.length > 0;
  // 仅运行中展示:run 结束(finished/interrupted)立即淡出,不论是否还有未完成项;
  // 两段都空(切项目/新会话)同样触发退场。
  const visible = (hasTasks || hasCards) && runStatus === 'running';
  const { mounted, closing } = useExitTransition(visible, 200);
  if (!mounted) return null;
  // 实际显示哪段由内容派生,而不是直接读 planView:一段空掉时自动回落另一段,
  // 于是「run.started 清空卡片后回到任务清单」不需要额外的重置动作(reducer 不该改 UI 态)
  const view: 'tasks' | 'subagents' = hasCards && (!hasTasks || planView === 'subagents') ? 'subagents' : 'tasks';
  const both = hasTasks && hasCards;
  const done = view === 'subagents'
    ? cards.filter((c) => isTerminalStatus(c.status)).length
    : tasks.filter((x) => x.status === 'completed').length;
  const total = view === 'subagents' ? cards.length : tasks.length;
  // 折叠态在标题下补一行当前进行中的项(清单取首个 in_progress、子代理取首个未收卡);无则只留标题行
  const current = tasks.find((x) => x.status === 'in_progress');
  const currentCard = cards.find((c) => !isTerminalStatus(c.status));
  // 展开列表把已完成项沉底:未完成在前(保持原相对顺序),完成的挪到最下方
  const ordered = [...tasks.filter((x) => x.status !== 'completed'), ...tasks.filter((x) => x.status === 'completed')];
  return (
    <div
      ref={ref}
      className={`absolute inset-x-3 bottom-full z-0 mb-2 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] px-2 py-3 shadow-[var(--shadow-popover)] backdrop-blur-[6px] ${closing ? 'anim-fade-out' : 'anim-collapse-in'}`}
    >
      <div className="flex w-full items-center gap-2 px-2">
        {both ? (
          <div className="min-w-0 flex-1">
            <Segmented
              value={view}
              options={[
                { value: 'tasks', label: t('chat.plan.title') },
                { value: 'subagents', label: `${t('chat.subagents.title')} ${cards.length}` },
              ]}
              onChange={(v) => setPlanView(v === 'subagents' ? 'subagents' : 'tasks')}
              ariaLabel={t('chat.subagents.switch')}
            />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-[1.5] text-[var(--color-ink)]">
            {view === 'subagents' ? t('chat.subagents.title') : t('chat.plan.title')}
          </span>
        )}
        <button
          type="button"
          onClick={togglePlanCollapsed}
          aria-expanded={!collapsed}
          aria-label={t('chat.plan.toggle')}
          className="flex shrink-0 items-center gap-2 text-left"
        >
          {collapsed && (
            <span className="font-mono text-[12px] text-[var(--color-muted)]">{done}/{total}</span>
          )}
          <CollapseArrow open={!collapsed} />
        </button>
      </div>
      {view === 'subagents' ? (
        <>
          {collapsed && currentCard && (
            <div className="mt-2 flex items-center gap-4 px-2">
              {/* 按卡片真实状态出图标:折叠态硬写「进行中」会让 pending / paused 的卡在这里转圈,
                  与展开态(paused 静态橙弧)对同一状态给出两种说法 */}
              <SubagentStatusIcon status={currentCard.status} />
              <span className="min-w-0 truncate font-mono text-[12px] leading-4 text-[var(--color-ink)]">
                {currentCard.description}
              </span>
            </div>
          )}
          {!collapsed && <SubagentList cards={cards} />}
        </>
      ) : (
      <>
      {collapsed && current && (
        <div className="mt-2 flex items-center gap-4 px-2">
          <PlanStatusIcon status="in_progress" />
          <span className="min-w-0 truncate font-mono text-[12px] leading-4 text-[var(--color-ink)]">
            {current.activeForm || current.subject}
          </span>
        </div>
      )}
      {/* 限高恰好 4 行(行高 16px + gap 16px = 112px),超出滚动查看 */}
      {!collapsed && (
        <ul aria-live="polite" className="scrollbar-auto mt-4 flex max-h-[112px] flex-col gap-4 overflow-y-auto px-2">
          {ordered.map((task) => (
            <li key={task.id} className="flex items-center gap-4">
              <PlanStatusIcon status={task.status} />
              <span
                className={`min-w-0 truncate font-mono text-[12px] leading-4 ${
                  task.status === 'completed' ? 'text-[var(--color-muted)] line-through' : 'text-[var(--color-ink)]'
                }`}
              >
                {task.status === 'in_progress' ? task.activeForm || task.subject : task.subject}
              </span>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
    </div>
  );
});

export default PlanCard;
