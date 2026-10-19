// 叠合部署契约：deploy_dev_pr.yml（合成 test 后部署）与 deploy_dev.yml（手动旁路）的
// 环境参数必须逐项一致（仅 ref 不同），漂移会以错误资源/后端地址上 develop 环境。
// 另守机制本身的三条不变式：基线是 dev、develop 唯一常态源是 test、冲突不部署。
import { describe, expect, it } from 'vitest';
import { readRepoFile, resolveInput } from './manifest';

const DEV_WF = '.github/workflows/deploy_dev.yml';
const PR_WF = '.github/workflows/deploy_dev_pr.yml';

/** 取 workflow 中某 input 的全部出现值（多个 job 各有一份 with: 块，须逐处校验） */
function allInputValues(workflowRelPath: string, key: string): string[] {
  const wf = readRepoFile(workflowRelPath);
  const re = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'gm');
  return [...wf.matchAll(re)].map((m) => m[1].trim());
}

describe('deploy_dev_pr.yml 与 deploy_dev.yml 参数防漂移', () => {
  const KEYS = [
    'environment',
    // namespace 曾是缺口：namespace-isolation-contract 只覆盖 dev/stage/prod 三个瘦封装，
    // 独漏 deploy_dev_pr.yml。这里写成 `develop` 就会打进 taluna 老栈的 ns（_deploy.yml 标 🔴）。
    'namespace',
    'app_env',
    'hpa_min',
    'hpa_max',
    'app_cpu_request',
    'app_mem_request',
    'app_cpu_limit',
    'app_mem_limit',
    'pgc_base_url',
    'public_pgc_base_url',
  ];

  it.each(KEYS)('input %s 与 deploy_dev.yml 一致', (key) => {
    const expected = resolveInput(DEV_WF, key);
    const values = allInputValues(PR_WF, key);
    expect(values).toHaveLength(1); // 只剩 deploy 一个调用 job
    expect(values[0]).toBe(expected);
  });

  it('concurrency group 与 deploy_dev.yml 同组（跨 workflow 串行互斥）', () => {
    const group = (wf: string) => readRepoFile(wf).match(/^\s*group:\s*(\S+)/m)?.[1];
    expect(group(PR_WF)).toBe('deploy-develop');
    expect(group(PR_WF)).toBe(group(DEV_WF));
  });
});

describe('叠合机制不变式', () => {
  const pr = readRepoFile(PR_WF);
  const dev = readRepoFile(DEV_WF);

  it('叠合基线是 dev（不是 go-rezona 的 main）', () => {
    expect(pr).toMatch(/ref:\s*dev\b/);
    expect(pr).toContain('git checkout -B compose-test origin/dev');
  });

  // 两处 ref：合成 job 的 checkout 取基线 dev，部署 job 取合成结果。顺序即出现顺序。
  it('部署的是合成出的 SHA，不是某个 PR 的 head', () => {
    expect(allInputValues(PR_WF, 'ref')).toEqual(['dev', '${{ needs.compose-test.outputs.sha }}']);
  });

  it('合成结果 force-push 到机器分支 test', () => {
    expect(pr).toContain('git push --force origin "compose-test:test"');
  });

  // 两条链同时挂 push:dev 会让 develop 上跑的是 dev 还是叠合体取决于排队顺序
  it('deploy_dev.yml 没有 push 触发器（develop 常态源唯一）', () => {
    expect(dev).not.toMatch(/^\s*push:/m);
    expect(pr).toMatch(/^\s*push:\s*$/m);
  });

  it('冲突时不部署，且在 PR 上留痕', () => {
    expect(pr).toContain('git merge --abort');
    expect(pr).toContain("status=conflict");
    expect(pr).toContain("needs.compose-test.outputs.status == 'success'");
    expect(pr).toContain('createComment');
  });

  it('fork PR 不参与叠合（拿不到 secrets，也不该上共享环境）', () => {
    expect(pr).toContain('来自 fork，跳过叠合');
  });

  // pulls.list 默认「新的在前」，而冲突时背锅的是迭代到的那一个 —— 默认序下老 PR 被判冲突，
  // 与 §5.3「后提交的 PR 让路」正好相反（2026-08-27 实测 [14,13]）。升序也保证同一批 PR
  // 每次合成同样的历史。
  it('按 PR 号升序叠合（先来的先占，后开的让路）', () => {
    expect(pr).toContain('.sort((a, b) => a - b)');
  });
});
