'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import type { TurnMeta } from '@/store/types';
import { modelLabel } from '@/lib/koubou/models';
import { formatDuration } from '@/lib/koubou/duration';

// 从 startedAt(ISO)到 endMs 的秒数;startedAt 缺失或非法返回 null。时钟偏移钳到 0。
function elapsedSeconds(startedAt: string | null, endMs: number): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((endMs - start) / 1000));
}

export default function TurnFooter({ turn }: { turn: TurnMeta }) {
  const { t } = useTranslation();
  const running = turn.status === 'running';
  // 回放期:事件是历史时间戳,"现在"改用播放头(最近一帧的 created_at),否则运行中回合按真实
  // 当前时间会显示成"已运行数月";播放头随每帧派发推进,自带跳秒,无需真实计时器
  const replaying = useStore((s) => s.replay != null);
  const playheadAt = useStore((s) => s.replay?.playheadAt ?? null);
  // 断连闩:一旦观测到失败态即锁定,直到重新 open 才解除——退避重连循环里 status 会在
  // closed/error ↔ connecting 间反复,不闩住计时会闪烁;首屏初次 connecting(从未失败)不触发。
  // 渲染期 guarded setState(遵仓库禁 effect-setState 约束,同 ReconnectBanner 的 everOpen 范式)
  const connStatus = useStore((s) => s.connStatus);
  const [connLost, setConnLost] = useState(false);
  if (!connLost && (connStatus === 'closed' || connStatus === 'error' || connStatus === 'stalled' || connStatus === 'fatal' || connStatus === 'superseded')) setConnLost(true);
  if (connLost && connStatus === 'open') setConnLost(false);
  // 断连是否接管展示:仅进行中且非回放期(回放不依赖连接)
  const showConnLost = running && !replaying && connLost;
  // 进行中:每秒重算"现在"以驱动跳秒;结束态/回放期/断连期不计时
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running || replaying || showConnLost) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, replaying, showConnLost]);

  const model = turn.model ? modelLabel(turn.model) : null;
  // 无模型:进行中仍渲染纯计时(发送即开表,model 要等 SystemMessage 回填);已结束轮维持不渲染的降级约定
  if (!model && !running) return null;

  let timeText: string | null;
  if (showConnLost) {
    // 断连期停表:计时数字失真(帧到不了),换成中断提示,重连横条负责操作入口
    timeText = t('chat.turn.connLost');
  } else if (running) {
    const endMs = replaying ? (playheadAt ? Date.parse(playheadAt) : NaN) : nowMs;
    const secs = Number.isNaN(endMs) ? null : elapsedSeconds(turn.startedAt, endMs);
    // secs == null 表示 startedAt/播放头缺失或非法,回落为纯 running 文案
    timeText = secs == null ? t('chat.turn.running') : t('chat.turn.runningFor', { dur: formatDuration(secs) });
  } else {
    const endMs = turn.finishedAt ? Date.parse(turn.finishedAt) : NaN;
    const secs = Number.isNaN(endMs) ? null : elapsedSeconds(turn.startedAt, endMs);
    // 此分支 running 已为 false,status 必非 'running'
    const status = turn.status as Exclude<TurnMeta['status'], 'running'>;
    timeText = secs == null ? null : t(`chat.turn.${status}`, { dur: formatDuration(secs) });
  }

  // model 与 timeText 双缺(如 running 但 startedAt 非法):没有可展示内容,不占位
  if (!model && !timeText) return null;
  return (
    // mb-5 与消息间距同节奏:避免贴住下一轮 user 气泡 / 底部骨架屏
    <div className="mb-5 mt-1 px-1 text-xs text-[var(--color-muted)]">
      {model ? `${model}${timeText ? ` · ${timeText}` : ''}` : timeText}
    </div>
  );
}
