import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 与 chat-attachment-text.test.ts / actions.upload.test.ts 同一范式:保留真实导出(尤其 PgcError),
// 仅替换 applyStudioPrelude 依赖链(createProject → selectProject → loadCanvas/loadVersions)所需的最小 api 集合。
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      createProject: vi.fn(async (name: string) => ({ id: 1, public_id: 'p1', name })),
      listProjects: vi.fn(async () => ({ items: [{ id: 1, public_id: 'p1', name: 'x' }] })),
      listCanvasItems: vi.fn(async () => ({ items: [] })),
      listVersions: vi.fn(async () => ({ items: [] })),
    },
  };
});

import { useStore } from '@/store';

describe('applyStudioPrelude 纯文本种子内容拉取', () => {
  beforeEach(() => {
    useStore.setState({ currentProjectId: null, projects: [], composer: { draft: '', attachments: [], baseLines: 1 }, autoSendArmed: false } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('txt 种子 fetch 成功 → 附件带 text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('文件内容', { status: 200 })));
    await useStore.getState().applyStudioPrelude({
      assets: [{ url: 'https://pgc.x/f/a.txt', kind: 'text', name: 'a.txt' }],
    });
    const att = useStore.getState().composer.attachments[0];
    expect(att.text).toBe('文件内容');
    expect(useStore.getState().autoSendArmed).toBe(true);
  });

  it('fetch 失败 → 附件无 text 仍 ready(降级 URL token),照常 arm', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await useStore.getState().applyStudioPrelude({
      assets: [{ url: 'https://pgc.x/f/a.txt', kind: 'text' }],
    });
    const att = useStore.getState().composer.attachments[0];
    expect(att.text).toBeUndefined();
    expect(att.status).toBe('ready');
    expect(useStore.getState().autoSendArmed).toBe(true);
  });

  it('pdf 种子不 fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await useStore.getState().applyStudioPrelude({
      assets: [{ url: 'https://pgc.x/f/a.pdf', kind: 'text', name: 'a.pdf' }],
    });
    expect(f).not.toHaveBeenCalled();
  });
});
