// 本前端在三个共享 url-map 里拥有的路由期望。
// 接入一个新环境 = 把它的 wired 翻成 true（资源名与 host 已按 setup-lb.sh / deploy_*.yml 的口径预填）。
import type { Expectation } from './audit';

export type EnvExpectation = Expectation & {
  /** 该环境的 /game 是否已接进 LB。false = 尚未接入，巡检跳过（避免未上线环境天天报红） */
  wired: boolean;
};

/** `/game` 更长前缀的邻居：pgc 与 koubou 三环境同构（历史 wire contract，与仓库名解耦） */
const LONGER_PREFIX_NEIGHBORS = ['/game/pgcserver', '/game/koubou'];

export const EXPECTED: EnvExpectation[] = [
  {
    env: 'dev',
    wired: true, // 2026-07-30 接入
    urlMap: 'rezona-lab-dev-urlmap',
    host: 'devlab.rezona.ai',
    pathMatcher: 'rezona-lab',
    ourPaths: ['/game', '/game/*'],
    // ENV 取自 deploy_*.yml 的 environment（develop/stage/production），非 namespace 后缀
    ourBackend: 'rezonalab-game-web-develop-backend',
    longerPrefixNeighbors: LONGER_PREFIX_NEIGHBORS,
  },
  {
    env: 'stage',
    wired: true, // 2026-07-31 接入
    urlMap: 'rezona-lab-stage-urlmap',
    host: 'stalab.rezona.ai',
    pathMatcher: 'rezona-lab',
    ourPaths: ['/game', '/game/*'],
    ourBackend: 'rezonalab-game-web-stage-backend',
    longerPrefixNeighbors: LONGER_PREFIX_NEIGHBORS,
  },
  {
    env: 'prod',
    wired: true, // 2026-07-31 接入
    urlMap: 'rezona-lab-prod-urlmap',
    host: 'lab.rezona.ai',
    pathMatcher: 'rezona-lab',
    ourPaths: ['/game', '/game/*'],
    ourBackend: 'rezonalab-game-web-production-backend',
    longerPrefixNeighbors: LONGER_PREFIX_NEIGHBORS,
  },
];
