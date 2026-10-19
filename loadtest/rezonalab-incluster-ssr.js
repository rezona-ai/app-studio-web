// rezonalab-game-web DEV 集群内 SSR CPU 基线：直连 ClusterIP Service 打 /game（Next.js 服务端渲染），
// 绕过外部 HTTPS LB 的单 IP 边缘限流，把主容器 CPU 推过 HPA 70% 阈值以测扩容延迟 + 冷启动 + QPS→CPU。
// 经 k6 Job 在 rezonalab-game-web 部署所在 namespace 内运行（见 loadtest/k6-incluster-job.yaml）。
//
// 注：默认 BASE 假定 dev namespace rezonalab-game-dev + service 名 rezonalab-game-web-develop-service:80；
// 按实际环境用 REZONALAB_INCLUSTER_BASE 覆盖（`http://<service>.<ns>.svc.cluster.local/game` 的父路径，不含 /game）。
import http from 'k6/http';
import { check } from 'k6';

const BASE =
  __ENV.REZONALAB_INCLUSTER_BASE ||
  'http://rezonalab-game-web-develop-service.rezonalab-game-dev.svc.cluster.local';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 200 },
    { duration: '2m', target: 400 },
    { duration: '2m', target: 0 },
  ],
  thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<2000'] },
};

export default function () {
  const res = http.get(`${BASE}/game`);
  check(res, { 'game 200': (r) => r.status === 200 });
}
