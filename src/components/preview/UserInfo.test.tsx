import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import UserInfo from './UserInfo';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import type { SubscriptionPlansData } from '@/lib/biz/types';

const plansCache = {
  currency: 'USD', current_tier: 'free', intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
} as unknown as SubscriptionPlansData;

// 语言由 vitest.setup.ts 的全局 changeLanguage('en') 兜底,本文件不改语言,无须重复设置。
// credit 起点置 null(未就绪),各用例按需自设 —— 口径用例要 held≠0,入口用例只关心 loading 态
beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    userInfo: null, credit: null,
  } as never);
});
afterEach(() => cleanup());

// 后端契约(pgc docs/api/credits.md:35「展示用 spendable,勿本地推导」):
// balance 是账面总额,held 是在飞异步生成已预留的部分,能花的只有 spendable。
// 显示 balance 会在有任务在飞时给出用户花不出去的数字 —— 与 402 拦截当面打架。
// 本仓原先显示 balance,迁入时按该契约改齐(TopupModal 的余额卡本就取 spendable)。
test('账户条显示 spendable 而非 balance(held 不为零时两者不同)', () => {
  useStore.setState({ credit: { balance: 1000, held: 400, spendable: 600 } } as never);
  render(<UserInfo />);
  const btn = screen.getByRole('button', { name: /credit|top ?up/i });
  expect(btn).toHaveTextContent('600');
  // 断言紧凑记法的形式:formatCredit(1000) 是 '1K' —— 按钮文本里永远不会出现千分位的
  // '1,000'(那只在 title 属性),拿它做否定断言等于什么都没断
  expect(btn).not.toHaveTextContent('1K');
});

test('悬停完整值(title)同样取 spendable', () => {
  useStore.setState({ credit: { balance: 1000, held: 400, spendable: 600 } } as never);
  render(<UserInfo />);
  expect(screen.getByRole('button', { name: /credit|top ?up/i })).toHaveAttribute('title', '600');
});

test('credit 未就绪:回退 0(不崩)', () => {
  render(<UserInfo />);
  expect(screen.getByRole('button', { name: /credit|top ?up/i })).toHaveTextContent('0');
});

// 积分块是手动入口(2026-08-12 回归):点击只置来源,开哪个弹窗由 CreditModalGate 按档位定
describe('UserInfo(积分块 = 手动入口)', () => {
  const creditBtn = () => screen.getByRole('button', { name: /credit/i });

  test('点击置手动来源(弹窗种类不在这里决定)', () => {
    render(<UserInfo />);
    creditBtn().click();
    expect(useStore.getState().creditModalOpen).toBe('manual');
  });

  test('首次点击(无套餐缓存)进 loading 并禁用,防重复点', () => {
    useStore.setState({ creditModalOpen: 'manual', plansCache: null } as never);
    render(<UserInfo />);
    const btn = creditBtn() as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.loading).toBe('true');
  });

  test('缓存命中时不进 loading(第二次点击瞬开)', () => {
    useStore.setState({ creditModalOpen: 'manual', plansCache } as never);
    render(<UserInfo />);
    const btn = creditBtn() as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.loading).toBeUndefined();
  });

  test('被动触发开着弹窗时不进 loading(那不是本入口发起的)', () => {
    useStore.setState({ creditModalOpen: 'insufficient', plansCache: null } as never);
    render(<UserInfo />);
    expect((creditBtn() as HTMLButtonElement).disabled).toBe(false);
  });

  test('余额紧凑显示,完整值挂 title', () => {
    useStore.setState({ credit: { balance: 1234, held: 0, spendable: 1234 } } as never);
    render(<UserInfo />);
    expect(creditBtn().getAttribute('title')).toBe('1,234');
  });
});
