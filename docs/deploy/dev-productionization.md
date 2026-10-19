# taluna-game develop 生产化（Dev HA）

> 范围：仅 `taluna-game` 前端服务。pgc-server / koubou 的 Dev 生产化各自归属其仓库，
> 跨栈编排与验收见 pgc-server 的 `docs/plans/2026-06-24-001-feat-dev-game-stack-productionization-plan.md`。

## 背景

2026-06-23 `/game/studio` 故障的根因是 `taluna-game-develop` 在 Pod 替换 / 节点中断期间
standalone NEG **掉到零端点**。pgc-server 当时健康，说明只看 pgc 健康检查无法证明用户面
游戏入口可用。本次改造把 develop 提升到生产化高可用姿态，消除该故障类。

## 目标状态

| 维度 | develop 目标 |
| --- | --- |
| HPA | `min=2` / `max=5`（`deploy_dev.yml` 的 `hpa_min/hpa_max`） |
| 滚动策略 | `RollingUpdate` + `maxUnavailable=0` + `maxSurge=1` + `minReadySeconds: 10` |
| 优雅下线 | `preStop: sleep 10` + `terminationGracePeriodSeconds: 30`（先从 NEG 摘端点再 SIGTERM） |
| 可用性预算 | PodDisruptionBudget `minAvailable: 50%` |
| 应用资源 | requests `500m/1Gi`，limits `4 CPU/8Gi` |
| 后端 LB | `backend-service` 健康检查 `/game:8080`、WS `timeoutSec=3600`、所有 zonal NEG 挂载、≥2 健康端点 |

这些 manifest/工作流参数由 `tests/deploy/dev-ha-contract.test.ts` 与
`tests/deploy/setup-lb-contract.test.ts` 渲染断言，防止回退漂移。

## 部署与校验

1. 合并到 `main` 自动触发 `Deploy (develop)`，生成/更新 zonal NEG 与 Deployment。
2. 若 backend-service 尚未接入或 NEG 列表有变，按 `deploy/README.md` 跑一次
   `ENV=develop URL_MAP=taluna-dev-urlmap ./deploy/setup-lb.sh`（幂等）。
3. 校验（命令见 `deploy/README.md` 的「develop 后端/端点健康校验」）：
   - HPA 实况 `MINPODS=2`、`MAXPODS=5`，PDB 存在。
   - backend-service 健康检查 `/game:8080`、`timeoutSec=3600`、所有 zonal NEG 已挂、HEALTHY 端点 ≥2。
   - 近期 Kubernetes 事件无 endpoint-count-zero、NEG 降级同步、异常 5xx、OOMKilled、Evicted、重启尖峰。

## 验收

- 滚动发布期间，对 `/game/studio?project=<id>` 的反复请求不出现 TLS 超时 / 连接重置 /
  HTTP `000` / 缺失 `_next` chunk。
- `taluna-game-develop` 实况 HPA `2-5`、PDB 存在、近期事件无掉零端点 / NEG 降级。

## 范围之外（后续工作）

- 部署源对齐（引入 `dev` 集成分支、改 develop 触发为 `push dev`、限制分支 dispatch）是
  独立后续 PR，本次不动现有 `push main` 触发，避免打断既有发布路径。
- 生产 `/game` LB 接线与 prod 后端切换；topology spread 跨可用区保证。
