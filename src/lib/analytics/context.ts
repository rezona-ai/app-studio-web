// GA4 公共参数上下文:页面来源 / 项目 / 用户身份。
// fromPage 会话内锁定（初载或用户主动登入/登出时调 initFromPage），后续埋点复用。

import { useStore } from '@/store';
import { resolveGa4, type Ga4Env } from './config';

// 模块级状态:会话期间锁定
let fromPage = 'direct';

/**
 * 公共参数接口——GA4 事件上下文
 */
export interface CommonParams {
  product: 'gamestudio';
  env: Ga4Env;
  page_name: 'editor';
  from_page: string;
  is_login: 0 | 1;
  user_id?: number;
}

/**
 * 纯函数：解析 ?from_page 参数。
 * 仅从 search 读取，不涉及任何模块状态。
 * 缺失/空 → 'direct'
 */
export function parseFromPage(search: string): string {
  const v = new URLSearchParams(search).get('from_page');
  return v && v.trim() ? v.trim() : 'direct';
}

/**
 * 初始化模块级 fromPage（会话锁定）。
 * 页面首载 / 用户登入登出时调一次，后续埋点复用。
 */
export function initFromPage(search: string): void {
  fromPage = parseFromPage(search);
}

/**
 * 根据 currentProjectId 查 projects 返回 public_id，
 * 不存在/未初始化时 undefined
 */
export function projectPublicId(): string | undefined {
  const state = useStore.getState();
  if (state.currentProjectId === null) return undefined;
  const project = state.projects.find((p) => p.id === state.currentProjectId);
  return project?.public_id;
}

/**
 * 返回 GA4 6 个公共参数。
 * user_id 仅当登录时加入对象（游客不含该键）。
 */
export function getCommonParams(): CommonParams {
  const state = useStore.getState();
  const ga4 = resolveGa4();
  const isLogin = state.userInfo ? 1 : 0;

  const params: CommonParams = {
    product: 'gamestudio',
    env: ga4.env,
    page_name: 'editor',
    from_page: fromPage,
    is_login: isLogin,
  };

  // 仅当登录时加入 user_id
  if (state.userInfo) {
    params.user_id = state.userInfo.id;
  }

  return params;
}
