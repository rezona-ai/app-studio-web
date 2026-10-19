import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './index';
import { selectModelGateLocked } from './selectors';
import type { SubscriptionPlansData } from '@/lib/biz/types';

const plans = (tier: 'free' | 'starter'): SubscriptionPlansData => ({
  currency: 'USD', current_tier: tier, intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
});

describe('模型门禁的 store 侧', () => {
  beforeEach(() => {
    useStore.setState({
      newUserStatus: null, plansCache: null,
      availableModels: ['Rez1', 'claude-opus-5'], selectedModel: 'claude-opus-5',
      currentProjectId: null, modelByProject: {},
    });
  });

  it('selectModelGateLocked:新用户 + free 才锁', () => {
    expect(selectModelGateLocked(useStore.getState())).toBe(false);
    useStore.setState({ newUserStatus: true });
    expect(selectModelGateLocked(useStore.getState())).toBe(false); // plans 未到
    useStore.setState({ plansCache: plans('free') });
    expect(selectModelGateLocked(useStore.getState())).toBe(true);
    useStore.setState({ plansCache: plans('starter') });
    expect(selectModelGateLocked(useStore.getState())).toBe(false);
  });

  it('enforceModelGate:锁定时把持久化的旧选择归位到 Rez1', () => {
    useStore.setState({ newUserStatus: true, plansCache: plans('free') });
    useStore.getState().enforceModelGate();
    expect(useStore.getState().selectedModel).toBe('Rez1');
  });

  it('enforceModelGate:归位同步落当前项目的模型记忆', () => {
    useStore.setState({ newUserStatus: true, plansCache: plans('free'), currentProjectId: 7 });
    useStore.getState().enforceModelGate();
    expect(Object.values(useStore.getState().modelByProject)).toContain('Rez1');
  });

  it('enforceModelGate:未锁定时不动用户的选择', () => {
    useStore.setState({ newUserStatus: false, plansCache: plans('free') });
    useStore.getState().enforceModelGate();
    expect(useStore.getState().selectedModel).toBe('claude-opus-5');
  });

  it('setSelectedModel 在锁定态被收口:UI 之外的写入口(prelude 的 ?model=)也绕不过', () => {
    useStore.setState({ newUserStatus: true, plansCache: plans('free') });
    useStore.getState().setSelectedModel('claude-opus-5');
    expect(useStore.getState().selectedModel).toBe('Rez1');
  });

  it('切项目取回的模型记忆在锁定态让位 Rez1', () => {
    useStore.setState({
      newUserStatus: true, plansCache: plans('free'),
      modelByProject: { '9|cc': 'claude-opus-5' }, agentBackend: 'cc',
    } as never);
    useStore.getState().switchProjectSession(9);
    expect(useStore.getState().selectedModel).toBe('Rez1');
  });

  it('未锁定时切项目照常取回记忆', () => {
    useStore.setState({
      newUserStatus: false, plansCache: plans('free'),
      modelByProject: { '9|cc': 'claude-opus-5' }, agentBackend: 'cc',
    } as never);
    useStore.getState().switchProjectSession(9);
    expect(useStore.getState().selectedModel).toBe('claude-opus-5');
  });

  it('setNewUserStatus 写入 store', () => {
    useStore.getState().setNewUserStatus(true);
    expect(useStore.getState().newUserStatus).toBe(true);
    useStore.getState().setNewUserStatus(null);
    expect(useStore.getState().newUserStatus).toBeNull();
  });
});
