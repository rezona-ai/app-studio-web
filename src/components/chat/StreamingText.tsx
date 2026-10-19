'use client';
import { useMemo } from 'react';
import Markdown from './Markdown';
import { useTypewriter } from '@/client/useTypewriter';
import { findStableBoundary } from '@/lib/chat/stable-markdown';

// 流式期保留打字机的揭示节奏,渲染走 Markdown 但按块边界分段(审计 A2):
// 已完成的块进「稳定前缀」实例——Markdown 已 memo,只在边界推进时重解析;
// 增长中的尾块单独一个小实例,每 tick 只重解析当前块,不再对整段已揭示文本从头解析
// (原实现对增长中字符串全量重解析,累计 O(最终长度²))。
// 尾部光标照旧;非流式(已落定)回到单实例全量渲染。
export default function StreamingText({
  text,
  streaming,
  className = '',
}: {
  text: string;
  streaming: boolean;
  className?: string;
}) {
  const { head, tail } = useTypewriter(text, streaming);
  const revealed = head + tail.map((c) => c.text).join('');
  const showCaret = streaming && revealed.length < text.length;
  const boundary = useMemo(() => (streaming ? findStableBoundary(revealed) : 0), [streaming, revealed]);
  const stable = revealed.slice(0, boundary);
  const live = revealed.slice(boundary);
  return (
    <div className={`md-stream ${className}`}>
      {stable && <Markdown text={stable} />}
      {(live || !stable) && <Markdown text={live} />}
      {showCaret && <span className="md-caret" aria-hidden />}
    </div>
  );
}
