'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '@/components/ui/Tooltip';

// 确定性波形高度(%),贴近音频频谱观感
const WAVE = [
  30, 52, 38, 68, 44, 60, 82, 48, 64, 90, 54, 72, 40, 58, 84, 50, 70, 46, 78, 62,
  34, 66, 50, 74, 42, 56, 70, 44, 60, 36, 52, 30,
];

// 模块级:保证全局同一时刻只有一个播放器在出声(播新的自动暂停旧的),画布卡与对话卡共用同一把锁
let activeAudio: HTMLAudioElement | null = null;
function claimPlayback(el: HTMLAudioElement) {
  if (activeAudio && activeAudio !== el) activeAudio.pause();
  activeAudio = el;
}

// 秒 → m:ss;metadata 未就绪(NaN/Infinity)回退 0:00
function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// 迷你音频播放器:播放/暂停 + 可 seek 的波形进度 + 当前/总时长。
// 原生 <audio controls> 各浏览器样式不一、与设计语汇冲突,故自绘控件,真实 audio 元素隐藏在内。
// 外观差异(画布卡的类型色底 / 对话里的凹槽底)由调用方经 className / style 决定。
export default function AudioPlayer({
  src,
  className = '',
  style,
  onMouseDown,
}: {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // 卸载(卡片被删 / 消息卸载)时若正占用全局播放位则让出
  useEffect(() => () => { if (activeAudio === audioRef.current) activeAudio = null; }, []);

  const progress = duration > 0 ? current / duration : 0;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  // 点击波形跳转:按点击横向比例换算 currentTime
  const seek = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = audioRef.current;
    const wave = waveRef.current;
    if (!el || !wave || !Number.isFinite(el.duration)) return;
    const rect = wave.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = frac * el.duration;
    setCurrent(el.currentTime);
  };

  return (
    <div className={className} style={style} onMouseDown={onMouseDown}>
      <div className="flex items-center gap-2.5">
        <Tooltip>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? t('canvas.pause') : t('canvas.play')}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-audio)] text-white transition-transform hover:scale-105 motion-safe:active:scale-[0.92]"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </Tooltip>

        <div ref={waveRef} onClick={seek} className="flex h-9 flex-1 cursor-pointer items-center gap-[2px]">
          {WAVE.map((h, i) => (
            <span
              key={`bar-${i}`}
              className="min-w-[2px] flex-1 rounded-full bg-[var(--color-audio)]"
              style={{ height: `${Math.max(h, 14)}%`, opacity: (i + 1) / WAVE.length <= progress ? 1 : 0.3 }}
            />
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums tracking-[-0.1px] text-[var(--color-audio)]">
        <span>{fmt(current)}</span>
        <span>{fmt(duration)}</span>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        hidden
        onPlay={() => { setPlaying(true); if (audioRef.current) claimPlayback(audioRef.current); }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />
    </div>
  );
}
