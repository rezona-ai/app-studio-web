import { describe, expect, test } from 'vitest';
import { isCreditError } from './credit-error';

describe('isCreditError', () => {
  test('code 含 CREDIT/INSUFFICIENT(任意大小写)命中', () => {
    expect(isCreditError({ code: 'CREDIT_INSUFFICIENT' })).toBe(true);
    expect(isCreditError({ code: 'insufficient_credits' })).toBe(true);
    expect(isCreditError({ code: 'NoCredit' })).toBe(true);
  });
  test('failure.code 命中也算', () => {
    expect(isCreditError({ code: 'GEN_FAILED', failure: { code: 'credit_insufficient' } })).toBe(true);
  });
  test('普通错误码不命中', () => {
    expect(isCreditError({ code: 'INTERNAL' })).toBe(false);
    expect(isCreditError({ code: 'INPUT_MODERATION_REJECTED', failure: { code: 'content_policy' } })).toBe(false);
    expect(isCreditError({ code: 'FORBIDDEN', failure: null })).toBe(false);
  });
});
