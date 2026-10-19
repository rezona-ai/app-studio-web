import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '@/store';
import { selectModelSwitchHint } from './selectors';
import { createInitialKoubouState } from './types';
import { BASE_MODEL } from '@/lib/subscription/model-gate';

// 红色报错气泡里的「换模型」提示 + Switch model 按钮(设计稿 2026-09-03,方案二)。
// reducer 只记 agentError.retryable === false 这个事实,值不值得提示换模型在这里判:
// 门禁锁定 / 只剩一个模型时无可换,提示与按钮都不出现。
const FATAL = { text: 'sanitized', code: 'upstream_error', detail: 'x', retryable: false as const };

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(),
    agentError: FATAL,
    availableModels: ['rez1', 'claude-x'],
    selectedModel: 'rez1',
    newUserStatus: false,
    modelMenuRequest: 0,
  });
});

test('retryable:false + ≥2 模型 + 未门禁 → 提示换模型', () => {
  expect(selectModelSwitchHint(useStore.getState())).toBe(true);
});

describe('否定分支', () => {
  test('报错不是模型侧不可重试(字段缺失)→ 不提示', () => {
    useStore.setState({ agentError: { text: 'boom', code: 'AGENT_RUN_ERROR' } });
    expect(selectModelSwitchHint(useStore.getState())).toBe(false);
  });
  test('只有一个可用模型 → 不提示', () => {
    useStore.setState({ availableModels: ['rez1'] });
    expect(selectModelSwitchHint(useStore.getState())).toBe(false);
  });
  // codex 活跃 run 期下拉禁用;error 事件不关轮,这个窗口真实存在 —— 此时给按钮等于给一个点了没反应的按钮
  test('codex 活跃 run 期(下拉被锁)→ 不提示', () => {
    useStore.setState({ backend: 'codex', runStatus: 'running' });
    expect(selectModelSwitchHint(useStore.getState())).toBe(false);
    useStore.setState({ runStatus: 'error' });
    expect(selectModelSwitchHint(useStore.getState())).toBe(true);
  });
  test('新用户门禁锁定(只放 Rez1)→ 不提示', () => {
    useStore.setState({
      availableModels: [BASE_MODEL, 'claude-x'], selectedModel: BASE_MODEL,
      newUserStatus: true, plansCache: { current_tier: 'free' } as never,
    });
    expect(selectModelSwitchHint(useStore.getState())).toBe(false);
  });
});

// 按钮不自己开菜单:它只能碰 store,菜单归 Composer 里的 ModelSelector。用递增计数而非布尔 ——
// 布尔在「用户手动关了菜单再点一次按钮」时值不变,effect 不会重跑
describe('requestModelMenu', () => {
  test('每次调用计数 +1', () => {
    useStore.getState().requestModelMenu();
    useStore.getState().requestModelMenu();
    expect(useStore.getState().modelMenuRequest).toBe(2);
  });
});
