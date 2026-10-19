import { getCommonParams } from './context';
import type { GA4EventName, GA4EventParams } from './events';

type GtagFn = (...args: unknown[]) => void;

// SSR(无 window)与 gtag 未就绪时一律 no-op;不抛错。gtag 由 layout 内联脚本立即定义(入队 dataLayer),
// 异步库加载后消费队列,故水合后 track 立即可用(设计稿 §地基/gtag 加载)。
function getGtag(): GtagFn | null {
  if (typeof window === 'undefined') return null;
  const g = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof g === 'function' ? g : null;
}

// params 恒为必传(不给默认值):事件的必填专有参数在编译期被强制,page_view 等空参事件显式传 {}。
export function track<E extends GA4EventName>(event: E, params: GA4EventParams[E]): void {
  const g = getGtag();
  if (!g) return;
  g('event', event, { ...getCommonParams(), ...params });
}

// 整页跳转 / 新标签前触发的事件保证送达(设计稿 §0-5):等 event_callback 或超时兜底。
export function trackAndWait<E extends GA4EventName>(
  event: E, params: GA4EventParams[E], timeoutMs = 800,
): Promise<void> {
  const g = getGtag();
  if (!g) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, timeoutMs);
    g('event', event, { ...getCommonParams(), ...params, event_callback: () => { clearTimeout(timer); finish(); } });
  });
}

// 原生 User-ID:登录后设、登出置 null(设计稿 §0-1)。
export function setUserId(id: number | null): void {
  const g = getGtag();
  if (!g) return;
  g('set', { user_id: id == null ? null : String(id) });
}
