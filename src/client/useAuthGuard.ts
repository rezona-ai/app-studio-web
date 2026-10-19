'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isLocalhost, buildSignInUrl } from '@/lib/auth';

// 监听未登录标志,非 localhost 环境整页跳转到 sign-in(登录后回跳原页面)。
// 决策逻辑全在 lib/auth(可单测),此处仅做副作用胶水。挂在 Workspace,故 gate 仅作用于工作台页(根路由)。
export function useAuthGuard(): void {
  const authRequired = useStore((s) => s.authRequired);
  const clearAuthRequired = useStore((s) => s.clearAuthRequired);
  const setWarning = useStore((s) => s.setWarning);
  const fired = useRef(false);
  useEffect(() => {
    if (!authRequired || fired.current) return;
    const { hostname, origin, href } = window.location;
    if (isLocalhost(hostname)) {
      // 本地靠 DEV_COOKIE 鉴权,不跳转(跳了也因 cookie 跨域死循环);清标志撤加载层,改弹非报错口吻的 warning 引导更新 DEV_COOKIE
      clearAuthRequired();
      setWarning({ code: 'AUTH', message: '本地未鉴权,请更新 DEV_COOKIE 后刷新' });
      return;
    }
    fired.current = true;                // 防重复跳转
    window.location.assign(buildSignInUrl(origin, href));
  }, [authRequired, clearAuthRequired, setWarning]);
}
