# rezonalab-game-web dev 环境上线记录

> 记录本仓库从 `taluna-game` 迁移过来、并首次部署到 Rezona Lab **dev** 的全过程与实测结果。
> 完成日期：2026-07-30。域名 `devlab.rezona.ai`，可测 URL：**https://devlab.rezona.ai/game**
>
> 本文是「这一次做了什么、资源叫什么名、怎么验的」的事实记录。
> CI/CD 机制与分支拓扑见 `docs/deploy/dev-productionization.md`；LB 接线脚本见 `deploy/setup-lb.sh`。

## 1. 仓库迁移映射

| 项 | 旧（taluna 栈） | 新（Rezona Lab 栈） |
| --- | --- | --- |
| 前端仓库 | `rezona-ai/taluna-game` | **`rezona-ai/rezonalab-game-web`**（本仓库） |
| 后端仓库 | `rezona-ai/pgc-server` | `rezona-ai/rezonalab-game-server` |
| Agent 仓库 | koubou（taluna 部署） | koubou（lab 部署，同集群另一 Deployment） |
| 用户面域名 | `tlndev.taluna.ai` / `taluna.ai` | `devlab.rezona.ai` / `stalab.rezona.ai` / `lab.rezona.ai` |
| K8s namespace | `develop`（与 taluna 全栈混住） | `rezonalab-game-{dev,stage,prod}`（三仓共用同一 ns） |
| Artifact Registry | `rezonago-repo` | `rezonalab-game-repo` |
| K8s Deployment | `taluna-game-develop` | `rezonalab-game-web-develop` |

两套环境**并行维护**：老 taluna 栈完全不动（实测 `tlndev.taluna.ai/game` 迁移期间始终 200）。

## 2. 首次部署前必须做的隔离改动（否则会打到 taluna 生产资源）

fork 出来的工作流沿用了 taluna 的资源名，**直接跑会污染老环境**。合并前修掉的四类：

1. **namespace 硬编码 `develop`** —— `_deploy.yml` 原本把 namespace 写死成 taluna 的 `develop`，
   一跑就会在 taluna 的 ns 里 `kubectl apply`，把线上跑了 51 天的 `taluna-game-develop` 顶掉。
   改为 `namespace` 必填 input，由 `deploy_dev.yml` / `deploy_stage.yml` / `deploy.yml` 分别传
   `rezonalab-game-{dev,stage,prod}`。
2. **`REPOSITORY_NAME: rezonago-repo`** → `rezonalab-game-repo`。
   （这一条实际是被最小权限部署身份挡下来的：首次部署在 push 镜像时 403 失败——部署 SA 只有新仓库的
   `artifactregistry.writer`，验证了最小权限设计有效。）
3. **`kubectl get namespace` 探测** → 改为 namespace 内 `kubectl get serviceaccounts -n "$NS"`。
   部署身份**没有** cluster 级 `get namespaces`（`kubectl auth can-i` 实测为 no），原写法必然失败。
4. **`SERVICE`/Deployment/HPA/探针名** → `rezonalab-game-web`，容器端口 8080，
   探针 `/game/api/readyz`、`/game/api/healthz`。

## 3. dev 实测基建资源清单

| 类别 | 名称 | 备注 |
| --- | --- | --- |
| GKE 集群 | `autopilot-cluster-1`（us-east1） | 与 taluna 同集群，靠 namespace 隔离 |
| namespace | `rezonalab-game-dev` | pgc / koubou / 本前端**共用** |
| Deployment | `rezonalab-game-web-develop` | 2 replica，2/2 Running |
| Service | `rezonalab-game-web-develop-service` | ClusterIP:80 → Pod:8080 |
| standalone NEG | `rezonalab-game-web-develop-neg` | zonal（us-east1-b/c/d），由 Service 注解自动建 |
| 健康检查 | `rezonalab-game-web-develop-health-check` | HTTP `GET /game`，**端口 8080**（NEG 直达 Pod，不是 Service:80） |
| backend service | `rezonalab-game-web-develop-backend` | `EXTERNAL_MANAGED` + HTTP，`timeout=3600`（WS） |
| url-map | `rezona-lab-dev-urlmap` | path matcher `rezona-lab`，**四方共用** |
| Artifact Registry | `us-east1-docker.pkg.dev/rezonaai/rezonalab-game-repo` | |
| 部署身份 | `rezonalab-game-deployer@rezonaai.iam.gserviceaccount.com` | 与 server 仓库**共用**：`container.clusterViewer` + `compute.networkViewer` + 新 AR 仓 `artifactregistry.writer` + ns 内 `edit` RoleBinding。前端不需要 GCS 与 GSA，无需额外授权 |
| GitHub secret | `GCP_SA_KEY` | 上述 SA 的 key |

**前端不持有任何数据面凭据**：无 GCS 桶、无 DB、无 Workload Identity GSA。
上游只有 `PGC_BASE_URL=https://devlab.rezona.ai`（同域，经 LB 回到 pgc / koubou / biz-api）。

## 4. LB 路由（`rezona-lab-dev-urlmap`，host `devlab.rezona.ai`）

按 GCLB **最长前缀优先**，四方共存、无需调序：

| path | backend | 归属 |
| --- | --- | --- |
| `/game/pgcserver`, `/game/pgcserver/*` | `rezonalab-game-dev-backend` | pgc 后端 |
| `/game/koubou`, `/game/koubou/*` | `koubou-agent-lab-dev-backend` | koubou agent |
| **`/game`, `/game/*`** | **`rezonalab-game-web-develop-backend`** | **本前端（本次新增）** |
| `/canvas/api`, `/canvas/api/*`, `/canvas/agent`, `/canvas/agent/*` | `rezona-canvas-api-develop-backend` | Rezona Canvas |
| `/canvas`, `/canvas/*` | `rezona-canvas-web-develop-backend` | Rezona Canvas |
| `/tln/biz/*` | `rezona-lab-dev-biz-api-backend` | biz-api |
| `default` | `rezona-lab-dev-web-backend` | Rezona Lab 官网 |

### 🔴 改这个 url-map 的铁律

`gcloud compute url-maps patch` **整体替换 `pathMatchers`，不是增量合并**。
2026-07-29 实发过事故：三个人先后各自 `patch` 同一个 url-map，最后写入者把前面所有人的规则冲掉，
pgc 与 Rezona Canvas 的规则全丢、对外返回错后端，无人发现直到用户在浏览器撞到。

因此**只能** `export → 改 → 逐条 diff → import`，并且：

1. 只**追加**自己的 path rule，不动别人的规则、也不动 `default`
2. import 前用集合比对断言「旧规则一条不少、只多自己这一条、`defaultService` 未变」
3. 备份留一份（本次：`~/Desktop/rezona-lab-dev-urlmap-BACKUP-before-web.yaml`）
4. import 后立刻回归别人的 path（见下表）

本次 import 的实测 diff 就是干净的 4 行新增、`丢失的旧规则: 无`。

## 5. 验证结果（2026-07-30，全部干净 GET、不带条件头）

### 本前端

| path | 结果 |
| --- | --- |
| `/game` | 200 `text/html`（Next.js，含 `/game/_next/static/*`） |
| `/game/api/healthz` | 200 json |
| `/game/api/readyz` | 200 json |
| `/game/share/pRWTgIwE/v1` | 200（分享路由是 `/share/[code]/[version]`，少版本段会 404，属正常） |
| `/game/api/pgc/api/showcase` | 200 —— BFF → pgc 转发通 |
| `/game/api/koubou/health` | 200 —— BFF → koubou 转发通 |

判据提示：响应**没有** `server: Google Frontend` 头才说明真进了 GKE；
带这个头 = 落到了 default 后端的 SPA fallback（事故时的典型表现）。

### 共存回归（别人的 path 一条没坏）

| path | 结果 |
| --- | --- |
| `/game/pgcserver/api/showcase` | 200 `server: uvicorn` |
| `/game/pgcserver/healthz` | 200 `server: uvicorn` |
| `/game/koubou/health` | 200 `server: uvicorn` |
| `/canvas` | 302 `server: nginx` |
| `/` | 200（default 后端） |
| `tlndev.taluna.ai/game` | 200 —— 老 taluna 栈未受影响 |

后端健康：`rezonalab-game-web-develop-backend` 两个 endpoint（b/c 各一）均 `HEALTHY`。

> `/tln/biz/*` 各路径返 404 —— 是 biz-api 自身路由，本次改动前后一致，非回归。

### 两个易误判的坑

**坑 1：滚动发布期 `/game` 会短暂 503（实测约 25s）。**
这是 standalone NEG **跨 zone 重编程**的窗口，不是配置错误：Autopilot 把新 Pod 调度到别的 zone 的新节点，
每个 zone 一个 NEG、GCLB 逐 zone 重编程不是原子的，旧 endpoint 摘除与新 endpoint 通过健康检查之间存在缝隙。

已确认防线**都在**、不需要改：`maxUnavailable=0` + `maxSurge=1` + `minReadySeconds=10` +
`preStop sleep 10` + PDB `50%` + HPA `2-5`，且 GKE 已注入 NEG readiness gate
（`cloud.google.com/load-balancer-neg-ready`，实测两个 Pod 均为 `True`）。

判据：`kubectl get deploy` 显示 `2/2` 但对外 503 时，查
`gcloud compute backend-services get-health rezonalab-game-web-develop-backend --global`——
若某 zone 显示 `(无 endpoint)` 而另一 zone 已 `HEALTHY`，就是这个窗口，几十秒自愈，**不要动 url-map**。
若要进一步收窄，把 `preStop sleep` 提到 30s（让旧 Pod 在新 endpoint 转健康期间继续服务）；dev 未做。

**坑 2**：url-map import **生效有传播窗口**，窗口内打 `/game/pgcserver/*` 可能瞬时 503 `text/plain`。
不要立刻判定「把 pgc 冲掉了」——先看 `backend-services get-health`
（本次实测 pgc backend 一直 `HEALTHY`），几十秒后复测即恢复为 `server: uvicorn`。

## 6. 复现步骤（stage / prod 照做）

```bash
# 1) 合到对应分支触发部署，让 GKE 按 Service 注解自动建出 zonal NEG
#    dev: push dev  /  stage: deploy_stage.yml  /  prod: deploy.yml（手动 dispatch）

# 2) 建健康检查 + backend service + 挂 NEG（幂等，可重复跑）
ENV=stage      URL_MAP=rezona-lab-stage-urlmap ./deploy/setup-lb.sh
ENV=production URL_MAP=rezona-lab-prod-urlmap  ./deploy/setup-lb.sh

# 3) url-map 加 /game + /game/*：严格走 export → diff → import（见 §4 铁律）
```

### stage / prod 前置条件（2026-07-30 用 gcloud 实测核对，均已就绪）

依据运维侧《Rezona Lab 三仓共用基建清单》，逐条与 GCP 现状比对的结果：

| 前置 | 状态 |
| --- | --- |
| namespace `rezonalab-game-{stage,prod}` | ✅ 已建，部署身份在三个 ns 均有 `edit` RoleBinding |
| url-map `rezona-lab-{stage,prod}-urlmap` | ✅ 已存在，且已含 pgc 的 `/game/pgcserver` 规则 |
| LB IP | stage `8.232.130.111` · prod `8.232.202.81`（证书 / 静态 IP / DNS 由运维侧持有，本仓不建） |
| 前端自己的 NEG / backend / health-check | ❌ **只有 develop 那套**——`rezonalab-game-web-{stage,production}-*` 尚不存在，必须先跑一次部署让 GKE 建出 NEG |
| 前端是否需要 GCS / DB / Workload Identity | 不需要，唯一上游是同域 `PGC_BASE_URL` |

> ⚠️ **别把 pgc 的资源当成自己的**：`rezonalab-game-{dev,stage,prod}-backend` 与
> `rezonalab-game-{develop,stage,production}-neg` 是 **pgc 后端**的，三个环境都已存在。
> 本前端的资源一律带 `-web-` 中缀：`rezonalab-game-web-${ENV}-{neg,backend,health-check}`。
> 认错会把 `/game` 指到 pgc 上。

> ℹ️ stage 直连 **prod** 数据库与 GCS 桶（运维侧 2026-07-29 决策）。这条对 pgc 是高危红线，
> 对本前端无影响——BFF 不碰 DB / 桶。

### 🔴 我们的 `/game` 规则目前不在任何巡检覆盖内

运维清单称已落地 `scripts/check_lb_routes.py` + `lb_route_audit.yml` 每 4 小时巡检共享 url-map。
2026-07-30 核实，**这条防线对本前端不成立，两个原因叠加**：

1. 该 workflow 只在 `rezonalab-game-server` 的 **`dev` 分支**上，未进 `main`。GitHub 的
   `schedule` 触发器**只从默认分支运行**，所以它一次都没跑过
   （`gh run list --workflow lb_route_audit.yml` 直接 `404: not found on the default branch`）。
2. 即便它跑起来，脚本里的 `EXPECTED` 表**只列了 pgc 自己的 `/game/pgcserver`** 三条，
   不含本前端的 `/game` + `/game/*`、koubou 的 `/game/koubou`、Canvas 的 `/canvas*`、
   biz-api 的 `/tln/biz/*`。

后果：本前端 2026-07-30 刚接入的 `/game` 规则若被别人的 `patch` 冲掉，巡检不会报警——
正是 §4 记录的「无人发现直到用户在浏览器撞到」那条路径。表现为 `devlab.rezona.ai/game`
静默返回 Rezona Lab 官网 SPA（`server: Google Frontend`）。

### ✅ 已补：本仓自己的只读巡检（2026-07-30）

自己的路由自己盯，不依赖别人仓库的期望表：

- `scripts/lb-route-audit/` —— 纯逻辑 `audit.ts`（无副作用、单测覆盖 10 例）+ 期望表 `expected.ts`
  + CLI 边界层 `index.ts`（`pnpm lb:audit`，只 `describe`，**不写任何 GCP 资源**）
- `.github/workflows/lb_route_audit.yml` —— 每 4 小时（`37 */4`，错开 pgc 仓的 `:17`）+ 手动 dispatch

巡检四类问题：① 我们的 `/game`、`/game/*` 逐条仍在且指向 `rezonalab-game-web-${ENV}-backend`
（少了裸 `/game` 会静默落 default）；② 更长前缀邻居 `/game/pgcserver`、`/game/koubou` 仍在且
不指向我们（它们消失会让流量被我们的 `/game/*` 吞掉）；③ 本前端没占 `default`；④ path matcher 仍在。

退出码分三档：`0` 健康 / `1` 路由偏离 / `2` 取数失败——取数失败与路由异常**必须分开**，
混同会训练出忽视告警的习惯。

> ⚠️ **本 workflow 必须在默认分支 `main` 上**才会被 schedule 触发。留在 `dev` 等于没启用
> ——`rezonalab-game-server` 正是踩了这个。
>
> ⚠️ 新环境接入 LB 后，记得把 `expected.ts` 里该环境的 `wired` 翻成 `true`，否则巡检跳过它。
> 期望表与 `setup-lb.sh` / `deploy_*.yml` 的口径由 `expected.test.ts` 钉住防漂移。

## 7. 分支保护（2026-07-30 配好；2026-08-27 补 `release/*` 与 `test`）

口径「**main / release 严 · dev 宽 · test 只归机器**」，人写的分支一律禁强推、禁删：

| 分支 | 必走 PR | required check | 批准数 | 说明 |
| --- | --- | --- | --- | --- |
| `main` | ✅ | `quality` + `branch-policy` | 0 | 发布线。批准数取 0 是因为目前单人维护，要求 1 会自锁。head 只收 `pick/*` `backport/*` `docs/*` `chore/*` |
| `release/*` | ✅ | `quality` + `branch-policy` | 0 | 冻结的上线快照，prod 的唯一部署源。head 只收 `backport/*` |
| `dev` | ❌ | 无 | — | 保住本地 `--no-ff` 合特性分支后直推 dev 的开发节奏。禁强推禁删走 ruleset `dev-guardrails`，**无 bypass、admin 也拦**（见下） |
| `test` | — | — | — | 机器分支（`deploy_dev_pr.yml` 叠合后 force-push）。**刻意不配任何保护**，理由见下 |

配置一律走 `deploy/setup-branch-protection.sh`（幂等，默认 dry-run，`APPLY=1` 才真改），别手点网页——手点的东西没有 diff 可看、也复核不了。

**两套机制并用不是随意混搭**：`main` / `dev` 是具体分支，用 classic branch protection（本仓 2026-07-30 起就是这套）；`release/*` 是通配模式**且 release 分支按需才创建**——classic 的 REST 端点按具体分支操作、分支不存在时 404，每切一条都要重配一次不现实，所以只能用 ruleset（`release-branches`）。

`main` / `dev` 是 `enforce_admins=false`，`release/*` 的 ruleset 给 `RepositoryRole 5`（admin）挂了 bypass——语义对齐：admin 可在故障时绕过，别当常态用。

> ⚠️ **`test` 为什么不配保护**（设计稿 §5.5 ③ 原本要求「只允许 `github-actions` 推」，落地时降级）：
> classic 的 `restrictions` 要求分支已存在，而 `test` 由第一次叠合创建；ruleset 侧要精确放行
> `GITHUB_TOKEN` 的推送，bypass actor 容易配错。**一旦配错，`compose-test` job 推不上 `test`，
> develop 环境再也不更新**——整条链瘫痪级故障。而它防的只是「人误推一条随时会被下一次叠合
> force-push 覆盖的分支」，损失近乎为零。收益/风险严重不对等，故列为**已知未做项**。人别推它就是了。

> 🔴 **`dev` 的禁强推不能用 classic protection，只能用 ruleset**（2026-08-27 实测）。本节自
> 2026-07-30 起声称「两条都禁强推」，但 `dev` 的 `allow_force_pushes` 实测一直是 `true`——而且
> **改不动**：`PUT .../branches/dev/protection` 传 `false` 或 `null` 都返回 200，响应体里仍是
> `"allow_force_pushes": {"enabled": true}`。同一套写法在 `main` 上却能生效，差别是 `main` 还带着
> required check 与 PR 要求；一条「什么都不要求」的 classic protection，GitHub 不认它的禁强推位。
> 现改为 ruleset `dev-guardrails`（`deletion` + `non_fast_forward`）。
>
> **由此，查「dev 能不能强推」不要看 classic 的 `allow_force_pushes`（它永远是 `true`，会误导）**，
> 要看实际生效的规则：
> ```bash
> gh api repos/rezona-ai/rezonalab-game-web/rules/branches/dev --jq '[.[].type]'
> # 预期：["deletion","non_fast_forward"]
> ```
>
> ⚠️ **`dev-guardrails` 的 `bypass_actors` 刻意为空，admin 也拦**——与 `main` / `release/*` 的
> 「admin 可绕过」不同。理由是 2026-08-27 真踩过一次：当时给了 admin bypass，用 admin 身份
> 试推时规则报了 `Cannot force-push to this branch` 却**照样放行**，`dev` 被推回旧 commit
> （靠记得旧 SHA 才捞回来）。`dev` 是唯一集成分支，被覆盖的历史没有 PR 记录可追，不该留口子。
> **真需要强推时**：先把该 ruleset 改成 `"enforcement": "disabled"`，推完立刻改回 `active`。

> ℹ️ `dev` 与 `main` **互不为祖先是刻意的**（两线独立演进，见
> `docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md`）。别照搬
> `rezonalab-game-server` 那套 `main ⊆ dev` 血缘校验——在本仓它是错的判据。

> ⚠️ **dev 上不要加 required status check**：GitHub 的 required checks 对**直接 push** 同样生效，
> 而直推的 commit 在推送当下还没有 check 结果，会被一律拒绝，等于封死 dev。CI 仍对每次 push 跑，
> 只是不阻断。**这条只约束 `dev`**——`main` / `release/*` 本就只走 PR，给它们加 required check
> 不会波及 dev 的直推节奏，所以 `branch-policy` 在那两条上是 required（不进 required 的话，
> 分支名合错只是个红叉，`gh pr merge` 照样能合，批准数 0 时尤其容易顺手合掉）。`rezonalab-game-server` 至今未配保护（protection 与 rulesets 实测均为空），
> 没有可照抄的样板；要统一口径就照本节配。

## 8. `main` release 晋级（2026-07-30 完成）

迁库后首次晋级：PR [#4](https://github.com/rezona-ai/rezonalab-game-web/pull/4)，merge commit `7d6f5a0`。
晋级前 `git rev-list --count dev..main` = 0（`main ⊆ dev`，纯追平无分叉），带过去 240 commits /
53 个 feature merge 组 / 365 files。

> ⚠️ **合入 `main` 只能用 merge commit，禁止 squash**：`scripts/release-board`（`pnpm board`）
> 会把 feature 身份的两个源（`Feature:` trailer 与 merge subject）同时打掉、看板失效。
> 晋级后实测 `pnpm board` 仍解析出 90 个 feature，history 完整。

合并**不触发**任何部署——`deploy.yml` 只接受手动 dispatch，不绑分支 / tag。

> 🔄 **本节记录的是 2026-08-27 之前的「整条 dev 开 PR 进 main」模式，已废止**（它每发一次版都在
> `main` 上留一条 dev 没有的桥接 commit——`a39dae5a` #9、`77fadda3` #10 就是）。现行是
> `pick/*` 挑拣 PR 进 `main`，`main` 再按需切 `release/YYYY-MM-DD` 发 prod。
> 口径见 `docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md`，
> 操作序列见 `docs/deploy/cicd-onboarding.md §5.2`。

## 9. stage 上线（2026-07-31 完成）

按 §6 复现步骤走通，无偏差。资源：`rezonalab-game-web-stage-{neg,backend,health-check}`
+ Deployment/Service/HPA `rezonalab-game-web-stage`（2/2，NEG 三 zone 齐）。
url-map `rezona-lab-stage-urlmap` 追加 `/game` + `/game/*`：diff 是干净的 4 行新增，
旧 3 条规则与 `defaultService` 零变动，备份 `~/Desktop/rezona-lab-stage-urlmap-BACKUP-20260730.yaml`。

### 🔴 两个把人带偏的验证陷阱（stage 实测踩到，dev 那轮侥幸没暴露）

**坑 1：本机 VPN 拦截 DNS，curl 打不到真实 LB。**
`dig stalab.rezona.ai` 返回 **`198.18.0.22`**（`devlab` 是 `198.18.0.23`），而 LB 实际是
`8.232.130.111`——`198.18.0.0/15` 是 VPN 客户端常用的拦截段。经它出去时
`/game/api/healthz` 返回**官网 SPA 的 index.html**（`text/html` + `server: Google Frontend`），
`/game/api/pgc/api/showcase` 返回 **502**，看起来就像「路由没接对」「BFF 转发挂了」。

绕开 DNS 直连 LB 复测，同样两个路径是 `application/json` 200 与 200：

```bash
curl --resolve stalab.rezona.ai:443:8.232.130.111 https://stalab.rezona.ai/game/api/healthz
```

**验证共享 LB 一律加 `--resolve` 直连 LB IP**，否则读到的是本机代理的响应，
会把好路由误判成坏、也可能把坏路由误判成好。三环境 LB IP：
dev `8.228.232.106` · stage `8.232.130.111` · prod `8.232.202.81`。

**坑 2（zsh）**：`R="--resolve host:443:ip"; curl $R ...` **不生效**——zsh 不对无引号参数扩展做
词分割，整串被当成一个参数，curl 报 `option --resolve ...: is unknown`。而失败的 curl 输出为空，
配合 `|| echo "(无 server 头)"` 会**打印出一片看似通过的结果**。用数组：
`R=(--resolve host:443:ip); curl "${R[@]}" ...`。

### stage 验证结果（全部经 `--resolve` 直连 LB）

| path | 结果 |
| --- | --- |
| `/game` · `/game/api/healthz` · `/game/api/readyz` | 200，**无** `server` 头（真进 GKE） |
| `/game/api/pgc/api/showcase` · `/game/api/koubou/health` | 200 —— BFF 转发链路通 |
| `/game/pgcserver/healthz` · `/game/koubou/health` | 200 `server: uvicorn`（未被冲掉） |
| `/tln/biz/me` | 401（biz-api 自身鉴权，非回归） |
| `/` | 200 `server: Google Frontend`（default 后端，符合预期） |

后端 `rezonalab-game-web-stage-backend` 2 个端点 `HEALTHY`。
`expected.ts` 的 stage 已翻 `wired: true`，`pnpm lb:audit` 现同时盯 dev 与 stage。

### LB 接入需要的权限（实测）

执行者需 **`roles/compute.loadBalancerAdmin`**。`roles/viewer` 不够——首次跑 `setup-lb.sh`
在第 1 步就失败：`Required 'compute.healthChecks.create' permission`。
（dev 那轮的 LB 资源实为 `charlescheng@rezona.ai` 创建，审计日志可查。）

## 10. prod 上线（2026-07-31 完成）

三环境至此全部上线。prod 走 §6 步骤无偏差，镜像 `rezonalab-game-web-production:main-3efde9f`。

| 项 | 值 |
| --- | --- |
| Deployment / Service | `rezonalab-game-web-production` 2/2 · ClusterIP `34.118.235.3:80` |
| NEG | `rezonalab-game-web-production-neg` us-east1-b/c/d 三 zone 全挂 |
| backend | `timeoutSec=3600` · `EXTERNAL_MANAGED` · HTTP |
| health-check | `/game` : 8080 |
| url-map | `rezona-lab-prod-urlmap` 追加 `/game` + `/game/*`，diff 为干净 4 行新增 |

⚠️ prod 的 `defaultService` 是 **`rezona-lab-prod-biz-api-backend`**，与 dev/stage 的
`rezona-lab-*-web-backend` **不同**（prod 还停在早期状态，非我方改动）。import 前后未变。
因此 prod 上 `/` 返回 404 是 biz-api 自身路由，**不是**本次回归。

### 验证结果（全部经 `--resolve lab.rezona.ai:443:8.232.202.81` 直连 LB）

| path | 结果 |
| --- | --- |
| `/game` · `/game/api/healthz` · `/game/api/readyz` | 200，**无** `server` 头 |
| `/game/figma/icons/logo.svg` | 200（basePath 静态资源生效） |
| `/game/api/pgc/api/showcase` · `/game/api/koubou/health` | 200，后者返回 `{"code":0,...,"database":"true"}` |
| `/game/pgcserver/healthz` · `/game/koubou/health` | 200 `server: uvicorn`（未被冲掉） |
| `/tln/biz/me` | 401（biz-api 自身鉴权） |
| devlab / stalab 的 `/game` | 200，未受影响 |

后端 2 个端点 `HEALTHY`。`expected.ts` 三个环境均已 `wired: true`，`pnpm lb:audit` 三条全绿。

### ⚠️ 传播窗口会伪装成故障（prod 实测两次）

import 后**立刻**测，先是 `/game` 返回 404 `text/plain`（而 `/game/api/*` 已 200），
几分钟后再测 `/game` 变 200 而 `/game/api/koubou/health` 又 404 了一次；连打 8 次全部 200。
两次都是 **GCLB 配置传播延迟**（官方 1–5 分钟），不是路由配错。

判据：**先看 `backend-services get-health`**——端点 `HEALTHY` 就说明后端没问题，
再等几分钟连打多次复测。单次 404 不足以下结论，**不要因此去动 url-map**（那才是真会出事的操作）。

## 11. 尚未完成

| 项 | 状态 |
| --- | --- |
| PostHog / Datadog 看板与告警 | 未接（缺 `POSTHOG_PERSONAL_API_KEY`、`DATADOG_{API,APP}_KEY`）。Datadog APM 目前只 dev 开启，stage/prod 是 `DD_TRACE_ENABLED=false` |
| biz-api 登录态端到端 | 未验（biz-api 侧路由/账号待对方确认） |
