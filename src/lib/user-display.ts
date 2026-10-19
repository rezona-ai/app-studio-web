import type { CurrentUser } from '@/lib/pgc/types';

// 首字母头像:display_name 优先,否则 username;取首个非空白码位大写;无有效字符回退 '?'。
// 后端 /auth/me 不返回头像 URL,故用首字母作占位头像。
export function userInitial(user: CurrentUser | null | undefined): string {
  const raw = user?.display_name?.trim() || user?.username?.trim() || '';
  const ch = [...raw][0]; // 扩展运算符按码位取首字符,兼容多字节(如中文/emoji)
  return ch ? ch.toUpperCase() : '?';
}

// credit 紧凑展示:< 1000 精确(如 856),≥ 1000 缩写为 K/M/B(如 1.2K / 3.4M / 1.5B)。
// 目的:让积分显示宽度有界——原样 String(n) 宽度无界,大额积分会把账户条撑到顶住分享按钮。
// 固定用 'en' 记法而非跟随 i18n:避免 zh/ja 出现 万/億 分级,六语统一 K/M/B;精确值由 formatCreditExact 悬停给出。
// 缺值 / 非有限数回退 '0'。
const CREDIT_COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export function formatCredit(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? CREDIT_COMPACT.format(n) : '0';
}

// credit 精确展示(带千分位),用于紧凑数字的悬停 title 提示;缺值 / 非有限数回退 '0'。
export function formatCreditExact(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en') : '0';
}
