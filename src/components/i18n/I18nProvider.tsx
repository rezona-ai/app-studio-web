'use client';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { changeLanguageWithLoad } from '@/i18n';
import { normalizeLocale } from '@/i18n/config';

// 挂载时把 i18n(SSR 初始为 en)对齐到内联脚本已设好的 <html lang>(主站下发的真实语言)。
// 运行期变更由 useHostConfig 负责(见该文件)。语言变化经 react-i18next 自动重渲订阅组件。
// 非 en 词典按需动态加载(changeLanguageWithLoad),加载间隙沿用 en 兜底,与「首帧恒 en」一致。
export default function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const target = normalizeLocale(document.documentElement.lang);
    if (i18n.language !== target) void changeLanguageWithLoad(target);
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
