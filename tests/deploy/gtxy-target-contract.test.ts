// 守住「多一个 GCP 部署目标」这套接线不被改回去。
//
// 背景：公司在把资源从官方渠道的计费账号迁到代理渠道的 `gtxy-rzn-infra`，共存期
// 两个计算层都要部。目标由运维变量 `WEB_DEPLOY_TARGETS` 驱动（见 deploy/deploy_targets.sh）。
// 本文件断言的是**变量没配时行为与迁移前逐字一致**，以及新目标那条腿不会静默降级到老项目。
//
// 断言方式沿用本目录既有风格（读文本 + 正则），不引入 YAML 依赖：加一个 devDependency
// 会改动 lockfile 与整条 install，代价远大于收益。
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deployInputDefault, readRepoFile } from './manifest';

const wfDir = '.github/workflows';
const read = (f: string) => readRepoFile(`${wfDir}/${f}`);

/** 以子进程跑脚本，拿它的 stdout（无 $GITHUB_OUTPUT / $GITHUB_ENV 时只打 stdout）。 */
function runScript(script: string, extraEnv: Record<string, string | undefined>): string {
  // 用 NodeJS.ProcessEnv 而不是 Record<string,string>：本仓给 ProcessEnv 补过必填键
  // （NODE_ENV），退化成宽松的 Record 会让 execFileSync 的重载匹配不上。
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_ENV;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return execFileSync('bash', [script], { env, encoding: 'utf8' });
}

function expectFails(script: string, extraEnv: Record<string, string | undefined>): string {
  try {
    runScript(script, extraEnv);
    throw new Error(`期望失败但成功了：${script} ${JSON.stringify(extraEnv)}`);
  } catch (e: unknown) {
    // execFileSync 在子进程非零退出时抛的错带 status/stderr；不带 status 的是别的故障
    // （脚本不存在、bash 缺失），那种必须原样抛出，不能被当成「断言通过」。
    const err = e as { status?: number; stderr?: unknown };
    if (typeof err.status !== 'number') throw e;
    expect(err.status).toBe(1);
    return String(err.stderr ?? '');
  }
}

const targets = (t?: string) => runScript('deploy/deploy_targets.sh', { TARGETS: t });
const renderEnv = (t: string) => runScript('deploy/render_env.sh', { GCP_TARGET: t });

describe('deploy_targets.sh', () => {
  // 这条是整套改动的安全网：运维变量没配 = 迁移前的单目标行为。
  it('变量未配时只解析出老项目一条腿', () => {
    expect(targets().trim()).toBe('targets=[{"gcp_target":"rezonaai"}]');
  });

  it('共存期两条腿，顺序与变量一致', () => {
    expect(targets('rezonaai,gtxy-rzn-infra').trim()).toBe(
      'targets=[{"gcp_target":"rezonaai"},{"gcp_target":"gtxy-rzn-infra"}]',
    );
  });

  it('去重：同一个目标写两遍只产出一条腿', () => {
    // 两条同 namespace 的腿会在同一个 run 内并发 apply 同一个 Deployment，
    // 各自等 rollout 时把对方的 ReplicaSet 判成未就绪。
    expect(targets('rezonaai,rezonaai').trim()).toBe('targets=[{"gcp_target":"rezonaai"}]');
  });

  it('空白与空项被忽略', () => {
    expect(targets(' rezonaai , , gtxy-rzn-infra ').trim()).toBe(
      'targets=[{"gcp_target":"rezonaai"},{"gcp_target":"gtxy-rzn-infra"}]',
    );
  });

  it('未知目标就地失败，不静默跳过', () => {
    // 静默跳过等于「变量写错了但部署照跑」，最后部到哪没人知道。
    expect(expectFails('deploy/deploy_targets.sh', { TARGETS: 'rezonaai,typo-project' })).toContain(
      'unknown deploy target',
    );
  });

  it('清空变量是错误，不是「停止部署」', () => {
    expect(expectFails('deploy/deploy_targets.sh', { TARGETS: '  ,  ' })).toContain('至少要有一个目标');
  });
});

describe('render_env.sh', () => {
  it('老项目解析出的三个值与迁移前的常量逐字相同', () => {
    // 迁移前这三行写死在 _deploy.yml 的 env 块里，值就是这些。
    expect(renderEnv('rezonaai')).toBe(
      ['PROJECT_ID=rezonaai', 'CLUSTER_NAME=autopilot-cluster-1', 'REPOSITORY_NAME=rezonalab-game-repo', ''].join('\n'),
    );
  });

  it('新项目解析到自己的 project，集群与仓库名同名', () => {
    expect(renderEnv('gtxy-rzn-infra')).toBe(
      [
        'PROJECT_ID=gtxy-rzn-infra',
        'CLUSTER_NAME=autopilot-cluster-1',
        'REPOSITORY_NAME=rezonalab-game-repo',
        '',
      ].join('\n'),
    );
  });

  it('未知目标就地失败', () => {
    expect(expectFails('deploy/render_env.sh', { GCP_TARGET: 'bogus' })).toContain('unknown deploy target');
  });
});

describe('_deploy.yml 的目标接线', () => {
  const wf = read('_deploy.yml');

  it('gcp_target 的缺省值是老项目', () => {
    // 缺省值一旦被改成新项目，所有没显式传值的调用方会静默换项目。
    expect(deployInputDefault('gcp_target')).toBe('rezonaai');
  });

  it.each(['PROJECT_ID', 'CLUSTER_NAME', 'REPOSITORY_NAME'])('%s 不再固定在顶层 env 块里', (key) => {
    // 留在 env 块 = 被静态固定 = 新项目那条腿部到老项目上，且全绿。
    // env 块的键是两空格缩进，与 step 里的 `PROJECT_ID: ...` 区分得开。
    expect(wf).not.toMatch(new RegExp(`^ {2}${key}:`, 'm'));
  });

  it('GH Environment 按目标分叉，新目标取 <env>-gtxy 作用域', () => {
    // 两个项目的部署凭据不同，只能靠 environment 作用域分开。
    expect(wf).toContain("inputs.gcp_target == 'gtxy-rzn-infra'");
    expect(wf).toContain("format('{0}-gtxy', inputs.environment)");
  });

  it('控制面脚本取自 workflow 自己的版本，不是被部署的 ref', () => {
    // develop 部的是合成的 test 分支、prod 部 release/*、回滚部更老的 SHA——
    // 那些 ref 上可能没有 render_env.sh 或者是旧版，用旧版控制面会部到错的项目。
    expect(wf).toContain('Checkout control-plane helpers (workflow revision)');
    expect(wf).toMatch(/path: \.control-plane/);
    // 解析步骤必须跑 .control-plane 里那份，不是工作树根目录那份。
    expect(wf).toContain('bash .control-plane/deploy/render_env.sh');
    // 且那次 checkout 必须钉在 github.sha 上。
    const cp = wf.slice(wf.indexOf('Checkout control-plane helpers'));
    expect(cp.slice(0, cp.indexOf('- name:', 1))).toContain('ref: ${{ github.sha }}');
  });

  it('解析目标发生在 GCP 认证与镜像推送之前', () => {
    // 顺序错了就是带着空 PROJECT_ID 去 auth，报错信息完全指不到根因。
    const resolve = wf.indexOf('name: Resolve deployment target');
    const auth = wf.indexOf('name: GCP auth');
    expect(resolve).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(-1);
    expect(resolve).toBeLessThan(auth);
  });
});

describe('入口 workflow 的矩阵接线', () => {
  const entries = ['deploy_dev.yml', 'deploy_dev_pr.yml', 'deploy_stage.yml', 'deploy.yml'];

  it.each(entries)('%s 的部署作业按 targets 展开矩阵', (f) => {
    const wf = read(f);
    expect(wf).toContain('target: ${{ fromJSON(needs.targets.outputs.targets) }}');
    expect(wf).toContain('gcp_target: ${{ matrix.target.gcp_target }}');
    // fail-fast 必须显式关掉：默认 true 会在一条腿失败时取消另一条在途的腿，
    // 于是老项目那次部署被新项目的抖动中断在半路。
    expect(wf).toMatch(/^\s+fail-fast: false$/m);
  });

  it.each(entries)('%s 的 targets 作业读的是运维变量', (f) => {
    expect(read(f)).toContain('TARGETS: ${{ vars.WEB_DEPLOY_TARGETS }}');
  });
});

// 这条与 gtxy 无关，是插入步骤时踩过的坑的护栏：
// 同一个 step 同时带 `run` 和 `with`（按行号插入时很容易把下一个 step 的 with 块留在原地），
// GitHub 不报语法错误，而是起一个**零作业、日志全空、名字退化成文件路径**的 run。
// 通用 YAML 校验完全看不出来——它是合法 YAML，只是非法 Actions。
describe('所有 workflow 的 step 形状合法', () => {
  const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  /** 按缩进切出每个 step 的文本块（step 以 `      - ` 起头，键与它同层）。 */
  function stepBlocks(text: string): { header: string; body: string[] }[] {
    const lines = text.split('\n');
    const out: { header: string; body: string[] }[] = [];
    let cur: { header: string; body: string[]; indent: number } | null = null;
    for (const line of lines) {
      const start = /^(\s+)- (.*)$/.exec(line);
      // 只认 steps 列表项：至少 6 空格缩进，且首键是 step 会用的那几个之一。
      if (start && start[1].length >= 6 && /^(name|uses|run|id|if|with|env|shell|continue-on-error):/.test(start[2])) {
        if (cur) out.push({ header: cur.header, body: cur.body });
        cur = { header: start[2], body: [start[2]], indent: start[1].length };
        continue;
      }
      if (cur) {
        const m = /^(\s*)(\S.*)$/.exec(line);
        if (!m) continue;
        if (m[1].length <= cur.indent) {
          out.push({ header: cur.header, body: cur.body });
          cur = null;
          continue;
        }
        if (m[1].length === cur.indent + 2) cur.body.push(m[2]);
      }
    }
    if (cur) out.push({ header: cur.header, body: cur.body });
    return out;
  }

  it.each(files)('%s 每个 step 恰好有一个 run/uses，且 run 步骤不带 with', (f) => {
    const blocks = stepBlocks(read(f));
    expect(blocks.length, `${f}: 没解析出任何 step，扫描器该修了`).toBeGreaterThan(0);
    for (const { body } of blocks) {
      const keys = body.map((l) => l.split(':')[0].trim());
      const label = `${f} 的 step「${body.find((l) => l.startsWith('name:')) ?? body[0]}」`;
      const hasRun = keys.includes('run');
      const hasUses = keys.includes('uses');
      expect([hasRun, hasUses].filter(Boolean).length, `${label}: run 与 uses 必须恰有其一`).toBe(1);
      if (hasRun) expect(keys.includes('with'), `${label}: run 步骤不能带 with`).toBe(false);
    }
  });
});
