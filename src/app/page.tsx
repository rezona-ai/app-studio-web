import { headers } from 'next/headers';
import { isMobileUA } from '@/lib/mobile-ua';
import MobileBlockPage from '@/components/workspace/MobileBlockPage';
import WorkspaceEntry from '@/components/workspace/WorkspaceEntry';

// 工作台即应用入口(landing 由主站提供)。server 侧按 UA 分发:移动端(含平板)硬拦截,
// 完全不下发工作台(不建 WS/轮询);桌面渲染三栏工作台(原客户端入口平移至 WorkspaceEntry,
// 外部 ?remix=/prelude 参仍由其内 useProjectBootstrap 挂载时分发)。
export default async function Page() {
  const ua = (await headers()).get('user-agent') ?? '';
  if (isMobileUA(ua)) return <MobileBlockPage />;
  return <WorkspaceEntry />;
}
