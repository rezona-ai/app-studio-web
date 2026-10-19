import type {
  TopupOptions, CreateWaffoOrderRequest, CreateWaffoOrderData, TopupOrder, CloseTopupOrderData,
  SubscriptionPlansData, SubscriptionChangeRequest, SubscribeData, ChangePlanData, SubscriptionOrder,
} from './types';
import { apiPath } from '@/lib/basePath';

// 经 apiPath 补 basePath(见 src/lib/basePath.ts):/game 部署下 → /game/api/biz,
// 否则命中 LB /api/* 规则被路由到别的后端。
const PREFIX = apiPath('/api/biz');

export class BizError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'BizError';
  }
}

// biz-api 无信封:2xx 即成功、body 即 data;非 2xx 尽力从 body 取 code/message(代理 502 为 {code,message},
// 上游错误格式未文档化,故只做尽力提取,不臆测字段做分支)。
async function unwrap<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const rec = (body ?? {}) as Record<string, unknown>;
    const code = typeof rec.code === 'string' ? rec.code : 'HTTP_ERROR';
    const message = typeof rec.message === 'string' ? rec.message : `HTTP ${res.status}`;
    throw new BizError(code, message, res.status);
  }
  return body as T;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function biz<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  // credentials:'include' 让浏览器附上 .rezona.ai session cookie(cookie 制鉴权)
  const init: RequestInit = { method, credentials: 'include', signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${PREFIX}${path}`, init);
  } catch (e) {
    // 超时中止归一为 BizError:调用方按已知错误兜底(Toast),而非裸抛 DOMException
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new BizError('TIMEOUT', `Request timeout: ${method} ${path}`, 0);
    }
    throw e;
  }
  return unwrap<T>(res);
}

export const bizApi = {
  // 充值配置:档位 + 可用券 + Waffo 开关
  getTopupOptions: () => biz<TopupOptions>('GET', '/credits/topup/options'),
  // 建单并拿收银台 URL;idempotency_key 每次点击新生成(重复提交由后端按键去重)
  createWaffoOrder: (body: CreateWaffoOrderRequest) =>
    biz<CreateWaffoOrderData>('POST', '/credits/topup/waffo', body),
  // 查单(支付轮询)
  getTopupOrder: (id: string) =>
    biz<TopupOrder>('GET', `/credits/topup/order?id=${encodeURIComponent(id)}`),
  // 用户主动关闭未支付订单(释放占用的优惠券)
  closeTopupOrder: (id: string) =>
    biz<CloseTopupOrderData>('POST', '/credits/topup/order/close', { id }),

  // ---- 订阅域 ----
  // 套餐列表:current_tier / plans / usage_units 一次拿全,故弹窗不再需要 /subscription/me。
  // 后端挂 UserAuthOptional,未登录按 free 档返回(不会 401)。
  getSubscriptionPlans: () => biz<SubscriptionPlansData>('GET', '/subscription/plans'),
  // 首次订阅(free → 付费):落本地 pending + Waffo Create,返回收银台 URL
  createSubscription: (body: SubscriptionChangeRequest) =>
    biz<SubscribeData>('POST', '/subscription/subscribe', body),
  // 升档(已付费 → 更高档):升档立即生效;redirect_url 仅在需重新授权时下发,缺失属正常
  changeSubscription: (body: SubscriptionChangeRequest) =>
    biz<ChangePlanData>('POST', '/subscription/change', body),
  // 订阅查单(支付轮询):不信任支付渠道 return URL,以本地状态为准
  getSubscriptionOrder: (id: string) =>
    biz<SubscriptionOrder>('GET', `/subscription/order?id=${encodeURIComponent(id)}`),
};
