import { render, screen, act } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import MobileBlockPage from './MobileBlockPage';
import i18n from '@/i18n';

beforeEach(() => { document.documentElement.lang = ''; void i18n.changeLanguage('en'); });

test('渲染标题与说明文案(en)', async () => {
  await act(async () => { render(<MobileBlockPage />); });
  expect(screen.getByRole('heading', { name: 'Desktop only' })).toBeInTheDocument();
  expect(screen.getByText(/not supported on mobile devices/)).toBeInTheDocument();
});

test('自带 I18nProvider:按 <html lang> 出中文', async () => {
  document.documentElement.lang = 'zh-CN';
  await act(async () => { render(<MobileBlockPage />); });
  // 非 en 词典动态加载后才切换,findBy 等待异步完成
  expect(await screen.findByRole('heading', { name: '暂不支持移动端' })).toBeInTheDocument();
});
