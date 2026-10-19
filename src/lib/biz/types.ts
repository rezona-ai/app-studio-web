// biz-api 充值域类型:字段与 Apifox 项目 8391231 /tln/biz/credits/topup/* 文档一致(snake_case,不加别名兜底)。
// 响应为裸 JSON(无 PGC/Koubou 信封),错误由 client 按 HTTP 状态码归一为 BizError。

// 当前可用折扣券(如首充券);无券时 options.coupon 为 null
export interface TopupCoupon {
  id: string;
  type: string;                 // 券类型:discount
  pay_rate_bps: number;         // 用户支付比例(基点):7000 即付 70% == 7 折;仅用于展示徽标,不参与价格计算
  max_discount_cents: number;   // 封顶优惠金额(分)
  currency: string;
  expires_at: string;           // 过期时间(倒计时依据)
}

// 可购买充值档位;券后价一律以 discounted_amount_cents 为准,前端不自行计算折扣
export interface TopupPackage {
  id: string;
  credits: number;              // 到账积分
  amount_cents: number;         // 原价(分)
  discounted_amount_cents: number; // 折后实付(分);无可用券时等于原价
  discount_cents: number;       // 本档优惠金额(分);无券时为 0
  currency: string;
}

export interface TopupOptions {
  enabled: boolean;             // Waffo 充值是否可用;false 时 CTA 回落主站充值页
  currency: string;
  coupon: TopupCoupon | null;
  packages: TopupPackage[];
  // 当前用户能否充值:后端强校验「须活跃付费订阅会员」(2026-08-03 起充值改为会员专属)。
  // 老响应无此字段 → undefined,调用方按「未知不拦」处理,由后端建单时拒。
  topup_allowed?: boolean;
}

// 建单入参:package_id 与 amount_usd(整数美元原价,最小 1)二选一
export interface CreateWaffoOrderRequest {
  package_id?: string;
  amount_usd?: number;
  idempotency_key: string;
}

export interface CreateWaffoOrderData {
  id: string;                   // 本地充值订单 UUID,用于轮询查单
  redirect_url: string;         // Waffo 收银台跳转 URL
  status: string;               // 本地订单状态(枚举未文档化,判定见 lib/topup.ts)
  order_status?: string;        // Waffo 订单状态:PAY_IN_PROGRESS / PAY_SUCCESS / ORDER_CLOSE 等
  merchant_order_id?: string;
  payment_request_id?: string;
  acquiring_order_id?: string;
}

export interface TopupOrder {
  id: string;
  status: string;
  paid_at?: string | null;      // 支付完成时间:非空即支付成功(唯一可靠的成功信号)
  expires_at?: string | null;   // 订单过期时间(超过则不可支付)
  credits?: number;
  amount_cents?: number;
  currency?: string;
  package_id?: string | null;
  redirect_url?: string;
  created_at?: string;
}

export interface CloseTopupOrderData {
  id: string;
  status: string;               // failed=已关闭并释放优惠券;其它=未改动(已终态/已支付)
}

// ---- 订阅域(biz-api /tln/biz/subscription/*,Apifox 8391231) ----
// 后端枚举恒为 starter/creator/master;设计稿的 Starter/Creator/Max 是展示名,
// 映射在 lib/subscription/plan-display.ts,不改这里的取值。
export type SubscriptionTier = 'starter' | 'creator' | 'master';
// current_tier 多一个 free(无订阅/订阅到期回落);free 不是可售档位,不出现在 plans 数组里
export type CurrentTier = 'free' | SubscriptionTier;
export type BillingPeriod = 'monthly' | 'yearly';

// 权益矩阵:后端**强校验的只有 topup_allowed(仅付费会员可充值)与 concurrent_jobs
// (reconciler 认领时按批次限流,超限排队而非报错)**,其余全是随 plans / me 下发供前端展示。
// ⚠️ premium_models **仅展示、后端无强制**(biz-api internal/types/types.go 与
// service/subscription/catalog.go 的注释均写明;min_tier 只在 biz-api /models 列表上标注
// locked,生成入口不校验)。这里原先写的「强校验 premium_models」是错的 —— 照它推理会
// 得出「starter 用户(premium_models=false)升级后仍用不了非 Rez1 模型」,而对话模型走
// koubou 的 GET /models,那条链上没有任何 tier 校验(2026-08-31 查证)。
export interface PlanEntitlements {
  watermark_free: boolean;
  commercial_license: string;   // none/personal/full
  premium_models: boolean;
  concurrent_jobs: number;
  queue_priority: string;       // standard/priority/highest
  topup_allowed: boolean;
}

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  monthly_price_cents: number;          // 月付价(分):卡上划线价
  yearly_price_cents: number;           // 年付整年价(分)
  yearly_monthly_price_cents: number;   // 年付折后月单价(分):卡上大号价
  credits_per_month: number;            // 每期到账积分
  intro_price_cents?: number;           // 首期优惠价(分);0=无优惠(当前后端四份配置恒 0)
  currency: string;
  entitlements: PlanEntitlements;
}

export interface SubscriptionPlansData {
  currency: string;
  current_tier: CurrentTier;
  intro_eligible: boolean;
  plans: SubscriptionPlan[];            // 付费档位升序
  // 换算单价表「类别 → 每单位耗多少积分」;**不是次数**,次数由前端除算。
  // JSON object 无序,展示顺序归前端(见 plan-display.ts 的固定顺序)。视频类单位是秒。
  usage_units: Record<string, number>;
  welcome_credits: number;
  welcome_credits_valid_days: number;   // <=0 = 永不过期
}

// subscribe 与 change 共用入参形状
export interface SubscriptionChangeRequest {
  tier: SubscriptionTier;
  billing_period: BillingPeriod;
  idempotency_key: string;
}

export interface SubscribeData {
  id: string;                           // 本地订阅 UUID,用于轮询状态
  merchant_subscription_id?: string;
  redirect_url: string;                 // 跳 Waffo 收银台授权
  status: string;                       // pending
}

export interface ChangePlanData {
  id: string;
  direction: string;                    // upgrade=立即生效 / downgrade=周期末生效
  status: string;
  effective_at?: string;                // 降档生效时间(=当前周期末)
  // 升档需重新授权时才下发(AUTHORIZATION_REQUIRED)。**Waffo 免授权直接扣差价时缺失**,
  // 调用方必须兼容:无此字段则不跳收银台,直接进订阅状态轮询。
  redirect_url?: string;
}

// 订阅状态(查单与聚合共用形状);本期只用到 status/tier,其余字段留给会员管理页
export interface SubscriptionOrder {
  id: string;
  tier: SubscriptionTier;
  status: string;                       // pending/active/past_due/paused/canceled/expired/closed
  billing_period?: BillingPeriod;
  credits_per_month?: number;
  renew_price_cents?: number;
  currency?: string;
  current_period_start?: string;
  current_period_end?: string;
  next_billing_at?: string;
  cancel_at_period_end?: boolean;
}
