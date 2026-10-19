// i18n 支持的语言、回退与归一。纯函数,无副作用。
export const SUPPORTED = ['en', 'zh', 'zh-TW', 'de', 'es', 'fr', 'ko', 'pt', 'ru', 'ja', 'vi'] as const;
export type Locale = (typeof SUPPORTED)[number];
export const FALLBACK: Locale = 'en';

// 支持列表的小写索引:全标签精确匹配用(zh-tw → zh-TW)
const BY_LOWER = new Map<string, Locale>(SUPPORTED.map((l) => [l.toLowerCase(), l]));

// 繁体中文常见别名归并:script 子标签与港澳地区码都指向 zh-TW 词典
const TRADITIONAL_ALIASES = new Set(['zh-hant', 'zh-hk', 'zh-mo']);

// 归一主站下发的任意 lang 值:小写、_→- 后先全标签精确匹配(zh-TW 不可折叠成 zh),
// 再归并繁体别名,否则取主子标签(zh-CN → zh、pt-BR → pt),未命中回退 en。
// 入参不可信(主站可能下发任意串 / 空 / undefined),恒返回合法 Locale。
export function normalizeLocale(input?: string | null): Locale {
  if (!input) return FALLBACK;
  const tag = input.trim().toLowerCase().replace(/_/g, '-');
  const exact = BY_LOWER.get(tag);
  if (exact) return exact;
  if (TRADITIONAL_ALIASES.has(tag)) return 'zh-TW';
  const primary = tag.split('-')[0];
  return BY_LOWER.get(primary) ?? FALLBACK;
}
