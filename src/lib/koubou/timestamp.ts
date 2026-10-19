// Koubou 时间戳归一。
//
// 契约不一致(实测):事件信封的 created_at 带 Z(`2026-07-31T11:16:50.028431Z`),而
// /sessions 的 created_at / updated_at **不带任何时区标记**(`2026-07-31T11:16:49.796923`)。
// JS 对「不带时区的 date-time」按**本地时间**解析 —— 直接 Date.parse 会在 UTC+8 机器上偏 8 小时
// (实测 naive 差值 8.000064 小时),回合计时会显示成「已运行 8 小时」。
// 后端两处时间都是 UTC,故补 Z 归一后再交给上层。
export function normalizeIsoUtc(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // 已带时区标记(Z / ±HH:MM / ±HHMM)的原样保留;否则视作 UTC 补 Z
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`;
  return Number.isNaN(Date.parse(withZone)) ? null : withZone;
}
