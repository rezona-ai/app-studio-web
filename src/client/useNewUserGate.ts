'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { pgcApi } from '@/lib/pgc/client';
import { useSubscriptionPlans } from '@/client/useSubscriptionPlans';
import { BASE_MODEL } from '@/lib/subscription/model-gate';
import { selectModelGateLocked } from '@/store/selectors';
import type { KoubouClient } from '@/koubou/client';

// 新用户模型门禁的取数与归位(spec 2026-08-28-new-user-model-gate-design)。
// 判据本身是纯函数(lib/subscription/model-gate.ts),归位是 store 写入口的不变式,
// 这里只管副作用:何时拉、何时重拉、以及**给已建立的会话补一条 set_model**。
//
// 失败一律置 null(未知 = 放行):接口的三个 503 是「暂时不知道」,当成新用户会把老用户误锁到只剩 Rez1。
export function useNewUserGate(client: React.RefObject<KoubouClient | null>) {
  const isNew = useStore((s) => s.newUserStatus);
  const plansCache = useStore((s) => s.plansCache);
  const models = useStore((s) => s.availableModels);
  const selected = useStore((s) => s.selectedModel);
  const pid = useStore((s) => s.currentProjectId);
  const sessionId = useStore((s) => s.sessionId);
  const connStatus = useStore((s) => s.connStatus);
  // 只有可能被锁的人才需要档位:非新用户根本不看 tier,省一次请求
  useSubscriptionPlans(isNew === true);

  // 最后一次请求胜出:挂载首拉与 build 后重拉可以并发(该接口扫存储,慢是常态),
  // 若首拉的 true 晚于重拉的 false 返回,用户刚 build 完又被锁回去且不会再自愈
  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const d = await pgcApi.getNewUserStatus();
      if (seq === reqSeq.current) useStore.getState().setNewUserStatus(d.is_new_user);
    } catch {
      // 判不出来 = 未知,回落放行(不得当成新用户)
      if (seq === reqSeq.current) useStore.getState().setNewUserStatus(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // build 出新版本那一刻用户就不再是新用户 —— 重拉一次当场解锁,不必刷新页面。
  // 只在当前判定为新用户时重拉:老用户重拉不会改变任何结论,白打一次扫存储的请求。
  const versionCount = useStore((s) => s.versions.length);
  const prevCount = useRef(versionCount);
  useEffect(() => {
    const grew = versionCount > prevCount.current;
    prevCount.current = versionCount;
    if (grew && useStore.getState().newUserStatus === true) void load();
  }, [versionCount, load]);

  // 归位 + 纠正已建立的会话。冷启动两条链并发:门禁要两个往返才判定,建连只等 currentProjectId,
  // 常态是连接先建起来(带着 persist 里的旧模型)。建连处的 gatedModel 只在「判定已到」时有效,
  // 故判定落地后必须给在世的连接补一条 set_model,否则 UI 归位了而会话仍跑在别家模型上。
  // 依赖含 selectedModel / currentProjectId:切项目会从 modelByProject 取回记忆、
  // 服务端 model.changed 也会回写,两者都能把归位后的值改掉。
  const correctedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectModelGateLocked(useStore.getState())) return;
    if (selected !== BASE_MODEL) useStore.getState().setSelectedModel(BASE_MODEL);
    // 每条会话只纠正一次:命令在 socket open 前会被 client 积压、open 后冲刷,
    // 故不必等 connStatus === 'open';但 connStatus 要进依赖 —— 判定先于建连时 client.current 还是 null
    const key = `${pid}|${sessionId}`;
    if (!client.current || correctedFor.current === key) return;
    client.current.setModel(BASE_MODEL);
    correctedFor.current = key;
  }, [isNew, plansCache, models, selected, pid, sessionId, connStatus, client]);
}
