import { describe, it, expect } from 'vitest';
import { BASE_MODEL, modelGateLocked, gatedModel } from './model-gate';

const MODELS = ['Rez1', 'claude-opus-5', 'gpt-5.6'];

describe('modelGateLocked', () => {
  it('新用户 + free + 列表含 Rez1 → 锁', () => {
    expect(modelGateLocked({ isNewUser: true, tier: 'free', models: MODELS })).toBe(true);
  });

  it('新用户但已订阅任意档 → 不锁(对已付费的人弹订阅窗没有意义)', () => {
    for (const tier of ['starter', 'creator', 'master'] as const) {
      expect(modelGateLocked({ isNewUser: true, tier, models: MODELS })).toBe(false);
    }
  });

  it('非新用户 → 不锁', () => {
    expect(modelGateLocked({ isNewUser: false, tier: 'free', models: MODELS })).toBe(false);
  });

  it('新用户状态未知(接口 503 / 未拉到) → 放行', () => {
    expect(modelGateLocked({ isNewUser: null, tier: 'free', models: MODELS })).toBe(false);
  });

  it('档位未知(plans 还没到) → 放行', () => {
    expect(modelGateLocked({ isNewUser: true, tier: null, models: MODELS })).toBe(false);
  });

  it('列表里没有 Rez1 → 放行(锁死等于把对话废掉)', () => {
    expect(modelGateLocked({ isNewUser: true, tier: 'free', models: ['claude-opus-5'] })).toBe(false);
    expect(modelGateLocked({ isNewUser: true, tier: 'free', models: [] })).toBe(false);
  });

  it('模型 ID 大小写敏感:rez1 不算 Rez1', () => {
    expect(modelGateLocked({ isNewUser: true, tier: 'free', models: ['rez1'] })).toBe(false);
  });
});

describe('gatedModel', () => {
  it('锁定时一律回落 Rez1', () => {
    expect(gatedModel('claude-opus-5', true)).toBe(BASE_MODEL);
    expect(gatedModel(null, true)).toBe(BASE_MODEL);
  });

  it('未锁定时原样返回(含 null)', () => {
    expect(gatedModel('claude-opus-5', false)).toBe('claude-opus-5');
    expect(gatedModel(null, false)).toBeNull();
  });
});
