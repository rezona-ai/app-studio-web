'use client';
import { useEffect } from 'react';
import { parseHostConfig } from '@/lib/host-config';
import { changeLanguageWithLoad } from '@/i18n';
import { normalizeLocale } from '@/i18n/config';

// 监听主站经 postMessage 下发的配置帧(rezonalab-config),实时把主题 / 语言应用到 <html>。
// 分站默认不回写 localStorage —— rezonalab-config 由主站管理(刷新后由防白闪脚本读取);
// 唯一例外是用户主动切换语言(见 LanguageMenu),此时合并写 lang。
// 仅在值变化时写 DOM,避免无谓 mutation 触发 useIsDark 的 MutationObserver 空转。
export function useHostConfig() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        const config = parseHostConfig(e.data, e.origin, window.location.origin);
        if (!config) return;
        const root = document.documentElement;
        if (root.dataset.theme !== config.theme) root.dataset.theme = config.theme;
        if (config.lang && root.lang !== config.lang) {
          root.lang = config.lang;
          void changeLanguageWithLoad(normalizeLocale(config.lang)); // 词典按需加载后切换 → react-i18next 自动重渲
        }
      } catch {
        // 非法帧跳过(沿用"非法 WS 帧 try/catch 跳过"哲学)
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
}
