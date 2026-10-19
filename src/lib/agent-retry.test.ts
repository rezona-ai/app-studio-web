import { describe, expect, test } from 'vitest';
import { MAX_AGENT_RETRIES, isRetryableAgentError, retryDelayMs } from './agent-retry';

describe('isRetryableAgentError', () => {
  // 白名单口径(2026-08-25 决策修正):只有确证该重试的才自动重试,其余一律落报错 + 手动重试。
  // 取白名单而非黑名单,是因为后端 error 的取值空间前端管不住 —— 后端新增一种业务错误
  // (quota exceeded / model unavailable…),黑名单会在前端加码之前把它白烧 10 次;白名单只是
  // 不自动重试,用户仍有手动入口,失效方向安全得多。
  test('后端说可重试(retryable:true)→ 重试', () => {
    expect(isRetryableAgentError('upstream_unavailable', true)).toBe(true);
    expect(isRetryableAgentError(undefined, true)).toBe(true);
  });

  test('后端说不可重试 → 不重试,retryable 永远压过白名单', () => {
    expect(isRetryableAgentError('upstream_auth_failed', false)).toBe(false);
    expect(isRetryableAgentError('RUN_ABANDONED', false)).toBe(false);
  });

  test('孤儿 run 是白名单里唯一的前端判定项(属主 Pod 没了,纯基础设施故障)', () => {
    expect(isRetryableAgentError('RUN_ABANDONED')).toBe(true);
  });

  test('Claude 执行异常不自动重试(异常类名千奇百怪,可能是 agent 代码硬 bug)', () => {
    expect(isRetryableAgentError('AGENT_RUN_ERROR')).toBe(false);
  });

  test('业务错误与未知错误一律不自动重试', () => {
    for (const code of [
      'INVALID_USER_MESSAGE', 'RUN_ALREADY_ACTIVE', 'INVALID_PERMISSION_MODE',
      'INVALID_MODEL', 'STALE_TOOL_APPROVAL', 'STALE_QUESTION_ANSWER', 'BUILD_FAILED',
      'upstream_auth_failed', 'upstream_error', 'budget_exceeded', 'output_limit',
      'SEND_TIMEOUT', 'SOME_FUTURE_BACKEND_CODE',
    ]) {
      expect(isRetryableAgentError(code), code).toBe(false);
    }
  });

  test('无 code 且后端没表态 → 不重试(未知即不试)', () => {
    expect(isRetryableAgentError(undefined)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  test('与传输层 scheduleReconnect 同一套退避,8s 封顶', () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });
});

test('重试上限 10 次', () => {
  expect(MAX_AGENT_RETRIES).toBe(10);
});
