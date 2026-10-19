# PR 标签部署：`deploy-for-testing` 灵活测试链路

## 目的

特性分支不合入 dev 也能上 develop 环境真机测试：给 PR 打 `deploy-for-testing` label
立刻把 **PR head** 部署到 develop；测试结束（关 PR / 摘 label）自动回滚重部署 **dev 分支**。

## 现状

- develop 部署由 `deploy_dev.yml` 承担：push dev 自动 / 手动 dispatch，瘦封装调 `_deploy.yml`。
- 手动 dispatch 虽可指定分支，但测试完要人工再 dispatch 一次 dev 回滚，且无 PR 生命周期联动。

## 设计

新增 `.github/workflows/deploy_dev_pr.yml`，`on: pull_request`（types:
`labeled / unlabeled / synchronize / reopened / closed`），两个 job 均复用 `_deploy.yml`，
`with:` 参数与 `deploy_dev.yml` **逐项一致**（仅 `ref` 不同）：

| job | 触发条件 | ref |
|---|---|---|
| `deploy-pr` | PR 处于 open、带 `deploy-for-testing` label，且事件为「刚打上该 label」/ 推新提交(synchronize) / 重开(reopened) | `pull_request.head.sha` |
| `redeploy-dev` | 带该 label 的 PR 被 closed（含 merge），或该 label 被摘除(unlabeled) | `dev` |

关键约束：

- **串行互斥**：concurrency group 与 `deploy_dev.yml` 同为 `deploy-develop`
  （GitHub concurrency 组是仓库级、跨 workflow 生效），`cancel-in-progress: false`，
  标签部署与 push dev 部署天然排队，不互踩。
- **同仓分支限定**：`head.repo.full_name == github.repository`，fork PR 不触发
  （fork 也拿不到 `secrets: inherit`）。
- **PR 合入 dev 的双触发**：merge 会同时触发本 workflow 的 `redeploy-dev`（ref=dev）
  与 `deploy_dev.yml`（push dev），两者部署同一内容且串行执行，冗余但无害，不做去重。
- 镜像 tag 侧 `_deploy.yml` 用 `GITHUB_REF_NAME`，pull_request 事件下为 `<PR号>/merge`，
  产出形如 `72-merge-<sha7>` 的 tag——可辨识来源，不改 `_deploy.yml`。

## 防漂移

`deploy_dev_pr.yml` 与 `deploy_dev.yml` 的环境参数若漂移，标签部署会以错误资源/后端地址
上 develop。新增契约测试 `tests/deploy/deploy-for-testing-contract.test.ts`：

- 两个 workflow 的 `hpa_* / app_* / pgc_base_url / public_pgc_base_url / environment` 逐项相等
  （PR workflow 中每处出现都校验）；
- concurrency group 一致；
- `deploy-pr` 的 ref 是 `pull_request.head.sha`，`redeploy-dev` 的 ref 是 `dev`。

## 备选与取舍

- ~~独立测试环境（每 PR 一个 namespace）~~：成本高（LB/url-map/域名均需增设），YAGNI；
  develop 单环境「借用—归还」模式已满足灵活测试。
- ~~扩展 deploy_dev.yml 加 pull_request 触发~~：单文件双触发源条件表达式纠缠，拆独立
  workflow 更可读，参数一致性交给契约测试守护。

## 使用方式

1. 特性分支开 PR（base 任意，一般为 dev），打 label `deploy-for-testing` → 立即部署该 PR。
2. 期间推新提交自动跟随重部署。
3. 测完关 PR（或摘 label）→ 自动重部署 dev 回滚。
