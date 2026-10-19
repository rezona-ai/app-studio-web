// 部署源契约：每个环境只认自己那条线（specs/2026-08-27-merge-strategy-alignment-design.md §5.5 ②）。
// 这层守的是「校验步骤还在、三条映射没被悄悄改宽」——校验逻辑本身在 _deploy.yml 的 shell 里，
// 真机验证靠故意填错 ref dispatch 一次（plan T8）。
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './manifest';

const DEPLOY_WF = '.github/workflows/_deploy.yml';
const wf = readRepoFile(DEPLOY_WF);

describe('_deploy.yml 部署源校验', () => {
  it('校验步骤存在，且排在构建之前', () => {
    const validateAt = wf.indexOf('name: Validate deploy source');
    const buildxAt = wf.indexOf('name: Set up Docker Buildx');
    expect(validateAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(buildxAt);
  });

  // ⚠️ 必须**全等**匹配 ALLOWED 的内容。用 toContain 子串匹配挡不住「悄悄改宽」——
  // 实测把 stage 的 ALLOWED 追加 " refs/remotes/origin/dev"（= stage 接受 dev），
  // 子串断言照样全绿，那这条测试就等于没写。
  it.each([
    ['production', "$(git for-each-ref --format='%(refname)' 'refs/remotes/origin/release/*')"],
    ['stage', 'refs/remotes/origin/main'],
    ['develop', 'refs/remotes/origin/test refs/remotes/origin/dev'],
  ])('%s 的允许来源恰好是 %s', (env, allowed) => {
    const line = wf.split('\n').find((l) => l.trim().startsWith(`${env})`));
    expect(line, `_deploy.yml 缺 ${env} 分支`).toBeTruthy();
    const m = /ALLOWED="(.*?)";/.exec(line!);
    expect(m, `${env} 分支未按 ALLOWED="…"; 的形式赋值`).toBeTruthy();
    expect(m![1]).toBe(allowed);
  });

  // 变异验证发现：把结尾的 exit 1 改成 exit 0，上面的断言一条都不会红——
  // 三条映射写得再准，不 exit 1 就只是打印一行好看的错误然后继续部署。
  it('校验不通过时以 exit 1 中止，不是打印了事', () => {
    // 切到**紧邻的下一个 step**，而不是某个写死名字的 step：原先切到 "Set up Docker
    // Buildx" 为止，于是在两者之间插入任何新步骤都会让本断言读到别人的最后一行而误红
    // （2026-09-08 加 gtxy 部署目标时实际发生）。要守的是「本 step 以 exit 1 收尾」，
    // 和后面跟着谁无关。
    const start = wf.indexOf('name: Validate deploy source');
    const rest = wf.slice(start);
    const nextStep = rest.indexOf('\n      - name:');
    const step = nextStep === -1 ? rest : rest.slice(0, nextStep);
    // 取该 step 里最后一条非空、非 YAML 结构行（末尾会残留下一个 step 的 "- " 前缀）
    const lastCmd = step
      .split('\n')
      .map((l) => l.trim())
      // 注释不是命令：下一个 step 的说明注释排在它的 `- name:` 之前，会落进本切片。
      .filter((l) => l && l !== '-' && !l.startsWith('#'))
      .pop();
    expect(lastCmd).toBe('exit 1');
  });

  // origin/* 引用在场靠的是 fetch-depth: 0（checkout 全量模式会拉全部分支）。
  // 去掉它，校验会对所有环境假阴性；这条断言就是守着它别被人顺手改成浅 checkout。
  it('checkout 是全量历史（判祖先的前提）', () => {
    expect(wf).toContain('fetch-depth: 0');
  });

  // 刷新用的 fetch 必须逐条独立：合成一条多 refspec 的 fetch 是全有全无——
  // 只要 test 分支还不存在就整体 128 退出、一条都不拉，被 || true 吞掉后完全看不出来。
  it('刷新 fetch 逐条独立执行，不合成多 refspec', () => {
    const step = wf.slice(wf.indexOf('name: Validate deploy source'), wf.indexOf('name: Set up Docker Buildx'));
    const fetchLines = step.split('\n').filter((l) => l.includes('git fetch'));
    expect(fetchLines.length).toBeGreaterThan(0);
    for (const line of fetchLines) {
      expect(line.match(/refs\/heads\//g)?.length ?? 0).toBe(1);
      expect(line).toContain('|| true');
    }
  });
});
