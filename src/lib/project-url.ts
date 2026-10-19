// 页签与项目绑定:当前项目 public_id 以 ?project=<public_id> 形式存在本页签 URL 中,
// 多页签互不干扰;只动 query 不动 pathname,天然兼容部署 basePath(/game)。

// 解析 search 串中的 project 参数;作为 opaque token 返回:
// 既容 public_id(纯字母),也容旧数值链(?project=73)兼容期访问。非法 token 返回 null。
export function readProjectIdFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('project');
  if (raw == null || !/^[A-Za-z0-9]+$/.test(raw)) return null;
  return raw;
}

// 返回更新(或 id 为 null 时移除)project 参数后的 search 串;保留其他参数
export function withProjectParam(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id == null) params.delete('project');
  else params.set('project', id);
  const s = params.toString();
  return s ? `?${s}` : '';
}

// 薄副作用包装:把项目 public_id 写回本页签 URL(replaceState 不产生历史记录);非浏览器环境 no-op
export function syncProjectToUrl(id: string | null): void {
  if (typeof window === 'undefined') return;
  const next = withProjectParam(window.location.search, id);
  if (next === window.location.search) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
}

// 回放 onboarding 入口:landing 带 ?replay_template=<template_id> 跳进 workspace。
// 作 opaque token 返回,空/缺省 null(空串视为缺省)
export function parseReplayTemplate(search: string): string | null {
  const v = new URLSearchParams(search).get('replay_template');
  return v && v.trim() ? v : null;
}

// 回放结束/完成态进入时剥掉 replay_template 参(保留 project 等其他参),避免刷新重进回放路由;非浏览器 no-op
export function stripReplayTemplateFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('replay_template')) return;
  params.delete('replay_template');
  const s = params.toString();
  const next = s ? `?${s}` : '';
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
}
