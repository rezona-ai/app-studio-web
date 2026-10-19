import { expect, test } from 'vitest';
import { sessionSlotKey } from './session-slot';

test('cc 沿用纯项目 id —— 老快照零迁移', () => {
  expect(sessionSlotKey(7, 'cc')).toBe('7');
  expect(sessionSlotKey('7', 'cc')).toBe('7');
});

test('codex 独立槽位,不与 cc 抢同一 key', () => {
  expect(sessionSlotKey(7, 'codex')).toBe('7:codex');
  expect(sessionSlotKey(7, 'codex')).not.toBe(sessionSlotKey(7, 'cc'));
});
