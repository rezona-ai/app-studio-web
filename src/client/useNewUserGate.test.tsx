import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNewUserGate } from './useNewUserGate';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import { pgcApi } from '@/lib/pgc/client';
import { bizApi } from '@/lib/biz/client';
import type { SubscriptionPlansData } from '@/lib/biz/types';
import type { NewUserStatusData } from '@/lib/pgc/types';
import type { Version } from '@/store/types';
import type { KoubouClient } from '@/koubou/client';

function makeClient() {
  const setModel = vi.fn();
  const ref = { current: { setModel } } as unknown as React.RefObject<KoubouClient | null>;
  return { ref, setModel };
}
const nullClient = () => ({ current: null }) as React.RefObject<KoubouClient | null>;

const status = (isNew: boolean): NewUserStatusData => ({
  user_id: 42, is_new_user: isNew, modes: ['prompt', 'mcp'],
  self_authored_project_count: 1, scanned_project_count: 1, built_project_public_id: null,
});
const plans = (tier: 'free' | 'starter'): SubscriptionPlansData => ({
  currency: 'USD', current_tier: tier, intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
});
const version = (id: string): Version => ({
  id, index: 1, label: 'V1', summary: '', createdAt: '', current: true,
  status: 'ready', assetKeys: [], game: { title: '', palette: '' },
});

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    availableModels: ['Rez1', 'claude-opus-5'], selectedModel: 'claude-opus-5',
  } as never);
  vi.spyOn(bizApi, 'getSubscriptionPlans').mockResolvedValue(plans('free'));
});
afterEach(() => vi.restoreAllMocks());

describe('useNewUserGate', () => {
  test('挂载拉一次:新用户 + free → 归位到 Rez1', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(true));
    renderHook(() => useNewUserGate(nullClient()));
    await waitFor(() => expect(useStore.getState().selectedModel).toBe('Rez1'));
    expect(useStore.getState().newUserStatus).toBe(true);
  });

  test('非新用户:不拉套餐、不动选中模型', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(false));
    renderHook(() => useNewUserGate(nullClient()));
    await waitFor(() => expect(useStore.getState().newUserStatus).toBe(false));
    expect(bizApi.getSubscriptionPlans).not.toHaveBeenCalled();
    expect(useStore.getState().selectedModel).toBe('claude-opus-5');
  });

  test('接口失败(503 判不出来)→ 从 true 翻回 null 放行,不归位', async () => {
    useStore.setState({ newUserStatus: true } as never);   // 先有结论,才测得出「回落未知」
    vi.spyOn(pgcApi, 'getNewUserStatus').mockRejectedValue(new Error('503'));
    renderHook(() => useNewUserGate(nullClient()));
    await waitFor(() => expect(pgcApi.getNewUserStatus).toHaveBeenCalled());
    expect(useStore.getState().newUserStatus).toBeNull();
    expect(useStore.getState().selectedModel).toBe('claude-opus-5');
  });

  test('已订阅的新用户不锁', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(true));
    vi.mocked(bizApi.getSubscriptionPlans).mockResolvedValue(plans('starter'));
    renderHook(() => useNewUserGate(nullClient()));
    await waitFor(() => expect(useStore.getState().plansCache?.current_tier).toBe('starter'));
    expect(useStore.getState().selectedModel).toBe('claude-opus-5');
  });

  test('build 出新版本后重拉一次(当场解锁,不必刷新页面)', async () => {
    const spy = vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(true));
    renderHook(() => useNewUserGate(nullClient()));
    await waitFor(() => expect(useStore.getState().newUserStatus).toBe(true));
    spy.mockResolvedValue(status(false));
    act(() => { useStore.setState({ versions: [version('v1')] } as never); });
    await waitFor(() => expect(useStore.getState().newUserStatus).toBe(false));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('老用户出新版本不重拉(结论不会变,白打一次扫存储的请求)', async () => {
    const spy = vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(false));
    renderHook(() => useNewUserGate(nullClient()));
    await waitFor(() => expect(useStore.getState().newUserStatus).toBe(false));
    act(() => { useStore.setState({ versions: [version('v1')] } as never); });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('useNewUserGate:会话纠正与切项目', () => {
  test('判定晚于建连:落地后给在世会话补一条 set_model(否则 UI 归位而会话仍跑别家模型)', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(true));
    const { ref, setModel } = makeClient();
    renderHook(() => useNewUserGate(ref));
    await waitFor(() => expect(setModel).toHaveBeenCalledWith('Rez1'));
  });

  test('同一会话只纠正一次(依赖抖动不重复发命令)', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(true));
    const { ref, setModel } = makeClient();
    renderHook(() => useNewUserGate(ref));
    await waitFor(() => expect(setModel).toHaveBeenCalledTimes(1));
    act(() => { useStore.setState({ connStatus: 'open' } as never); });
    expect(setModel).toHaveBeenCalledTimes(1);
  });

  test('未锁定时不碰会话模型', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(false));
    const { ref, setModel } = makeClient();
    renderHook(() => useNewUserGate(ref));
    await waitFor(() => expect(useStore.getState().newUserStatus).toBe(false));
    expect(setModel).not.toHaveBeenCalled();
  });

  test('锁定态下 selectedModel 被别处改回(切项目取回记忆 / model.changed 回填)→ 再次归位', async () => {
    vi.spyOn(pgcApi, 'getNewUserStatus').mockResolvedValue(status(true));
    const { ref } = makeClient();
    renderHook(() => useNewUserGate(ref));
    await waitFor(() => expect(useStore.getState().selectedModel).toBe('Rez1'));
    act(() => { useStore.setState({ selectedModel: 'claude-opus-5' } as never); });
    await waitFor(() => expect(useStore.getState().selectedModel).toBe('Rez1'));
  });
});
