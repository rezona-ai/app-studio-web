// 低余额弹窗的频控状态机(纯函数):同一低余额区间只弹一次,余额回升才解锁。
// 调用点是 store 的 refreshBalance 写入处——消耗后余额的唯一漏斗(三个生成漏斗都汇入它),
// 故不在各 generate* action 里各撒一份判定。冷启动的 loadUserInfo 不接判定:
// 触发条件是「上一次生成后」,刚进页面就弹不符合口径(见 spec 约束 2/3)。

// 触发阈值:产品口径「上一次生成后剩余积分小于 20」。后端无下发字段,故为前端常量。
export const LOW_BALANCE_THRESHOLD = 20;

export interface LowBalanceState {
  locked: boolean;      // 已弹过、等余额回升解锁;**持久化**,刷新页面不重弹
  shouldOpen: boolean;  // 本次是否要弹
}

// 判据用 balance(与账户条展示同源)。不用 spendable:在途生成的 held 会在提交瞬间把它压低,
// 而那笔额度还没真正消耗掉,会误判成低余额。
export function nextLowBalanceState(balance: number | null | undefined, locked: boolean): LowBalanceState {
  // 余额未知(拉取失败保留旧值 / 首次未就绪):不动锁、不弹
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return { locked, shouldOpen: false };
  if (balance >= LOW_BALANCE_THRESHOLD) return { locked: false, shouldOpen: false };
  return locked ? { locked: true, shouldOpen: false } : { locked: true, shouldOpen: true };
}

// 上面那台状态机的「只解锁」分支,给**非终态**的回血路径用(充值 / 订阅成功后的 loadUserInfo、
// 在途兜底 tick):这些路径不是「上一次生成之后」,既不能弹也不能上锁(上锁会让终态那次不再弹,
// 提示永久丢失),但解锁必须照做——否则「回血后又跌破」这个新区间会被旧锁一直吃掉。
// 返回下一个 locked 值。
export function unlockedByBalance(balance: number | null | undefined, locked: boolean): boolean {
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return locked;
  return balance >= LOW_BALANCE_THRESHOLD ? false : locked;
}
