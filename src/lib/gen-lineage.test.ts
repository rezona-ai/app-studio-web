import { describe, expect, test } from 'vitest';
import { sourceUrlsFromInput, matchAssetsByUrl, lineageForTask } from './gen-lineage';
import type { Asset, Message } from '@/store/types';

// 最小画布资产:只有 id/key/preview.src 参与归因
const asset = (id: string, src: string): Asset => ({
  id, key: id, label: id, kind: 'image', source: 'generated', status: 'ready',
  position: { x: 0, y: 0 }, preview: { src },
});

const ASSETS = [
  asset('img-hero', 'https://pgc.local/preview/7/42/current/src/assets/hero.png'),
  asset('img-tree', 'https://pgc.local/preview/7/42/current/src/assets/tree.png'),
];

// agent 提交生成的 tool part:input 是工具入参,result 是 media.task_submitted 回执原文
const toolPart = (input: unknown, taskId: string | null, name = 'mcp__media__submit_image_generation') => ({
  type: 'tool' as const,
  id: `toolu_${taskId ?? 'x'}`,
  name,
  input,
  status: 'ready' as const,
  ...(taskId ? { result: JSON.stringify({ type: 'media.task_submitted', kind: 'image', task_id: taskId }) } : {}),
});

const msg = (parts: Message['parts']): Message => ({ id: 'm1', role: 'assistant', status: 'ready', parts });

describe('sourceUrlsFromInput', () => {
  test('图生图 source_urls 保序取出', () => {
    expect(sourceUrlsFromInput({ prompt: 'x', source_urls: ['https://a/1.png', 'https://a/2.png'] }))
      .toEqual(['https://a/1.png', 'https://a/2.png']);
  });

  test('图生 3D / 视频首帧的 source_url', () => {
    expect(sourceUrlsFromInput({ source_url: 'https://a/hero.png' })).toEqual(['https://a/hero.png']);
  });

  test('视频尾帧 last_frame_url 与参考图/参考视频列表', () => {
    expect(sourceUrlsFromInput({
      source_url: 'https://a/first.png',
      last_frame_url: 'https://a/last.png',
      ref_image_urls: ['https://a/r1.png'],
      ref_video_urls: ['https://a/r2.mp4'],
    })).toEqual(['https://a/first.png', 'https://a/last.png', 'https://a/r1.png', 'https://a/r2.mp4']);
  });

  test('重复 url 去重保序', () => {
    expect(sourceUrlsFromInput({ source_url: 'https://a/1.png', ref_image_urls: ['https://a/1.png', 'https://a/2.png'] }))
      .toEqual(['https://a/1.png', 'https://a/2.png']);
  });

  // 反模式:不臆测后端字段。只认工具契约里确实存在的源字段名
  test('未知字段不取(prompt / image_url / style_image_url 等一概不认)', () => {
    expect(sourceUrlsFromInput({ prompt: 'https://a/x.png', image_url: 'https://a/y.png' })).toEqual([]);
  });

  test('非字符串项跳过;非对象 input → 空', () => {
    expect(sourceUrlsFromInput({ source_urls: [1, null, 'https://a/ok.png'] })).toEqual(['https://a/ok.png']);
    expect(sourceUrlsFromInput(undefined)).toEqual([]);
    expect(sourceUrlsFromInput('文本')).toEqual([]);
  });
});

describe('matchAssetsByUrl', () => {
  test('全等命中 preview.src', () => {
    expect(matchAssetsByUrl(['https://pgc.local/preview/7/42/current/src/assets/hero.png'], ASSETS))
      .toEqual(['img-hero']);
  });

  test('多个 url 按给定顺序命中,重复只取一次', () => {
    expect(matchAssetsByUrl([
      'https://pgc.local/preview/7/42/current/src/assets/tree.png',
      'https://pgc.local/preview/7/42/current/src/assets/hero.png',
      'https://pgc.local/preview/7/42/current/src/assets/tree.png',
    ], ASSETS)).toEqual(['img-tree', 'img-hero']);
  });

  // agent 可能给带 query 的直链;路径相同即同一资产
  test('带 query/hash 的 url 仍命中同一资产', () => {
    expect(matchAssetsByUrl(['https://pgc.local/preview/7/42/current/src/assets/hero.png?v=2'], ASSETS))
      .toEqual(['img-hero']);
  });

  test('全等不中时按 basename 唯一命中兜底', () => {
    expect(matchAssetsByUrl(['https://othercdn/assets/hero.png'], ASSETS)).toEqual(['img-hero']);
  });

  test('basename 撞名(两张同名卡)= 歧义,不连', () => {
    const dup = [...ASSETS, asset('img-hero2', 'https://pgc.local/preview/9/9/current/src/assets/hero.png')];
    expect(matchAssetsByUrl(['https://othercdn/assets/hero.png'], dup)).toEqual([]);
  });

  test('一个都不中 → 空', () => {
    expect(matchAssetsByUrl(['https://othercdn/assets/nothing.png'], ASSETS)).toEqual([]);
    expect(matchAssetsByUrl([], ASSETS)).toEqual([]);
  });
});

describe('lineageForTask', () => {
  test('单源 → sourceItemId,无 refItemIds', () => {
    const messages = [msg([toolPart({ source_url: ASSETS[0].preview!.src }, 'gtask-1')])];
    expect(lineageForTask(messages, 'gtask-1', ASSETS)).toEqual({ sourceItemId: 'img-hero' });
  });

  test('多源 → 首个作 sourceItemId(决定落位),其余进 refItemIds', () => {
    const messages = [msg([toolPart({ source_urls: [ASSETS[1].preview!.src, ASSETS[0].preview!.src] }, 'gtask-2')])];
    expect(lineageForTask(messages, 'gtask-2', ASSETS)).toEqual({ sourceItemId: 'img-tree', refItemIds: ['img-hero'] });
  });

  test('taskId 对不上任何 tool part → 空(不猜)', () => {
    const messages = [msg([toolPart({ source_url: ASSETS[0].preview!.src }, 'gtask-1')])];
    expect(lineageForTask(messages, 'gtask-other', ASSETS)).toEqual({});
  });

  test('纯文生图(有 input 无源字段)→ 空,不连线', () => {
    const messages = [msg([toolPart({ prompt: '森林背景' }, 'gtask-3')])];
    expect(lineageForTask(messages, 'gtask-3', ASSETS)).toEqual({});
  });

  test('源 url 一个都 match 不到(外部 url / 卡已删)→ 空', () => {
    const messages = [msg([toolPart({ source_url: 'https://external/x.png' }, 'gtask-4')])];
    expect(lineageForTask(messages, 'gtask-4', ASSETS)).toEqual({});
  });

  test('result 非 JSON / 非提交回执 / 缺失 → 跳过不崩', () => {
    const messages = [
      msg([{ type: 'tool', id: 't1', name: 'Bash', input: { command: 'ls' }, status: 'ready', result: '不是 JSON' }]),
      msg([toolPart({ source_url: ASSETS[0].preview!.src }, null)]),
      msg([{ type: 'text', text: '普通文本' }]),
    ];
    expect(lineageForTask(messages, 'gtask-1', ASSETS)).toEqual({});
  });

  test('多轮消息里按 taskId 精确定位(不误取邻近的另一次生成)', () => {
    const messages = [
      msg([toolPart({ source_url: ASSETS[0].preview!.src }, 'gtask-a')]),
      msg([toolPart({ source_url: ASSETS[1].preview!.src }, 'gtask-b')]),
    ];
    expect(lineageForTask(messages, 'gtask-b', ASSETS)).toEqual({ sourceItemId: 'img-tree' });
  });
});
