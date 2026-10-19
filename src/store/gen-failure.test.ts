import { beforeEach, describe, expect, test, vi } from 'vitest';

// 保留真实导出(PgcError 供 instanceof 与构造),仅替换 api 方法
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      ...actual.pgcApi,
      deleteCanvasItem: vi.fn(async () => ({})),
      updateCanvasReference: vi.fn(async () => ({})),
      getBalance: vi.fn(async () => ({ balance: 0, held: 0, spendable: 0 })),
      pollVideo: vi.fn(),
      pollModel3d: vi.fn(),
      pollRig3d: vi.fn(),
      pollRetexture: vi.fn(),
    },
  };
});

import { useStore } from './index';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';
import type { CanvasGenFailure } from '@/lib/pgc/types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

// 真机形态:pgc 的 retryable 是「**调整后**能否重试」,内容审核类改了 prompt 就能再试 → 恒 true
// (spec 2026-08-13-retry-route-content-policy;重试路由按 category 判,不看这个字段)
const moderationFailure: CanvasGenFailure = {
  code: 'INPUT_MODERATION_REJECTED',
  category: 'content_policy',
  message: '提示词包含不被允许的内容',
  retryable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    ...createInitialKoubouState(),
    ...createInitialServerState(),
    currentProjectId: 1,
  } as never);
});

// 异步(video / 3d / 派生)失败:此前 failGenTask 会删掉本地卡,现在一律就地转失败态。
// 服务端那份 failed item 也**不再删** —— 保留它,失败卡才能活过刷新
// (loadCanvas 带回,映射层 statusOf('failed')→'error' 已接好)
describe('异步生成失败:卡片保留 + 服务端 failed item 不再删', () => {
  const generatingCard = (id: string, kind: 'video' | '3d' = 'video') => ({
    id, key: id, label: 'x', kind, source: 'generated' as const,
    status: 'generating' as const, position: { x: 10, y: 20 },
  });

  test('任务级失败:卡留在原位转 error,failure 来自 task.failure', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [generatingCard('vid-1')],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    } as never);
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'failed', failure: moderationFailure });

    await useStore.getState().pollGenTasks();

    const card = useStore.getState().assets.find((a) => a.id === 'vid-1')!;
    expect(card.status).toBe('error');
    expect(card.failure).toEqual(moderationFailure);
    expect(card.position).toEqual({ x: 10, y: 20 });        // 原位不动
    expect(useStore.getState().genTasks).toHaveLength(0);   // 任务离队
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();    // 服务端 failed item 保留
  });

  test('item 级失败:同样保留卡并挂 failure', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [generatingCard('vid-1')],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    } as never);
    api.pollVideo.mockResolvedValue({
      task_id: 't1', status: 'running', failure: moderationFailure,
      item: { id: 1, item_id: 'vid-1', type: 'video', status: 'failed' },
    });

    await useStore.getState().pollGenTasks();

    const card = useStore.getState().assets.find((a) => a.id === 'vid-1')!;
    expect(card.status).toBe('error');
    expect(card.failure).toEqual(moderationFailure);
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
  });

  test('轮询超时兜底:卡留下而非静默消失', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [generatingCard('vid-1')],
      // startedAt 远早于 DEADLINE,poll 成功但无 item → 走超时兜底
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: 0 }],
    } as never);
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'running' });

    await useStore.getState().pollGenTasks();

    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')!.status).toBe('error');
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  test('连续轮询失败达上限:卡留下', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [generatingCard('vid-1')],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now(), fails: 99 }],
    } as never);
    api.pollVideo.mockRejectedValue(new PgcError('NETWORK', '网络错误', 0, null));

    await useStore.getState().pollGenTasks();

    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')!.status).toBe('error');
  });

  test('派生(rig3d)失败:卡留下并带 failure(回归,此前已是保留语义)', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [{ ...generatingCard('rig-1', '3d'), parentId: 'src-1' }],
      genTasks: [{ itemId: 'rig-1', kind: 'rig3d', taskId: 't1', startedAt: Date.now() }],
    } as never);
    api.pollRig3d.mockResolvedValue({
      task_id: 't1', status: 'retarget', failure: moderationFailure,
      item: { id: 2, item_id: 'rig-1', type: 'rig3d', status: 'failed' },
    });

    await useStore.getState().pollGenTasks();

    const card = useStore.getState().assets.find((a) => a.id === 'rig-1')!;
    expect(card.status).toBe('error');
    expect(card.failure).toEqual(moderationFailure);
    expect(card.position).toEqual({ x: 10, y: 20 });
  });

  test('失败后切项目:不把失败态写回旧项目的卡', async () => {
    useStore.setState({
      currentProjectId: 1,
      assets: [generatingCard('vid-1')],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
    } as never);
    api.pollVideo.mockImplementation(async () => {
      useStore.setState({ currentProjectId: 2, assets: [] } as never);
      return { task_id: 't1', status: 'failed', failure: moderationFailure };
    });

    await useStore.getState().pollGenTasks();

    expect(useStore.getState().assets).toHaveLength(0);
  });
});
