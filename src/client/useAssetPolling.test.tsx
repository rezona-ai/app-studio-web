import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssetPolling } from './useAssetPolling';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState, isDerivedGenKind } from '@/store/types';
import type { GenTaskKind } from '@/store/types';

// 可控的页面可见性:jsdom 默认恒 visible,用 defineProperty 接管
let visibility: DocumentVisibilityState = 'visible';
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

const genTask = { itemId: 'vid-1', kind: 'video' as const, taskId: 't1', startedAt: 0 };

// 版本行:status 是本组用例的唯一变量,其余字段取无意义占位
const makeVersion = (id: string, status: string) => ({
  id, index: 1, label: id, summary: '', createdAt: status === 'ready' ? '2026-08-31T00:00:00Z' : '',
  current: false, status, assetKeys: [], game: { title: '', palette: '' },
});

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    // 覆写两个轮询 action 为 mock:本测试只关心触发时机,不关心轮询内部
    genTasks: [genTask], versions: [makeVersion('v9', 'building')],
    pollGenTasks: vi.fn(), pollVersions: vi.fn(),
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAssetPolling 可见性门(C2)', () => {
  test('可见时按间隔轮询生成任务与版本', () => {
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(useStore.getState().pollGenTasks).toHaveBeenCalled();
    expect(useStore.getState().pollVersions).toHaveBeenCalled();
  });

  test('绑骨/重纹理任务使用 3 秒轮询间隔', () => {
    useStore.setState({ genTasks: [{ ...genTask, kind: 'rig3d' }] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(2_999); });
    expect(useStore.getState().pollGenTasks).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(useStore.getState().pollGenTasks).toHaveBeenCalledTimes(1);
    expect(useStore.getState().pollGenTasks).toHaveBeenCalledWith('derived');
  });

  test('普通任务与派生 3D 任务各走自己的轮询节奏', () => {
    useStore.setState({ genTasks: [genTask, { ...genTask, itemId: 'rig-1', taskId: 't2', kind: 'rig3d' }] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(useStore.getState().pollGenTasks).toHaveBeenCalledWith('derived');
    expect(useStore.getState().pollGenTasks).not.toHaveBeenCalledWith('base');
    act(() => { vi.advanceTimersByTime(7_000); });
    expect(useStore.getState().pollGenTasks).toHaveBeenCalledWith('base');
  });

  test('页面隐藏时不打后端', () => {
    renderHook(() => useAssetPolling());
    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(useStore.getState().pollGenTasks).not.toHaveBeenCalled();
    expect(useStore.getState().pollVersions).not.toHaveBeenCalled();
  });

  test('转回可见立即补一轮,不等下个间隔', () => {
    renderHook(() => useAssetPolling());
    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => { setVisibility('visible'); });
    // 不推进计时器:visibilitychange 应即时补一次
    expect(useStore.getState().pollGenTasks).toHaveBeenCalledTimes(1);
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(1);
  });

  test('无生成任务且无待构建版本时不起 interval', () => {
    useStore.setState({ genTasks: [], versions: [] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(useStore.getState().pollGenTasks).not.toHaveBeenCalled();
    expect(useStore.getState().pollVersions).not.toHaveBeenCalled();
  });
});

// spec 2026-08-31:listVersions 会返回 status:'building' 的行,轮询必须由列表状态驱动,
// 早先那套开关在生产上恒 null,构建中的版本因此永远不会被二次刷新。
describe('useAssetPolling 版本轮询由列表里的非 ready 行驱动', () => {
  test('列表含 building 行 → 起轮询', () => {
    useStore.setState({ genTasks: [], versions: [makeVersion('v1', 'building')] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(2_500); });
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(1);
  });

  test('列表全 ready → 不起 interval', () => {
    useStore.setState({ genTasks: [], versions: [makeVersion('v1', 'ready')] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(useStore.getState().pollVersions).not.toHaveBeenCalled();
  });

  // 边界钉死到具体次数:只断言"封顶前至少轮过一次"的话,把 MAX_TICKS 改成 2 也能全绿(实测),
  // 等于 spec 决策 3 的核心参数与 >= / > 的差一完全没有保护。
  test('持续非 ready 恰好轮 120 次(5 分钟 / 2.5 秒)后停轮,只停轮不改状态', () => {
    useStore.setState({ genTasks: [], versions: [makeVersion('v1', 'building')] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(297_500); });   // 第 119 次
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(119);
    act(() => { vi.advanceTimersByTime(2_500); });     // 第 120 次:计满
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(120);
    act(() => { vi.advanceTimersByTime(60_000); });    // 此后 interval 已拆,不再增长
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(120);
    // 封顶只是停轮:版本行原样保留,状态不被前端改写
    expect(useStore.getState().versions).toEqual([makeVersion('v1', 'building')]);
  });

  // Important-3(评审发现):一条永不 ready 的行不得毒死后续所有构建的轮询
  test('老的构建中行卡死后,新出现的构建中行仍能获得一轮完整额度', () => {
    useStore.setState({ genTasks: [], versions: [makeVersion('stuck', 'building')] } as never);
    renderHook(() => useAssetPolling());
    // 分两段推进,理由同上:单次 advance 到不了真正的封顶态
    act(() => { vi.advanceTimersByTime(297_500); });
    act(() => { vi.advanceTimersByTime(2_500); });     // stuck 行已把额度耗尽并停轮
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(120);
    // 老行**仍在**列表里(后端没救回来),此时新构建产出一条新的构建中行
    act(() => { useStore.setState({ versions: [makeVersion('stuck', 'building'), makeVersion('fresh', 'building')] } as never); });
    act(() => { vi.advanceTimersByTime(2_500); });
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(121);
  });

  test('非 ready 行消失后再出现 → 计数重置,重新开始轮询', () => {
    useStore.setState({ genTasks: [], versions: [makeVersion('v1', 'building')] } as never);
    renderHook(() => useAssetPolling());
    // 分两段推进:单次 advance 内 tick 同步连发,React 来不及重渲染去拆 interval,
    // 到不了真正的封顶态。分段才让"已封顶"这个前提成立。
    act(() => { vi.advanceTimersByTime(297_500); });
    act(() => { vi.advanceTimersByTime(2_500); });     // 第 120 次:计满并拆掉 interval
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(120);
    act(() => { vi.advanceTimersByTime(60_000); });    // 确认确实停了
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(120);
    act(() => { useStore.setState({ versions: [makeVersion('v1', 'ready')] } as never); });
    act(() => { useStore.setState({ versions: [makeVersion('v1', 'ready'), makeVersion('v2', 'building')] } as never); });
    act(() => { vi.advanceTimersByTime(2_500); });
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(121);
  });

  test('切项目重置计数', () => {
    useStore.setState({ currentProjectId: 1, genTasks: [], versions: [makeVersion('v1', 'building')] } as never);
    renderHook(() => useAssetPolling());
    act(() => { vi.advanceTimersByTime(300_000); });   // 项目 1 已封顶
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(120);
    // 切到项目 2,同样有一条构建中的版本
    act(() => { useStore.setState({ currentProjectId: 2, versions: [makeVersion('v9', 'building')] } as never); });
    act(() => { vi.advanceTimersByTime(2_500); });
    expect(useStore.getState().pollVersions).toHaveBeenCalledTimes(121);
  });
});

// 2026-10-08 devlab 实发:音频任务登记进了 store,却没有任何 interval 会起来,GET 一次不发,
// 服务端 77 秒出货而画布上的卡转圈到天荒地老(task gtask-72b0d219)。根因是「哪些 kind 归基础档」
// 在仓里被枚举了三遍,加 audio 时只改到其中一遍。
// 故这里**逐 kind 表驱动**而不是只补一条 audio:下一种 kind 漏写会在这里立刻红,
// 而不是像这次一样静默不轮询(线上表现是永久 loading,本地测试全绿)。
describe('每一种 GenTaskKind 都必须被某个 interval 驱动', () => {
  const KINDS: GenTaskKind[] = ['video', 'model3d', 'rig3d', 'retexture', 'audio'];

  test.each(KINDS)('画布上只有 %s 任务时,轮询照样起得来', (kind) => {
    useStore.setState({ genTasks: [{ itemId: `it-${kind}`, kind, taskId: `t-${kind}`, startedAt: 0 }] } as never);
    renderHook(() => useAssetPolling());
    // 取两档间隔的较大者:派生档 3s 已过,基础档 10s 也已过,哪一档接住都算数
    act(() => { vi.advanceTimersByTime(10_000); });
    const scope = isDerivedGenKind(kind) ? 'derived' : 'base';
    expect(useStore.getState().pollGenTasks).toHaveBeenCalledWith(scope);
  });
});
