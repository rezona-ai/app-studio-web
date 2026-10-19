#!/usr/bin/env bash
# 把「部署到哪些 GCP project」变成一个**运维变量**，而不是散在 workflow 文件里的常量。
#
# **为什么**：公司在把资源从官方渠道的计费账号迁到代理渠道的 `gtxy-rzn-infra`，两个
# 计算层只共存**周维度**，之后新项目就是唯一目标。这个窗口里「切过去」和「退回来」
# 都可能发生好几次，每次开 PR 太重；而 dispatch-only 的新项目入口会**漂移**——每次
# 改代码都要有人记得再点一次，漏一次新环境就落后，落后的环境验证不了任何东西。
#
# 所以：`vars.WEB_DEPLOY_TARGETS`（逗号分隔）驱动一个 matrix，改变量即改部署目标：
#   `rezonaai`                    → 今天的行为，一条腿（缺省值，零变化）
#   `rezonaai,gtxy-rzn-infra`     → 共存期，每次 push 两边都部（不漂移）
#   `gtxy-rzn-infra`              → 切换完成，只部新项目
# 退回来就是把 `rezonaai` 加回去，**秒级、不动代码、不开 PR**。
#
# **与 rezonalab-game-server 的同名脚本刻意不同**：那边把第一条腿单独拆成一个作业，
# 因为它下游挂着独立的 `verify-*` / `promote-*` 作业——矩阵里任一条腿红会让它们整个
# 被跳过，等于新项目一抖动就让老项目失去冒烟与自动回滚。**本仓没有独立验证作业**：
# 构建、apply、`rollout status` 全在同一个 `_deploy.yml` 调用内部，每条腿自成闭环，
# 一条腿失败不会让另一条少做任何事。所以这里一个矩阵就够，不需要 primary/secondary
# 拆分。`fail-fast: false` 仍然必需——它阻止一条腿失败时**取消**另一条在途的腿。
#
# 用法：
#   TARGETS=rezonaai,gtxy-rzn-infra bash deploy/deploy_targets.sh
#   → 往 $GITHUB_OUTPUT 写（无 $GITHUB_OUTPUT 时只打 stdout，供契约测试断言）：
#       targets  JSON 数组，每项是一条腿的 {gcp_target}
#
# 退出码：0 正常；1 参数非法（未知目标 / 空列表）。
set -uo pipefail

_fail() {
  echo "::error::$*" >&2
  exit 1
}

# 缺省只有老项目：**变量没配时行为必须与迁移前逐字一致**。
TARGETS="${TARGETS:-rezonaai}"
[ -n "${TARGETS//[[:space:],]/}" ] || _fail "WEB_DEPLOY_TARGETS 为空；至少要有一个目标（想停部署请禁用 workflow，别清空变量）"

_out=""
_seen=""
_IFS_OLD="$IFS"
IFS=','
for _t in $TARGETS; do
  IFS="$_IFS_OLD"
  _t="${_t#"${_t%%[![:space:]]*}"}"
  _t="${_t%"${_t##*[![:space:]]}"}"
  [ -n "$_t" ] || continue
  # 去重：`rezonaai,rezonaai`（回退时手滑很容易打出来）会产出两条同 namespace 的腿，
  # 它们在同一个 run 内并发对**同一个 Deployment** apply 并各自等 rollout，
  # 互相把对方的 ReplicaSet 判成「未就绪」。
  case ",$_seen," in
    *",$_t,"*)
      echo "::warning::deploy target $_t 出现多次，已忽略重复项（重复会让两条腿并发 apply 同一个 Deployment）" >&2
      continue
      ;;
  esac
  _seen="$_seen,$_t"
  case "$_t" in
    rezonaai | gtxy-rzn-infra) ;;
    *) _fail "unknown deploy target: $_t; expected rezonaai|gtxy-rzn-infra" ;;
  esac
  _entry=$(printf '{"gcp_target":"%s"}' "$_t")
  if [ -z "$_out" ]; then _out="$_entry"; else _out="$_out,$_entry"; fi
done
IFS="$_IFS_OLD"

[ -n "$_out" ] || _fail "解析后目标列表为空：TARGETS=$TARGETS"

printf 'targets=[%s]\n' "$_out"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'targets=[%s]\n' "$_out" >>"$GITHUB_OUTPUT"
fi
