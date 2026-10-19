'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import {
  parseStudioPrelude, parseRemixSource, parseShareSource, parseHandoffId, handoffStorageKey, parseHandoffPayload,
} from '@/lib/studio-prelude';
import { parseReplayTemplate } from '@/lib/project-url';

// 挂载时六选一,按优先级顺序判断(回放最高):① ?replay_template=(landing onboarding 回放跳转)→ 进入即回放;
// ② ?share=<public_id>(分享工作台 fork 跳转:含对话完整可写副本)→ 进入即三步 fork;
// ③ ?remix=<public_id>(外部页 fork 跳转:只读单版本)→ 进入即 fork;④ ?handoff=<id>(超长 prelude 经 sessionStorage)→ 新建预填;
// ⑤ prelude(URL query 模型/提示词/资产)→ 新建预填;⑥ 否则拉项目列表选定当前项目。
// 各入口只带各自专属 query 参数,理论不会同时出现,判断顺序仅为兜底防御。**share 刻意排在 remix 之前**:
// 二者若共存(如手拼链接),share 语义更强(整份含对话工作台)故优先,remix 被忽略(见对应测试)。自动登录由服务端代理处理。
export function useProjectBootstrap() {
  const loadProjects = useStore((s) => s.loadProjects);
  const applyStudioPrelude = useStore((s) => s.applyStudioPrelude);
  const applyStudioRemix = useStore((s) => s.applyStudioRemix);
  const applyWorkbenchShare = useStore((s) => s.applyWorkbenchShare);
  const enterReplay = useStore((s) => s.enterReplay);
  const ran = useRef(false);
  useEffect(() => {
    // StrictMode 双挂载 / 重复 bootstrap 下只跑一次(remix/prelude 会新建项目,绝不可重复执行);
    // ran 在 effect 内置位(非渲染期),符合仓库 hooks 约束
    if (ran.current) return;
    ran.current = true;
    // 回放 onboarding 入口最优先:landing 带 ?replay_template= 跳进来 → 进入即回放(enterReplay 内幂等 start)
    const replayTemplate = parseReplayTemplate(window.location.search);
    if (replayTemplate) { void enterReplay(replayTemplate); return; }
    // 分享工作台先于 remix:share 是含对话的完整可写 fork,语义强于 remix 的只读单版本;共存时 share 胜出
    const share = parseShareSource(window.location.search);
    if (share) { void applyWorkbenchShare(share); return; } // 进入即三步 fork(成功后剥 ?share=,刷新不重复 fork)
    const remix = parseRemixSource(window.location.search);
    if (remix) { void applyStudioRemix(remix); return; } // 进入即 fork(成功后剥 URL,刷新不再重复 fork)
    // 超长 prelude 走 sessionStorage handoff 线(URL 只带 id);读后立即删 key 一次性消费,
    // 防刷新重复新建项目(applyStudioPrelude 成功后 URL 全量重写为 ?project=,handoff 参数随之剥离)
    const handoffId = parseHandoffId(window.location.search);
    if (handoffId) {
      let raw: string | null = null;
      try {
        const key = handoffStorageKey(handoffId);
        raw = window.sessionStorage.getItem(key);
        window.sessionStorage.removeItem(key);
      } catch { /* sessionStorage 不可用(隐私模式等):按无载荷回落 */ }
      const p = parseHandoffPayload(raw);
      if (p) { void applyStudioPrelude(p); return; }
      // key 缺失/载荷非法(如刷新后已被消费):回落项目列表
      void loadProjects();
      return;
    }
    const prelude = parseStudioPrelude(window.location.search);
    if (prelude) void applyStudioPrelude(prelude);
    else void loadProjects();
  }, [loadProjects, applyStudioPrelude, applyStudioRemix, applyWorkbenchShare, enterReplay]);
}
