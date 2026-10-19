'use client';
import { useTranslation } from 'react-i18next';
import Select from '@/components/ui/Select';
import { changeLanguageWithLoad } from '@/i18n';
import { normalizeLocale, type Locale } from '@/i18n/config';
import { serializeHostConfigPatch } from '@/lib/host-config';

// 主站同源配置 key(与 layout.tsx 防白闪脚本、useHostConfig 一致)
const HOST_CONFIG_KEY = 'rezonalab-config';

// 语言母语名 + 触发钮短码。母语名语言无关,故为常量,不进 i18n 词典。
const LANGS: { value: Locale; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'zh', label: '简体中文', short: 'ZH' },
  { value: 'zh-TW', label: '繁體中文', short: 'TW' },
  { value: 'de', label: 'Deutsch', short: 'DE' },
  { value: 'es', label: 'Español', short: 'ES' },
  { value: 'fr', label: 'Français', short: 'FR' },
  { value: 'ko', label: '한국어', short: 'KO' },
  { value: 'pt', label: 'Português', short: 'PT' },
  { value: 'ru', label: 'Русский', short: 'RU' },
  { value: 'ja', label: '日本語', short: 'JA' },
  { value: 'vi', label: 'Tiếng Việt', short: 'VI' },
];

// 账户条语言下拉:切换即时套用本地 i18n + <html lang>,并合并回写主站同源 localStorage['rezonalab-config']。
// 受控例外:分站平时不回写该 key,仅用户主动切语言时写 lang(保留 theme 等其余字段,见 serializeHostConfigPatch)。
export default function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const current = normalizeLocale(i18n.language);

  const onChange = (value: string) => {
    const locale = normalizeLocale(value);
    void changeLanguageWithLoad(locale); // 词典按需加载后切换,本地即时重渲(react-i18next 订阅)
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(HOST_CONFIG_KEY, serializeHostConfigPatch(localStorage.getItem(HOST_CONFIG_KEY), { lang: locale }));
    } catch {
      // localStorage 不可用(隐私模式等)时静默:本地语言已切,仅未持久化到主站配置
    }
  };

  const short = LANGS.find((l) => l.value === current)?.short ?? 'EN';
  return (
    <Select
      value={current}
      options={LANGS.map((l) => ({ value: l.value, label: l.label }))}
      onChange={onChange}
      triggerLabel={short}
      variant="ghost"
      size="sm"
      direction="down"
      align="right"
      ariaLabel={t('preview.language')}
    />
  );
}
