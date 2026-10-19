'use client';
import { useCallback, useState } from 'react';
import { useStore } from '@/store';
import { isBaseGenKind, isDerivedGenKind } from '@/store/types';
import { useVisibilityGatedInterval } from './useVisibilityGatedInterval';

const GEN_INTERVAL = 10000;    // 视频/普通 3D 异步生成任务轮询(后端生成较慢,放宽到 10s)
const DERIVED_3D_INTERVAL = 3000; // 绑骨/重纹理契约建议 3s，缩短两阶段绑骨完成后的可见延迟
const VERSION_INTERVAL = 2500; // 版本构建轮询(预览就绪需较快响应)
// 构建中的版本轮询封顶:到点只停轮,不改版本状态、不删任何东西 —— 后端可能仍在跑,
// 前端自作主张标失败等于丢掉用户已付费的产物(同「孤儿任务不删服务端 item」)。见 spec 2026-08-31。
// 计**次**而非计时:间隔固定,两者等价,而 Date.now() 属不纯调用(react-hooks/purity 禁在渲染期用)。
// 附带收益是后台标签页不计次 —— 封顶口径变成「5 分钟的有效轮询」而非墙钟,更贴合本意。
const VERSION_POLL_MAX_TICKS = (5 * 60_000) / VERSION_INTERVAL;

// 存在生成中任务或构建中版本时,定时推进轮询(两者分用独立间隔)。
// 原名 useCanvasPolling,画布退役第一阶段被误当作「只服务画布」删掉;实际 agent 在对话里登记的
// 生成任务与版本构建(status:'building')都只靠它推进,故第二阶段原样恢复(spec 2026-10-19 phase2 计划 T1)
export function useAssetPolling() {
  // 两个谓词是**补集**关系且同出一处(store/types):新增一种 GenTaskKind 不改这里也会被基础档接住。
  // 曾经这里各自枚举 kind,加 audio 时漏改,音频任务登记了却没有 interval 会起来 —— GET 一次不发。
  const baseGenCount = useStore((s) => s.genTasks.filter((task) => isBaseGenKind(task.kind)).length);
  const derived3dCount = useStore((s) => s.genTasks.filter((task) => isDerivedGenKind(task.kind)).length);
  // listVersions 会返回构建中的版本(status:'building'、created_at 为空),轮询据此驱动。
  // 取的是**非 ready 行的身份集合**而非布尔:只用布尔的话,一条永远不 ready 的行(后端构建挂死,
  // 或 spec 风险节承认的第三种 status 值)会让 key 恒定、封顶计数永久卡死,此后该项目里
  // **每一次新构建都不再被轮询** —— 等于本缺陷换个前提复发,且更隐蔽。按 id 集合分辨则
  // 新出现的构建中行自带新 key,重新获得一轮额度,卡死的老行不再阻断它。
  // 字符串选择器,versions 换引用但集合不变时不触发重渲染。
  const unreadyKey = useStore((s) => s.versions.filter((v) => v.status !== 'ready').map((v) => v.id).sort().join(','));
  const hasUnreadyVersion = unreadyKey !== '';
  const pid = useStore((s) => s.currentProjectId);
  const pollGenTasks = useStore((s) => s.pollGenTasks);
  const pollVersions = useStore((s) => s.pollVersions);

  // 封顶计次归本 hook 所有:门控语义本就在这儿,放 actions 闭包只能让 pollVersions 空转,
  // interval 仍每 2.5s 触发一次再原地返回,等于没停。
  // 「出现非 ready 行」与「切项目」是仅有的两个重新计次的转折点,用 key 表达;
  // 走 React 官方的"渲染期调整 state"而非 effect —— effect 里 setState 会触发级联渲染(eslint 亦禁)。
  const versionPollKey = `${pid}|${unreadyKey}`;
  const [versionPoll, setVersionPoll] = useState<{ key: string; ticks: number }>(
    () => ({ key: versionPollKey, ticks: 0 }),
  );
  if (versionPoll.key !== versionPollKey) setVersionPoll({ key: versionPollKey, ticks: 0 });
  const versionPollCapped = versionPoll.ticks >= VERSION_POLL_MAX_TICKS;

  // tick 引用要稳定(是 effect 依赖);tick 时再读一次 store 现值,防 interval 存活期内任务已清空
  const tickBaseGen = useCallback(() => {
    if (useStore.getState().genTasks.some((task) => isBaseGenKind(task.kind))) void pollGenTasks('base');
  }, [pollGenTasks]);
  const tickDerived3d = useCallback(() => {
    if (useStore.getState().genTasks.some((task) => isDerivedGenKind(task.kind))) void pollGenTasks('derived');
  }, [pollGenTasks]);
  const tickVersions = useCallback(() => {
    if (!useStore.getState().versions.some((v) => v.status !== 'ready')) return;
    setVersionPoll((p) => ({ ...p, ticks: p.ticks + 1 }));   // 计满即由上面的 capped 拆掉 interval
    void pollVersions();
  }, [pollVersions]);

  useVisibilityGatedInterval(baseGenCount > 0, GEN_INTERVAL, tickBaseGen);
  useVisibilityGatedInterval(derived3dCount > 0, DERIVED_3D_INTERVAL, tickDerived3d);
  useVisibilityGatedInterval(hasUnreadyVersion && !versionPollCapped, VERSION_INTERVAL, tickVersions);
}
