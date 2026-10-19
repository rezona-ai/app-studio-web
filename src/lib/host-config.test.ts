import { expect, test } from 'vitest';
import { parseHostConfig, serializeHostConfigPatch } from './host-config';

const SELF = 'https://app.rezona.ai';
// 主站消息格式:{ type:'rezonalab-config', key:'rezonalab-config', config:{ lang, theme } }
const msg = (config: unknown, type = 'rezonalab-config') => ({ type, key: 'rezonalab-config', config });

test('异源消息被拒(返回 null)', () => {
  expect(parseHostConfig(msg({ theme: 'light' }), 'https://evil.com', SELF)).toBeNull();
});

test('type 非 rezonalab-config 被拒', () => {
  expect(parseHostConfig(msg({ theme: 'light' }, 'other'), SELF, SELF)).toBeNull();
});

test('config 非对象 / 缺失被拒', () => {
  expect(parseHostConfig(msg(null), SELF, SELF)).toBeNull();
  expect(parseHostConfig({ type: 'rezonalab-config' }, SELF, SELF)).toBeNull();
});

test('data 非对象被拒', () => {
  expect(parseHostConfig('nope', SELF, SELF)).toBeNull();
  expect(parseHostConfig(null, SELF, SELF)).toBeNull();
});

test('theme=light → light', () => {
  expect(parseHostConfig(msg({ theme: 'light' }), SELF, SELF)).toEqual({ theme: 'light' });
});

test('theme=dark / 缺省 / 非法 → dark', () => {
  expect(parseHostConfig(msg({ theme: 'dark' }), SELF, SELF)).toEqual({ theme: 'dark' });
  expect(parseHostConfig(msg({}), SELF, SELF)).toEqual({ theme: 'dark' });
  expect(parseHostConfig(msg({ theme: 'wat' }), SELF, SELF)).toEqual({ theme: 'dark' });
});

test('lang 非空字符串被带上', () => {
  expect(parseHostConfig(msg({ theme: 'light', lang: 'zh' }), SELF, SELF)).toEqual({ theme: 'light', lang: 'zh' });
});

test('lang 空串 / 非字符串被丢弃', () => {
  expect(parseHostConfig(msg({ theme: 'dark', lang: '' }), SELF, SELF)).toEqual({ theme: 'dark' });
  expect(parseHostConfig(msg({ theme: 'dark', lang: 123 }), SELF, SELF)).toEqual({ theme: 'dark' });
});

test('serializeHostConfigPatch:合并写 lang 时保留既有 theme', () => {
  const out = serializeHostConfigPatch('{"theme":"light","lang":"en"}', { lang: 'zh' });
  expect(JSON.parse(out)).toEqual({ theme: 'light', lang: 'zh' });
});

test('serializeHostConfigPatch:现有为 null 时仅写入 patch', () => {
  const out = serializeHostConfigPatch(null, { lang: 'ja' });
  expect(JSON.parse(out)).toEqual({ lang: 'ja' });
});

test('serializeHostConfigPatch:非法 JSON 视作空对象,不抛错', () => {
  const out = serializeHostConfigPatch('not-json{', { lang: 'fr' });
  expect(JSON.parse(out)).toEqual({ lang: 'fr' });
});

test('serializeHostConfigPatch:保留 patch 未覆盖的其余字段', () => {
  const out = serializeHostConfigPatch('{"theme":"dark","lang":"en","extra":1}', { lang: 'vi' });
  expect(JSON.parse(out)).toEqual({ theme: 'dark', lang: 'vi', extra: 1 });
});

test('serializeHostConfigPatch:数组输入视作空对象(不产生索引键)', () => {
  const out = serializeHostConfigPatch('[1,2,3]', { lang: 'fr' });
  expect(JSON.parse(out)).toEqual({ lang: 'fr' });
});
