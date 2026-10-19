import { expect, test } from 'vitest';
import { formatDuration } from './duration';

test('<60s 显示纯秒', () => {
  expect(formatDuration(0)).toBe('0s');
  expect(formatDuration(42)).toBe('42s');
  expect(formatDuration(59)).toBe('59s');
});

test('>=60s 整分省略秒', () => {
  expect(formatDuration(60)).toBe('1m');
  expect(formatDuration(120)).toBe('2m');
});

test('>=60s 含余秒显示「Xm Ys」', () => {
  expect(formatDuration(61)).toBe('1m 1s');
  expect(formatDuration(310)).toBe('5m 10s');
});

test('负数 / 小数向下钳制取整', () => {
  expect(formatDuration(-5)).toBe('0s');
  expect(formatDuration(42.9)).toBe('42s');
});
