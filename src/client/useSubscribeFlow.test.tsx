import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubscribeFlow } from './useSubscribeFlow';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import { bizApi } from '@/lib/biz/client';

vi.mock('@/lib/biz/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/biz/client')>()),
  bizApi: {
    createSubscription: vi.fn(),
    changeSubscription: vi.fn(),
    getSubscriptionOrder: vi.fn(),
  },
}));

const api = bizApi as unknown as {
  createSubscription: ReturnType<typeof vi.fn>;
  changeSubscription: ReturnType<typeof vi.fn>;
  getSubscriptionOrder: ReturnType<typeof vi.fn>;
};

// 收银台占位窗:记录 open 调用与 location 写入,验「手势栈内先开窗」与「免授权时不留空白窗」
let opened: { href: string | null; closed: boolean }[] = [];
function stubWindowOpen() {
  vi.stubGlobal('open', vi.fn(() => {
    const w = { href: null as string | null, closed: false };
    opened.push(w);
    // location 是对象:生产代码写 cashier.location.href(同 useTopupFlow)
    return {
      location: { set href(v: string) { w.href = v; }, get href() { return w.href ?? ''; } },
      close: () => { w.closed = true; },
    };
  }));
}

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackAndWait: vi.fn() }));

const requestClose = vi.fn();
const flush = () => act(async () => { await Promise.resolve(); });

// 只有 current_tier 参与本文件的断言,其余字段填够类型即可
const PLANS = {
  currency: 'USD', current_tier: 'starter', intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  opened = [];
  requestClose.mockReset();
  track.mockReset();
  api.createSubscription.mockReset();
  api.changeSubscription.mockReset();
  api.getSubscriptionOrder.mockReset();
  stubWindowOpen();
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    loadUserInfo: vi.fn(async () => {}),
    setError: vi.fn(),
    setSuccess: vi.fn(),
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (currentTier: 'free' | 'starter' | 'creator' = 'starter') =>
  renderHook(() => useSubscribeFlow({ trigger: 'insufficient', currentTier, requestClose }));

describe('useSubscribeFlow(订阅下单与轮询)', () => {
  test('free 用户走 subscribe;已付费用户走 change', async () => {
    api.createSubscription.mockResolvedValue({ id: 's1', redirect_url: 'https://waffo/x', status: 'pending' });
    const free = render('free');
    await act(async () => { await free.result.current.subscribe('starter'); });
    expect(api.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'starter', billing_period: 'yearly',
    }));
    expect(api.changeSubscription).not.toHaveBeenCalled();

    // 上一单还挂在 store 上,phase 会是 waiting 而拦掉下一次下单:清掉再验第二条分支
    act(() => { useStore.setState({ subscribeOrder: null } as never); });
    api.changeSubscription.mockResolvedValue({ id: 's2', direction: 'upgrade', status: 'active' });
    const paid = render('starter');
    await act(async () => { await paid.result.current.subscribe('creator'); });
    expect(api.changeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'creator', billing_period: 'yearly',
    }));
  });

  test('有 redirect_url:手势栈内先开的占位窗被写入收银台地址', async () => {
    api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'authorizing', redirect_url: 'https://waffo/cashier' });
    const { result } = render('starter');
    await act(async () => { await result.current.subscribe('creator'); });
    expect(opened).toHaveLength(1);
    expect(opened[0].href).toBe('https://waffo/cashier');
    expect(opened[0].closed).toBe(false);
    expect(result.current.phase).toBe('waiting');
  });

  test('无 redirect_url(Waffo 免重新授权):关掉占位窗,不留空白页,直接进轮询', async () => {
    api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
    const { result } = render('starter');
    await act(async () => { await result.current.subscribe('creator'); });
    expect(opened[0].href).toBeNull();
    expect(opened[0].closed).toBe(true);
    expect(result.current.phase).toBe('waiting');
  });

  // 轮询判据(active + tier 已切档)、订单被关闭、单轮失败重试、10 分钟超时——这些语义随轮询
  // 一起搬去了 store,覆盖在 store/subscribe-watch.test.ts;这里只留下单与 phase 派生。

  test('成功后停留一会自动关窗(成功由 store 标记驱动)', async () => {
    const { rerender } = render('starter');
    act(() => { useStore.setState({ subscribeSucceeded: true } as never); });
    rerender();
    expect(requestClose).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(requestClose).toHaveBeenCalled();
  });

  test('建单失败:关掉占位窗、回 idle、报 error Toast', async () => {
    api.changeSubscription.mockRejectedValue(new Error('boom'));
    const { result } = render('starter');
    await act(async () => { await result.current.subscribe('creator'); });
    expect(opened[0].closed).toBe(true);
    expect(result.current.phase).toBe('idle');
    expect(useStore.getState().setError).toHaveBeenCalled();
  });

  test('重复点击:非 idle 态不再建单', async () => {
    api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
    const { result } = render('starter');
    await act(async () => { await result.current.subscribe('creator'); });
    await act(async () => { await result.current.subscribe('creator'); });
    expect(api.changeSubscription).toHaveBeenCalledTimes(1);
  });

  // PR#9 评审 C6:轮询原本挂在本 hook 的 effect 上,弹窗一卸载就被 clearInterval 带走。
  // 而关窗 / Escape / 遮罩点击 / 「See all plans」跳转都不受 phase 约束 —— 用户没放弃,
  // 收银台还开着,前端却已经不再监听。现在单登记进 store,卸载与它无关。
  describe('在飞订单归 store,不随弹窗卸载', () => {
    test('waiting 期间卸载弹窗:store 里的在飞单仍在', async () => {
      api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
      const { result, unmount } = render('starter');
      await act(async () => { await result.current.subscribe('creator'); });
      expect(result.current.phase).toBe('waiting');

      unmount();
      expect(useStore.getState().subscribeOrder).toMatchObject({ id: 's1', tier: 'creator' });
    });

    test('本 hook 不再自建轮询:卸载后计时器推进也不打查单接口', async () => {
      api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
      const { result, unmount } = render('starter');
      await act(async () => { await result.current.subscribe('creator'); });
      unmount();
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(api.getSubscriptionOrder).not.toHaveBeenCalled();
    });

    test('文案在建单时就译好交给 store(成败可能发生在弹窗关掉之后)', async () => {
      api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
      const { result } = render('starter');
      await act(async () => { await result.current.subscribe('creator'); });
      const messages = useStore.getState().subscribeOrder?.messages;
      expect(messages?.active).toBeTruthy();
      expect(messages?.closed).toBeTruthy();
    });
  });

  describe('phase 由 store 派生', () => {
    test('无在飞单即 idle;登记后 waiting;标记成功后 active', async () => {
      const { result } = render('starter');
      expect(result.current.phase).toBe('idle');

      await act(async () => {
        useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages: { active: 'a', closed: 'c' } });
      });
      expect(result.current.phase).toBe('waiting');

      await act(async () => { useStore.setState({ subscribeOrder: null, subscribeSucceeded: true } as never); });
      expect(result.current.phase).toBe('active');
    });

    test('跨弹窗跳转后 phase 仍是 waiting:新弹窗的 CTA 照样禁用,堵掉重复下单', async () => {
      api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
      const first = render('starter');
      await act(async () => { await first.result.current.subscribe('creator'); });
      first.unmount();                     // 点「See all plans」:PlanBody 卸载,换 AllPlansModal

      const second = render('starter');    // 新弹窗里重新挂同一个 hook
      expect(second.result.current.phase).toBe('waiting');
    });
  });

  // 终审 I2:点击事件的 trigger 必须与曝光事件同一套字面值,否则同一漏斗关联不上
  test('subscribe_click 上报 generate / low_balance,而非内部的 insufficient / lowBalance', async () => {
    api.changeSubscription.mockResolvedValue({ id: 's1', direction: 'upgrade', status: 'active' });
    const { result } = render('starter');
    await act(async () => { await result.current.subscribe('creator'); });
    expect(track).toHaveBeenCalledWith('subscribe_click', expect.objectContaining({
      trigger: 'generate', tier: 'starter', target_tier: 'creator', billing_period: 'yearly', from: 'upsell',
    }));
    expect(track).not.toHaveBeenCalledWith('subscribe_click', expect.objectContaining({ trigger: 'insufficient' }));
  });
});
