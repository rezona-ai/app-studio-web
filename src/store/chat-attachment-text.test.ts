import { beforeEach, describe, expect, test, vi } from 'vitest';

// 与 actions.upload.test.ts 同一范式:保留真实导出(尤其 PgcError),仅替换 api 方法
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      updateCanvasReference: vi.fn(async () => ({})),
      deleteCanvasItem: vi.fn(async () => ({})),
      createTextItem: vi.fn(async () => ({ item_id: 'txt1', url: null, content: '# 标题\n内容' })),
    },
    uploadCanvasItem: vi.fn(async () => ({ item_id: 'it1', url: '/preview/a.png' })),
  };
});

import { useStore } from './index';
import { pgcApi, uploadCanvasItem } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';

describe('uploadChatAttachment 纯文本读内容', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      ...createInitialKoubouState(),
      ...createInitialServerState(),
      currentProjectId: 1,
      composer: { draft: '', attachments: [], baseLines: 1 },
    });
  });

  test('text/markdown 文件走专用 text 接口(multipart 上传端点不收文本),ready 后附件带 text 内容', async () => {
    const file = new File(['# 标题\n内容'], 'a.md', { type: 'text/markdown' });
    await useStore.getState().uploadChatAttachment(file);
    const att = useStore.getState().composer.attachments[0];
    expect(att.status).toBe('ready');
    expect(att.text).toBe('# 标题\n内容');
    expect(att.itemId).toBe('txt1');
    // 后端 upload 端点只收 图片/视频/音频/PDF/glb(text → 422),文本必须分流 createTextItem 且创建即带 chat_attachment 标记
    expect(uploadCanvasItem).not.toHaveBeenCalled();
    expect(pgcApi.createTextItem).toHaveBeenCalledWith(1, expect.objectContaining({
      content: '# 标题\n内容',
      text_format: 'markdown',
      reference: { chat_attachment: true },
    }));
  });

  test('非文本 mime 不读内容', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await useStore.getState().uploadChatAttachment(file);
    expect(useStore.getState().composer.attachments[0].text).toBeUndefined();
  });

  test('octet-stream 的 GLB 按扩展名识别为 3D，并沿用附件上传与标记链路', async () => {
    const file = new File([new Uint8Array([1])], 'hero.glb', { type: 'application/octet-stream' });

    await useStore.getState().uploadChatAttachment(file);

    expect(useStore.getState().composer.attachments[0]).toEqual(expect.objectContaining({
      name: 'hero.glb',
      mime: 'application/octet-stream',
      kind: '3d',
      status: 'ready',
      itemId: 'it1',
    }));
    expect(uploadCanvasItem).toHaveBeenCalledWith(1, file);
    expect(pgcApi.updateCanvasReference).toHaveBeenCalledWith(1, 'it1', { chat_attachment: true });
  });

  test('text/plain 的 glTF 按扩展名走 3D 上传，不误入纯文本接口', async () => {
    const file = new File(['{}'], 'scene.gltf', { type: 'text/plain' });

    await useStore.getState().uploadChatAttachment(file);

    expect(useStore.getState().composer.attachments[0]).toEqual(expect.objectContaining({
      kind: '3d',
      status: 'ready',
      itemId: 'it1',
    }));
    expect(uploadCanvasItem).toHaveBeenCalledWith(1, file);
    expect(pgcApi.createTextItem).not.toHaveBeenCalled();
  });
});
