import { beforeEach, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHostConfig } from './useHostConfig';
import i18n from '@/i18n';

// jsdom 下 window.location.origin 即自身 origin,用它构造合法同源消息
const SELF = window.location.origin;
const post = (data: unknown, origin = SELF) =>
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin })); });

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('lang');
});

test('合法同源消息 → 更新 data-theme 与 lang', () => {
  renderHook(() => useHostConfig());
  post({ type: 'rezonalab-config', key: 'rezonalab-config', config: { theme: 'light', lang: 'zh' } });
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.lang).toBe('zh');
});

test('只带 theme 的消息 → 仅更新 data-theme', () => {
  renderHook(() => useHostConfig());
  post({ type: 'rezonalab-config', config: { theme: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.lang).toBe(''); // lang 缺省未被改动
});

test('异源消息 → DOM 不变', () => {
  renderHook(() => useHostConfig());
  post({ type: 'rezonalab-config', config: { theme: 'light' } }, 'https://evil.com');
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test('畸形消息(type 不符) → DOM 不变', () => {
  renderHook(() => useHostConfig());
  post({ type: 'other', config: { theme: 'light' } });
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test('卸载后再发消息 → 无副作用', () => {
  const { unmount } = renderHook(() => useHostConfig());
  unmount();
  post({ type: 'rezonalab-config', config: { theme: 'light' } });
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test('收到 lang=vi 帧 → i18n 切到 vi(词典按需加载,异步完成)', async () => {
  renderHook(() => useHostConfig());
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'rezonalab-config', config: { theme: 'dark', lang: 'vi' } },
    }));
  });
  await vi.waitFor(() => expect(i18n.language).toBe('vi'));
});
