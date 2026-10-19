'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useSecondTick } from '@/client/useSecondTick';
import { MAX_AGENT_RETRIES } from '@/lib/agent-retry';
import { DANGER_ACTION_CLS, DANGER_LEAD_CLS, DANGER_ROW_CLS } from './danger-bubble';

// agent 回合失败后的自愈进度(设计稿 2026-08-25 决策 5)。就地占错误气泡那一格、沿用同款
// danger 配色,但**不写进 messages** —— 于是不落盘(重试上下文本就跨不了刷新)、全程只占一条
// (每次失败各留一条会把对话刷成 10 条红),倒计时每秒 tick 也只重渲它自己,不碰 MessageItem 的 memo。
export default function AgentRetryBubble() {
  const { t } = useTranslation();
  const retry = useStore((s) => s.agentRetry);
  const waiting = retry?.phase === 'waiting' && retry.nextAt != null;
  // 只在等待期订阅每秒 tick(单例 interval,没订阅者时不存在定时器)
  const now = useSecondTick(waiting);

  // responded = 后端已受理这次自愈,自愈这件事对用户已经结束(状态还留着,只为下次失败续计数)
  if (!retry || retry.phase === 'responded') return null;

  const left = waiting ? Math.max(0, Math.ceil((retry.nextAt! - now) / 1000)) : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="anim-collapse-in mb-2 flex items-baseline gap-2 rounded-[12px] border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2 text-[13px] leading-5 text-[var(--color-danger)]"
    >
      <span aria-hidden className={DANGER_LEAD_CLS}>
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-[var(--color-danger-soft)] border-t-[var(--color-danger)] align-middle" />
      </span>
      <div className={`${DANGER_ROW_CLS} min-w-0 flex-1`}>
        <span className="min-w-0 break-words">
          {t('chat.retry.progress', { n: retry.attempt, max: MAX_AGENT_RETRIES })}
          {waiting ? ` · ${t('chat.retry.waiting', { s: left })}` : ''}
        </span>
        <button
          type="button"
          onClick={() => useStore.getState().cancelAgentRetry()}
          className={DANGER_ACTION_CLS}
        >
          {t('chat.retry.cancel')}
        </button>
      </div>
    </div>
  );
}
