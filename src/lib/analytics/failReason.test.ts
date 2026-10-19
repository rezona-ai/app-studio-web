import { describe, it, expect } from 'vitest';
import { mapFailReason } from './failReason';

describe('mapFailReason', () => {
  it('积分类 → insufficient_credit', () => {
    expect(mapFailReason('CREDIT_INSUFFICIENT')).toBe('insufficient_credit');
    expect(mapFailReason('insufficient_credit')).toBe('insufficient_credit');
  });
  it('内容合规类 → content_blocked', () => {
    expect(mapFailReason('INPUT_MODERATION_REJECTED')).toBe('content_blocked');
    expect(mapFailReason('PROVIDER_CONTENT_POLICY_VIOLATION')).toBe('content_blocked');
  });
  it('超时类 → timeout', () => {
    expect(mapFailReason('TIMEOUT')).toBe('timeout');
    expect(mapFailReason('DEADLINE_EXCEEDED')).toBe('timeout');
  });
  it('缺省 / 未知 → server_error', () => {
    expect(mapFailReason(undefined)).toBe('server_error');
    expect(mapFailReason('SOMETHING_ELSE')).toBe('server_error');
  });
});
