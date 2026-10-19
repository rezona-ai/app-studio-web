import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/biz/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/biz/client')>()),
  bizApi: { getSubscriptionOrder: vi.fn() },
}));
// loadUserInfo 在成功分支被调用:mock 掉两个 GET,免打真实网络
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return { ...actual, pgcApi: { ...actual.pgcApi, getCurrentUser: vi.fn(), getBalance: vi.fn() } };
});

import { useStore } from './index';
import { bizApi } from '@/lib/biz/client';
import { pgcApi } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const getOrder = bizApi.getSubscriptionOrder as unknown as ReturnType<typeof vi.fn>;
const messages = { active: '订阅已生效', closed: '订单已关闭' };
const PLANS = {
  currency: 'USD', current_tier: 'starter' as const, intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
};

// 登记一单并把 startedAt 挪到 ms 毫秒之前(超时分支用;不动系统时间,免与 fake timers 纠缠)
const watchAgedBy = (ms: number) => {
  useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
  const order = useStore.getState().subscribeOrder!;
  useStore.setState({ subscribeOrder: { ...order, startedAt: order.startedAt - ms } } as never);
};

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() } as never);
  getOrder.mockReset();
  (pgcApi.getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 7, username: 'nick' });
  (pgcApi.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue({ balance: 100, held: 0, spendable: 100 });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('watchSubscribeOrder(登记在飞订阅单)', () => {
  test('初始态无在飞单;登记后 id/tier/文案就位', () => {
    expect(useStore.getState().subscribeOrder).toBeNull();
    useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
    expect(useStore.getState().subscribeOrder).toMatchObject({ id: 's1', tier: 'creator', messages });
    expect(useStore.getState().subscribeSucceeded).toBe(false);
  });
});

describe('pollSubscribeOrder(订阅单状态机)', () => {
  test('无在飞单:不打后端', async () => {
    await useStore.getState().pollSubscribeOrder();
    expect(getOrder).not.toHaveBeenCalled();
  });

  // 判据是「active 且 tier 已切到目标档」:升档改的是同一条订阅行,授权期间恒 active
  test('仍是旧档 + active:不判成功,继续等', async () => {
    useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
    getOrder.mockResolvedValue({ id: 's1', tier: 'starter', status: 'active' });
    await useStore.getState().pollSubscribeOrder();
    expect(useStore.getState().subscribeOrder).not.toBeNull();
    expect(useStore.getState().toast).toBeNull();
  });

  test('切到目标档 + active:收单、success Toast、刷账户条', async () => {
    useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
    getOrder.mockResolvedValue({ id: 's1', tier: 'creator', status: 'active' });
    await useStore.getState().pollSubscribeOrder();
    expect(useStore.getState().subscribeOrder).toBeNull();
    expect(useStore.getState().toast).toMatchObject({ code: 'SUBSCRIBED', message: messages.active, kind: 'success' });
    await vi.waitFor(() => expect(pgcApi.getCurrentUser).toHaveBeenCalled());
  });

  test('订单被关闭/过期/取消:收单并报 error Toast', async () => {
    for (const status of ['closed', 'expired', 'canceled']) {
      useStore.setState({ toast: null } as never);
      useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
      getOrder.mockResolvedValue({ id: 's1', tier: 'starter', status });
      await useStore.getState().pollSubscribeOrder();
      expect(useStore.getState().subscribeOrder).toBeNull();
      expect(useStore.getState().toast).toMatchObject({ code: 'SUBSCRIBE_CLOSED', kind: 'error' });
    }
  });

  test('超时只收单回可重试态,不判失败(到账由 webhook 保证)', async () => {
    watchAgedBy(11 * 60_000);
    getOrder.mockResolvedValue({ id: 's1', tier: 'starter', status: 'pending' });
    await useStore.getState().pollSubscribeOrder();
    expect(useStore.getState().subscribeOrder).toBeNull();
    expect(useStore.getState().toast).toBeNull();
  });

  test('单轮拉单失败:跳过本轮,单还在', async () => {
    useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
    getOrder.mockRejectedValue(new Error('net'));
    await useStore.getState().pollSubscribeOrder();
    expect(useStore.getState().subscribeOrder).not.toBeNull();
  });

  // PR#9 评审 C7:失败分支若直接 return 会绕过超时判定,持续 5xx 就永远轮询下去
  test('持续拉单失败满 10 分钟:照样收单,不无限轮询', async () => {
    watchAgedBy(11 * 60_000);
    getOrder.mockRejectedValue(new Error('net'));
    await useStore.getState().pollSubscribeOrder();
    expect(useStore.getState().subscribeOrder).toBeNull();
  });

  test('await 期间已被别的分支收单:丢弃过期响应,不误写 Toast', async () => {
    useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
    getOrder.mockImplementation(async () => {
      useStore.setState({ subscribeOrder: null } as never);   // 模拟收单发生在响应回来之前
      return { id: 's1', tier: 'creator', status: 'active' };
    });
    await useStore.getState().pollSubscribeOrder();
    expect(useStore.getState().toast).toBeNull();
  });
});

// plansCache.current_tier 决定开哪个弹窗、推荐哪一档、以及下单走 subscribe 还是 change,
// 订阅成功后必须失效;但当场清会让 CreditModalGate 见 plans==null 直接卸载弹窗、吃掉成功态停留。
describe('订阅成功后 plansCache 的失效时机', () => {
  const succeed = async () => {
    useStore.getState().watchSubscribeOrder({ id: 's1', tier: 'creator', messages });
    getOrder.mockResolvedValue({ id: 's1', tier: 'creator', status: 'active' });
    await useStore.getState().pollSubscribeOrder();
  };

  test('没有弹窗开着:当场清(没人在渲染它)', async () => {
    useStore.setState({ plansCache: PLANS } as never);
    await succeed();
    expect(useStore.getState().plansCache).toBeNull();
    expect(useStore.getState().subscribeSucceeded).toBe(false);
  });

  test('弹窗开着:先不清,只标记——否则成功态停留会被吃掉', async () => {
    useStore.setState({ plansCache: PLANS, creditModalOpen: 'insufficient' } as never);
    await succeed();
    expect(useStore.getState().plansCache).toEqual(PLANS);
    expect(useStore.getState().subscribeSucceeded).toBe(true);
  });

  test('关窗那一刻清掉并复位标记', async () => {
    useStore.setState({ plansCache: PLANS, creditModalOpen: 'insufficient' } as never);
    await succeed();
    useStore.getState().setCreditModalOpen(false);
    expect(useStore.getState().plansCache).toBeNull();
    expect(useStore.getState().subscribeSucceeded).toBe(false);
  });

  test('没订阅成功过就关窗:缓存保留(即时开窗的优化不白丢)', () => {
    useStore.setState({ plansCache: PLANS, creditModalOpen: 'insufficient' } as never);
    useStore.getState().setCreditModalOpen(false);
    expect(useStore.getState().plansCache).toEqual(PLANS);
  });

  test('充值弹窗 / all-plans 开着也算「有弹窗」,同样推迟到关窗', async () => {
    useStore.setState({ plansCache: PLANS, topupModalOpen: true } as never);
    await succeed();
    expect(useStore.getState().plansCache).toEqual(PLANS);
    expect(useStore.getState().subscribeSucceeded).toBe(true);
  });
});
