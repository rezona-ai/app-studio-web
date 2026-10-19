'use client';
/* eslint-disable react-hooks/set-state-in-effect --
   本 hook 承载充值弹窗的标准数据获取与计时(自 TopupModal 平移,豁免理由同源):
   挂载即拉充值配置(触发时同步置载入态),券倒计时/支付轮询在计时器回调里落定。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { bizApi, BizError } from '@/lib/biz/client';
import type { CreateWaffoOrderRequest, TopupOptions } from '@/lib/biz/types';
import { isOrderPaid, isOrderClosed } from '@/lib/topup';
import type { TriggerDimension } from '@/lib/subscription/plan-display';
import { track } from '@/lib/analytics';

// 充值链路共享逻辑(TopupModal 与升购弹窗的顶档积分分支共用):
// 配置拉取(最后请求胜出)+ 券倒计时(归零重拉)+ Waffo 建单/轮询/取消/回落 + 曝光与点击埋点。
// 档位选择与自定义金额归各弹窗组件;body 由调用方构造。

// 回落主站充值页(外部路径,不经 apiPath);跳转须带 source_product/source_trigger/from_page(§0-2)
const rechargeFallbackPath = (trigger: string) =>
  `/studio/recharge?source_product=gamestudio&source_trigger=${trigger}&from_page=editor`;

const POLL_INTERVAL_MS = 3_000;
// 轮询兜底上限:超时只停轮询回到可重试态,不判定失败(到账最终由后端 webhook 保证)
const POLL_DEADLINE_MS = 10 * 60_000;

// paid 态停留时长:弹窗内展示「充值成功」后再自动播退场关闭(Meegle 13602050)
const PAID_CLOSE_DELAY_MS = 1_500;

export type TopupPhase = 'idle' | 'creating' | 'waiting' | 'paid';

export function useTopupFlow({
  trigger,
  requestClose,
  onLoaded,
}: {
  // 埋点维度由调用方按真实来源给(生成被拒 / 低余额 / 手动点积分块),不再恒 generate
  trigger: TriggerDimension;
  requestClose: () => void;
  onLoaded?: (data: TopupOptions) => void;
}) {
  const loadUserInfo = useStore((s) => s.loadUserInfo);
  const setError = useStore((s) => s.setError);
  const setSuccess = useStore((s) => s.setSuccess);
  const { t } = useTranslation();

  const [options, setOptions] = useState<TopupOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phase, setPhase] = useState<TopupPhase>('idle');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 弹窗出现即上报(弹窗条件渲染,挂载=出现);shownRef 防 dev StrictMode 双挂载重复上报
  const shownRef = useRef(false);
  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    track('out_of_credits_show', { trigger });
  }, [trigger]);

  // 拉充值配置:最后一次请求胜出(券过期重拉/手动重试可能并发)
  const reqSeq = useRef(0);
  // onLoaded 多为内联箭头,经 ref 消费保持 reload 身份稳定(避免「打开即拉取」effect 反复触发)
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => { onLoadedRef.current = onLoaded; });
  const reload = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoadFailed(false);
    try {
      const data = await bizApi.getTopupOptions();
      if (seq !== reqSeq.current) return;
      setOptions(data);
      onLoadedRef.current?.(data);
    } catch {
      if (seq !== reqSeq.current) return;
      setLoadFailed(true);
    }
  }, []);

  // 打开即拉配置 + 刷新余额(余额展示以最新为准;失败静默,loadUserInfo 内部已兜底)
  useEffect(() => { void reload(); void loadUserInfo(); }, [reload, loadUserInfo]);

  // 倒计时 1s 步进;归零重拉配置(券过期后各档 discounted_amount_cents 会变)
  const coupon = options?.coupon ?? null;
  const expiresMs = coupon ? Date.parse(coupon.expires_at) : null;
  useEffect(() => {
    if (expiresMs == null) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= expiresMs) { clearInterval(id); void reload(); }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresMs, reload]);

  // 支付轮询:paid_at 非空 → 刷余额 + success Toast 进 paid 态(弹窗展示成功后自动关闭);
  // status=failed → error Toast 回 idle;
  // 超时只停轮询(到账由 webhook 保证,余额下次刷新可见)。弹窗关闭随组件卸载自然清理。
  useEffect(() => {
    if (!orderId) return;
    const startedAt = Date.now();
    const id = setInterval(async () => {
      let order;
      try { order = await bizApi.getTopupOrder(orderId); } catch { return; }   // 单次查单失败跳过,下一轮重试
      if (isOrderPaid(order)) {
        clearInterval(id);
        setOrderId(null); setPhase('paid');
        setSuccess({ code: 'TOPUP_PAID', message: t('topup.paidToast') });
        void loadUserInfo();
      } else if (isOrderClosed(order)) {
        clearInterval(id);
        setOrderId(null); setPhase('idle');
        setError({ code: 'TOPUP_CLOSED', message: t('topup.closedToast') });
      } else if (Date.now() - startedAt > POLL_DEADLINE_MS) {
        clearInterval(id);
        setOrderId(null); setPhase('idle');
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [orderId, loadUserInfo, setError, setSuccess, t]);

  // paid 态停留后自动关闭弹窗(共享 hook 内实现,两个充值弹窗行为一致);卸载/离开 paid 态清理计时器
  useEffect(() => {
    if (phase !== 'paid') return;
    const id = setTimeout(requestClose, PAID_CLOSE_DELAY_MS);
    return () => clearTimeout(id);
  }, [phase, requestClose]);

  // 建单:body 由调用方构造(档位/自定义金额),调用方需保证此时可下单
  const recharge = useCallback(async (body: CreateWaffoOrderRequest) => {
    if (!options || phase !== 'idle') return;
    track('out_of_credits_recharge_click', { trigger });
    // Waffo 关闭:回落主站充值页(旧行为,新标签),保持功能可用
    if (!options.enabled) {
      window.open(window.location.origin + rechargeFallbackPath(trigger), '_blank');
      requestClose();
      return;
    }
    // 防弹窗拦截:在用户手势同步栈内先开占位窗,建单成功后写入收银台地址
    const cashier = window.open('', '_blank');
    setPhase('creating');
    try {
      const order = await bizApi.createWaffoOrder(body);
      if (cashier) cashier.location.href = order.redirect_url;
      else window.open(order.redirect_url, '_blank');
      setOrderId(order.id);
      setPhase('waiting');
    } catch (e) {
      cashier?.close();
      setPhase('idle');
      setError({
        code: e instanceof BizError ? e.code : 'TOPUP_CREATE_FAILED',
        message: t('topup.createFailedToast'),
      });
    }
  }, [options, phase, trigger, requestClose, setError, t]);

  // 取消支付:先回到可重试态,再尽力关单释放券;后端拒绝(已支付/在途)时以服务端文案提示
  const cancelOrder = useCallback(async () => {
    const id = orderId;
    setOrderId(null); setPhase('idle');
    if (!id) return;
    try { await bizApi.closeTopupOrder(id); }
    catch (e) {
      if (e instanceof BizError) setError({ code: e.code, message: e.message });
      else throw e;
    }
  }, [orderId, setError]);

  return { options, loadFailed, reload, coupon, expiresMs, now, phase, recharge, cancelOrder };
}
