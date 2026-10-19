// U3 部署契约:setup-lb.sh 与 runbook 的后端/健康检查口径不得漂移
// (一次性 SRE 脚本不进 CI,故用契约测试当回归护栏)。
import { describe, expect, test } from 'vitest';
import { readRepoFile } from './manifest';

const lb = readRepoFile('deploy/setup-lb.sh');
const readme = readRepoFile('deploy/README.md');

describe('rezonalab-game-web LB / backend 接入契约', () => {
  test('backend-service 与 health-check 沿用 rezonalab-game-web-${ENV}-* 命名', () => {
    expect(lb).toContain('BACKEND="rezonalab-game-web-${ENV}-backend"');
    expect(lb).toContain('HEALTHCHECK="rezonalab-game-web-${ENV}-health-check"');
  });

  test('健康检查路径为 /game(非根 /),端口 8080', () => {
    expect(lb).toMatch(/--request-path=\/game\b/);
    expect(lb).toMatch(/--port=8080\b/);
  });

  test('WebSocket backend 超时保持 3600', () => {
    expect(lb).toMatch(/--timeout=3600\b/);
  });

  test('脚本动态挂载所有 zonal NEG', () => {
    expect(lb).toContain('rezonalab-game-web-${ENV}-neg');
    expect(lb).toMatch(/add-backend/);
  });

  test('runbook 含 develop 的 zonal NEG 与端点健康校验', () => {
    expect(readme).toContain('develop 后端/端点健康校验');
    expect(readme).toMatch(/get-health/);          // 端点健康
    expect(readme).toMatch(/healthChecks|requestPath/); // 健康检查校验
    expect(readme).toContain('docs/deploy/dev-productionization.md');
  });



  test('runbook 的环境表指向 Rezona Lab 栈,不残留 taluna 老栈资源名', () => {
    // 迁库后 runbook 一度还写着 taluna 的 namespace / url-map,照抄会把共享 LB 改到老栈上。
    for (const env of ['dev', 'stage', 'prod']) {
      expect(readme).toContain(`rezona-lab-${env}-urlmap`);
      expect(readme).toContain(`rezonalab-game-${env}`);
    }
    expect(readme).not.toMatch(/taluna-\w+-urlmap|new-api-url-map|taluna-routes|taluna-web-backend/);
  });

  test('path matcher 指向 lab 的 rezona-lab（不是 taluna-routes）', () => {
    // 只断言赋值行本身：脚本正文/文案里可能提到 taluna 作对比说明，
    // 全文搜索会把说明算成违规（此前已在别处踩过两次）。
    expect(lb).toContain('PATH_MATCHER="rezona-lab"');
  });

  test('健康检查探 Pod 容器端口 8080，不是 Service 的 80', () => {
    // NEG 是容器原生 LB，直达 Pod:8080；探 80 会一直失败 → 后端 UNHEALTHY → 502。
    expect(lb).toContain('--port=8080');
  });
});
