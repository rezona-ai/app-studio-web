import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import LanguageMenu from './LanguageMenu';
import i18n from '@/i18n';

beforeEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); localStorage.clear(); });
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

test('触发钮显示当前语言短码(en → EN)', () => {
  render(<LanguageMenu />);
  expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('EN');
});

test('选择中文:切换 i18n 语言 + 合并写 rezonalab-config(保留 theme)', async () => {
  localStorage.setItem('rezonalab-config', JSON.stringify({ theme: 'dark', lang: 'en' }));
  render(<LanguageMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '简体中文' })); });
  // 词典动态加载后语言才落定;<html lang> 与配置回写是同步的
  await vi.waitFor(() => expect(i18n.language).toBe('zh'));
  expect(document.documentElement.lang).toBe('zh');
  expect(JSON.parse(localStorage.getItem('rezonalab-config')!)).toEqual({ theme: 'dark', lang: 'zh' });
});

test('无既有 rezonalab-config 时也能写入 lang', async () => {
  render(<LanguageMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '日本語' })); });
  expect(JSON.parse(localStorage.getItem('rezonalab-config')!)).toEqual({ lang: 'ja' });
});
