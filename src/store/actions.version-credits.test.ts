import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// 版本消耗积分:loadVersions 落库后按「ready 版本集合是否变化」驱动 /versions/credits。
// 设计稿 docs/superpowers/specs/2026-08-31-version-credits-breakdown-design.md。
vi.mock('@/lib/analytics', () => ({ track: () => {}, projectPublicId: () => 'AbCd' }));

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listVersions: vi.fn(),
      getVersionCredits: vi.fn(),
    },
  };
});

import { useStore } from './index';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';
import type { VersionData } from '@/lib/pgc/types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const ver = (id: string, seq: number, status = 'ready'): VersionData =>
  ({ version_id: id, seq, title: `V${seq}`, status, created_at: '2026-08-31T10:00:00Z' });

const creditsOf = (id: string) => useStore.getState().versionCreditsById[id];

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  vi.clearAllMocks();
  api.getVersionCredits.mockResolvedValue({ items: [], notes: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('loadVersionCredits 落数', () => {
  test('首载有 ready 版本 → 拉一次,命中行拿到 total_credits', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1), ver('v2', 2)], total: 2 });
    api.getVersionCredits.mockResolvedValue({
      items: [
        { version_id: 'v1', asset_credits: 200, llm_credits: 100, total_credits: 300 },
        { version_id: 'v2', asset_credits: 100, llm_credits: 20, total_credits: 120 },
      ],
      notes: [],
    });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(api.getVersionCredits).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(creditsOf('v1')).toBe(300));
    expect(creditsOf('v2')).toBe(120);
  });

  // total 为 null(后端不编数)的段在 map 层已被丢掉,这里守的是「行上不留数字」
  test('total_credits 为 null 的版本行不带数字', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1)], total: 1 });
    api.getVersionCredits.mockResolvedValue({
      items: [{ version_id: 'v1', asset_credits: 200, llm_credits: null, total_credits: null }],
      notes: ['billing_disabled'],
    });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(api.getVersionCredits).toHaveBeenCalledTimes(1));
    expect(creditsOf('v1')).toBeUndefined();
  });

  // 二轮不再给某版本数字(如后端转为不编数)→ 旧数字必须走,不能挂在界面上
  test('二轮返回不再包含某版本 → 该行数字被清掉', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1)], total: 1 });
    api.getVersionCredits.mockResolvedValue({ items: [{ version_id: 'v1', total_credits: 300 }], notes: [] });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(creditsOf('v1')).toBe(300));

    api.getVersionCredits.mockResolvedValue({ items: [{ version_id: 'v1', total_credits: null }], notes: [] });
    await useStore.getState().loadVersionCredits();
    await vi.waitFor(() => expect(creditsOf('v1')).toBeUndefined());
  });
});

describe('触发判据:ready 集合变化', () => {
  test('ready 集合不变的重复 loadVersions(轮询空转)→ 不再拉', async () => {
    useStore.setState({ currentProjectId: 42 });
    // 有一行构建中:pollVersions 正是靠它驱动,每 2.5s 调一次 loadVersions
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1), ver('v2', 2, 'building')], total: 2 });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(api.getVersionCredits).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 3; i++) await useStore.getState().loadVersions();
    expect(api.getVersionCredits).toHaveBeenCalledTimes(1);
  });

  // 评审 C1:loadVersions 整体替换 versions,而判据恰好保证不重拉 ⟹ 每次不出新版本的
  // loadVersions 都是一次静默清空。最难看的是一次不产出版本的 agent run
  // (run.finished(succeeded) 搭车 loadVersions):所有行的数字集体消失到下一版为止。
  test('不产出新版本的 loadVersions 不得擦掉已显示的数字', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1)], total: 1 });
    api.getVersionCredits.mockResolvedValue({ items: [{ version_id: 'v1', total_credits: 300 }], notes: [] });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(creditsOf('v1')).toBe(300));

    await useStore.getState().loadVersions();   // ready 集合原样:不重拉,也不该丢数
    expect(api.getVersionCredits).toHaveBeenCalledTimes(1);
    expect(creditsOf('v1')).toBe(300);
  });

  test('构建中的版本变 ready → 再拉一次', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1), ver('v2', 2, 'building')], total: 2 });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(api.getVersionCredits).toHaveBeenCalledTimes(1));

    api.listVersions.mockResolvedValue({ items: [ver('v1', 1), ver('v2', 2)], total: 2 });
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(api.getVersionCredits).toHaveBeenCalledTimes(2));
  });

  test('空项目(版本列表为空)→ 不打无谓请求', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadVersions();
    expect(api.getVersionCredits).not.toHaveBeenCalled();
  });
});

describe('失败与竞态', () => {
  test('端点报错 → 版本照常渲染、不弹 Toast、不抛出', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1)], total: 1 });
    api.getVersionCredits.mockRejectedValue(new PgcError('UPSTREAM', '上游失败', 502));
    await useStore.getState().loadVersions();
    await vi.waitFor(() => expect(api.getVersionCredits).toHaveBeenCalledTimes(1));
    expect(useStore.getState().versions.map((v) => v.id)).toEqual(['v1']);
    expect(creditsOf('v1')).toBeUndefined();
    expect(useStore.getState().toast).toBeNull();
  });

  // 评审 I2:此前这条在切项目后把 versions 置空,map 作用在空数组上 —— 删掉 pid 校验也全绿。
  // 而 version_id 是项目内序号('v1'/'v2'),跨项目**必然撞 id**,那才是守卫存在的理由。
  // 故新项目给一组同名 id 的版本,断言 A 的数字不落到 B 的同名行上。
  test('在飞期间切项目 → 数字不落到新项目的同名版本上', async () => {
    const rowV1 = {
      id: 'v1', index: 1, label: 'V1', status: 'ready' as const, summary: '', createdAt: '', current: true,
      assetKeys: [], game: { title: '', palette: '' },
    };
    useStore.setState({ currentProjectId: 42, versions: [rowV1] });
    let release: (v: unknown) => void = () => {};
    api.getVersionCredits.mockReturnValue(new Promise((res) => { release = res; }));
    const p = useStore.getState().loadVersionCredits();
    // 响应回来之前切走:新项目也有一个 id 为 'v1' 的版本(项目内序号,跨项目撞名是常态)
    useStore.setState({ currentProjectId: 7, versions: [rowV1] });
    release({ items: [{ version_id: 'v1', total_credits: 300 }], notes: [] });
    await p;
    expect(creditsOf('v1')).toBeUndefined();
  });

  // 评审 I1:在飞守卫无 pid 无排队,后来者直接丢弃。本 action 的触发是**一次性事件**
  // (某版本定稿),吞掉即永久丢失 —— 与 pollVersions「每 2.5s 必再跑」的语义不同。
  test('在飞期间又有新版本定稿 → 第二次触发不得被吞', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1), ver('v2', 2, 'building')], total: 2 });
    let release: (v: unknown) => void = () => {};
    api.getVersionCredits.mockReturnValueOnce(new Promise((res) => { release = res; }));
    await useStore.getState().loadVersions();
    expect(api.getVersionCredits).toHaveBeenCalledTimes(1);

    // 第一次还在飞,v2 已定稿(轮询 2.5s 一跳,上游自带 5s 预算,这个窗口是常态)
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1), ver('v2', 2)], total: 2 });
    api.getVersionCredits.mockResolvedValue({
      items: [{ version_id: 'v1', total_credits: 300 }, { version_id: 'v2', total_credits: 120 }],
      notes: [],
    });
    await useStore.getState().loadVersions();
    release({ items: [{ version_id: 'v1', total_credits: 300 }], notes: [] });
    await vi.waitFor(() => expect(creditsOf('v2')).toBe(120));
  });

  test('在飞期间切项目 → 旧项目的在飞不拦住新项目的拉取', async () => {
    useStore.setState({ currentProjectId: 42 });
    let release: (v: unknown) => void = () => {};
    api.getVersionCredits.mockReturnValueOnce(new Promise((res) => { release = res; }));
    void useStore.getState().loadVersionCredits();
    expect(api.getVersionCredits).toHaveBeenCalledTimes(1);

    useStore.setState({ currentProjectId: 7 });
    api.listVersions.mockResolvedValue({ items: [ver('v1', 1)], total: 1 });
    api.getVersionCredits.mockResolvedValue({ items: [{ version_id: 'v1', total_credits: 88 }], notes: [] });
    await useStore.getState().loadVersions();
    release({ items: [], notes: [] });
    await vi.waitFor(() => expect(creditsOf('v1')).toBe(88));
  });
});
