// 共享 url-map 路由巡检的纯逻辑：给定一份 url-map 描述与本前端的期望，算出问题清单。
// 无副作用（不碰 gcloud、不读环境），故可完整单测；取数在 index.ts 的边界层。
//
// 为什么本仓要有自己的一份：rezona-lab-{dev,stage,prod}-urlmap 由本前端 / pgc / koubou /
// Rezona Canvas / biz-api 五方共用，`url-maps patch` 是整体替换而非合并，2026-07-29 已实发过
// 「后写入者冲掉前面所有人规则」的事故。pgc 仓的巡检只盯它自己的 /game/pgcserver，
// 本前端的 /game 不在任何人的覆盖内。自己的路由自己盯。

/** `gcloud compute url-maps describe --format=json` 的相关子集 */
export type UrlMap = {
  name: string;
  defaultService: string;
  pathMatchers: Array<{
    name: string;
    defaultService: string;
    pathRules: Array<{ paths: string[]; service: string }>;
  }>;
};

export type Expectation = {
  env: string;
  urlMap: string;
  host: string;
  pathMatcher: string;
  /** 本前端拥有的 path，必须**逐条**存在：少了裸 `/game` 会静默落到 default 后端 */
  ourPaths: string[];
  ourBackend: string;
  /** 比 `/game` 更长的前缀（pgc / koubou）。它们消失或被指向我们，流量就会被 `/game/*` 吞掉 */
  longerPrefixNeighbors: string[];
};

/** selfLink → 裸服务名；已经是裸名则原样返回 */
export function backendName(service: string): string {
  return service.slice(service.lastIndexOf('/') + 1);
}

/** 某条 path 在该 matcher 内落到哪个 backend；未命中任何 pathRule 返回 null */
function backendForPath(
  matcher: UrlMap['pathMatchers'][number],
  path: string,
): string | null {
  const rule = matcher.pathRules.find((r) => r.paths.includes(path));
  return rule ? backendName(rule.service) : null;
}

/** 返回问题清单；空数组 = 路由健康 */
export function auditUrlMap(map: UrlMap, want: Expectation): string[] {
  const matcher = map.pathMatchers.find((m) => m.name === want.pathMatcher);
  if (!matcher) return [`path matcher ${want.pathMatcher} 不存在于 ${want.urlMap}`];

  const problems: string[] = [];

  // 1) 我们的每条 path 都必须在，且指向我们的 backend
  for (const path of want.ourPaths) {
    const actual = backendForPath(matcher, path);
    if (actual === null) {
      problems.push(`${path} 未命中任何 pathRule —— 规则被冲掉了，流量正落到 default 后端`);
    } else if (actual !== want.ourBackend) {
      problems.push(`${path} -> ${actual}（期望 ${want.ourBackend}）`);
    }
  }

  // 2) 更长前缀的邻居必须仍在、且不指向我们。它们一旦缺失，GCLB 最长前缀匹配会把
  //    /game/pgcserver/* 之类落到本前端的 /game/*，BFF 收到本不该由它处理的流量。
  for (const path of want.longerPrefixNeighbors) {
    const actual = backendForPath(matcher, path);
    if (actual === null) {
      problems.push(`${path} 规则缺失 —— 该前缀的流量会被本前端的 /game/* 吞掉`);
    } else if (actual === want.ourBackend) {
      problems.push(`${path} -> ${actual} —— 指向了本前端，会被本前端的 /game/* 吞掉`);
    }
  }

  // 3) 本前端只加 /game 两条，从不占 default（运维侧共用约定）
  if (backendName(matcher.defaultService) === want.ourBackend) {
    problems.push(`matcher default 指向了本前端 ${want.ourBackend} —— 本前端不得占 default`);
  }
  if (backendName(map.defaultService) === want.ourBackend) {
    problems.push(`url-map default 指向了本前端 ${want.ourBackend} —— 本前端不得占 default`);
  }

  return problems;
}
