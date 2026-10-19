import { useEffect, useState } from "react";
import { FigIcon, figAsset } from "@/components/ui/figma";

// 品牌字标逐字拆分:每字独立进场延迟(+50ms),整词容器负责 Sekuya 字体与循环扫光。
// 词间空格转 NBSP:逐字 span 是 inline-block,普通空格会被折叠掉,字标会连成 "RezonaLab"
const WORDMARK = Array.from("Rezona Lab", (ch) => (ch === " " ? "\u00A0" : ch));

// 全局加载动画:shimmer 底 + 可选文案;应用启动与预览加载共用,尺寸由 className 决定。
// 三档层级(反馈重量匹配加载范围,勿越级使用):
// 'brand'(仅 Workspace 全屏启动):logo 弹入 + 字标逐字浮现 + 循环呼吸/扫光;
// 'soft'(面板级较长等待:游戏预览/回放 provisioning):品牌橙柔光底 + 轨道环 + hints 假进度,不引入 logo/字标;
// 默认 'spinner'(对比等小容器):品牌橙轨道环,无底纹无 hints。
// closing=true 时播放淡出(配合 useExitTransition 延时卸载);默认挂载淡入。
export default function LoadingScreen({
  label,
  className = "",
  closing = false,
  variant = "spinner",
  hints = [],
}: {
  label?: string;
  className?: string;
  closing?: boolean;
  variant?: "brand" | "soft" | "spinner";
  /** brand/soft 档:假进度文案序列,每 900ms 顺序切换、停在最后一条;传入时替代 label 文案位 */
  hints?: string[];
}) {
  // 假进度轮播:纯展示,不上报真实阶段;booting 撤层即整层退场,走到哪算哪
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (variant === "spinner" || hints.length <= 1) return;
    const timer = setInterval(() => {
      // 走到最后一条停住不回绕;到底后清掉计时器避免空转
      setHintIdx((i) => (i + 1 >= hints.length ? (clearInterval(timer), i) : i + 1));
    }, 900);
    return () => clearInterval(timer);
  }, [variant, hints.length]);
  const hint = hints.length > 0 ? hints[Math.min(hintIdx, hints.length - 1)] : label;
  return (
    // 外层不加 relative:定位由调用方 className(fixed/absolute)提供;若加 relative,会因 Tailwind 中 .relative 排在 .fixed/.absolute 之后而覆盖它们,导致全屏层塌陷、loading 不显示
    <div className={`grid place-items-center ${closing ? "anim-fade-out" : "anim-media-in"} ${className}`}>
      {/* brand/soft 档用静态品牌底(canvas 色 + 中心 品牌橙柔光),spinner 档保留骨架 shimmer */}
      {variant !== "spinner" ? (
        <div className="brand-backdrop absolute inset-0 rounded-[inherit]" aria-hidden />
      ) : (
        <div className="skeleton-shimmer absolute inset-0 rounded-[inherit]" aria-hidden />
      )}
      {variant === "brand" ? (
        <div role="status" aria-label={label ?? "Loading"} className={`relative flex flex-col items-center gap-4 ${closing ? "brand-exit" : ""}`}>
          {/* transform 动画加在 wrapper 上:FigIcon original 档 <img> 自带 style 尺寸,避免 transform 冲突 */}
          <div className="brand-logo-in brand-float">
            <FigIcon src={figAsset.logo} size={48} />
          </div>
          <span aria-hidden className="relative font-display text-[24px] leading-none text-[var(--color-ink)]">
            {WORDMARK.map((ch, i) => (
              <span key={i} className="brand-letter inline-block" style={{ animationDelay: `${150 + i * 50}ms` }}>
                {ch}
              </span>
            ))}
            {/* 扫光覆盖层:Chromium 下 background-clip:text 无法透过带动画的子元素(独立合成层)绘制,
                故基础字母正常着色做进场,扫光放到无子动画的独立覆盖层,只裁出高光带。
                覆盖层逐字 span 与基础层同构以保证排版逐像素对齐(整词文本有 kerning、逐字 span 无,混用会错位) */}
            <span className="wordmark-sheen absolute inset-0">
              {WORDMARK.map((ch, i) => (
                <span key={i} className="inline-block">
                  {ch}
                </span>
              ))}
            </span>
          </span>
          {hint && (
            <span
              key={hint}
              className="anim-media-in text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]"
              style={{ animationDelay: hintIdx === 0 ? "400ms" : "0ms", animationFillMode: "both" }}
            >
              {hint}
            </span>
          )}
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-2.5">
          <span
            role="status"
            aria-label={label ?? "Loading"}
            className="size-7 animate-spin rounded-full border-2 border-[var(--color-primary-soft)] border-t-[var(--color-primary)]"
          />
          {/* soft 档文案位走 hint(假进度轮播,key 触发逐条淡入);spinner 档保持静态 label */}
          {variant === "soft"
            ? hint && (
                <span key={hint} className="anim-media-in text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]">
                  {hint}
                </span>
              )
            : label && (
                <span className="text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]">{label}</span>
              )}
        </div>
      )}
    </div>
  );
}
