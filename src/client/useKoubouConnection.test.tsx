import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const setModel = vi.fn();
const createClient = vi.fn<(opts: unknown) => { close: () => void; reconnect: () => void; setModel: (m: string) => void }>(() => ({ close: vi.fn(), reconnect: vi.fn(), setModel }));
vi.mock('@/koubou/client', () => ({ createKoubouClient: (opts: unknown) => createClient(opts), shouldReconnectOnWake: () => false }));
vi.mock('@/lib/koubou/client', () => ({ koubouApi: { listSessions: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue({ events: [], oldest_sequence: 0, newest_sequence: 0, latest_sequence: 0, has_more: false }) } }));

import { useKoubouConnection } from './useKoubouConnection';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

beforeEach(() => {
  process.env.NEXT_PUBLIC_PGC_BASE_URL = 'https://pgc.example';
  // 模型相关字段属 UIState,不在上面两个初始态工厂里 —— 不显式重置会跨用例泄漏
  // (泄漏的 availableModels 会让 switchProjectSession 把别的用例的 selectedModel 回落成首项)
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    availableModels: [], selectedModel: null, modelByProject: {}, modelBackend: null, toast: null,
  });
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

test('replay 活跃时不建连(早退出)', async () => {
  useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 0, cursor: 0, speed: 1 } });
  renderHook(() => useKoubouConnection());
  await new Promise((r) => setTimeout(r, 10));
  expect(createClient).not.toHaveBeenCalled();
});

test('replayHandoff 存在:跳过种子,按 handoff 建连并清 handoff', async () => {
  const { koubouApi } = await import('@/lib/koubou/client');
  useStore.setState({ currentProjectId: 7, replayHandoff: { sessionId: 'sess_c', afterSequence: 42, projectId: 7 } });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const opts = createClient.mock.calls[0][0] as { sessionId: string; afterSequence: number };
  expect(opts.sessionId).toBe('sess_c');
  expect(opts.afterSequence).toBe(42);
  expect((koubouApi.listEvents as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();   // 未种子
  expect(useStore.getState().replayHandoff).toBeNull();   // 已清
});

test('replayHandoff.projectId 与当前项目不符:不消费,走原 resolveSession 路径,handoff 原样保留', async () => {
  const { koubouApi } = await import('@/lib/koubou/client');
  // handoff 属于项目 99,但当前连接项目是 7(用户切项目后遗留的另一项目握手)
  useStore.setState({ currentProjectId: 7, replayHandoff: { sessionId: 'sess_a', afterSequence: 42, projectId: 99 } });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  expect((koubouApi.listSessions as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(7);   // 走了原 resolveSession 路径
  const opts = createClient.mock.calls[0][0] as { sessionId: string | null; afterSequence: number | null };
  expect(opts.sessionId).toBeNull();   // 未误用别项目的 handoff session
  // handoff 未被清空:留给项目 99 自己的连接消费
  expect(useStore.getState().replayHandoff).toEqual({ sessionId: 'sess_a', afterSequence: 42, projectId: 99 });
});

test('种子化历史后逐帧媒体补导:page.events 交给 importMediaFromEvent(断连窗口内的 ready 帧不丢)', async () => {
  const { koubouApi } = await import('@/lib/koubou/client');
  const mediaEvent = {
    type: 'claude.message', project_id: '7', session_id: 's1', sequence: 3,
    payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/hero.png', preview_url: 'https://x/hero.png' }] }) }] } },
  };
  (koubouApi.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ events: [mediaEvent], oldest_sequence: 3, newest_sequence: 3, latest_sequence: 3, has_more: false });
  const importSpy = vi.fn();
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 2, messages: [], turns: [], tasks: [] } },
    importMediaFromEvent: importSpy,
  });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  expect(importSpy).toHaveBeenCalledWith(mediaEvent);
});

test('mintTicket 的 fetch 带超时 signal(休眠悬挂有界,不卡死 connecting)', async () => {
  useStore.setState({ currentProjectId: 7 });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { mintTicket } = createClient.mock.calls[0][0] as { mintTicket: () => Promise<string | null> };
  const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { ticket: 'tk' } }) });
  vi.stubGlobal('fetch', f);
  await expect(mintTicket()).resolves.toBe('tk');
  const [, init] = f.mock.calls[0] as [string, RequestInit];
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

// REST 跟跑豁免集的生命周期:投递权按 attach 归属,每个 ready 须清空 wsRunIds——
// 上一条 socket 收过某 run 的帧不代表重连后的新 socket 也收得到(每次重连重新抽 Pod)
test('每个 session.ready 清空 wsRunIds:旧 socket 的投递事实不豁免新 socket 的跟跑', async () => {
  const track = vi.fn().mockResolvedValue(undefined);
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    trackActiveRunViaRest: track,
  });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  // 首个 ready → 触发跟跑,拿到共享豁免谓词
  onEvent({ type: 'session.ready', project_id: '7', session_id: 's1', payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } });
  expect(track).toHaveBeenCalledTimes(1);
  const isWsOwned = track.mock.calls[0][0] as (id: string) => boolean;

  // 本 socket 收到 r1 的帧 → 进豁免集(WS 在投,跟跑应退位)
  onEvent({ type: 'run.started', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } });
  expect(isWsOwned('r1')).toBe(true);

  // 重连后的第二个 ready → 豁免集清零:r1 是否仍由 WS 投递须由新 socket 重新证明
  onEvent({ type: 'session.ready', project_id: '7', session_id: 's1', payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } });
  expect(track).toHaveBeenCalledTimes(2);
  expect(isWsOwned('r1')).toBe(false);
});

// 会话落库模型回填(spec 2026-09-11):判定与落库在 store,这里只验「该不该发帧」
test('session.ready 带已下架的会话模型:发一帧 set_model 切到列表首项', async () => {
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    availableModels: ['Rez1', 'claude-fable-5'],
    selectedModel: 'Rez1',
    trackActiveRunViaRest: vi.fn().mockResolvedValue(undefined),
  });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  onEvent({
    type: 'session.ready', project_id: '7', session_id: 's1',
    payload: {
      session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] },
      model: 'claude-opus-4-8', available_models: ['Rez1', 'claude-fable-5'],
    },
  });
  expect(setModel).toHaveBeenCalledTimes(1);
  expect(setModel).toHaveBeenCalledWith('Rez1');
  expect(useStore.getState().toast?.code).toBe('MODEL_RETIRED');
});

// 回填是纯 store 动作:会话模型可用时不该产生任何帧(白发一条 set_model 等于无谓的写库 + model.changed 回声)
test('session.ready 带可用的会话模型:只回填选择器,不发帧', async () => {
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    availableModels: ['Rez1', 'claude-fable-5'],
    selectedModel: 'Rez1',
    trackActiveRunViaRest: vi.fn().mockResolvedValue(undefined),
  });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  onEvent({
    type: 'session.ready', project_id: '7', session_id: 's1',
    payload: {
      session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] },
      model: 'claude-fable-5', available_models: ['Rez1', 'claude-fable-5'],
    },
  });
  expect(setModel).not.toHaveBeenCalled();
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
  expect(useStore.getState().modelByProject['7']).toBe('claude-fable-5');
});

test('run 终态:成功与失败都刷余额(跑过的 LLM 调用不退费)', async () => {
  const refreshBalance = vi.fn();
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    refreshBalance,
    loadCanvas: vi.fn().mockResolvedValue(undefined),
    loadVersions: vi.fn().mockResolvedValue(undefined),
  } as never);
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  onEvent({ type: 'run.finished', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 1, payload: { run_id: 'r1', status: 'succeeded' } });
  expect(refreshBalance).toHaveBeenCalledTimes(1);

  onEvent({ type: 'run.finished', project_id: '7', session_id: 's1', run_id: 'r2', sequence: 2, payload: { run_id: 'r2', status: 'failed' } });
  expect(refreshBalance).toHaveBeenCalledTimes(2);
});

test('run 进行中的普通帧不刷余额(靠 useBalanceRefresh 的在途轮询,不是每帧打后端)', async () => {
  const refreshBalance = vi.fn();
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    refreshBalance,
  } as never);
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  onEvent({ type: 'run.started', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } });
  onEvent({ type: 'claude.message', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 2, payload: { sdk_type: 'AssistantMessage', payload: { content: [{ type: 'text', text: 'hi' }] } } });
  expect(refreshBalance).not.toHaveBeenCalled();
});

test('checkpoint.created 刷版本与画布(新版本就绪的权威信号,不等 run 终态)', async () => {
  const loadVersions = vi.fn().mockResolvedValue(undefined);
  const loadCanvas = vi.fn().mockResolvedValue(undefined);
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    loadVersions,
    loadCanvas,
    refreshBalance: vi.fn(),
  } as never);
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  onEvent({ type: 'checkpoint.created', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 9, payload: { run_id: 'r1', version: 'v12' } });
  expect(loadVersions).toHaveBeenCalledTimes(1);
  expect(loadCanvas).toHaveBeenCalledTimes(1);
});

test('build.started / build.succeeded 本期不出 UI,也不触发刷新', async () => {
  const loadVersions = vi.fn().mockResolvedValue(undefined);
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: { '7': { sessionId: 's1', lastSequence: 0, messages: [], turns: [], tasks: [] } },
    loadVersions,
    loadCanvas: vi.fn().mockResolvedValue(undefined),
    refreshBalance: vi.fn(),
  } as never);
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const { onEvent } = createClient.mock.calls[0][0] as { onEvent: (e: unknown) => void };

  onEvent({ type: 'build.started', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 7, payload: { run_id: 'r1' } });
  onEvent({ type: 'build.succeeded', project_id: '7', session_id: 's1', run_id: 'r1', sequence: 8, payload: { run_id: 'r1', dist_files: [] } });
  expect(loadVersions).not.toHaveBeenCalled();
});

test('建连不带跨 backend 的模型(否则新建会话被 invalid model + 4400 拒且不重连)', async () => {
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: {},
    agentBackend: 'codex',
    modelBackend: 'cc',
    selectedModel: 'claude-opus-5',
  } as never);
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const opts = createClient.mock.calls[0][0] as { model: string | null; backend: string };
  expect(opts.model).toBeNull();
  expect(opts.backend).toBe('codex');
});

test('建连带同 backend 的模型', async () => {
  useStore.setState({
    currentProjectId: 7,
    koubouByProject: {},
    agentBackend: 'codex',
    modelBackend: 'codex',
    selectedModel: 'gpt-5.5',
  } as never);
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const opts = createClient.mock.calls[0][0] as { model: string | null };
  expect(opts.model).toBe('gpt-5.5');
});
