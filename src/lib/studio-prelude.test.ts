import { expect, test } from 'vitest';
import {
  parseStudioPrelude, parseRemixSource, parseShareSource, assetSeedLabel,
  parseHandoffId, handoffStorageKey, parseHandoffPayload,
} from './studio-prelude';

// 用 URLSearchParams 构造 search,确保编码/解码闭环与生产侧一致
const search = (params: Record<string, string>) => '?' + new URLSearchParams(params).toString();
const assetsParam = (arr: unknown) => search({ assets: JSON.stringify(arr) });

test('model + prompt + assets 齐全 → 全部解析', () => {
  const s = search({
    model: 'claude-x',
    prompt: 'make a platformer',
    assets: JSON.stringify([{ url: 'https://cdn/a.png', kind: 'image', name: 'A' }]),
  });
  expect(parseStudioPrelude(s)).toEqual({
    model: 'claude-x',
    prompt: 'make a platformer',
    assets: [{ url: 'https://cdn/a.png', kind: 'image', name: 'A' }],
  });
});

test('仅 model', () => {
  expect(parseStudioPrelude(search({ model: 'claude-x' }))).toEqual({ model: 'claude-x', assets: [] });
});

test('仅 prompt', () => {
  expect(parseStudioPrelude(search({ prompt: 'hi' }))).toEqual({ prompt: 'hi', assets: [] });
});

test('仅 assets', () => {
  expect(parseStudioPrelude(assetsParam([{ url: 'https://cdn/a.mp4', kind: 'video' }]))).toEqual({
    assets: [{ url: 'https://cdn/a.mp4', kind: 'video' }],
  });
});

test('空 search / 三者皆空 → null', () => {
  expect(parseStudioPrelude('')).toBeNull();
  expect(parseStudioPrelude('?')).toBeNull();
  expect(parseStudioPrelude(search({ foo: 'bar' }))).toBeNull();
  expect(parseStudioPrelude(search({ model: '', prompt: '' }))).toBeNull();
});

test('assets 非法 JSON → 回退空数组(无 model/prompt 则整体 null)', () => {
  expect(parseStudioPrelude(search({ assets: 'not-json' }))).toBeNull();
  expect(parseStudioPrelude(search({ model: 'm', assets: 'not-json' }))).toEqual({ model: 'm', assets: [] });
});

test('assets 含非法条目 → 丢弃该条,保留合法条目', () => {
  const arr = [
    { url: 'https://cdn/ok.png', kind: 'image' }, // 合法
    { url: 'https://cdn/bad.png', kind: 'gif' },  // kind 不在枚举
    { kind: 'image' },                            // 缺 url
    { url: '', kind: 'image' },                   // 空 url
    'nope',                                        // 非对象
  ];
  expect(parseStudioPrelude(assetsParam(arr))).toEqual({
    assets: [{ url: 'https://cdn/ok.png', kind: 'image' }],
  });
});

test('assets 顶层非数组 → 空', () => {
  expect(parseStudioPrelude(search({ assets: JSON.stringify({ url: 'x', kind: 'image' }) }))).toBeNull();
});

test('assetSeedLabel:有 name 用 name', () => {
  expect(assetSeedLabel({ url: 'https://cdn/x.png', kind: 'image', name: 'Hero' })).toBe('Hero');
});

test('assetSeedLabel:单段路径 → 取文件名', () => {
  expect(assetSeedLabel({ url: 'https://cdn/hero.png', kind: 'image' })).toBe('hero.png');
});

test('assetSeedLabel:无 name → 从 url 取文件名(去 query/hash)', () => {
  expect(assetSeedLabel({ url: 'https://cdn/path/hero.png?v=1#frag', kind: 'image' })).toBe('hero.png');
});

test('assetSeedLabel:无文件名可取 → 回退整个 url', () => {
  expect(assetSeedLabel({ url: 'https://cdn', kind: 'image' })).toBe('https://cdn');
});

test('parseRemixSource:?remix=<public_id> → 返回 code', () => {
  expect(parseRemixSource(search({ remix: 'DakkYXUy' }))).toBe('DakkYXUy');
});

test('parseRemixSource:无 remix / 空串 → null', () => {
  expect(parseRemixSource('')).toBeNull();
  expect(parseRemixSource(search({ remix: '' }))).toBeNull();
  expect(parseRemixSource(search({ foo: 'bar' }))).toBeNull();
});

test('parseShareSource:?share=<public_id> → 返回 code', () => {
  expect(parseShareSource(search({ share: 'DakkYXUy' }))).toBe('DakkYXUy');
});

test('parseShareSource:无 share / 空串 → null', () => {
  expect(parseShareSource('')).toBeNull();
  expect(parseShareSource(search({ share: '' }))).toBeNull();
  expect(parseShareSource(search({ foo: 'bar' }))).toBeNull();
});

test('parseShareSource 与 parseRemixSource 共存 → 各自独立解析(优先级由 bootstrap 决定)', () => {
  const s = search({ share: 'ShAre123', remix: 'DakkYXUy' });
  expect(parseShareSource(s)).toBe('ShAre123');
  expect(parseRemixSource(s)).toBe('DakkYXUy');
});

test('parseRemixSource:与 prelude 参共存 → 各自独立解析', () => {
  const s = search({ remix: 'DakkYXUy', model: 'claude-x' });
  expect(parseRemixSource(s)).toBe('DakkYXUy');
  expect(parseStudioPrelude(s)).toEqual({ model: 'claude-x', assets: [] });
});

test('kind=document 归一为内部 text', () => {
  const assets = encodeURIComponent(JSON.stringify([
    { url: 'https://x.com/a.txt', kind: 'document', name: 'a.txt' },
    { url: 'https://x.com/b.pdf', kind: 'document' },
  ]));
  const p = parseStudioPrelude(`?assets=${assets}`);
  expect(p?.assets).toEqual([
    { url: 'https://x.com/a.txt', kind: 'text', name: 'a.txt' },
    { url: 'https://x.com/b.pdf', kind: 'text' },
  ]);
});

test('未知 kind 仍被丢弃', () => {
  const assets = encodeURIComponent(JSON.stringify([{ url: 'https://x.com/a', kind: 'file' }]));
  expect(parseStudioPrelude(`?assets=${assets}`)).toBeNull();
});

// —— handoff 线 ——

test('parseHandoffId:解析 ?handoff=,空/缺省返回 null', () => {
  expect(parseHandoffId('?handoff=273d3861-c383-40a3-8a39-9c35041d4143')).toBe('273d3861-c383-40a3-8a39-9c35041d4143');
  expect(parseHandoffId('?handoff=')).toBeNull();
  expect(parseHandoffId('?foo=bar')).toBeNull();
  expect(parseHandoffId('')).toBeNull();
});

test('handoffStorageKey:拼约定前缀', () => {
  expect(handoffStorageKey('abc')).toBe('tln.game.handoff.abc');
});

test('parseHandoffPayload:合法载荷 → StudioPrelude(document 归一为 text)', () => {
  const raw = JSON.stringify({
    v: 1, model: 'claude-opus-4-8', prompt: '很长的提示词',
    assets: [{ url: 'https://cdn/file.pdf', kind: 'document', name: 'file.pdf' }],
    createdAt: 1720870000000,
  });
  expect(parseHandoffPayload(raw)).toEqual({
    model: 'claude-opus-4-8', prompt: '很长的提示词',
    assets: [{ url: 'https://cdn/file.pdf', kind: 'text', name: 'file.pdf' }],
  });
});

test('parseHandoffPayload:仅 prompt 也成立;非法条目丢弃', () => {
  const raw = JSON.stringify({ v: 1, prompt: 'hi', assets: [{ kind: 'image' }] });
  expect(parseHandoffPayload(raw)).toEqual({ prompt: 'hi', assets: [] });
});

test('parseHandoffPayload:非法输入返回 null', () => {
  expect(parseHandoffPayload(null)).toBeNull();
  expect(parseHandoffPayload('not-json')).toBeNull();
  expect(parseHandoffPayload('"str"')).toBeNull();
  expect(parseHandoffPayload(JSON.stringify({ v: 2, prompt: 'hi' }))).toBeNull(); // 版本不符
  expect(parseHandoffPayload(JSON.stringify({ v: 1 }))).toBeNull();               // 全空
  expect(parseHandoffPayload(JSON.stringify({ v: 1, model: '', prompt: '' }))).toBeNull();
});
