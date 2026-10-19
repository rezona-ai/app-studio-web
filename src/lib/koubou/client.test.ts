import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KoubouError, koubouApi } from './client';

function mockJson(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.restoreAllMocks());

describe('koubouApi.listSessions 信封拆解', () => {
  test('code 0 成功返回 data 数组,GET 命中 sessions 端点', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: [{ session_id: 'sess_abc', project_id: '42', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }] }));
    const d = await koubouApi.listSessions(42);
    expect(d).toHaveLength(1);
    expect(d[0].session_id).toBe('sess_abc');
    expect(f).toHaveBeenCalledWith('/api/koubou/projects/42/sessions', expect.objectContaining({ method: 'GET' }));
  });

  test('code 非 0 抛 KoubouError 带 code+status', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ code: 404, message: 'session not found', data: null }, false, 404),
    );
    await expect(koubouApi.listSessions('42')).rejects.toMatchObject({ code: 404, status: 404 });
  });

  test('HTTP 200 但 code 非 0 也抛 KoubouError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ code: 409, message: 'conflict', data: null }, true, 200),
    );
    await expect(koubouApi.listSessions('42')).rejects.toMatchObject({ code: 409, status: 200 });
  });

  test('listEvents 构造分页查询参数并返回分页信封', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    const page = { events: [{ type: 'run.finished', sequence: 7 }], oldest_sequence: 7, newest_sequence: 7, latest_sequence: 7, has_more: false };
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: page }));
    const d = await koubouApi.listEvents(42, 's1', { limit: 50, beforeSequence: 8 });
    expect(d.has_more).toBe(false);
    expect(d.events[0].sequence).toBe(7);
    expect(f).toHaveBeenCalledWith('/api/koubou/projects/42/sessions/s1/events?limit=50&before_sequence=8', expect.objectContaining({ method: 'GET' }));
  });

  test('listEvents 无参数时不带查询串(取最新一页)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { events: [], oldest_sequence: 0, newest_sequence: 0, latest_sequence: 0, has_more: false } }));
    await koubouApi.listEvents('42', 's1');
    expect(f).toHaveBeenCalledWith('/api/koubou/projects/42/sessions/s1/events', expect.objectContaining({ method: 'GET' }));
  });

  test('非 JSON / HTTP 错误抛 KoubouError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      { ok: false, status: 502, json: () => Promise.reject(new Error('not json')) } as unknown as Response,
    );
    await expect(koubouApi.listSessions('42')).rejects.toBeInstanceOf(KoubouError);
  });
});

describe('replay 相关', () => {
  test('cloneFromTemplate POST body 带 template_id,解析 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { session_id: 'sess_new', already_provisioned: false } }));
    const d = await koubouApi.cloneFromTemplate(42, 'tpl_1');
    expect(d.session_id).toBe('sess_new');
    expect(d.already_provisioned).toBe(false);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/koubou/projects/42/sessions/clone-from-template');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ template_id: 'tpl_1' });
  });

  test('clone 409 抛 KoubouError(供 action 兜底既有会话)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ code: 409, message: 'REPLAY_ALREADY_PROVISIONED', data: null }, true, 200),
    );
    await expect(koubouApi.cloneFromTemplate(42, 'tpl_1')).rejects.toMatchObject({ code: 409, status: 200 });
  });

  test('listEvents 带 after_sequence(全量正向翻页用)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { events: [], oldest_sequence: 0, newest_sequence: 0, latest_sequence: 0, has_more: false } }));
    await koubouApi.listEvents(42, 's1', { limit: 100, afterSequence: 0 });
    expect(f).toHaveBeenCalledWith('/api/koubou/projects/42/sessions/s1/events?limit=100&after_sequence=0', expect.objectContaining({ method: 'GET' }));
  });
});

describe('koubouApi.listModels', () => {
  test('返回 data.models,GET 命中 /models?backend=cc', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { backend: 'cc', default_model: 'claude-opus-4-8', models: ['claude-opus-4-8', 'claude-fable-5'] } }));
    const d = await koubouApi.listModels('cc');
    expect(d).toEqual(['claude-opus-4-8', 'claude-fable-5']);
    expect(f).toHaveBeenCalledWith('/api/koubou/models?backend=cc', expect.objectContaining({ method: 'GET' }));
  });
  test('backend=codex 命中 codex 列表(两个 backend 列表不同)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { backend: 'codex', default_model: 'gpt-5.5', models: ['gpt-5.6', 'gpt-5.5'] } }));
    const d = await koubouApi.listModels('codex');
    expect(d).toEqual(['gpt-5.6', 'gpt-5.5']);
    expect(f).toHaveBeenCalledWith('/api/koubou/models?backend=codex', expect.objectContaining({ method: 'GET' }));
  });
  test('code 非 0 抛 KoubouError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockJson({ code: 400, message: 'backend not supported', data: null }, false, 400));
    await expect(koubouApi.listModels('cc')).rejects.toBeInstanceOf(KoubouError);
  });
});

describe('koubouApi.listSkills', () => {
  test('返回 name + 原生调用串 invocation(codex 为 $name)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { backend: 'codex', skills: [{ name: 'brainstorm', invocation: '$brainstorm' }] } }));
    const d = await koubouApi.listSkills('codex');
    expect(d).toEqual([{ name: 'brainstorm', invocation: '$brainstorm' }]);
    expect(f).toHaveBeenCalledWith('/api/koubou/skills?backend=codex', expect.objectContaining({ method: 'GET' }));
  });
  test('invocation 缺失(老服务端)按 cc 惯例兜底', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { backend: 'cc', skills: [{ name: 'plan' }] } }));
    expect(await koubouApi.listSkills('cc')).toEqual([{ name: 'plan', invocation: '/plan' }]);
  });
});

test('koubou() 所有请求带超时 signal(休眠悬挂 fetch 有界)', async () => {
  const f = fetch as ReturnType<typeof vi.fn>;
  f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: [] }));
  await koubouApi.listSessions(42);
  const [, init] = f.mock.calls[0] as [string, RequestInit];
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

describe('请求超时分档', () => {
  test('轻量控制面调用走默认 15s', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockJson({ code: 0, message: 'ok', data: [] }));
    await koubouApi.listSessions(42);
    expect(spy).toHaveBeenCalledWith(15_000);
  });

  // bug #13870465:clone 是服务端整份复制会话的 provisioning 端点,压在 15s 上会把一个其实会成功的
  // 操作误杀成前端失败。同一条编排里 pgc 那半截(workbenchShare.open)早就放宽到 300s,koubou 这半截漏配。
  test.each([
    ['cloneFromShare', () => koubouApi.cloneFromShare(9, { source_user_id: '1', source_project_id: '2', source_session_id: 's', share_token: 't' })],
    ['cloneFromTemplate', () => koubouApi.cloneFromTemplate(9, 'tpl')],
  ])('%s 放宽超时,不被默认值误杀', async (_name, call) => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { session_id: 's', already_provisioned: false } }));
    await call();
    expect(spy).toHaveBeenCalledWith(300_000);
  });
});
