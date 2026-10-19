#!/usr/bin/env tsx
// 共享 url-map 路由巡检（**只读**，不修改任何 GCP 资源）。
//
// rezona-lab-{dev,stage,prod}-urlmap 由本前端 / pgc / koubou / Rezona Canvas / biz-api 共用，
// `gcloud compute url-maps patch` 是整体替换而非合并——后写入者会把先写入者的规则冲掉
// （2026-07-29 实发一次，无人发现直到用户在浏览器撞到）。本脚本把发现前移。
//
// 用法：
//   pnpm lb:audit              # 巡检全部已接入(wired)的环境
//   pnpm lb:audit --env dev    # 只巡检某个环境
// 退出码：0 = 全部健康；1 = 有路由问题；2 = 取数失败（gcloud 不可用 / 无权限）。
import { execFileSync } from 'node:child_process';
import { auditUrlMap, type UrlMap } from './audit';
import { EXPECTED } from './expected';

const PROJECT = process.env.GCP_PROJECT_ID || 'rezonaai';

function fetchUrlMap(name: string): UrlMap {
  const out = execFileSync(
    'gcloud',
    ['compute', 'url-maps', 'describe', name, `--project=${PROJECT}`, '--global', '--format=json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out) as UrlMap;
}

function main(): number {
  const envArg = process.argv.includes('--env')
    ? process.argv[process.argv.indexOf('--env') + 1]
    : null;

  const targets = EXPECTED.filter((e) => (envArg ? e.env === envArg : e.wired));
  if (targets.length === 0) {
    console.log(envArg ? `没有名为 ${envArg} 的环境` : '没有已接入(wired)的环境，跳过。');
    return envArg ? 2 : 0;
  }

  let failed = false;
  for (const want of targets) {
    if (!want.wired) {
      console.log(`⏭  ${want.env}：尚未接入 LB（expected.ts 里 wired=false），跳过`);
      continue;
    }
    let map: UrlMap;
    try {
      map = fetchUrlMap(want.urlMap);
    } catch (err) {
      // 取数失败与路由异常必须分开：把「查不到」误报成「路由坏了」会训练出忽视告警的习惯，
      // 反过来把认证失败吞成成功会在凭据最该被修时把监控静默关掉。
      console.error(`✖ ${want.env}：读取 ${want.urlMap} 失败 —— ${(err as Error).message.trim()}`);
      return 2;
    }

    const problems = auditUrlMap(map, want);
    if (problems.length === 0) {
      console.log(`✔ ${want.env}（${want.host}）：${want.ourPaths.join(', ')} -> ${want.ourBackend}`);
    } else {
      failed = true;
      console.error(`✖ ${want.env}（${want.host} / ${want.urlMap}）:`);
      for (const p of problems) console.error(`    - ${p}`);
    }
  }

  if (failed) {
    console.error(
      '\n路由已偏离期望。修复走 export → 改 → 逐条 diff → import（禁用裸 patch），' +
        '只加回自己的规则，不动别人的与 default。见 docs/deploy/rezonalab-dev-bringup.md §4。',
    );
  }
  return failed ? 1 : 0;
}

process.exit(main());
