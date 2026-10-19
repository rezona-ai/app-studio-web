import type { RemixPolicyData } from './pgc/types';

// Remix 开关的可用性判据(纯函数,不碰 store / 网络)。判据集中在这一处:
// 组件里散着写 `status === 'ready'` 与版本比对,迟早两处口径打架(重试判据 retryRouteFor 已教过一次)。
//
// reason 的用途是「为什么不能动」的文案键:
//   loading      首次 GET 未回,后端事实未知,不许下判断
//   unavailable  GET 失败 / 缺当前版本 id —— 不假装是「关」的可拨状态
//   notBuilt     当前版本未 build,开不了(后端会 409 REMIX_SOURCE_NOT_READY);
//                注意它**只挡开不挡关**:已开放的项目不能因当前停在 building 版本就锁死关不掉
export type RemixToggleReason = 'loading' | 'unavailable' | 'notBuilt';

export interface RemixToggleState {
  checked: boolean;
  disabled: boolean;
  reason: RemixToggleReason | null;
  // 已开启但策略绑在别的版本时,给出那个版本号供提示。改绑靠用户先关再开,不隐式改绑
  // (打开弹窗看一眼就改掉对外策略是不可接受的副作用,见设计稿 2026-08-28-share-remix-toggle)
  boundElsewhere: string | null;
}

export function remixToggleState({
  policy, pending, activeVersionId, activeStatus, loading,
}: {
  policy: RemixPolicyData | null;
  pending: boolean | null;       // 非 null = 有 PATCH 在飞,值即乐观目标态
  activeVersionId: string | null;
  activeStatus: string | null;
  loading: boolean;
}): RemixToggleState {
  if (loading) return { checked: false, disabled: true, reason: 'loading', boundElsewhere: null };
  if (!policy) return { checked: false, disabled: true, reason: 'unavailable', boundElsewhere: null };

  // 在飞期间显示乐观目标态并禁用:连点会重复 PATCH,且「拨开」这一发正是要绑到当前版本,
  // 此时不该再提示旧策略绑在别处
  if (pending != null) return { checked: pending, disabled: true, reason: null, boundElsewhere: null };

  const checked = policy.enabled;
  // 拨开的前置条件只在「当前是关」时校验 —— 拨关无版本要求
  if (!checked) {
    if (!activeVersionId) return { checked, disabled: true, reason: 'unavailable', boundElsewhere: null };
    if (activeStatus !== 'ready') return { checked, disabled: true, reason: 'notBuilt', boundElsewhere: null };
  }
  const bound = policy.source_version_id;
  return {
    checked,
    disabled: false,
    reason: null,
    boundElsewhere: checked && bound && bound !== activeVersionId ? bound : null,
  };
}
