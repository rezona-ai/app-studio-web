# loadtest — rezonalab-game-web DEV 压测脚本

落地 [`docs/deploy/dev-productionization.md`](../docs/deploy/dev-productionization.md) §5
的 DEV 压测方案。目标：量化 SSR 路径的 QPS→CPU、HPA `2-5` 扩缩容延迟与 Pod 冷启动，为 prod 右尺寸取数据。

> 同源经验来自 pgc-server 2026-06-24 实测（见 pgc-server repo `docs/deploy/pgc-dev-loadtest-baseline-2026-06-24.md`）：
> **单一外网 IP 经 LB 持续加压会先撞边缘连接限流**，应用未必被压到——应用 CPU 容量基线必须**集群内直连 Service**。

## 前置

- 安装 [k6](https://k6.io/docs/get-started/installation/)（`brew install k6`）。
- rezonalab-game-web dev 已部署（HPA `2-5`、资源参数化、PDB 已具备；见生产化文档）。

## 脚本

| 文件 | 场景 | 说明 |
| --- | --- | --- |
| `rezonalab-read-baseline.js` | 外部 SSR 读路径（参照） | 经外部 HTTPS LB 打 `/game` 阶梯加压。⚠️ 单 IP 会先撞边缘限流，仅作方法论/读路径参照 |
| `rezonalab-incluster-ssr.js` + `k6-incluster-job.yaml` | SSR CPU 基线 + 扩缩容（推荐） | **集群内直连 ClusterIP 打 `/game`，绕过边缘限流**。阶梯 50→200→400 VU 把 SSR CPU 推过 70%，量化扩容延迟 + 冷启动 + QPS→CPU |

### 运行

```bash
# 外部读路径（约 12min，受边缘限流约束）
k6 run loadtest/rezonalab-read-baseline.js

# 集群内 SSR CPU 基线（推荐，绕过边缘；dev 的 namespace 是 rezonalab-game-dev）
kubectl create configmap k6-rezonalab-script -n rezonalab-game-dev --from-file=script.js=loadtest/rezonalab-incluster-ssr.js
kubectl apply -f loadtest/k6-incluster-job.yaml
kubectl logs -f job/k6-rezonalab -n rezonalab-game-dev
kubectl delete job k6-rezonalab -n rezonalab-game-dev && kubectl delete configmap k6-rezonalab-script -n rezonalab-game-dev   # 收尾
```

> namespace `rezonalab-game-dev` 由本前端 / pgc / koubou 共用，压测 Job 跑完务必删干净。

### 同跑观测（另开终端）

```bash
kubectl top pod -n rezonalab-game-dev -l app=rezonalab-game-web --containers
kubectl get hpa -n rezonalab-game-dev -l app=rezonalab-game-web -w
kubectl get pods -n rezonalab-game-dev -l app=rezonalab-game-web -o wide -w
kubectl get nodes -L topology.kubernetes.io/zone   # 跨 zone 验收（topologySpread 落地后）
```

## 注意

- `/game` 是 SSR 落地页（探针同路径，公开无需鉴权）；`/game/studio` 等需登录态 cookie，单独压测时另配。
- SSR 渲染是 CPU 密集型，比纯健康端点重；阶梯 VU 可能较快越过 70%。
- 跑完把 QPS→CPU 曲线、扩容延迟、冷启动时间回写生产化文档 §5/§6，作为 prod 右尺寸依据。
