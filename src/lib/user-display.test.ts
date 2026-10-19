import { describe, expect, test } from 'vitest';
import { userInitial, formatCredit, formatCreditExact } from './user-display';

describe('userInitial', () => {
  test('display_name 优先,取首字母大写', () => {
    expect(userInitial({ id: 1, username: 'nick', display_name: 'Nick' })).toBe('N');
  });
  test('display_name 缺失回退 username', () => {
    expect(userInitial({ id: 1, username: 'alice', display_name: null })).toBe('A');
  });
  test('忽略前导空白', () => {
    expect(userInitial({ id: 1, username: 'x', display_name: '  bob' })).toBe('B');
  });
  test('display_name 仅空白时回退 username', () => {
    expect(userInitial({ id: 1, username: 'zoe', display_name: '   ' })).toBe('Z');
  });
  test('全空 / null 回退 ?', () => {
    expect(userInitial({ id: 1, username: '', display_name: '' })).toBe('?');
    expect(userInitial(null)).toBe('?');
    expect(userInitial(undefined)).toBe('?');
  });
  test('多字节字符正确取首个码位', () => {
    expect(userInitial({ id: 1, username: 'x', display_name: '小明' })).toBe('小');
  });
});

describe('formatCredit', () => {
  test('< 1000 精确显示', () => {
    expect(formatCredit(0)).toBe('0');
    expect(formatCredit(856)).toBe('856');
    expect(formatCredit(999)).toBe('999');
  });
  test('≥ 1000 紧凑缩写为 K/M/B(宽度有界,防顶到分享按钮)', () => {
    expect(formatCredit(1000)).toBe('1K');
    expect(formatCredit(1234)).toBe('1.2K');
    expect(formatCredit(12345)).toBe('12.3K');
    expect(formatCredit(999999)).toBe('1M'); // 进位:不产生 "1000K"
    expect(formatCredit(1234567)).toBe('1.2M');
    expect(formatCredit(1500000000)).toBe('1.5B');
  });
  test('null / undefined / NaN → "0"', () => {
    expect(formatCredit(null)).toBe('0');
    expect(formatCredit(undefined)).toBe('0');
    expect(formatCredit(Number.NaN)).toBe('0');
  });
});

describe('formatCreditExact', () => {
  test('带千分位的完整数字(悬停 tooltip 用)', () => {
    expect(formatCreditExact(856)).toBe('856');
    expect(formatCreditExact(1234567)).toBe('1,234,567');
  });
  test('null / undefined / NaN → "0"', () => {
    expect(formatCreditExact(null)).toBe('0');
    expect(formatCreditExact(undefined)).toBe('0');
    expect(formatCreditExact(Number.NaN)).toBe('0');
  });
});
