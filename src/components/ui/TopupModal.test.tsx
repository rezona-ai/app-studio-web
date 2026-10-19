import { StrictMode } from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '@/store';
import TopupModal from './TopupModal';
import type { TopupOptions } from '@/lib/biz/types';

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({
  track: (...a: unknown[]) => track(...a),
  trackAndWait: vi.fn().mockResolvedValue(undefined),
}));

// bizApi 全量 mock;BizError 需为真类(组件 instanceof 判定)
const getTopupOptions = vi.fn();
const createWaffoOrder = vi.fn();
const getTopupOrder = vi.fn();
const closeTopupOrder = vi.fn();
vi.mock('@/lib/biz/client', () => ({
  bizApi: {
    getTopupOptions: (...a: unknown[]) => getTopupOptions(...a),
    createWaffoOrder: (...a: unknown[]) => createWaffoOrder(...a),
    getTopupOrder: (...a: unknown[]) => getTopupOrder(...a),
    closeTopupOrder: (...a: unknown[]) => closeTopupOrder(...a),
  },
  BizError: class BizError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); this.name = 'BizError'; }
  },
}));

const OPTIONS: TopupOptions = {
  enabled: true,
  currency: 'USD',
  coupon: { id: 'c1', type: 'discount', pay_rate_bps: 7000, max_discount_cents: 500, currency: 'USD', expires_at: '2026-07-15T00:00:00Z' },
  packages: [
    { id: 'p5', credits: 5000, amount_cents: 500, discounted_amount_cents: 350, discount_cents: 150, currency: 'USD' },
    { id: 'p10', credits: 10000, amount_cents: 1000, discounted_amount_cents: 700, discount_cents: 300, currency: 'USD' },
  ],
};

const loadUserInfo = vi.fn().mockResolvedValue(undefined);

// 挂载后冲刷 options 拉取的微任务链
async function renderModal(ui: React.ReactElement = <TopupModal />) {
  const r = render(ui);
  await act(async () => { await Promise.resolve(); });
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
  useStore.setState({
    topupModalOpen: true,
    credit: { balance: 88, held: 0, spendable: 88 },
    toast: null,
    // 组件只调用这一个 ServerAction,直接以 mock 覆盖,避免测试触发真实 PGC 请求
    loadUserInfo,
  });
  track.mockClear();
  loadUserInfo.mockClear();
  getTopupOptions.mockReset().mockResolvedValue(OPTIONS);
  createWaffoOrder.mockReset();
  getTopupOrder.mockReset();
  closeTopupOrder.mockReset();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TopupModal 渲染', () => {
  test('余额 / 档位 / 默认选中首档 / 结算条取后端报价', async () => {
    await renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();               // 余额卡
    // 首档默认选中:credits/券后价同时出现在卡片与结算条(各 2 处)
    expect(screen.getAllByText('5,000 credits')).toHaveLength(2);
    expect(screen.getByText('10,000 credits')).toBeInTheDocument();
    const cards = screen.getAllByRole('button', { pressed: true });
    expect(cards).toHaveLength(1);                                     // 默认仅首档选中
    expect(screen.getAllByText('$3.50')).toHaveLength(2);             // 卡片券后价 = 结算条来源
    expect(screen.getByText('Save $1.50')).toBeInTheDocument();       // SAVE 徽标
  });

  // 后端契约(pgc docs/api/credits.md:35「展示用 spendable,勿本地推导」)。
  // 充值场景下用户要判断的是「还能花多少」,不是「账面挂了多少」;四处口径必须一致,
  // 否则在两个弹窗之间看到两个数字更糟
  test('余额卡取 spendable 而非 balance(held 不为零时两者不同)', async () => {
    useStore.setState({ credit: { balance: 1000, held: 400, spendable: 600 } });
    await renderModal();
    expect(screen.getByText('600')).toBeInTheDocument();
    expect(screen.queryByText('1,000')).toBeNull();
  });

  // 值换成 spendable 后标签必须跟着换:印着「Current Balance 600」而账面确实有 1000,
  // 是把本轮要消灭的那个矛盾换了个位置,不是消灭它
  test('余额卡的标签是「可用」而非「余额」(与所显示的 spendable 同义)', async () => {
    await renderModal();
    expect(screen.getByText('Available Credits')).toBeInTheDocument();
    expect(screen.queryByText('Current Balance')).toBeNull();
  });

  test('券横幅:折扣文案由 bps/封顶派生,倒计时按 expires_at 渲染', async () => {
    await renderModal();
    expect(screen.getByText('30% discount (up to $5 discount)')).toBeInTheDocument();
    expect(screen.getByText('48:00:00')).toBeInTheDocument();         // 2026-07-13 → 07-15 共 48h
  });

  test('无券不渲染横幅;无折扣档位不渲染划线价与徽标', async () => {
    getTopupOptions.mockResolvedValue({
      enabled: true, currency: 'USD', coupon: null,
      packages: [{ id: 'p5', credits: 5000, amount_cents: 500, discounted_amount_cents: 500, discount_cents: 0, currency: 'USD' }],
    });
    await renderModal();
    expect(screen.queryByText(/discount/)).toBeNull();
    expect(screen.queryByText(/Save/)).toBeNull();
  });

  test('挂载即上报 out_of_credits_show,trigger 随打开来源;StrictMode 双挂载只报一次', async () => {
    await renderModal(
      <StrictMode>
        <TopupModal />
      </StrictMode>,
    );
    const calls = track.mock.calls.filter((c) => c[0] === 'out_of_credits_show');
    expect(calls).toEqual([['out_of_credits_show', { trigger: 'generate' }]]);
  });

  test('配置拉取失败显示重试,重试成功后渲染档位', async () => {
    getTopupOptions.mockRejectedValueOnce(new Error('boom'));
    await renderModal();
    expect(screen.getByText('Failed to load recharge options')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByText('5,000 credits').length).toBeGreaterThan(0);
  });
});

describe('TopupModal 选档与自定义', () => {
  test('切换档位联动结算条;Customize 输入整数美元并按档位比率估算积分', async () => {
    await renderModal();
    fireEvent.click(screen.getByText('10,000 credits'));
    expect(screen.getAllByText('$7.00')).toHaveLength(2);             // p10 券后价:卡片 + 结算条

    fireEvent.click(screen.getByText('Customize'));
    const input = screen.getByLabelText('Custom amount (USD)');
    fireEvent.change(input, { target: { value: '7' } });
    expect(screen.getAllByText('$7.00').length).toBeGreaterThan(0);   // 结算条原价,无券后报价
    expect(screen.getByText('≈ 7,000 credits')).toBeInTheDocument();  // 5000/$5 → 1000/$
  });

  test('自定义金额最低 $5:低于下限禁用 CTA 并提示,达到下限恢复', async () => {
    await renderModal();
    fireEvent.click(screen.getByText('Customize'));
    const input = screen.getByLabelText('Custom amount (USD)');

    fireEvent.change(input, { target: { value: '3' } });
    expect(screen.getByText('Recharge Now')).toBeDisabled();
    expect(screen.getByText('Minimum $5')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '5' } });
    expect(screen.getByText('Recharge Now')).toBeEnabled();
    expect(screen.queryByText('Minimum $5')).toBeNull();
    expect(screen.getAllByText('$5.00').length).toBeGreaterThan(0);
  });
});

describe('TopupModal 支付流', () => {
  test('enabled:false 回落主站充值页(带来源参数)并关闭', async () => {
    getTopupOptions.mockResolvedValue({ ...OPTIONS, enabled: false });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderModal();
    fireEvent.click(screen.getByText('Recharge Now'));
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}/studio/recharge?source_product=gamestudio&source_trigger=generate&from_page=editor`,
      '_blank',
    );
    expect(track).toHaveBeenCalledWith('out_of_credits_recharge_click', { trigger: 'generate' });
    act(() => vi.advanceTimersByTime(250));                            // useRequestClose 退场 200ms
    expect(useStore.getState().topupModalOpen).toBe(false);
  });

  test('建单 → 占位窗写入收银台 → 轮询 paid → 刷余额 + success Toast + 成功态自动关闭', async () => {
    const cashier = { location: { href: '' }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(cashier);
    createWaffoOrder.mockResolvedValue({ id: 'o1', redirect_url: 'https://waffo.example/pay', status: 'pending' });
    getTopupOrder.mockResolvedValue({ id: 'o1', status: 'pending', paid_at: null });

    await renderModal();
    fireEvent.click(screen.getByText('Recharge Now'));
    expect(open).toHaveBeenCalledWith('', '_blank');                   // 手势同步栈内预开,防拦截
    await act(async () => { await Promise.resolve(); });
    expect(createWaffoOrder).toHaveBeenCalledWith(expect.objectContaining({ package_id: 'p5' }));
    expect((cashier as Window).location.href).toBe('https://waffo.example/pay');
    expect(screen.getByText('Cancel payment')).toBeInTheDocument();    // waiting 态

    getTopupOrder.mockResolvedValue({ id: 'o1', status: 'paid', paid_at: '2026-07-13T00:01:00Z' });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(loadUserInfo).toHaveBeenCalled();
    expect(useStore.getState().toast).toMatchObject({ kind: 'success' });
    expect(screen.getByText('Recharge successful')).toBeInTheDocument(); // paid 态 CTA
    expect(useStore.getState().topupModalOpen).toBe(true);               // 停留期内仍打开
    // 1.5s 停留 + 200ms 退场后自动关闭
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(useStore.getState().topupModalOpen).toBe(false);
  });

  test('建单失败:关占位窗 + error Toast 回 idle', async () => {
    const cashier = { location: { href: '' }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(cashier);
    createWaffoOrder.mockRejectedValue(new Error('boom'));
    await renderModal();
    fireEvent.click(screen.getByText('Recharge Now'));
    await act(async () => { await Promise.resolve(); });
    expect((cashier as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    expect(useStore.getState().toast).toMatchObject({ kind: 'error' });
    expect(screen.getByText('Recharge Now')).toBeInTheDocument();
  });

  // 设计稿 6180:109915 的橙底大按钮是白字;深字那条令牌留给橙底小徽章,别顺手改回去
  test('Recharge Now 是橙底白字(不是徽章那套深字)', async () => {
    await renderModal();
    const cta = screen.getByText('Recharge Now');
    expect(cta.className).toContain('--color-on-primary-strong');
    expect(cta.className).not.toContain('var(--color-on-primary)');
  });

  test('waiting 态取消:停止轮询并尽力关单', async () => {
    const cashier = { location: { href: '' }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(cashier);
    createWaffoOrder.mockResolvedValue({ id: 'o1', redirect_url: 'https://waffo.example/pay', status: 'pending' });
    closeTopupOrder.mockResolvedValue({ id: 'o1', status: 'failed' });
    await renderModal();
    fireEvent.click(screen.getByText('Recharge Now'));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByText('Cancel payment'));
    await act(async () => { await Promise.resolve(); });
    expect(closeTopupOrder).toHaveBeenCalledWith('o1');
    expect(screen.getByText('Recharge Now')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
    expect(getTopupOrder).not.toHaveBeenCalled();                      // 轮询已随取消停止
  });
});
