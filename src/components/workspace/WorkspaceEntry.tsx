'use client';
import { useSyncExternalStore } from 'react';
import Workspace from '@/components/workspace/Workspace';
import I18nProvider from '@/components/i18n/I18nProvider';
import MobileBlockPage from '@/components/workspace/MobileBlockPage';

// iPadOS Safari 默认伪装桌面 Mac UA,server 侧 isMobileUA 放行——在此客户端补判。
// 用 useSyncExternalStore:server/水合快照恒 false(与 SSR 首帧一致,不触发 hydration
// mismatch——本项目 mismatch 会整树重渲抹掉 <html data-theme>),真 iPad 上水合后切拦截页。
const subscribeNoop = () => () => {};
const isIpadOs = () => navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent);

export default function WorkspaceEntry() {
  const blocked = useSyncExternalStore(subscribeNoop, isIpadOs, () => false);
  if (blocked) return <MobileBlockPage />;
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  );
}
