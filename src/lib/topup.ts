// 充值弹窗纯逻辑:金额/倒计时/折扣展示与订单终态判定。
// 全部无副作用,便于单测;字段语义见 src/lib/biz/types.ts 与 spec 2026-07-13-topup-modal。
import type { TopupPackage, TopupOrder } from '@/lib/biz/types';

// 分 → 美元字符串。compact 模式用于卡片划线原价(整元去小数,对齐设计稿 "$10" vs "$5.00")。
// 当前 biz-api 仅 USD,符号固定 $;多币种待后端出现再扩展,不预置分支。
export function formatUsd(cents: number, opts: { compact?: boolean } = {}): string {
  const usd = cents / 100;
  if (opts.compact && Number.isInteger(usd)) return `$${usd}`;
  return `$${usd.toFixed(2)}`;
}

// pay_rate_bps(用户支付比例,基点)→ 折扣百分比:7000(付 70%)→ 30(即 30% off)
export function couponPercent(payRateBps: number): number {
  return Math.round((10000 - payRateBps) / 100);
}

// 剩余毫秒 → HH:MM:SS(小时可超 24,对齐设计稿 47:12:03);已过期一律 00:00:00
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// 从档位推「每美元积分数」(以原价计):自定义金额无后端报价接口,仅用于展示估算(spec 决策 1)。
// 各档位比率可能不同,取首档;档位为空或数据异常返回 null(UI 隐藏估算)。
export function creditsPerUsd(packages: TopupPackage[]): number | null {
  const p = packages[0];
  if (!p || p.amount_cents <= 0 || p.credits <= 0) return null;
  return p.credits / (p.amount_cents / 100);
}

// 自定义金额的到账积分估算(展示用,实际以后端到账为准)
export function estimateCustomCredits(amountUsd: number, rate: number | null): number | null {
  if (rate == null || !Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  return Math.round(amountUsd * rate);
}

// 订单终态判定:状态枚举未在 Apifox 文档化,只依赖已文档化字段——
// paid_at 非空 = 支付成功;status === 'failed' = 已关闭/失败(与关单接口文档一致)。
export function isOrderPaid(order: Pick<TopupOrder, 'paid_at'>): boolean {
  return order.paid_at != null && order.paid_at !== '';
}

export function isOrderClosed(order: Pick<TopupOrder, 'status'>): boolean {
  return order.status === 'failed';
}
