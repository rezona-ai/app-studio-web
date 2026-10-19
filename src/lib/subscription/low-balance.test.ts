import { describe, it, expect } from 'vitest';
import { nextLowBalanceState, unlockedByBalance, LOW_BALANCE_THRESHOLD } from './low-balance';

describe('nextLowBalanceState(低余额弹窗频控状态机)', () => {
  it('阈值是 20(前端常量,后端无下发字段)', () => {
    expect(LOW_BALANCE_THRESHOLD).toBe(20);
  });

  it('首次跌破阈值:弹一次并上锁', () => {
    expect(nextLowBalanceState(19, false)).toEqual({ locked: true, shouldOpen: true });
    expect(nextLowBalanceState(0, false)).toEqual({ locked: true, shouldOpen: true });
  });

  it('已上锁期间继续生成不再弹(同一低余额区间只弹一次)', () => {
    expect(nextLowBalanceState(19, true)).toEqual({ locked: true, shouldOpen: false });
    expect(nextLowBalanceState(0, true)).toEqual({ locked: true, shouldOpen: false });
  });

  it('余额回升到阈值即解锁,且解锁那一刻不弹', () => {
    expect(nextLowBalanceState(20, true)).toEqual({ locked: false, shouldOpen: false });
    expect(nextLowBalanceState(5000, true)).toEqual({ locked: false, shouldOpen: false });
  });

  it('解锁后再次跌破会重新弹(充值/续订 → 再消耗完)', () => {
    const unlocked = nextLowBalanceState(5000, true);
    expect(nextLowBalanceState(3, unlocked.locked)).toEqual({ locked: true, shouldOpen: true });
  });

  it('余额未知(拉取失败保留旧值/首次未就绪)不动状态、不弹', () => {
    expect(nextLowBalanceState(null, false)).toEqual({ locked: false, shouldOpen: false });
    expect(nextLowBalanceState(undefined, true)).toEqual({ locked: true, shouldOpen: false });
    expect(nextLowBalanceState(Number.NaN, false)).toEqual({ locked: false, shouldOpen: false });
  });
});

// 回血路径(充值 / 订阅 / 冷启动 / 在途兜底 tick)拿到的余额不是「上一次生成之后」的,
// 不能弹也不能上锁,但必须解锁——否则「回血后又跌破」这个新区间会被旧锁吃掉。
describe('unlockedByBalance(只解锁不上锁的分支)', () => {
  it('余额回到阈值以上即解锁', () => {
    expect(unlockedByBalance(20, true)).toBe(false);
    expect(unlockedByBalance(5000, true)).toBe(false);
  });

  it('余额仍低于阈值:锁保持原样,**不**在这里上锁(上锁会吃掉终态那次提示)', () => {
    expect(unlockedByBalance(19, true)).toBe(true);
    expect(unlockedByBalance(19, false)).toBe(false);
    expect(unlockedByBalance(0, false)).toBe(false);
  });

  it('余额未知:不动锁', () => {
    expect(unlockedByBalance(null, true)).toBe(true);
    expect(unlockedByBalance(undefined, false)).toBe(false);
    expect(unlockedByBalance(Number.NaN, true)).toBe(true);
  });
});
