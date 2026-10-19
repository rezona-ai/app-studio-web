import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// getBalance 是本文件的主角;updateCanvasReference 是落位后的 fire-and-forget 回写,不 mock 会打真实网络
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      ...actual.pgcApi,
      getBalance: vi.fn(), getCurrentUser: vi.fn(), updateCanvasReference: vi.fn(),
    },
  };
});

import { useStore } from './index';
import { pgcApi } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const getBalance = pgcApi.getBalance as ReturnType<typeof vi.fn>;
const bal = (balance: number) => ({ balance, held: 0, spendable: balance });
const USER = { id: 7, username: 'nick' };
// 终态刷新(生成真的结束了)才允许开窗;省略入参即非终态,保证新调用点默认不弹
const terminal = { terminal: true };

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    userInfo: USER,
  } as never);
  getBalance.mockReset();
  (pgcApi.getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(USER);
  (pgcApi.updateCanvasReference as ReturnType<typeof vi.fn>).mockResolvedValue({});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('低余额升购弹窗(挂在 refreshBalance 这个唯一漏斗上)', () => {
  test('终态刷新首次跌破阈值:弹 lowBalance 并按用户上锁', async () => {
    getBalance.mockResolvedValue(bal(19));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
    expect(useStore.getState().lowBalanceLockedUserId).toBe(USER.id);
    // 余额侧触发拿不到资产类型,进度卡退化成纯余额行
    expect(useStore.getState().creditModalKind).toBeNull();
  });

  test('已上锁:再生成不再弹(同一低余额区间只弹一次)', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(5));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe(false);
    expect(useStore.getState().lowBalanceLockedUserId).toBe(USER.id);
  });

  test('余额回升到阈值即解锁,解锁那一刻不弹;再跌破重新弹', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(5000));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().lowBalanceLockedUserId).toBeNull();
    expect(useStore.getState().creditModalOpen).toBe(false);

    getBalance.mockResolvedValue(bal(3));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
  });

  // 终审 I6:兜底 tick 在 run 进行中每 15s 跑一次,不能把弹窗盖在进行中的生成上
  test('非终态刷新(在途兜底 tick)只更余额:不弹,**也不推进锁**', async () => {
    getBalance.mockResolvedValue(bal(3));
    await useStore.getState().refreshBalance();
    expect(useStore.getState().credit).toEqual(bal(3));
    expect(useStore.getState().creditModalOpen).toBe(false);
    // 锁若在这里被推进,run 结束后的终态刷新会看到已上锁 → 这次提示永久丢失
    expect(useStore.getState().lowBalanceLockedUserId).toBeNull();
  });

  test('run 中途跌破 → 兜底 tick 不弹;run 结束的终态刷新补上这次提示', async () => {
    getBalance.mockResolvedValue(bal(3));
    await useStore.getState().refreshBalance();            // 在途 tick
    expect(useStore.getState().creditModalOpen).toBe(false);
    await useStore.getState().refreshBalance(terminal);    // run.finished
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
  });

  // 终审自查:锁没绑用户时会被上一个账号带给下一个账号
  test('锁按用户存:换账号后新用户仍能弹(即便新用户余额同样低)', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(4));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe(false);   // 老用户仍被锁

    useStore.setState({ userInfo: { id: 99, username: 'other' }, creditModalOpen: false } as never);
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
    expect(useStore.getState().lowBalanceLockedUserId).toBe(99);
  });

  test('用户未知(userInfo 未就绪):只更余额,不弹不动锁', async () => {
    useStore.setState({ userInfo: null } as never);
    getBalance.mockResolvedValue(bal(1));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().credit).toEqual(bal(1));
    expect(useStore.getState().creditModalOpen).toBe(false);
    expect(useStore.getState().lowBalanceLockedUserId).toBeNull();
  });

  test('已有升购弹窗或充值弹窗开着时不抢(同为 z-40,会叠窗)', async () => {
    useStore.setState({ creditModalOpen: 'insufficient', creditModalKind: '3d' } as never);
    getBalance.mockResolvedValue(bal(2));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe('insufficient');
    expect(useStore.getState().creditModalKind).toBe('3d');
    expect(useStore.getState().lowBalanceLockedUserId).toBe(USER.id);   // 这次低余额已被看到,锁照常推进

    useStore.setState({ creditModalOpen: false, lowBalanceLockedUserId: null, topupModalOpen: true } as never);
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().creditModalOpen).toBe(false);
  });

  test('余额拉取失败:保留旧值、不动锁、不弹', async () => {
    useStore.setState({ credit: bal(100) } as never);
    getBalance.mockRejectedValue(new Error('net'));
    await useStore.getState().refreshBalance(terminal);
    expect(useStore.getState().credit).toEqual(bal(100));
    expect(useStore.getState().lowBalanceLockedUserId).toBeNull();
    expect(useStore.getState().creditModalOpen).toBe(false);
  });
});

// 解锁的口径与上锁不同:上锁只能发生在终态(否则吃掉提示),但**解锁必须在任何拿到
// 新余额的路径上都发生**——回血走的是充值 / 订阅成功后的 loadUserInfo 与在途兜底 tick,
// 都不经终态判定;不在那里解锁的话,「回血后又跌破」这个新区间会被旧锁永久吃掉。
describe('回血解锁:不限于终态刷新', () => {
  test('充值/订阅成功后的 loadUserInfo 拿到回升的余额:解锁,且不弹', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(500));

    await useStore.getState().loadUserInfo();

    expect(useStore.getState().lowBalanceLockedUserId).toBeNull();
    expect(useStore.getState().creditModalOpen).toBe(false);
  });

  test('回血后又跌破:新的低余额区间照常弹(此前被旧锁吃掉)', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(25));
    await useStore.getState().loadUserInfo();          // 小额充值回到阈值以上

    getBalance.mockResolvedValue(bal(17));
    await useStore.getState().refreshBalance(terminal); // 下一次生成又跌破
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
  });

  test('在途兜底 tick 拿到回升的余额也解锁(仍不弹、不上锁)', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(500));
    await useStore.getState().refreshBalance();
    expect(useStore.getState().lowBalanceLockedUserId).toBeNull();
    expect(useStore.getState().creditModalOpen).toBe(false);
  });

  test('余额仍低时非终态路径不动锁(上锁只能在终态发生)', async () => {
    useStore.setState({ lowBalanceLockedUserId: USER.id } as never);
    getBalance.mockResolvedValue(bal(5));
    await useStore.getState().refreshBalance();
    expect(useStore.getState().lowBalanceLockedUserId).toBe(USER.id);
    await useStore.getState().loadUserInfo();
    expect(useStore.getState().lowBalanceLockedUserId).toBe(USER.id);
  });
});

// 在飞合流原本是为「多个生成几乎同时完成」省请求,但它把 opts.terminal 一并共享了:
// 非终态 tick 在飞时,生成完成的那次终态刷新会借用它的响应——而那个 GET 在生成完成前
// 就发出了,余额可能还没扣完,拿它做终态判定等于判「完成前」的旧余额。
describe('刷新合流不能吞掉终态意图', () => {
  test('非终态 tick 在飞时的终态刷新:排到它后面重发一次,用完成后的余额判定', async () => {
    let releaseTick: (v: unknown) => void = () => {};
    getBalance
      .mockReturnValueOnce(new Promise((r) => { releaseTick = r; }))   // 15s tick:生成完成前发出
      .mockResolvedValue(bal(15));                                     // 完成后重发:已扣费

    const tick = useStore.getState().refreshBalance();                 // 非终态,在飞
    const done = useStore.getState().refreshBalance(terminal);         // 生成完成,撞上在飞
    releaseTick(bal(100));                                             // tick 的响应:还没扣

    await tick;
    await done;

    expect(getBalance).toHaveBeenCalledTimes(2);
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
    expect(useStore.getState().lowBalanceLockedUserId).toBe(USER.id);
  });

  test('多个生成同时完成(都是终态)仍合流成一次请求', async () => {
    getBalance.mockResolvedValue(bal(15));
    const a = useStore.getState().refreshBalance(terminal);
    const b = useStore.getState().refreshBalance(terminal);
    await Promise.all([a, b]);
    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(useStore.getState().creditModalOpen).toBe('lowBalance');
  });
});

describe('升购弹窗开关', () => {
  test('关闭时一并清掉资产类型与 all-plans(下次打开不沿用上一次的类型)', () => {
    useStore.setState({ creditModalOpen: 'insufficient', creditModalKind: 'video', allPlansOpen: true } as never);
    useStore.getState().setCreditModalOpen(false);
    expect(useStore.getState().creditModalOpen).toBe(false);
    expect(useStore.getState().creditModalKind).toBeNull();
    expect(useStore.getState().allPlansOpen).toBe(false);
  });

  test('打开时带上资产类型;不传即 null', () => {
    useStore.getState().setCreditModalOpen('insufficient', '3d');
    expect(useStore.getState().creditModalKind).toBe('3d');
    useStore.getState().setCreditModalOpen('lowBalance');
    expect(useStore.getState().creditModalKind).toBeNull();
  });
});
