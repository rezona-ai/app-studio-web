'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { initFromPage } from '@/lib/analytics/context';
import { track, setUserId } from '@/lib/analytics/gtag';

// GA4 会话级副作用:① 挂载时锁定 from_page 并发一次 page_view(本站单场景 editor);
// ② 订阅 userInfo,登录/登出时同设原生 User-ID。StrictMode 双挂载 / HMR 用 ref 去重。
export function useAnalytics(): void {
  const ran = useRef(false);
  const userId = useStore((s) => s.userInfo?.id ?? null);
  const lastUid = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (ran.current) return;           // ref 在 effect 内置位(非渲染期),符合仓库 hooks 约束
    ran.current = true;
    initFromPage(window.location.search);   // 早于 useProjectBootstrap 剥 URL
    track('page_view', {});
  }, []);

  useEffect(() => {
    if (lastUid.current === userId) return;
    lastUid.current = userId;
    setUserId(userId);
  }, [userId]);
}
