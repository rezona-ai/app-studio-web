import { expect, test } from 'vitest';
import {
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  PREVIEW_WIDTH_MIN,
  SEPARATOR_W,
  clampChatWidth,
  fitChatWidth,
  minPageWidth,
} from './sidebar-fit';

test('视口宽裕时 Chat 原样返回期望宽', () => {
  expect(fitChatWidth(CHAT_WIDTH_DEFAULT, 1440)).toBe(CHAT_WIDTH_DEFAULT);
});

test('视口收窄时压 Chat,给预览列留足硬底', () => {
  // 视口 800:Chat 让出到 800−1−330=469,预览恰为硬底
  expect(fitChatWidth(518, 800)).toBe(800 - SEPARATOR_W - PREVIEW_WIDTH_MIN);
});

test('极窄视口下 Chat 停在下限(交由页面横向滚动兜底)', () => {
  expect(fitChatWidth(518, 600)).toBe(CHAT_WIDTH_MIN);
  expect(fitChatWidth(518, 320)).toBe(CHAT_WIDTH_MIN);
});

test('期望 Chat 宽超出自身区间时先夹到 [MIN, MAX]', () => {
  expect(clampChatWidth(10_000)).toBe(CHAT_WIDTH_MAX);
  expect(clampChatWidth(0)).toBe(CHAT_WIDTH_MIN);
  expect(fitChatWidth(10_000, 2560)).toBe(CHAT_WIDTH_MAX);
});

test('对话栏收起:期望 Chat 宽原样保留待展开,极窄视口也不压', () => {
  expect(fitChatWidth(518, 800, true)).toBe(518);
  expect(fitChatWidth(518, 400, true)).toBe(518);
});

test('页面最小宽 = Chat 下限 + 分隔条 + 预览硬底;收起态只剩预览硬底', () => {
  expect(minPageWidth()).toBe(CHAT_WIDTH_MIN + SEPARATOR_W + PREVIEW_WIDTH_MIN);
  expect(minPageWidth(true)).toBe(PREVIEW_WIDTH_MIN);
});

test('宽度落在页面最小宽时两栏刚好铺满,不重叠', () => {
  const w = minPageWidth();
  expect(fitChatWidth(518, w) + SEPARATOR_W + PREVIEW_WIDTH_MIN).toBe(w);
});
