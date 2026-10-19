import { expect, test } from 'vitest';
import { normalizeIsoUtc } from './timestamp';

test('无时区标记(/sessions 的 updated_at 实测形状)→ 补 Z 按 UTC 解析', () => {
  const at = normalizeIsoUtc('2026-07-31T11:16:49.796923');
  expect(at).toBe('2026-07-31T11:16:49.796923Z');
  // 与同一时刻的事件时间戳(带 Z)只差 232ms —— 若按本地时间解析会差 8 小时(UTC+8)
  expect(Date.parse('2026-07-31T11:16:50.028431Z') - Date.parse(at!)).toBe(232);
});

test('已带时区标记(Z / 偏移量)→ 原样保留', () => {
  expect(normalizeIsoUtc('2026-07-31T11:16:50.028431Z')).toBe('2026-07-31T11:16:50.028431Z');
  expect(normalizeIsoUtc('2026-07-31T19:16:50+08:00')).toBe('2026-07-31T19:16:50+08:00');
});

test('空 / 非字符串 / 无法解析 → null(调用方回落到不显示时长)', () => {
  expect(normalizeIsoUtc('')).toBeNull();
  expect(normalizeIsoUtc('   ')).toBeNull();
  expect(normalizeIsoUtc(null)).toBeNull();
  expect(normalizeIsoUtc(undefined)).toBeNull();
  expect(normalizeIsoUtc('not-a-date')).toBeNull();
});
