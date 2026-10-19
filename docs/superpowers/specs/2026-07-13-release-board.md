# 功能上线看板（release board）设计稿

日期：2026-07-13

## 目标

一条命令生成静态 HTML 看板，展示每个 feature 在 dev / stage / prod 三套环境的上线情况，供发布前核对"哪些功能到了哪一层"。

## 环境 ↔ 数据源映射（完全以 GitHub 为准）

| 环境 | 当前上线内容 | 依据 |
|---|---|---|
| dev | `origin/dev` | push dev 自动触发 `Deploy (develop)`，分支尖即近似部署态 |
| stage | `Deploy (stage)` 最近一次成功 run 的 `headSha` | stage 手动 dispatch（默认 main），实际部署 commit 只在 Actions 记录里 |
| prod | `Deploy (production)` 最近一次成功 run 的 `headSha` | 同上，prod 亦为手动 dispatch |

- 运行前 `git fetch origin --tags`，全部祖先判定基于远端数据；
- Actions 记录经 `gh run list --workflow ... --status success` 读取（需 `gh` 已登录）；
- 某环境从未成功部署时显示"未部署"，全列置空。

## Feature 单位

仓库约定特性分支回合用 `--no-ff`，merge commit message 形如 `merge: <一句话描述> (<分支名>)`。看板以这些 merge commit 为 feature 单位：

- 在 `origin/dev` 的 `--first-parent --merges` 历史上枚举，按提交时间倒序；
- 跳过 `Merge pull request ...`（dev→main 同步）与 `Merge branch ...`（分支同步）等非 feature 合并；
- 某 feature 是否"已上线到环境 X" = 该 merge commit 是否为环境 X 引用的祖先。

## 输出

- 生成 `release-board.html`（git 忽略，不入库），自包含无外部依赖；
- 头部显示三环境的数据源（引用名或 workflow）/ 短 SHA / 时间与统计（各环境 feature 数）；
- 表格列：feature 描述、分支名、合入时间、dev / stage / prod 状态（✅ 已上线 / — 未到）；
- 亮暗色随系统 `prefers-color-scheme` 自适应。

## 非目标

- 不查询 k8s 实际部署（以 GitHub Actions 部署记录为准，映射见上表）；
- 不做人工录入 / 编辑；
- 不侵入 Next.js 应用（纯 `scripts/` 工具）。
