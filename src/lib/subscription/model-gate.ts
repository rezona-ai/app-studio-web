// 新用户模型门禁的纯判据(无副作用,见 spec 2026-08-28-new-user-model-gate-design)。
// 锁定 = 后端判定的新用户 + 未订阅(free) + 列表里确有自研模型;三项任一未知一律放行。
import type { CurrentTier } from '@/lib/biz/types';

// 自研模型 ID:后端下发的 ID 就是展示名,大小写敏感(与 lib/koubou/models.ts 的 KNOWN_MODELS 同源)
export const BASE_MODEL = 'Rez1';

export interface ModelGateInput {
  isNewUser: boolean | null;   // null = 未知(接口 503 / 未拉到)
  tier: CurrentTier | null;    // null = 套餐配置还没到
  models: string[];            // 当前 backend 的可用模型列表
}

export function modelGateLocked({ isNewUser, tier, models }: ModelGateInput): boolean {
  // 未知一律放行:两个 503 是「暂时不知道」,当成新用户会把老用户误锁到只剩 Rez1(比漏放糟得多)
  if (isNewUser !== true || tier !== 'free') return false;
  // 后端没下发自研模型时锁死等于无模型可用,此时放行
  return models.includes(BASE_MODEL);
}

// 建连、归位与各写入口共用:锁定态下选中模型恒是 Rez1
export function gatedModel(model: string | null, locked: boolean): string | null {
  return locked ? BASE_MODEL : model;
}

// 刻意**没有**「free 档用着付费模型 → 拦」这类判据:模型选择对非新用户一律开放
// (本文件的 modelGateLocked 只锁从未 build 过版本的新用户,后端也不强制),
// 消费闸门是积分而非订阅档位。曾实现过一版按档位拦的,已整块删除 ——
// 理由见 spec 2026-09-11-session-model-adopt-design「场景 2 为何删除」,勿重新引入。
