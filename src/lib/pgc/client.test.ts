import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PgcError, pgcApi, uploadCanvasItem, downloadVersion, importProjectArchive } from './client';

function mockJson(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body), blob: () => Promise.resolve(new Blob()) } as unknown as Response;
}

// XHR 模拟:用于 uploadCanvasItem 和 importProjectArchive 单测
class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  method = '';
  url = '';
  aborted = false;
  body: unknown = null;
  constructor() { FakeXHR.instances.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  send(body: unknown) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  emitProgress(loaded: number, total: number) { this.upload.onprogress?.({ lengthComputable: true, loaded, total }); }
  respond(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
  fail() { this.onerror?.(); }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.restoreAllMocks());

describe('pgcApi 信封拆解', () => {
  test('成功返回 data', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 0, page: 1, page_size: 100 } }),
    );
    const d = await pgcApi.listProjects();
    expect(d.total).toBe(0);
  });

  test('GET 列表拼对 URL', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 0 } }));
    await pgcApi.listCanvasItems(42);
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/items', expect.objectContaining({ method: 'GET' }));
  });

  test('POST 带 JSON body', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, name: 'a', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' } }));
    await pgcApi.createProject('像素地牢');
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: '像素地牢' }),
    }));
  });

  // 批量坐标回写:collection 级 PATCH(无 item_id 路径段),body 为 { items: [...] }
  test('批量更新打 collection 级 PATCH', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { updated: 1, failed: [] } }));
    const items = [{ item_id: 'img-1', canvas_x: 10, canvas_y: 20 }];
    const d = await pgcApi.batchUpdateCanvasItems(42, items);
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/items', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ items }),
    }));
    expect(d).toEqual({ updated: 1, failed: [] });
  });

  // 分组框四个端点(spec 2026-08-05-canvas-groups)
  describe('分组框端点', () => {
    const grp = {
      group_id: 'grp-1', name: '主角', canvas_x: 80, canvas_y: 40, width: 520, height: 380,
      color: '#FF8800', collapsed: false, created_at: '', updated_at: '',
    };

    test('列表打 GET /canvas/groups', async () => {
      const f = fetch as ReturnType<typeof vi.fn>;
      f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { groups: [grp], total: 1 } }));
      const d = await pgcApi.listCanvasGroups(42);
      expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/groups', expect.objectContaining({ method: 'GET' }));
      expect(d.total).toBe(1);
    });

    test('建框打 POST,body 原样透传', async () => {
      const f = fetch as ReturnType<typeof vi.fn>;
      f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: grp }));
      const body = { name: '主角', canvas_x: 80, canvas_y: 40, width: 520, height: 380, color: '#FF8800' };
      const d = await pgcApi.createCanvasGroup(42, body);
      expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/groups', expect.objectContaining({
        method: 'POST', body: JSON.stringify(body),
      }));
      expect(d.group_id).toBe('grp-1');
    });

    test('改框打 PATCH /canvas/groups/{gid}', async () => {
      const f = fetch as ReturnType<typeof vi.fn>;
      f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: grp }));
      await pgcApi.updateCanvasGroup(42, 'grp-1', { name: '改名了' });
      expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/groups/grp-1', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ name: '改名了' }),
      }));
    });

    test('删框打 DELETE /canvas/groups/{gid},回被删的框', async () => {
      const f = fetch as ReturnType<typeof vi.fn>;
      f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: grp }));
      const d = await pgcApi.deleteCanvasGroup(42, 'grp-1');
      expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/groups/grp-1', expect.objectContaining({ method: 'DELETE' }));
      expect(d.group_id).toBe('grp-1');
    });

    // flag 关时四个端点都是 503;走既有信封拆解归一成 PgcError,不需要特判,写一条钉住
    test('flag 关的 503 归一成 PgcError(code=CANVAS_GROUPS_DISABLED)', async () => {
      const f = fetch as ReturnType<typeof vi.fn>;
      f.mockResolvedValue(mockJson(
        { success: false, code: 'CANVAS_GROUPS_DISABLED', message: 'disabled', data: null }, false, 503,
      ));
      await expect(pgcApi.listCanvasGroups(42)).rejects.toMatchObject({ code: 'CANVAS_GROUPS_DISABLED', status: 503 });
    });
  });

  // 生成前估价:扁平请求体(真机确认)。signal 实参必须真的接到 fetch ——
  // 成功标准 3(连改只采用最后一次)全靠它;不断言的话把实参删掉全套测试仍绿
  test('估价打 POST /generate/estimate,body 扁平且 signal 实参接到 fetch', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: {
      type: 'image', credits: 8, credits_min: null, credits_max: null,
      currency: 'credit', model_id: 'gpt-image-2', billable: true,
    } }));
    const body = { type: 'image' as const, prompt: 'x', n: 2, model: 'gpt-image-2' };
    // 侦听 AbortSignal.any:pgc() 用它把调用方 signal 与超时 signal 合并(沿用本文件既有惯例)
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const ctrl = new AbortController();
    const d = await pgcApi.estimateGenerate(42, body, ctrl.signal);
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/items/generate/estimate', expect.objectContaining({
      method: 'POST', body: JSON.stringify(body),
    }));
    // 调用方 signal 确实进了合并(删掉 estimateGenerate 的 signal 实参这条就红)
    expect(anySpy).toHaveBeenCalledWith(expect.arrayContaining([ctrl.signal]));
    expect(d.credits).toBe(8);
  });

  test('success=false 抛 PgcError 带 code', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'ARTGEN_DISABLED', message: '未配 key', data: null }, false, 503),
    );
    await expect(pgcApi.genImage(42, { prompt: 'x' })).rejects.toMatchObject({ code: 'ARTGEN_DISABLED', status: 503 });
  });

  test('内容审核 422:信封顶层 failure 被透传进 PgcError.failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({
        success: false,
        code: 'INPUT_MODERATION_REJECTED',
        message: '提示词疑似违规',
        data: null,
        failure: { code: 'INPUT_MODERATION_REJECTED', category: 'content_policy', message: '提示词疑似违规', retryable: true, provider_code: 'moderation:blocklist' },
      }, false, 422),
    );
    await expect(pgcApi.genVideo(42, { prompt: 'x' })).rejects.toMatchObject({
      code: 'INPUT_MODERATION_REJECTED',
      status: 422,
      failure: { category: 'content_policy', retryable: true },
    });
  });

  test('无 failure 字段的普通错误:PgcError.failure 为 null', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'FORBIDDEN', message: '非属主', data: null }, true, 200),
    );
    await pgcApi.getProject(1).catch((e: PgcError) => {
      expect(e.failure).toBeNull();
    });
  });

  test('错误信封的 request_id 透传进 PgcError.requestId(供联系支持时定位)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'REZONA_UNAVAILABLE', message: '上游不可达', data: null, request_id: 'req-abc-123' }, false, 503),
    );
    await expect(pgcApi.getProject(1)).rejects.toMatchObject({ code: 'REZONA_UNAVAILABLE', requestId: 'req-abc-123' });
  });

  test('信封无 request_id 时 PgcError.requestId 为 null', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'FORBIDDEN', message: '非属主', data: null }, false, 403),
    );
    await expect(pgcApi.getProject(1)).rejects.toMatchObject({ code: 'FORBIDDEN', requestId: null });
  });

  test('HTTP 200 但 success=false 也抛 PgcError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'FORBIDDEN', message: '非属主', data: null }, true, 200),
    );
    await expect(pgcApi.getProject(1)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 200 });
  });

  test('非 JSON / HTTP 错误抛 PgcError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      { ok: false, status: 500, json: () => Promise.reject(new Error('not json')) } as unknown as Response,
    );
    await expect(pgcApi.listProjects()).rejects.toBeInstanceOf(PgcError);
  });

  test('fetch 网络失败归一为可处理的 NETWORK PgcError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(pgcApi.listProjects()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  test('成功但 data 为 null 时返回 null(交由调用方处理,不抛 NULL_DATA)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: true, code: 'OK', message: 'OK', data: null }),
    );
    await expect(pgcApi.getProject(1)).resolves.toBeNull();
  });

  test('writeCanvasItemFromUrl POST 命中 import 端点并带 body', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, item_id: 'imp-1', type: 'image', status: 'ready', url: '/p/h.png', canvas_x: 100, canvas_y: 110 } }));
    const d = await pgcApi.writeCanvasItemFromUrl(42, { source_url: 'https://pgc.example/preview/42/hero.png', type: 'image', canvas_x: 100, canvas_y: 110, reference: { source_filename: 'hero.png' } });
    expect(d.item_id).toBe('imp-1');
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/items/import', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source_url: 'https://pgc.example/preview/42/hero.png', type: 'image', canvas_x: 100, canvas_y: 110, reference: { source_filename: 'hero.png' } }),
    }));
  });

  test('createRemix POST /api/remixes 带 source_code,返回 data.project', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({
      success: true, code: 'OK', message: 'OK',
      data: {
        project: { id: 9, public_id: 'NEWcode', name: 'X remix', cover_url: null, cover_source: null, current_version_id: 'v1', status: 'draft', created_at: '', updated_at: '' },
        source_code: 'DakkYXUy', source_version_id: 'v5', target_version_id: 'v1',
        play_url: 'https://x/play/NEWcode', working_preview_url: 'https://x/pv/NEWcode/v1/dist/index.html',
      },
    }));
    const d = await pgcApi.createRemix({ source_code: 'DakkYXUy' });
    expect(d.project.public_id).toBe('NEWcode');
    expect(f).toHaveBeenCalledWith('/api/pgc/api/remixes', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source_code: 'DakkYXUy' }),
    }));
  });

  test('createRemix 源未开放时抛 PgcError(REMIX_NOT_AVAILABLE)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'REMIX_NOT_AVAILABLE', message: '未开放', data: null }, true, 200),
    );
    await expect(pgcApi.createRemix({ source_code: 'x' })).rejects.toMatchObject({ code: 'REMIX_NOT_AVAILABLE' });
  });
});

describe('当前用户 / 余额', () => {
  test('getCurrentUser GET /api/auth/me 解出 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 7, username: 'nick', display_name: 'Nick', email: 'n@x.ai', group: 'default', role: 1, status: 1 }, request_id: 'r1' }));
    const u = await pgcApi.getCurrentUser();
    expect(u.id).toBe(7);
    expect(u.display_name).toBe('Nick');
    expect(f).toHaveBeenCalledWith('/api/pgc/api/auth/me', expect.objectContaining({ method: 'GET' }));
  });

  test('getBalance GET /api/credits/balance 解出 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { balance: 120, held: 20, spendable: 100 } }));
    const b = await pgcApi.getBalance();
    expect(b.balance).toBe(120);
    expect(b.spendable).toBe(100);
    expect(f).toHaveBeenCalledWith('/api/pgc/api/credits/balance', expect.objectContaining({ method: 'GET' }));
  });
});

describe('3D 绑骨与重纹理接口', () => {
  test('precheck/generate/poll 均通过 BFF 命中精确路径与请求体', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { riggable: true, cached: false } }));
    await pgcApi.precheckRig3d(42, { source_item_id: 'm3d-source' });
    expect(f).toHaveBeenLastCalledWith('/api/pgc/api/projects/42/canvas/items/rig3d/precheck', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ source_item_id: 'm3d-source' }),
    }));

    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { task_id: 'rig-task', status: 'queued', item: null } }));
    await pgcApi.genRig3d(42, { source_item_id: 'm3d-source', animations: ['preset:idle'] });
    expect(f).toHaveBeenLastCalledWith('/api/pgc/api/projects/42/canvas/items/generate/rig3d', expect.objectContaining({ method: 'POST' }));
    await pgcApi.pollRig3d(42, 'rig-task');
    expect(f).toHaveBeenLastCalledWith('/api/pgc/api/projects/42/canvas/items/generate/rig3d/rig-task', expect.objectContaining({ method: 'GET' }));

    await pgcApi.genRetexture(42, { source_item_id: 'm3d-source', text_prompt: 'bronze' });
    expect(f).toHaveBeenLastCalledWith('/api/pgc/api/projects/42/canvas/items/generate/retexture', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ source_item_id: 'm3d-source', text_prompt: 'bronze' }),
    }));
    await pgcApi.pollRetexture(42, 'tex-task');
    expect(f).toHaveBeenLastCalledWith('/api/pgc/api/projects/42/canvas/items/generate/retexture/tex-task', expect.objectContaining({ method: 'GET' }));
  });
});

describe('downloadVersion', () => {
  test('download 成功返回 Blob', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({}, true, 200));
    const b = await downloadVersion(42, 'v1');
    expect(b).toBeInstanceOf(Blob);
    expect(f.mock.calls[0][0]).toBe('/api/pgc/api/projects/42/versions/v1/download');
  });

  test('download 失败抛 PgcError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      { ok: false, status: 404, json: () => Promise.resolve({ success: false, code: 'VERSION_NOT_FOUND', message: 'x', data: null }) } as unknown as Response,
    );
    await expect(downloadVersion(42, 'v1')).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND', status: 404 });
  });

  test('download 失败也走统一信封解析:request_id 不丢', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      { ok: false, status: 500, json: () => Promise.resolve({ success: false, code: 'INTERNAL', message: 'x', data: null, request_id: 'req-dl' }) } as unknown as Response,
    );
    await expect(downloadVersion(42, 'v1')).rejects.toMatchObject({ code: 'INTERNAL', requestId: 'req-dl' });
  });
});

// —— XHR 上传:注入 FakeXHR 观测进度 / 解包 / 失败 / 中止 ——
describe('uploadCanvasItem(XHR)', () => {
  beforeEach(() => { FakeXHR.instances = []; vi.stubGlobal('XMLHttpRequest', FakeXHR); });

  test('POST 到 upload 端点,带 withCredentials,回报进度,解出 data', async () => {
    const onProgress = vi.fn();
    const file = new File(['x'], 'a.png');
    const p = uploadCanvasItem(42, file, onProgress);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/pgc/api/projects/42/canvas/items/upload');
    expect(xhr.withCredentials).toBe(true);
    // 送出的是含文件的 FormData(multipart),而非裸 File —— 防止误改字段名/漏 append
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get('file')).toBe(file);
    xhr.emitProgress(50, 100);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.respond(200, { success: true, code: 'OK', message: 'OK', data: { item_id: 'up-1', type: 'image', status: 'ready', url: null } });
    await expect(p).resolves.toMatchObject({ item_id: 'up-1' });
  });

  test('失败信封 → 抛 PgcError(带 code/status)', async () => {
    const p = uploadCanvasItem(42, new File(['x'], 'a.png'));
    FakeXHR.instances[0].respond(413, { success: false, code: 'TOO_LARGE', message: '太大', data: null });
    await expect(p).rejects.toMatchObject({ code: 'TOO_LARGE', status: 413 });
  });

  test('signal abort → xhr.abort() 且抛 ABORTED', async () => {
    const ctrl = new AbortController();
    const p = uploadCanvasItem(42, new File(['x'], 'a.png'), undefined, ctrl.signal);
    const xhr = FakeXHR.instances[0];
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });

  test('xhr.onerror(网络错误) → 抛 PgcError(NETWORK)', async () => {
    const p = uploadCanvasItem(42, new File(['x'], 'a.png'));
    FakeXHR.instances[0].fail();
    await expect(p).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('文本卡接口', () => {
  test('createTextItem POST /canvas/items/text 带 content/name/坐标', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(
      mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, item_id: 't1', type: 'text', status: 'ready', content: 'hi', text_format: 'markdown' } }),
    );
    const item = await pgcApi.createTextItem(3, { content: 'hi', name: 'Text', canvas_x: 10, canvas_y: 20 });
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/api/projects/3/canvas/items/text');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ content: 'hi', name: 'Text', canvas_x: 10, canvas_y: 20 });
    expect(item.content).toBe('hi');
  });

  test('updateTextContent PATCH item 只带 content', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(
      mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, item_id: 't1', type: 'text', status: 'ready', content: '新' } }),
    );
    await pgcApi.updateTextContent(3, 't1', '新');
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/api/projects/3/canvas/items/t1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ content: '新' });
  });
});

describe('listLibraryAssets', () => {
  test('拼装 query 并解包信封', async () => {
    const items = [{ id: 1, key: 'k1', type: 'image', media_kind: 'image', url: 'https://x/1.png' }];
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(
      { success: true, code: 'OK', message: '', data: { items, total: 1 }, request_id: 'r' },
    )));
    const data = await pgcApi.listLibraryAssets({ type: 'image', q: 'cat', offset: 40 });
    expect(spy).toHaveBeenCalledWith(
      '/api/pgc/api/library/assets?type=image&q=cat&sort=curated&limit=40&offset=40',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(data.total).toBe(1);
    expect(data.items[0].key).toBe('k1');
    spy.mockRestore();
  });

  test('缺省参数:不带 type/q,sort=curated,limit=40,offset=0', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(
      { success: true, code: 'OK', message: '', data: { items: [], total: 0 }, request_id: 'r' },
    )));
    await pgcApi.listLibraryAssets();
    expect(spy).toHaveBeenCalledWith(
      '/api/pgc/api/library/assets?sort=curated&limit=40&offset=0',
      expect.anything(),
    );
    spy.mockRestore();
  });
});

describe('importProjectArchive(XHR 压缩包导入)', () => {
  beforeEach(() => { FakeXHR.instances = []; vi.stubGlobal('XMLHttpRequest', FakeXHR); });
  const okEnvelope = {
    success: true, code: 'OK', message: 'OK',
    data: {
      id: 7, public_id: 'pubx', name: 'My Game', cover_url: null, cover_source: null,
      current_version_id: 'v1', status: 'draft', created_at: '', updated_at: '',
      version_id: 'v1', version_status: 'ready', play_url: '/play/x', preview_url: '/pv/x',
      file_count: 12, assets: [],
    },
  };

  test('POST multipart 到 /api/projects/import,带进度回调,解出 data', async () => {
    const onProgress = vi.fn();
    const file = new File(['zipbytes'], 'game.zip');
    const p = importProjectArchive(file, 'My Game', onProgress);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/pgc/api/projects/import');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get('file')).toBe(file);
    expect((xhr.body as FormData).get('name')).toBe('My Game');
    xhr.emitProgress(30, 100);
    expect(onProgress).toHaveBeenCalledWith(0.3);
    xhr.respond(200, okEnvelope);
    await expect(p).resolves.toMatchObject({ id: 7, public_id: 'pubx' });
  });

  test('422 错误信封 → PgcError 带后端 code/status', async () => {
    const p = importProjectArchive(new File(['x'], 'game.rar'), 'g');
    FakeXHR.instances[0].respond(422, { success: false, code: 'ARCHIVE_UNSUPPORTED_FORMAT', message: '不支持的格式', data: null });
    await expect(p).rejects.toMatchObject({ code: 'ARCHIVE_UNSUPPORTED_FORMAT', status: 422 });
  });

  test('signal abort → xhr.abort() 且抛 ABORTED', async () => {
    const ctrl = new AbortController();
    const p = importProjectArchive(new File(['x'], 'game.zip'), 'g', undefined, ctrl.signal);
    const xhr = FakeXHR.instances[0];
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });

  test('网络错误 → PgcError(NETWORK)', async () => {
    const p = importProjectArchive(new File(['x'], 'game.zip'), 'g');
    FakeXHR.instances[0].fail();
    await expect(p).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('listProjects 全量分页', () => {
  // 后端 /api/projects 是分页端点;侧栏/项目选择都需要用户全量项目,>page_size 时必须续拉
  const page = (items: number[], total: number, p = 1, size = 100) =>
    mockJson({ success: true, code: 'OK', message: 'OK', data: { items: items.map((id) => ({ id, public_id: `p${id}`, name: `n${id}` })), total, page: p, page_size: size } });

  test('total 未超单页时只请求一次', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(page([1, 2], 2));
    const d = await pgcApi.listProjects();
    expect(d.items.map((p) => p.id)).toEqual([1, 2]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/api/pgc/api/projects?page=1&page_size=100');
  });

  test('total 超单页时续拉剩余页并按序合并', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(page([1, 2], 5, 1, 2))
      .mockResolvedValueOnce(page([3, 4], 5, 2, 2))
      .mockResolvedValueOnce(page([5], 5, 3, 2));
    const d = await pgcApi.listProjects(2);
    expect(d.items.map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
    expect(d.total).toBe(5);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      '/api/pgc/api/projects?page=1&page_size=2',
      '/api/pgc/api/projects?page=2&page_size=2',
      '/api/pgc/api/projects?page=3&page_size=2',
    ]);
  });

  test('后端钳制 page_size 时按回执实际页长算页数', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    // 请求 100,后端只给 2/页:须按 2 而非 100 推剩余页,否则漏项
    f.mockResolvedValueOnce(page([1, 2], 4, 1, 2)).mockResolvedValueOnce(page([3, 4], 4, 2, 2));
    const d = await pgcApi.listProjects();
    expect(d.items.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(f.mock.calls[1][0]).toBe('/api/pgc/api/projects?page=2&page_size=100');
  });

  test('并发新建导致跨页重复时按 id 去重保序', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(page([1, 2], 4, 1, 2)).mockResolvedValueOnce(page([2, 3], 4, 2, 2));
    const d = await pgcApi.listProjects(2);
    expect(d.items.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  test('total 虚高时空页即收敛,不无界请求', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(page([1, 2], 1000, 1, 2)).mockResolvedValue(page([], 1000, 2, 2));
    const d = await pgcApi.listProjects(2);
    expect(d.items.map((p) => p.id)).toEqual([1, 2]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('缺 total 字段时退化为单页,不额外请求', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [{ id: 1, public_id: 'p1', name: 'n1' }] } }));
    const d = await pgcApi.listProjects();
    expect(d.items.map((p) => p.id)).toEqual([1]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('请求超时(C1)', () => {
  test('普通请求带默认 30s 超时 signal', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 0 } }));
    await pgcApi.listProjects();
    expect(spy).toHaveBeenCalledWith(30_000);
    const [, init] = f.mock.calls[0];
    expect(init.signal).toBe(spy.mock.results[0].value);
  });

  test('同步生成端点(genImage)放宽超时,不被默认值误杀', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 1 } }));
    await pgcApi.genImage(42, { prompt: 'x' });
    expect(spy).toHaveBeenCalledWith(300_000);
  });

  test('超时中止归一为 PgcError(TIMEOUT),不裸抛 DOMException', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));
    await expect(pgcApi.listProjects()).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(pgcApi.listProjects()).rejects.toBeInstanceOf(PgcError);
  });
});

describe('生成端点外部中止 signal', () => {
  test('genImage 透传外部 signal:与超时组合为 AbortSignal.any', async () => {
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 1 } }));
    const controller = new AbortController();
    await pgcApi.genImage(42, { prompt: 'x' }, controller.signal);
    expect(anySpy).toHaveBeenCalledTimes(1);
    expect(anySpy.mock.calls[0][0][0]).toBe(controller.signal);
    const [, init] = f.mock.calls[0];
    expect(init.signal).toBe(anySpy.mock.results[0].value);
  });

  test('外部中止归一为 PgcError(ABORTED),与上传 XHR 中止同码', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    const controller = new AbortController();
    controller.abort();
    await expect(pgcApi.genVideo(42, { prompt: 'x' }, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
  });

  test('不带外部 signal 时不走 AbortSignal.any,维持纯超时 signal', async () => {
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 1 } }));
    await pgcApi.genImage(42, { prompt: 'x' });
    expect(anySpy).not.toHaveBeenCalled();
  });
});

describe('replay 端点', () => {
  test('startReplay POST 命中 templates/{id}/start,解析 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { target_project_id: 42, template_id: 'tpl_1', status: 'provisioning' } }));
    const d = await pgcApi.startReplay('tpl_1');
    expect(d.target_project_id).toBe(42);
    expect(d.status).toBe('provisioning');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/replay/templates/tpl_1/start');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
  });

  test('finalizeReplay POST body 带 current_version_id', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { project_id: 42, status: 'ready' } }));
    const d = await pgcApi.finalizeReplay(42, 'v1');
    expect(d.status).toBe('ready');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/replay/projects/42/finalize');
    expect(JSON.parse(init.body as string)).toEqual({ current_version_id: 'v1' });
  });

  test('updateReplayState POST body 带 status', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { project_id: 42, status: 'completed' } }));
    await pgcApi.updateReplayState(42, 'completed');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/replay/projects/42/state');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'completed' });
  });

  test('start 404 抛 PgcError 带 code', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'REPLAY_TEMPLATE_NOT_FOUND', message: '模板不存在', data: null }, false, 404),
    );
    await expect(pgcApi.startReplay('nope')).rejects.toMatchObject({ code: 'REPLAY_TEMPLATE_NOT_FOUND', status: 404 });
  });
});
