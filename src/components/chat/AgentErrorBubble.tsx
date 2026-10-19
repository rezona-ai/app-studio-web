'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { selectModelSwitchHint } from '@/store/selectors';
import { resolveErrorMessage } from '@/i18n/errors';
import ErrorDetail, { ErrorDetailToggle } from './ErrorDetail';
import { DANGER_ACTION_CLS, DANGER_ACTION_PRIMARY_CLS } from './danger-bubble';

// agent/run 级报错(设计稿 2026-08-27)。**不进 messages**:它长在输入框正上方的固定槽里,
// 与重试进度气泡同一格、同一套瞬态模型 —— 对话流里不再堆历次失败,同一时刻至多一条。
//
// 排版(Nick 2026-09-03 定案):文案分层 + 底部一条动作栏。
//   主行(13px 红)
//   提示行(12px 正文色,仅模型侧不可重试失败时有)
//   ▸ Details                    Try again  [Switch model]
// 动作全部收进底部一条栏:此前每行右侧各挂一个按钮,两行同色同字号,读不出哪句是错误、哪句是建议、
// 哪个是首选动作。
export default function AgentErrorBubble() {
  const { t } = useTranslation();
  const err = useStore((s) => s.agentError);
  // 手动重试的判据。**不再是「它是 messages 最后一条」**:那条判据在报错之后又来了任何一条
  // 消息时就把按钮弄没了,而报错已经从消息流里搬走,「第几条」也不再有意义。
  // 三个条件各有各的理由:没有可重发 payload(刷新后 lastSend 必空)点了也发不出去;
  // 回合还在跑会撞后端 start_run 的「run already active」门;自愈中则由进度气泡接管这一格
  const canRetry = useStore((s) => s.lastSend != null && s.agentRetry == null && s.runStatus !== 'running');
  // **只在进度气泡真的在场时**让位(评审 I-2)。phase='responded' 时 agentRetry 还留着(它只
  // 剩计数用途)但进度气泡已退场 —— 判据写成 agentRetry != null 的话,这段横跨整个被重试 run
  // 的窗口里两个气泡都不画,固定槽是空的,期间任何报错都看不见
  const retrying = useStore((s) => s.agentRetry?.phase === 'waiting' || s.agentRetry?.phase === 'running');
  // 模型侧不可重试失败(设计稿 2026-09-03):多一行「换个模型试试」的提示与 Switch model 首选动作。
  // 按钮不自己开菜单,只向 store 发请求 —— 菜单归 Composer 里的 ModelSelector,两处各开一份会分叉
  const switchHint = useStore(selectModelSwitchHint);
  // 原文开合归气泡持有(开关在动作栏里、正文在栏下整宽铺开,见 ErrorDetail 注释)。
  // 不跟 err 联动重置:同一格里换了一条错,上一条摊开的原文对新错没有意义 —— 但 key 由 detail 决定更直接
  const [detailOpen, setDetailOpen] = useState(false);

  if (!err || retrying) return null;

  const hasActions = !!err.detail || canRetry || switchHint;

  return (
    <div
      role="alert"
      className="anim-collapse-in mb-2 rounded-[12px] border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2 text-[13px] leading-5 text-[var(--color-danger)]"
    >
      {/* 不带前导圆点(Nick 2026-09-03):气泡自身已有红底描边,主行下面还有提示行与动作栏,
          圆点在这个多行结构里只是多一个视觉元素,还逼着下面几行都缩进去对齐它 */}
      <p className="break-words">{resolveErrorMessage(err.code ?? '', err.text, t)}</p>
      {switchHint && (
        // 提示行用正文色而非灰:红底上的灰字发闷;红 = 错误本身,正文色 = 给你的建议,两种语义两种色
        <p className="mt-0.5 text-[12px] leading-4 text-[var(--color-ink)]">{t('chat.modelSwitch.hint')}</p>
      )}
      {hasActions && (
        <div role="group" aria-label={t('chat.error.actions')} className="mt-2 flex items-center gap-2">
          {err.detail && <ErrorDetailToggle open={detailOpen} onToggle={() => setDetailOpen((o) => !o)} />}
          <div className="ml-auto flex items-center gap-1.5">
            {canRetry && (
              <button type="button" onClick={() => useStore.getState().retryAgentNow()} className={DANGER_ACTION_CLS}>
                {t('chat.retry.manual')}
              </button>
            )}
            {switchHint && (
              <button type="button" onClick={() => useStore.getState().requestModelMenu()} className={DANGER_ACTION_PRIMARY_CLS}>
                {t('chat.modelSwitch.change')}
              </button>
            )}
          </div>
        </div>
      )}
      {detailOpen && err.detail && <ErrorDetail detail={err.detail} />}
    </div>
  );
}
