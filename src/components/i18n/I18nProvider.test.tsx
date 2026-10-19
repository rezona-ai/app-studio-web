import { render, screen, act } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { expect, test, beforeEach } from 'vitest';
import I18nProvider from './I18nProvider';
import i18n from '@/i18n';

function Probe() {
  const { t } = useTranslation();
  return <span>{t('common.close')}</span>;
}

// 必须 await:i18n 是模块单例,changeLanguage 是异步的(非 en 词典还要动态 import)。
// 不等它落定就进下一条,上一条的 ja 可能晚落、或本条的 en 尚未生效 —— 下面第三条又是**同步**断言,
// 于是概率性拿到「閉じる」。本仓记录过的 I18nProvider 偶发红(1 条)正是这个形状
beforeEach(async () => { document.documentElement.lang = ''; await i18n.changeLanguage('en'); });

test('挂载时按 <html lang> 同步 i18n 语言(zh-CN → 关闭)', async () => {
  document.documentElement.lang = 'zh-CN';
  await act(async () => { render(<I18nProvider><Probe /></I18nProvider>); });
  // 非 en 词典动态加载后才切换,findBy 等待异步完成
  expect(await screen.findByText('关闭')).toBeInTheDocument();
});

test('挂载时按 <html lang> 同步 i18n 语言(ja → 閉じる)', async () => {
  document.documentElement.lang = 'ja';
  await act(async () => { render(<I18nProvider><Probe /></I18nProvider>); });
  expect(await screen.findByText('閉じる')).toBeInTheDocument();
});

test('<html lang> 不支持(es)→ 回退 en(Close)', async () => {
  document.documentElement.lang = 'es';
  await act(async () => { render(<I18nProvider><Probe /></I18nProvider>); });
  // 与上面两条一致用 findBy:回退到 en 同样要过一次 languageChanged,同步断言会抢跑
  expect(await screen.findByText('Close')).toBeInTheDocument();
});
