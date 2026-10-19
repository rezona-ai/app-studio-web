// rezonalab-game-web DEV 读路径压测基线（外部，经外部 HTTPS LB）。
//
// 落地 docs/deploy/dev-productionization.md §5「外部压测」。打 SSR 落地页 /game
// （readiness/liveness 探针同路径），阶梯加压量化 P50/P95/P99 与 HPA 触发点。
//
// ⚠️ 与 pgc-server 同源经验：**单一外网 IP 持续加压会先撞 LB 边缘连接限流**，应用未必被压到。
// 要测应用真实 CPU 容量请用 rezonalab-incluster-ssr.js（集群内直连 ClusterIP Service，绕过边缘）。
//
// 运行：k6 run loadtest/rezonalab-read-baseline.js
// 可选 env：REZONALAB_BASE（默认 DEV），不含尾斜杠。
import http from 'k6/http';
import { check } from 'k6';

const BASE = (__ENV.REZONALAB_BASE || 'https://devlab.rezona.ai').replace(/\/$/, '');

export const options = {
  stages: [
    { duration: '2m', target: 20 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '3m', target: 0 },
  ],
  thresholds: { http_req_duration: ['p(95)<1500'], http_req_failed: ['rate<0.02'] },
};

export default function () {
  // /game 是 SSR 落地页（探针路径），服务端渲染 → 代表性的 CPU 负载。
  const res = http.get(`${BASE}/game`);
  check(res, { 'game 200': (r) => r.status === 200 });
}
