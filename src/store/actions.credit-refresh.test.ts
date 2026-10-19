import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// 消耗侧余额刷新:验证异步任务轮询 pollGenTasks 这条结算路径刷了余额(发起侧 runGen 随画布生成入口退役)。
// 注意本文件守不住「只有这两处」——断言打在 api.getBalance 上,而 refreshBalance 内部有在飞合流,
// 同 tick 的重复调用在网络层看不出差别(实测「finally + 成功侧都刷」的变异能全绿逃逸)。
// 要真守住得给 refreshBalance 加注入面,那正是 CLAUDE.md 反模式里「为测试而加的包装」,不值得。
vi.mock('@/lib/analytics', () => ({ track: () => {}, projectPublicId: () => 'AbCd' }));

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      pollVideo: vi.fn(), pollModel3d: vi.fn(),
      updateCanvasReference: vi.fn(), deleteCanvasItem: vi.fn(),
      batchUpdateCanvasItems: vi.fn(),
      getBalance: vi.fn(),
    },
  };
});

import { useStore } from './index';
import { pgcApi } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  vi.clearAllMocks();
  api.updateCanvasReference.mockResolvedValue({});
  api.batchUpdateCanvasItems.mockResolvedValue({ updated: 0, failed: [] });
  api.getBalance.mockResolvedValue({ balance: 99, held: 0, spendable: 99 });
});
afterEach(() => vi.restoreAllMocks());

describe('异步任务结算侧(pollGenTasks 漏斗)', () => {
  test('轮询到 ready(任务离队)→ 刷新余额(held 释放、balance 落定)', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() - 1000, fails: 0 }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'ready', item: { item_id: 'vid-1', type: 'video', status: 'ready', url: '/p/v.mp4' } });
    await useStore.getState().pollGenTasks();
    await vi.waitFor(() => expect(api.getBalance).toHaveBeenCalledTimes(1));
  });

  test('轮询到失败(任务离队)→ 也刷余额(失败可能已退款)', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'm-1', key: 'm-1', label: 'x', kind: '3d', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'm-1', kind: 'model3d', taskId: 't9', startedAt: Date.now(), fails: 0 }],
    });
    api.pollModel3d.mockResolvedValue({ task_id: 't9', status: 'failed', item: null, failure: { code: 'X', category: 'server', message: 'boom' } });
    api.deleteCanvasItem.mockResolvedValue({});
    await useStore.getState().pollGenTasks();
    await vi.waitFor(() => expect(api.getBalance).toHaveBeenCalledTimes(1));
  });

  test('一轮内任务仍 generating(无任务离队)→ 不刷余额(否则等于按轮询间隔常拉)', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-2', key: 'vid-2', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
      genTasks: [{ itemId: 'vid-2', kind: 'video', taskId: 't2', startedAt: Date.now(), fails: 0 }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't2', status: 'processing', item: { item_id: 'vid-2', type: 'video', status: 'generating', url: null } });
    await useStore.getState().pollGenTasks();
    expect(api.getBalance).not.toHaveBeenCalled();
  });

  test('同一轮两个任务同时完成 → 在飞合流,只打一次余额请求', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [
        { id: 'vid-3', key: 'vid-3', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 } },
        { id: 'm-3', key: 'm-3', label: 'y', kind: '3d', source: 'generated', status: 'generating', position: { x: 0, y: 0 } },
      ],
      genTasks: [
        { itemId: 'vid-3', kind: 'video', taskId: 't3', startedAt: Date.now(), fails: 0 },
        { itemId: 'm-3', kind: 'model3d', taskId: 't4', startedAt: Date.now(), fails: 0 },
      ],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't3', status: 'ready', item: { item_id: 'vid-3', type: 'video', status: 'ready', url: '/p/v.mp4' } });
    api.pollModel3d.mockResolvedValue({ task_id: 't4', status: 'ready', item: { item_id: 'm-3', type: 'model3d', status: 'ready', url: '/p/m.glb' } });
    await useStore.getState().pollGenTasks();
    await vi.waitFor(() => expect(api.getBalance).toHaveBeenCalledTimes(1));
  });
});
