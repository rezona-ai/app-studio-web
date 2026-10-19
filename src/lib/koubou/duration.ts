// 轮次耗时格式化(纯函数):<60s 显示秒;>=60s 显示「Xm」或「Xm Ys」(整分省略秒)
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}
