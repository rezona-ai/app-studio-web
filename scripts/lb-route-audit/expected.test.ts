// 期望表防漂移：巡检里的 backend 名必须与 setup-lb.sh 实际建出的名字、
// 以及各 deploy_*.yml 的 environment 一致——对不上就会盯着一个不存在的 backend 报绿。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED } from './expected';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('巡检期望表与部署口径一致', () => {
  it('backend 名沿用 setup-lb.sh 的 rezonalab-game-web-${ENV}-backend 模板', () => {
    expect(read('deploy/setup-lb.sh')).toContain('BACKEND="rezonalab-game-web-${ENV}-backend"');
    for (const e of EXPECTED) {
      expect(e.ourBackend).toMatch(/^rezonalab-game-web-(develop|stage|production)-backend$/);
    }
  });

  it('三个环境的 ENV 后缀与 deploy_*.yml 的 environment 对齐', () => {
    const envOf: Record<string, string> = {
      dev: '.github/workflows/deploy_dev.yml',
      stage: '.github/workflows/deploy_stage.yml',
      prod: '.github/workflows/deploy.yml',
    };
    for (const e of EXPECTED) {
      const wf = read(envOf[e.env]);
      const environment = wf.match(/^\s*environment:\s*(\S+)\s*$/m)?.[1];
      expect(environment, `${envOf[e.env]} 未找到 environment`).toBeTruthy();
      expect(e.ourBackend).toBe(`rezonalab-game-web-${environment}-backend`);
    }
  });

  it('url-map 名与 setup-lb.sh 用法注释里的一致', () => {
    const lb = read('deploy/setup-lb.sh');
    for (const e of EXPECTED) expect(lb).toContain(e.urlMap);
  });

  it('本前端只声明 /game 两条，不含 default、不越界到别人的前缀', () => {
    for (const e of EXPECTED) {
      expect(e.ourPaths).toEqual(['/game', '/game/*']);
      expect(e.longerPrefixNeighbors).toEqual(['/game/pgcserver', '/game/koubou']);
    }
  });
});
