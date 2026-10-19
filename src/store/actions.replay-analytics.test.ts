import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// 回放埋点(PR#129 §6):replay_start / replay_complete / replay_continue_first_message 待报标记
const trackMock = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => trackMock(...a), projectPublicId: () => 'AbCd' }));

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listCanvasItems: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listVersions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      startReplay: vi.fn(), finalizeReplay: vi.fn(), updateReplayState: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock('@/lib/koubou/client', () => ({
  koubouApi: { cloneFromTemplate: vi.fn(), listSessions: vi.fn(), listEvents: vi.fn() },
  KoubouError: class extends Error { constructor(public code: number, m: string, public status: number) { super(m); } },
}));

import { useStore } from './index';
import { pgcApi } from '@/lib/pgc/client';
import { koubouApi } from '@/lib/koubou/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  trackMock.mockClear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => vi.clearAllMocks());

describe('回放埋点', () => {
  test('enterReplay 起播(phase=playing)时上报 replay_start', async () => {
    mocked(pgcApi.startReplay).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    mocked(koubouApi.cloneFromTemplate).mockResolvedValue({ session_id: 'sess_c', already_provisioned: false });
    mocked(pgcApi.finalizeReplay).mockResolvedValue({ project_id: 7, status: 'ready' });
    await useStore.getState().enterReplay('tpl');
    expect(trackMock).toHaveBeenCalledWith('replay_start', expect.objectContaining({ template_id: 'tpl' }));
  });

  test('completed 项目不起播,不上报 replay_start', async () => {
    mocked(pgcApi.startReplay).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'completed' });
    await useStore.getState().enterReplay('tpl');
    expect(trackMock).not.toHaveBeenCalled();
  });

  test('completeReplay 上报 replay_complete(看完 skipped=false)并置续作待报标记', () => {
    useStore.setState({ replay: { phase: 'playing', templateId: 'tpl', projectId: 7, sessionId: 's', total: 3, cursor: 3, speed: 1 } });
    useStore.getState().completeReplay();
    expect(trackMock).toHaveBeenCalledWith('replay_complete', expect.objectContaining({ template_id: 'tpl', skipped: false }));
    expect(useStore.getState().replayContinuePending).toEqual({ projectId: 7, templateId: 'tpl' });
  });

  test('skip 收尾(phase=skipping)时 replay_complete 带 skipped=true', () => {
    useStore.setState({ replay: { phase: 'skipping', templateId: 'tpl', projectId: 7, sessionId: 's', total: 3, cursor: 1, speed: 1 } });
    useStore.getState().completeReplay();
    expect(trackMock).toHaveBeenCalledWith('replay_complete', expect.objectContaining({ skipped: true }));
  });
});
