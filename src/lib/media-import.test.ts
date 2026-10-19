import { describe, expect, it, test } from 'vitest';
import { basename, mediaKindToAssetKind, kindToImportType, mimeToAssetKind, eventAssets, isPlainTextName } from './media-import';
import type { ServerEvent } from '@/koubou/protocol';

describe('basename', () => {
  test('纯文件名原样', () => expect(basename('hero.png')).toBe('hero.png'));
  test('带目录取末段', () => expect(basename('assets/hero.png')).toBe('hero.png'));
  test('多级目录', () => expect(basename('/a/b/c.mp4')).toBe('c.mp4'));
});

describe('kind 映射', () => {
  test('media.kind→AssetKind:model3d/3d→3d,未知→image', () => {
    expect(mediaKindToAssetKind('model3d')).toBe('3d');
    expect(mediaKindToAssetKind('3d')).toBe('3d');
    expect(mediaKindToAssetKind('image')).toBe('image');
    expect(mediaKindToAssetKind('???')).toBe('image');
  });
  test('AssetKind→import type:3d→model3d,text→text', () => {
    expect(kindToImportType('3d')).toBe('model3d');
    expect(kindToImportType('image')).toBe('image');
    expect(kindToImportType('text')).toBe('text');
  });
});

describe('mimeToAssetKind', () => {
  test('mimeToAssetKind 按 MIME 主类型映射,PDF 特判 text,未知回退 image', () => {
    expect(mimeToAssetKind('image/png')).toBe('image');
    expect(mimeToAssetKind('video/mp4')).toBe('video');
    expect(mimeToAssetKind('audio/mpeg')).toBe('audio');
    expect(mimeToAssetKind('application/pdf')).toBe('text');
    expect(mimeToAssetKind('application/zip')).toBe('image');
  });
});

const userToolResult = (content: string, isError = false): ServerEvent => ({
  type: 'claude.message', project_id: '2', session_id: 's1',
  payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: isError, content }] } },
} as unknown as ServerEvent);

describe('eventAssets', () => {
  test('ready 图片 media → media 项(basename + 完整 path + kind + previewUrl),跳过 video/3d', () => {
    const e = userToolResult(JSON.stringify({ type: 'media.tasks.status', items: [
      { task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/hero.png', preview_url: 'https://x/p.png' },
      { task_id: 'g2', kind: 'video', status: 'ready', asset_path: 'assets/clip.mp4', preview_url: null },
    ] }));
    // taskId 透传:导入时据此回溯该次生成的源卡(血缘归因)
    expect(eventAssets(e)).toEqual({ media: [{ filename: 'hero.png', path: 'assets/hero.png', kind: 'image', previewUrl: 'https://x/p.png', taskId: 'g1' }], tasks: [] });
  });

  test('ready 文档 media(kind=text/doc)→ media 项,不被当作 video/3d 跳过', () => {
    const e = userToolResult(JSON.stringify({ type: 'media.tasks.status', items: [
      { task_id: 'g1', kind: 'text', status: 'ready', asset_path: 'docs/design.md', preview_url: '/preview/design.md' },
      { task_id: 'g2', kind: 'doc', status: 'ready', asset_path: 'docs/notes.txt', preview_url: null },
    ] }));
    expect(eventAssets(e)).toEqual({ media: [
      { filename: 'design.md', path: 'docs/design.md', kind: 'text', previewUrl: '/preview/design.md', taskId: 'g1' },
      { filename: 'notes.txt', path: 'docs/notes.txt', kind: 'text', previewUrl: null, taskId: 'g2' },
    ], tasks: [] });
  });

  test('video task_submitted → tasks 项', () => {
    const e = userToolResult(JSON.stringify({ type: 'media.task_submitted', task_id: 'gt1', kind: 'video' }));
    expect(eventAssets(e)).toEqual({ media: [], tasks: [{ taskId: 'gt1', kind: 'video' }] });
  });

  test('is_error 结果跳过', () => {
    const e = userToolResult(JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/x.png', preview_url: null }] }), true);
    expect(eventAssets(e)).toEqual({ media: [], tasks: [] });
  });

  test('非 claude.message / 非 UserMessage → 空', () => {
    expect(eventAssets({ type: 'session.ready', project_id: '2', session_id: 's1', payload: {} } as ServerEvent)).toEqual({ media: [], tasks: [] });
    expect(eventAssets({ type: 'claude.message', project_id: '2', session_id: 's1', payload: { sdk_type: 'AssistantMessage', payload: { content: [] } } } as unknown as ServerEvent)).toEqual({ media: [], tasks: [] });
  });
});

describe('isPlainTextName', () => {
  test('txt/md/markdown 扩展判定为纯文本(大小写不敏感)', () => {
    expect(isPlainTextName('notes.txt')).toBe(true);
    expect(isPlainTextName('README.MD')).toBe(true);
    expect(isPlainTextName('a.markdown')).toBe(true);
  });
  test('pdf/其他扩展/无扩展不是纯文本', () => {
    expect(isPlainTextName('spec.pdf')).toBe(false);
    expect(isPlainTextName('a.png')).toBe(false);
    expect(isPlainTextName('noext')).toBe(false);
  });
  test('URL 剥离 query/hash 后按路径末段判定', () => {
    expect(isPlainTextName('https://x.com/f/design.md?sig=abc#top')).toBe(true);
    expect(isPlainTextName('https://x.com/f/movie.mp4?ext=.md')).toBe(false);
  });
});

// —— Codex backend:media 结果在 codex.message / item/completed 的 mcpToolCall item.result ——
describe('eventAssets(codex)', () => {
  const cxItem = (item: Record<string, unknown>): ServerEvent =>
    ({ type: 'codex.message', project_id: '2', session_id: 's1', sequence: 10, payload: { method: 'item/completed', payload: { threadId: 't', turnId: 'u', item } } }) as unknown as ServerEvent;

  const readyStatus = {
    type: 'media.tasks.status',
    items: [
      { task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'current/src/assets/slime.png', preview_url: 'https://x/slime.png' },
      { task_id: 'g2', kind: 'image', status: 'pending', asset_path: 'current/src/assets/later.png' },
    ],
  };

  it('structuredContent 优先:就绪图片进 media', () => {
    const { media, tasks } = eventAssets(cxItem({
      id: 'm1', type: 'mcpToolCall', server: 'media', tool: 'check_generation_tasks', status: 'completed',
      result: { structuredContent: readyStatus },
    }));
    expect(media).toEqual([{ filename: 'slime.png', path: 'current/src/assets/slime.png', kind: 'image', previewUrl: 'https://x/slime.png', taskId: 'g1' }]);
    expect(tasks).toEqual([]);
  });

  it('兼容路径:从 result.content[].text 解析同一 JSON', () => {
    const { media } = eventAssets(cxItem({
      id: 'm2', type: 'mcpToolCall', status: 'completed',
      result: { content: [{ type: 'text', text: JSON.stringify(readyStatus) }] },
    }));
    expect(media).toHaveLength(1);
  });

  it('提交回执:video / 3D 登记异步任务(不从 media 导)', () => {
    const { media, tasks } = eventAssets(cxItem({
      id: 'm3', type: 'mcpToolCall', status: 'completed',
      result: { structuredContent: { type: 'media.task_submitted', kind: 'video', task_id: 'gtask-9' } },
    }));
    expect(media).toEqual([]);
    expect(tasks).toEqual([{ taskId: 'gtask-9', kind: 'video' }]);
  });

  it('工具失败(item.error)不导入', () => {
    const { media } = eventAssets(cxItem({
      id: 'm4', type: 'mcpToolCall', status: 'failed', error: 'boom',
      result: { structuredContent: readyStatus },
    }));
    expect(media).toEqual([]);
  });

  it('瞬时 method / 非工具结果 / 缺 item 一律无产出', () => {
    expect(eventAssets({ type: 'codex.message', project_id: '2', session_id: 's1', payload: { method: 'item/agentMessage/delta', payload: { itemId: 'a', delta: 'x' } } } as unknown as ServerEvent).media).toEqual([]);
    expect(eventAssets(cxItem({ id: 'm5', type: 'agentMessage', text: '好了' })).media).toEqual([]);
    expect(eventAssets({ type: 'codex.message', project_id: '2', session_id: 's1', payload: { method: 'item/completed', payload: {} } } as unknown as ServerEvent).media).toEqual([]);
  });
});
