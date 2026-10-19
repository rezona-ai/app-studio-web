'use client';
import { useSyncExternalStore } from 'react';

// 主题由主站写入 <html data-theme>:首屏由 layout.tsx 内联脚本读 localStorage 设置;
// 运行期由主站经 postMessage 下发,useHostConfig 更新 data-theme(见 src/client/useHostConfig.ts)。
// 本 hook 监听 data-theme 变更,组件据此挑选明 / 暗样式分支并自动重渲染。
// SSR 与首帧均按默认深色渲染,挂载后读取真实 data-theme;用 useSyncExternalStore
// 保证 SSR 安全(服务端取 server 快照,水合后再切到客户端真实值,不报 hydration mismatch)。
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
};
const getSnapshot = () => document.documentElement.dataset.theme !== 'light';
const getServerSnapshot = () => true; // 服务端 / 首帧默认深色

export function useIsDark() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
