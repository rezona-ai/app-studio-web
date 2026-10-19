# rezonalab-game-web CI/CD 与部署

本目录是 rezonalab-game-web 的容器化与部署资产。CI/CD 用 GitHub Actions，运行时部署在
GKE `autopilot-cluster-1`（`rezonaai` / `us-east1`），对外复用现有外部 HTTPS LB，
以 `/game/*` 路径暴露。

## 架构总览

```
rezona.ai/game/*  ──►  外部 HTTPS LB (url-map: rezona-lab-prod-urlmap；旧域 lab.rezona.ai/game/* 永久直连)
                          │  path rule /game, /game/*（path matcher: rezona-lab）
                          ▼
                    backend-service rezonalab-game-web-production-backend  (timeout=3600)
                          │  standalone NEG (zonal)
                          ▼
                    GKE: Deployment + Service(ClusterIP) @ namespace rezonalab-game-prod
                          └─ 自定义 server.ts（Next SSR + 访问日志；生产不托管业务 WS）
```

- **单服务**（Next.js 16 + 自定义 `server.ts`），不能走 Next standalone，
  镜像保留完整 `node_modules`（含 `tsx`）+ `.next`，运行时 `tsx server.ts`。
- **basePath `/game`**：构建期注入 `NEXT_PUBLIC_BASE_PATH=/game`，让应用整体跑在 `/game` 前缀下
  （页面、`/game/_next/*` 资源、`/game/api/*` 都在该前缀内），与 LB path rule 对齐。
  本地开发不设该变量 → 跑在根路径，互不影响。
- **WebSocket 归属（易误解）**：本服务 backend-service 上的 `timeoutSec=3600` **保护的不是 agent 对话 WS**。
  生产的对话 WS 由浏览器直连 `wss://<host>/game/koubou`（见 `src/koubou/wsBase.ts` 与
  `src/lib/backend-routes.ts` 的 `KOUBOU_PREFIX`），按 GCLB 最长前缀落 **koubou 自己的 backend-service**，
  一个字节不经本服务；`server.ts` 生产分支只把 upgrade 交给 Next（仅 HMR 用）。
  故对话断连要去查 koubou 的 backend，不是本服务的。本服务这个 3600 是历史遗留 + 防御性继承：
  将来本服务若自己托管长连接才用得上。
- **standalone NEG 模式下 `BackendConfig` 不生效**，故此类超时只能直接设在 backend-service。

## Workflows（`.github/workflows/`）

| 文件 | 触发 | 作用 |
|---|---|---|
| `ci.yml` | push 任意分支 / PR | pnpm install → lint → `tsc --noEmit` → test → build |
| `_deploy.yml` | `workflow_call`（可复用） | Buildx → AR → envsubst\|kubectl → rollout → Lark 通知 |
| `deploy_dev.yml` | **仅**手动 dispatch（默认 `dev`） | develop 的旁路直发；刻意无 push 触发器 |
| `deploy_dev_pr.yml` | 推 dev / PR 打摘 label `deploy-for-testing` / 带标签 PR 推提交或关闭 | 合成 `test` = dev + 全部带标签 PR，部署到 develop；冲突则整次不部署 |
| `deploy_stage.yml` | 手动 dispatch | 部署 stage |
| `deploy.yml` | 手动 dispatch（ref **必填无默认**，只接受 `release/*`） | 部署 production |

`deploy_*` 都是瘦封装，`secrets: inherit` 调用 `_deploy.yml`，只传环境差异参数。

## 前置条件

- GitHub Secret **`GCP_SA_KEY`**（CI 部署身份 `rezonalab-game-deployer@rezonaai.iam.gserviceaccount.com`，
  与 `rezonalab-game-server` 共用）。按最小权限授：`rezonalab-game-repo` 仓上
  `roles/artifactregistry.writer` + `roles/container.clusterViewer` + `roles/compute.networkViewer`
  + 各 namespace 内 `edit` RoleBinding。**没有** cluster 级 `get namespaces`——工作流里探测
  namespace 只能用 ns 内资源（`kubectl get serviceaccounts -n $NS`），别写 `kubectl get namespace`。
- GitHub Secret `LARK_WEBHOOK_URL`（可选，缺省则静默跳过通知）。
- GitHub Environments：`develop` / `stage` / `production`（与 k8s namespace 名解耦，见下表）。
- LB 接入（`setup-lb.sh` + 改 url-map）走**执行者本人**的 gcloud 凭证，不走 CI SA（CI SA 只有
  `compute.networkViewer` 只读，实测写不了）。执行者需 **`roles/compute.loadBalancerAdmin`**
  ——`roles/viewer` / `roles/editor` 都不够：viewer 会在建 health-check 时就报
  `Required 'compute.healthChecks.create' permission`。先自查：
  `gcloud projects get-iam-policy rezonaai --flatten="bindings[].members" --filter="bindings.members:<你>@rezona.ai" --format="value(bindings.role)"`

## 环境与 url-map 映射

三个 namespace 由本前端 / pgc(`rezonalab-game-server`) / koubou **共用**，path matcher 均为 `rezona-lab`：

| 环境（GH Environment） | namespace | 域名 | url-map |
|---|---|---|---|
| develop | `rezonalab-game-dev` | devlab.rezona.ai | `rezona-lab-dev-urlmap` |
| stage | `rezonalab-game-stage` | stalab.rezona.ai | `rezona-lab-stage-urlmap` |
| production | `rezonalab-game-prod` | rezona.ai（2026-09-03 起主域；旧域 lab.rezona.ai 的 /game/* 永久直连） | `rezona-lab-prod-urlmap` |

> namespace 是 `_deploy.yml` 的必填 input，**绝不能**回退成 environment 同名值——那会打进老 taluna 栈的
> `develop` / `production`，顶掉线上 Deployment。

## 上线 Runbook（每个环境一次）

dev 已按此流程走通，实测记录（资源名清单 / LB 路由表 / 两个易误判的坑）见
[`docs/deploy/rezonalab-dev-bringup.md`](../docs/deploy/rezonalab-dev-bringup.md)。

```bash
# ① 触发部署，生成 zonal NEG
#   develop：推送 dev 分支触发叠合（deploy_dev_pr.yml 合成 test 后部署）
#   stage  ：Actions 手动 dispatch "Deploy (stage)"
#   prod   ：Actions 手动 dispatch "Deploy (production)"（--ref 与 -f branch 同填 release/YYYY-MM-DD，不绑 tag）

# ② 部署成功后，把 NEG 接进 LB（自动建 health-check + backend-service(timeout=3600) + 挂 NEG）
ENV=develop    URL_MAP=rezona-lab-dev-urlmap   ./deploy/setup-lb.sh   # dev（已完成）
ENV=stage      URL_MAP=rezona-lab-stage-urlmap ./deploy/setup-lb.sh   # stage
ENV=production URL_MAP=rezona-lab-prod-urlmap  ./deploy/setup-lb.sh   # prod

# ③ 往 url-map 加 /game path rule（脚本会打印片段；唯一碰共享资源的步骤，故人工执行）
```

### ③ 改 url-map 的具体操作（只能 export → diff → import）

🔴 `gcloud compute url-maps patch` 是**整体替换 `pathMatchers`、不是增量合并**。
`rezona-lab-*-urlmap` 由本前端 / pgc / koubou / Rezona Canvas / biz-api 共用，2026-07-29 实发过
「后写入者把前面所有人的规则冲掉」的事故。因此必须 export → 改 → 逐条 diff → import：

```bash
# 导出（含 fingerprint，顺手即回滚备份）
gcloud compute url-maps export rezona-lab-prod-urlmap \
  --project=rezonaai --global --destination=urlmap.prod.yaml
cp urlmap.prod.yaml urlmap.prod.yaml.bak

# 在 pathMatchers[name=rezona-lab].pathRules 末尾**追加**（不动别人的规则、也不动 default）：
#   - paths:
#     - /game
#     - /game/*
#     service: https://www.googleapis.com/compute/v1/projects/rezonaai/global/backendServices/rezonalab-game-web-production-backend

# import 前断言：旧规则一条不少、只多自己这一条、defaultService 未变
# 导入（校验 + fingerprint 乐观锁，期间被改过会拒绝）
gcloud compute url-maps import rezona-lab-prod-urlmap \
  --project=rezonaai --global --source=urlmap.prod.yaml
```

GCLB 是**最长前缀匹配**，`/game/*` 与更长的 `/game/pgcserver/*`、`/game/koubou/*` 以及
`/canvas/*`、`/tln/biz/*`、default（Rezona Lab 官网后端）互不冲突，追加位置不影响匹配。

### 验证

```bash
gcloud compute url-maps describe rezona-lab-prod-urlmap --project=rezonaai --global \
  --format="yaml(pathMatchers)" | grep -A3 game
curl -I https://rezona.ai/game     # LB 重新生效约 1-2 分钟，后端 healthy 后返回 200
# 判据：响应**没有** server: Google Frontend 头才说明真进了 GKE；带该头 = 落到 default 后端
```

import 后立刻回归别人的 path（`/game/pgcserver/healthz`、`/game/koubou/health`、`/canvas`、`/`），
确认一条没坏。

### 回滚

```bash
gcloud compute url-maps import rezona-lab-prod-urlmap \
  --project=rezonaai --global --source=urlmap.prod.yaml.bak
```

## 文件清单

- `dockerfile` — 多阶段构建，运行层 `tsx server.ts`
- `k8s-deployment.yaml` — Deployment + Service(ClusterIP + standalone NEG 注解)，envsubst 渲染
- `hpa.yaml` — CPU 70% 自动扩缩 + PodDisruptionBudget（`minAvailable: 50%`，自愿驱逐期保端点）
- `setup-lb.sh` — 一次性把 NEG 接进现有 LB（幂等）

## Dev 高可用（生产化）

develop 已按 Dev 生产化目标加固，消除 standalone NEG 掉到零端点的故障类：

- HPA `2-5`（`deploy_dev.yml` 的 `hpa_min/hpa_max`），下限 2 保证常态/维护期不单点。
- Deployment 用 `RollingUpdate` + `maxUnavailable=0` + `maxSurge=1` + `minReadySeconds: 10`，
  新 pod 就绪后才下线旧 pod，发布全程容量不缩水。
- `preStop: sleep 10` + `terminationGracePeriodSeconds: 30`：先让 GCLB 从 NEG 摘除本端点再收
  SIGTERM，避免在途请求打到正在终止的 pod。
- PodDisruptionBudget `minAvailable: 50%`：节点升级/维护等自愿驱逐期至少保留 1 个可用端点。
- 应用容器 requests `500m/1Gi`、limits `4 CPU/8Gi`。

> 这些参数由 `tests/deploy/dev-ha-contract.test.ts` 渲染 manifest 后断言，改动会触发 CI 失败提醒同步。

### develop 后端/端点健康校验

LB 接入是一次性 SRE 操作（`setup-lb.sh`，不进 CI），但其口径由 `tests/deploy/setup-lb-contract.test.ts`
守护：`backend-service` 名 `rezonalab-game-web-${ENV}-backend`、`health-check` 探 `/game:8080`、WS `timeout=3600`。
HA 改造（U2）后，develop 后端应稳定保持 **≥2 个健康端点**。改完用下列命令校验（完整 runbook 见
`docs/deploy/dev-productionization.md`）：

```bash
ENV=develop
BACKEND="rezonalab-game-web-${ENV}-backend"
NEG="rezonalab-game-web-${ENV}-neg"

# 1) backend-service 的健康检查路径与 WS 超时
gcloud compute backend-services describe "$BACKEND" --global \
  --format="value(healthChecks, timeoutSec)"
gcloud compute health-checks describe "rezonalab-game-web-${ENV}-health-check" --global \
  --format="value(httpHealthCheck.requestPath, httpHealthCheck.port)"   # 期望 /game 8080

# 2) 所有 zonal NEG 都挂上 backend、且端点健康
gcloud compute backend-services get-health "$BACKEND" --global \
  --format="value(status.healthStatus[].healthState)" | sort | uniq -c   # 期望 HEALTHY 计数 ≥2

# 3) 用户面入口在滚动期不掉线（多打几次,不应出现 000/重置/缺 _next chunk）
#    打 /game：工作台已随 109be23 移到根路由,/game/studio 不再存在
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code}\n" https://devlab.rezona.ai/game; done
```

## Datadog APM（BFF 服务端监控，dev 先行）

BFF（`server.ts` + Next 自定义 server）的服务端可观测接 Datadog APM——SSR 渲染与
pgc/koubou 出站代理由 `dd-trace` 自动 instrument，数据进 Datadog us5 内置 **APM › Services**
视图（延迟 p50/p95/p99、吞吐、错误率、resource 路由），**不自建看板**。

**接入方式（ESM preload）**：本仓库是 ESM（`import` + 顶层 await）+ Node 22，用 tsx 跑 `server.ts`。
dd-trace 经 `NODE_OPTIONS="--import dd-trace/initialize.mjs"` 在进程启动时最先加载（一步完成
init + ESM loader hook，保证 `http`/`next`/`undici` 被 instrument）。**无需改 Dockerfile CMD、无需
单独 tracer 文件**。

**环境矩阵**（由 `.github/workflows/_deploy.yml` 按环境注入，模板只留占位符）：

| 变量 | develop | stage/prod |
| --- | --- | --- |
| `NODE_OPTIONS` | `--import dd-trace/initialize.mjs` | 空（不 preload，零变更） |
| `DD_TRACE_ENABLED` | `true` | `false` |
| `DD_SERVICE` | `rezonalab-game-web` | `rezonalab-game-web` |
| `DD_ENV` | `${ENVIRONMENT}`（develop） | namespace |
| `DD_VERSION` | `${GITHUB_SHA}` | 同 |
| `DD_AGENT_HOST` | fieldRef `status.hostIP`（节点上的 DD Agent，trace→:8126） | 同 |

> dd-trace 原生可选模块（appsec/iast/profiling/runtime-metrics）的 build script 在
> `pnpm-workspace.yaml` 置 `false` 不编译——`node:22-slim` 无 node-gyp 工具链，基础 tracing 纯 JS 即可。

**日志-trace 关联**：本仓库是手写 JSON logger（`src/server/logging.ts`），`DD_LOGS_INJECTION`
对它无效，故在 `emit()` 里手动从活跃 span 取 `dd.trace_id`/`dd.span_id`（`DD_TRACE_ENABLED!=true`
时零开销、不加字段）。Cloud Logging 日志因此能跳到对应 APM trace。

**验证（dev 部署后）**：
```bash
# 1) us5 APM › Services 出现 service:rezonalab-game-web，延迟/吞吐/错误率有数据（dd-trace 自动产生 span）
# 2) Pod 启动无 tracer 报错、持续 Ready：
env -u GOOGLE_APPLICATION_CREDENTIALS kubectl logs -n rezonalab-game-dev -l app=rezonalab-game-web --since=5m | grep -iE "dd-trace|error" | head
# 3) JSON 访问日志带 dd.trace_id：
env -u GOOGLE_APPLICATION_CREDENTIALS kubectl logs -n rezonalab-game-dev -l app=rezonalab-game-web --since=5m | grep dd.trace_id | head -1
```

**Follow-up（本次不做，见 pgc-server `docs/plans/2026-06-25-002`）**：浏览器 RUM、跨服务分布式
trace、自定义 DogStatsD 指标、自建 dashboard/告警、prod 启用。
