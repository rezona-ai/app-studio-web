import { describe, expect, it } from 'vitest';
import { auditUrlMap, backendName, type UrlMap } from './audit';

const B = (n: string) => `https://www.googleapis.com/compute/v1/projects/rezonaai/global/backendServices/${n}`;

const EXPECTATION = {
  env: 'dev' as const,
  urlMap: 'rezona-lab-dev-urlmap',
  host: 'devlab.rezona.ai',
  pathMatcher: 'rezona-lab',
  ourPaths: ['/game', '/game/*'],
  ourBackend: 'rezonalab-game-web-develop-backend',
  longerPrefixNeighbors: ['/game/pgcserver', '/game/koubou'],
};

/** 健康的 dev url-map（按 2026-07-30 实测结构裁剪） */
function healthyMap(): UrlMap {
  return {
    name: 'rezona-lab-dev-urlmap',
    defaultService: B('rezona-lab-dev-web-backend'),
    pathMatchers: [
      {
        name: 'rezona-lab',
        defaultService: B('rezona-lab-dev-web-backend'),
        pathRules: [
          { paths: ['/tln/biz/*'], service: B('rezona-lab-dev-biz-api-backend') },
          { paths: ['/game/pgcserver', '/game/pgcserver/*'], service: B('rezonalab-game-dev-backend') },
          { paths: ['/game/koubou', '/game/koubou/*'], service: B('koubou-agent-lab-dev-backend') },
          { paths: ['/game', '/game/*'], service: B('rezonalab-game-web-develop-backend') },
        ],
      },
    ],
  };
}

describe('backendName', () => {
  it('从 selfLink 取末段服务名', () => {
    expect(backendName(B('rezonalab-game-web-develop-backend'))).toBe('rezonalab-game-web-develop-backend');
  });

  it('已经是裸名时原样返回', () => {
    expect(backendName('rezonalab-game-web-develop-backend')).toBe('rezonalab-game-web-develop-backend');
  });
});

describe('auditUrlMap', () => {
  it('健康的 url-map 零问题', () => {
    expect(auditUrlMap(healthyMap(), EXPECTATION)).toEqual([]);
  });

  it('我们的规则整条被冲掉 —— 2026-07-29 事故的形态', () => {
    const map = healthyMap();
    map.pathMatchers[0].pathRules = map.pathMatchers[0].pathRules.filter(
      (r) => !r.paths.includes('/game'),
    );
    const problems = auditUrlMap(map, EXPECTATION);
    expect(problems).toHaveLength(2); // /game 与 /game/* 各报一条
    expect(problems.join('\n')).toContain('/game 未命中任何 pathRule');
  });

  it('只丢裸前缀 /game —— 会静默落到 default 后端', () => {
    const map = healthyMap();
    const ours = map.pathMatchers[0].pathRules.find((r) => r.paths.includes('/game'))!;
    ours.paths = ['/game/*'];
    const problems = auditUrlMap(map, EXPECTATION);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('/game 未命中');
  });

  it('我们的 path 被指到别人的 backend', () => {
    const map = healthyMap();
    const ours = map.pathMatchers[0].pathRules.find((r) => r.paths.includes('/game'))!;
    ours.service = B('rezona-lab-dev-web-backend');
    const problems = auditUrlMap(map, EXPECTATION);
    expect(problems.join('\n')).toContain('期望 rezonalab-game-web-develop-backend');
  });

  it('更长前缀的邻居被删 —— 我们的 /game/* 会吞掉 pgc 流量', () => {
    const map = healthyMap();
    map.pathMatchers[0].pathRules = map.pathMatchers[0].pathRules.filter(
      (r) => !r.paths.includes('/game/pgcserver'),
    );
    const problems = auditUrlMap(map, EXPECTATION);
    expect(problems.join('\n')).toContain('/game/pgcserver');
    expect(problems.join('\n')).toContain('会被本前端的 /game/* 吞掉');
  });

  it('邻居仍在但指向我们 —— 同样是吞流量', () => {
    const map = healthyMap();
    const nb = map.pathMatchers[0].pathRules.find((r) => r.paths.includes('/game/koubou'))!;
    nb.service = B('rezonalab-game-web-develop-backend');
    expect(auditUrlMap(map, EXPECTATION).join('\n')).toContain('/game/koubou');
  });

  it('本前端抢了 default —— 违反「不占 default」约定', () => {
    const map = healthyMap();
    map.pathMatchers[0].defaultService = B('rezonalab-game-web-develop-backend');
    expect(auditUrlMap(map, EXPECTATION).join('\n')).toContain('default');
  });

  it('path matcher 整个不见了', () => {
    const map = healthyMap();
    map.pathMatchers = [];
    const problems = auditUrlMap(map, EXPECTATION);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('rezona-lab');
  });
});
