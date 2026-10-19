#!/usr/bin/env bash
# 按部署目标（GCP project）解析出 project / 集群 / 镜像仓库三个值，写进 $GITHUB_ENV。
#
# **为什么单独成脚本、而不是写在 workflow 的 inline `run:` 里**：inline 脚本没法在
# 本地跑，也没法被契约测试当子进程调用断言。把它抽出来之后，「gtxy 目标缺了必要变量
# 就当场失败」这类闸门才是**可测**的——rezonalab-game-server 那边就是这么做的，
# 一条 inline 分支写错静默降级、没人发现，直到部到错的项目上。
#
# 用法：
#   GCP_TARGET=gtxy-rzn-infra bash deploy/render_env.sh
#   → 写 PROJECT_ID / CLUSTER_NAME / REPOSITORY_NAME 到 $GITHUB_ENV（无则打 stdout）
#
# 刻意**不**处理凭据：两个目标都走 `secrets.GCP_SA_KEY`，靠 job 的 `environment:`
# 作用域分叉取到各自项目的那把 key（`develop` vs `develop-gtxy`）。脚本里没有任何密钥。
#
# 退出码：0 正常；1 未知目标。
set -uo pipefail

_fail() {
  echo "::error::$*" >&2
  exit 1
}

GCP_TARGET="${GCP_TARGET:-rezonaai}"

case "$GCP_TARGET" in
  rezonaai)
    _project="rezonaai"
    _cluster="autopilot-cluster-1"
    _repo="rezonalab-game-repo"
    ;;
  gtxy-rzn-infra)
    # 新项目复用它**已有**的 autopilot-cluster-1（us-east1，rzn-prod-vpc），
    # 那里跑着 app 侧的 koubou 与 gorezona；两个项目的集群刻意同名，靠 project 区分。
    _project="gtxy-rzn-infra"
    _cluster="autopilot-cluster-1"
    _repo="rezonalab-game-repo"
    ;;
  *)
    _fail "unknown deploy target: $GCP_TARGET; expected rezonaai|gtxy-rzn-infra"
    ;;
esac

_emit() {
  printf '%s=%s\n' "$1" "$2"
  if [ -n "${GITHUB_ENV:-}" ]; then
    # heredoc 定界形式：值里带换行也不会注入出额外的 env 项。
    {
      printf '%s<<__RENDER_EOF__\n' "$1"
      printf '%s\n' "$2"
      printf '__RENDER_EOF__\n'
    } >>"$GITHUB_ENV"
  fi
}

_emit PROJECT_ID "$_project"
_emit CLUSTER_NAME "$_cluster"
_emit REPOSITORY_NAME "$_repo"
