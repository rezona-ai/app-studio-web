// 迁库到 Rezona Lab 栈后最危险的不变式:k8s namespace 与 GitHub environment 已解耦
// (environment=develop|stage|production 决定资源名后缀,namespace=rezonalab-game-{dev,stage,prod})。
// 任何拿 inputs.environment 当 namespace 用的地方,都会指向 taluna 老栈的同名 ns。
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './manifest';

const wf = readRepoFile('.github/workflows/_deploy.yml');

describe('_deploy.yml 的 namespace 不得回退成 environment', () => {
  it('所有 NS shell 变量赋值都取 inputs.namespace', () => {
    const assigned = [...wf.matchAll(/^\s*NS="\$\{\{\s*inputs\.(\w+)\s*\}\}"/gm)].map((m) => m[1]);
    expect(assigned.length).toBeGreaterThan(0); // 防正则失配导致空断言假绿
    expect(assigned).toEqual(assigned.map(() => 'namespace'));
  });

  it('kubectl 的 --namespace 参数都取 inputs.namespace', () => {
    const flags = [...wf.matchAll(/--namespace=\$\{\{\s*inputs\.(\w+)\s*\}\}/g)].map((m) => m[1]);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags).toEqual(flags.map(() => 'namespace'));
  });

  it('三个 deploy_*.yml 传的 namespace 都是 rezonalab-game-* 前缀', () => {
    const wfs = {
      '.github/workflows/deploy_dev.yml': 'rezonalab-game-dev',
      '.github/workflows/deploy_stage.yml': 'rezonalab-game-stage',
      '.github/workflows/deploy.yml': 'rezonalab-game-prod',
    };
    for (const [path, expected] of Object.entries(wfs)) {
      const found = [...readRepoFile(path).matchAll(/^\s*namespace:\s*(\S+)\s*$/gm)].map((m) => m[1]);
      expect(found.length).toBeGreaterThan(0);
      expect(found).toEqual(found.map(() => expected));
    }
  });
});
