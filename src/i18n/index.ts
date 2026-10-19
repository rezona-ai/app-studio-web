import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { FALLBACK } from './config';

// 单例:仅 en 静态打包(fallback 兜底,SSR 与客户端首帧一致);
// 其余语言按需动态 import(审计 E2:六语全量静态打包约多出 21KB gzip/80KB raw 每会话)。
// 初始 lng 确定性用 FALLBACK(en),真实语言由 I18nProvider / useHostConfig 挂载后经
// changeLanguageWithLoad 切换(先取词典再切,期间 UI 短暂显示 en,与既有「首帧恒 en」行为一致)。
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
    },
    lng: FALLBACK,
    fallbackLng: FALLBACK,
    interpolation: { escapeValue: false },
    returnNull: false,
    // 单命名空间(translation),从不用 ns:key 语法;关掉默认的 ':' 命名空间分隔,
    // 否则像 '16:9' 这类字面选项值经 t() 会被当成 ns=16/key=9 拆分而误显为 '9'。keySeparator 仍保留 '.'(键用点分)。
    nsSeparator: false,
  });
}

// 各语言词典的动态加载器:显式静态映射(而非模板字符串 import)让打包器为每种语言拆出确定的独立 chunk
const localeLoaders: Record<string, () => Promise<Record<string, unknown>>> = {
  zh: async () => (await import('./locales/zh')).zh,
  'zh-TW': async () => (await import('./locales/zh-TW')).zhTW,
  de: async () => (await import('./locales/de')).de,
  es: async () => (await import('./locales/es')).es,
  fr: async () => (await import('./locales/fr')).fr,
  ko: async () => (await import('./locales/ko')).ko,
  pt: async () => (await import('./locales/pt')).pt,
  ru: async () => (await import('./locales/ru')).ru,
  ja: async () => (await import('./locales/ja')).ja,
  vi: async () => (await import('./locales/vi')).vi,
};

// 切换语言前确保词典已注册:未注册且有加载器则动态 import + addResourceBundle;
// 未知语言直接切换(t() 由 fallback en 兜底)。所有语言切换入口统一走这里。
export async function changeLanguageWithLoad(lng: string): Promise<void> {
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    const load = localeLoaders[lng];
    if (load) i18n.addResourceBundle(lng, 'translation', await load());
  }
  await i18n.changeLanguage(lng);
}

export default i18n;
