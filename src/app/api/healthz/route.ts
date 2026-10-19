// Liveness 探针端点（实际路径 `/game/api/healthz`，因 basePath=/game）：仅证明进程存活，
// **不依赖任何上游**（pgc/koubou），避免上游抖动误杀本进程。供 k8s livenessProbe，
// 把探针从整页 SSR（旧 `/game`）解耦，降低探针成本与误判。
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json({ ok: true });
}
