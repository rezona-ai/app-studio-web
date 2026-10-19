import { describe, expect, test } from 'vitest';
import { normalizeLocale, SUPPORTED, FALLBACK } from './config';

describe('normalizeLocale', () => {
  test('精确支持的语言原样返回', () => {
    for (const l of SUPPORTED) expect(normalizeLocale(l)).toBe(l);
  });
  test('带 region / 下划线 / 大小写 → 取主子标签', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('VI')).toBe('vi');
    expect(normalizeLocale('fr-FR')).toBe('fr');
    expect(normalizeLocale('ru_RU')).toBe('ru');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('pt-BR')).toBe('pt');
    expect(normalizeLocale('de-AT')).toBe('de');
    expect(normalizeLocale('es-MX')).toBe('es');
    expect(normalizeLocale('ko-KR')).toBe('ko');
  });
  test('繁体中文:全标签精确匹配 + 别名归并,不折叠成简体', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('zh_TW')).toBe('zh-TW');
    expect(normalizeLocale('ZH-tw')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('zh-MO')).toBe('zh-TW');
  });
  test('不支持 / 空 / undefined / null → 回退 en', () => {
    expect(normalizeLocale('xx')).toBe(FALLBACK);
    expect(normalizeLocale(undefined)).toBe(FALLBACK);
    expect(normalizeLocale(null)).toBe(FALLBACK);
    expect(normalizeLocale('  ')).toBe(FALLBACK);
  });
});
