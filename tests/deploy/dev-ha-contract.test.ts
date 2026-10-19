// U2 部署契约:rezonalab-game-web develop 必须满足 Dev 生产化高可用目标,防止后续误改回退掉零端点。
import { describe, expect, test } from 'vitest';
import { renderDevelop, renderProduction, workflowInput } from './manifest';

const WF = '.github/workflows/deploy_dev.yml';

describe('rezonalab-game-web develop HA 部署契约', () => {
  test('HPA min/max = 2 / 5', () => {
    expect(workflowInput(WF, 'hpa_min')).toBe('2');
    expect(workflowInput(WF, 'hpa_max')).toBe('5');
    const hpa = renderDevelop('deploy/hpa.yaml');
    expect(hpa).toMatch(/minReplicas:\s*2\b/);
    expect(hpa).toMatch(/maxReplicas:\s*5\b/);
  });

  test('Deployment 采用 RollingUpdate 且 maxUnavailable=0(发布不缩容)', () => {
    const dep = renderDevelop('deploy/k8s-deployment.yaml');
    expect(dep).toMatch(/type:\s*RollingUpdate/);
    expect(dep).toMatch(/maxUnavailable:\s*0\b/);
  });

  test('存在 PDB 且选择器匹配 app=rezonalab-game-web / env=develop', () => {
    const hpa = renderDevelop('deploy/hpa.yaml');
    expect(hpa).toMatch(/kind:\s*PodDisruptionBudget/);
    // PDB 的 selector 段须同时带这两个标签(渲染后 env 已被替换为 develop)
    const selectorBlock = hpa.slice(hpa.indexOf('PodDisruptionBudget'));
    expect(selectorBlock).toMatch(/app:\s*rezonalab-game-web/);
    expect(selectorBlock).toMatch(/env:\s*develop/);
  });

  test('readiness / liveness 仍探 /game 端口 8080', () => {
    const dep = renderDevelop('deploy/k8s-deployment.yaml');
    expect((dep.match(/path:\s*\/game\b/g) ?? []).length).toBe(2); // readiness + liveness
    expect(dep).toMatch(/port:\s*8080/);
  });

  test('develop 应用容器 resources = 500m/1Gi requests + 4/8Gi limits', () => {
    const dep = renderDevelop('deploy/k8s-deployment.yaml');
    expect(dep).toContain('cpu: "500m"');
    expect(dep).toContain('memory: "1Gi"');
    expect(dep).toContain('cpu: "4"');
    expect(dep).toContain('memory: "8Gi"');
  });

  test('production 资源不被 develop 抬高连累(共享模板参数化护栏)', () => {
    // 资源经 _deploy.yml input 参数化:deploy.yml 不显式传 → 回落基线默认 250m/512Mi · 1/1Gi。
    const prod = renderProduction('deploy/k8s-deployment.yaml');
    expect(prod).toContain('cpu: "250m"');
    expect(prod).toContain('memory: "512Mi"');
    expect(prod).toContain('cpu: "1"');
    expect(prod).not.toContain('cpu: "500m"');
    expect(prod).not.toContain('memory: "8Gi"');
    // 顺带核对 prod HPA 维持 2-10(未被本次 develop 改动波及)
    expect(workflowInput('.github/workflows/deploy.yml', 'hpa_max')).toBe('10');
  });

  test('设置 minReadySeconds / preStop / terminationGracePeriodSeconds(无缝下线前提)', () => {
    const dep = renderDevelop('deploy/k8s-deployment.yaml');
    expect(dep).toMatch(/minReadySeconds:\s*\d+/);
    expect(dep).toMatch(/preStop:/);
    expect(dep).toMatch(/terminationGracePeriodSeconds:\s*\d+/);
  });
});
