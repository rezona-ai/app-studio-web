// Readiness 探针端点（实际路径 `/game/api/readyz`，因 basePath=/game）：进程就绪即返回 200。
// **刻意不探上游**——上游（pgc/koubou）抖动反复摘流会放大故障面、把前端 Pod 误判为不可用
// （生产化文档 §4.3 告诫）；上游可达性由 BFF 代理层各自收敛为 502。供 k8s readinessProbe。
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, status: 'ready' });
}
