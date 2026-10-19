import { expect, test } from 'vitest';
import i18n, { changeLanguageWithLoad } from './index';

// 审计 E2:六语全量静态打包约多出 21KB gzip/会话;改为仅 en 静态兜底,
// 其余语言切换时动态 import + addResourceBundle。

test('初始仅静态注册 en(其余语言不进首屏 bundle)', () => {
  expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
  expect(i18n.hasResourceBundle('zh', 'translation')).toBe(false);
  expect(i18n.hasResourceBundle('ja', 'translation')).toBe(false);
});

test('changeLanguageWithLoad:动态加载词典并完成切换', async () => {
  await changeLanguageWithLoad('zh');
  expect(i18n.hasResourceBundle('zh', 'translation')).toBe(true);
  expect(i18n.t('canvas.assetKind.image')).toBe('图像');
  await changeLanguageWithLoad('en');
  expect(i18n.t('canvas.assetKind.image')).toBe('Image');
});

test('重复切换同语言:词典只注册一次,直接切换', async () => {
  await changeLanguageWithLoad('ja');
  await changeLanguageWithLoad('ja');
  expect(i18n.hasResourceBundle('ja', 'translation')).toBe(true);
  await changeLanguageWithLoad('en');
});

test('新增语言(zh-TW/de/es/ko/pt):按需加载并完成切换', async () => {
  await changeLanguageWithLoad('zh-TW');
  expect(i18n.hasResourceBundle('zh-TW', 'translation')).toBe(true);
  expect(i18n.t('canvas.assetKind.image')).toBe('圖像');
  for (const lng of ['de', 'es', 'ko', 'pt']) {
    await changeLanguageWithLoad(lng);
    expect(i18n.hasResourceBundle(lng, 'translation')).toBe(true);
    // 各语言词典均已注册且非 en 原文(抽查一个非专名 key)
    expect(i18n.t('common.loading')).not.toBe('Loading');
  }
  await changeLanguageWithLoad('en');
});

test('未知语言:不抛错,t() 由 fallback(en) 兜底', async () => {
  await expect(changeLanguageWithLoad('xx')).resolves.toBeUndefined();
  expect(i18n.t('canvas.assetKind.image')).toBe('Image');
  await changeLanguageWithLoad('en');
});
