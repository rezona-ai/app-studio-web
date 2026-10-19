#!/usr/bin/env bash
# 分支保护配置（幂等）。口径见 docs/deploy/rezonalab-dev-bringup.md §7 与
# docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md §5.5 ③。
#
# 默认 **dry-run**：只打印将要发出的 API 调用，并在最后复核当前实际状态，不改任何东西。
# 确认无误后加 APPLY=1 再跑一次。
#
#   ./deploy/setup-branch-protection.sh            # 看将要做什么 + 当前状态
#   APPLY=1 ./deploy/setup-branch-protection.sh    # 真改
#
# 两套机制并用，不是随意混搭：
# - `main` / `dev` 是**具体分支**，用 classic branch protection（本仓 2026-07-30 起就是这套）。
# - `release/*` 是**通配模式**，且 release 分支按需才创建 —— classic 的 REST 端点按具体分支
#   操作、且分支不存在时 404，每切一条 release 都要重配一次不现实。这类只能用 ruleset。
#
# 需要仓库 admin 权限。
set -euo pipefail

REPO="${REPO:-rezona-ai/rezonalab-game-web}"
APPLY="${APPLY:-0}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

run_api() { # $1=方法 $2=路径 $3=JSON body（可空）
  local method="$1" path="$2" body="${3:-}"
  if [ "$APPLY" = "1" ]; then
    if [ -n "$body" ]; then
      printf '%s' "$body" | gh api -X "$method" "$path" --input - >/dev/null
    else
      gh api -X "$method" "$path" >/dev/null
    fi
    echo "  ✔ 已执行 $method $path"
  else
    echo "  [dry-run] $method $path"
    [ -n "$body" ] && printf '%s\n' "$body" | sed 's/^/    /'
  fi
}

# ── 1. main：必走 PR + required checks + 禁强推禁删 ─────────────────────────────
# 批准数 0：目前单人维护，要求 1 会自锁。enforce_admins=false：故障时 admin 可绕过。
# branch-policy 也进 required：不进的话它只是个红叉，`gh pr merge` 照样能合（批准数 0 时
# 尤其容易顺手合掉）。「required check 对直推也生效」那条只约束 dev —— main/release 本就
# 只走 PR，给它们加不会波及 dev 的直推节奏。该 job 在 PR 事件上恒会运行，不会因 skip 卡死。
say "[main] 必走 PR + required checks quality/branch-policy + 禁强推禁删"
run_api PUT "repos/${REPO}/branches/main/protection" '{
  "required_status_checks": { "strict": false, "contexts": ["quality", "branch-policy"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}'

# ── 2. dev：不加 required check；禁强推禁删走 ruleset ────────────────────────────
# 🔴 dev 上**不要**加 required status check：GitHub 的 required check 对直接 push 同样生效，
#    而直推的 commit 在推送当下还没有 check 结果，会被一律拒绝 —— 等于封死 dev。
#
# 🔴 2026-08-27 实测到的 GitHub 行为：**classic protection 的 allow_force_pushes 在 dev 上写不进去**。
#    传 false 传 null 都一样，PUT 返回 200 且响应体里仍是 `"allow_force_pushes": {"enabled": true}`。
#    同一套写法在 main 上却是 false —— 差别是 main 还带着 required check 与 PR 要求；一条「什么都不
#    要求」的 classic protection，GitHub 不认它的禁强推位。所以 dev 的禁强推**只能走 ruleset**
#    （non_fast_forward 规则），下面那条 dev-guardrails 就是干这个的。
#    ⚠️ 别把这里改回 classic 的 allow_force_pushes:false 然后以为配上了 —— 它会静默不生效。
say "[dev] classic protection：无 required check、禁删（禁强推见下面的 ruleset）"
run_api PUT "repos/${REPO}/branches/dev/protection" '{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}'

# dev 的禁强推 / 禁删。bypass_actors 刻意为空 —— 不给 admin 留口子：
# dev 是唯一集成分支，被强推覆盖的历史没有 PR 记录可追，恢复全靠有人记得旧 SHA
# （2026-08-27 就真踩过一次：带 admin bypass 时规则报了错却照样放行，dev 被推回旧 commit）。
# 真需要强推时，先把本 ruleset 改成 "enforcement": "disabled"，推完再改回 active。
DEV_RULESET='{
  "name": "dev-guardrails",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/heads/dev"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ]
}'

say "[dev] ruleset：禁强推禁删（无 bypass，admin 也拦）"
DEV_RS_ID="$(gh api "repos/${REPO}/rulesets" --jq '.[] | select(.name=="dev-guardrails") | .id' 2>/dev/null || true)"
if [ -n "$DEV_RS_ID" ]; then
  echo "  已存在 ruleset id=${DEV_RS_ID}，改用 PUT 覆盖"
  run_api PUT "repos/${REPO}/rulesets/${DEV_RS_ID}" "$DEV_RULESET"
else
  run_api POST "repos/${REPO}/rulesets" "$DEV_RULESET"
fi

# ── 3. release/*：ruleset（通配 + 分支尚不存在，classic 做不到）─────────────────
# bypass_actors 给 RepositoryRole 5（admin），对齐 main 的 enforce_admins=false 语义：
# 故障时人可绕过，但别当常态。
RELEASE_RULESET='{
  "name": "release-branches",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "conditions": { "ref_name": { "include": ["refs/heads/release/*"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "quality" }, { "context": "branch-policy" } ] } }
  ]
}'

say "[release/*] ruleset：必走 PR + required checks quality/branch-policy + 禁强推禁删"
EXISTING_ID="$(gh api "repos/${REPO}/rulesets" --jq '.[] | select(.name=="release-branches") | .id' 2>/dev/null || true)"
if [ -n "$EXISTING_ID" ]; then
  echo "  已存在 ruleset id=${EXISTING_ID}，改用 PUT 覆盖"
  run_api PUT "repos/${REPO}/rulesets/${EXISTING_ID}" "$RELEASE_RULESET"
else
  run_api POST "repos/${REPO}/rulesets" "$RELEASE_RULESET"
fi

# ── 4. test：刻意不加保护 ───────────────────────────────────────────────────────
# 设计稿 §5.5 ③ 原本要给 test 配「只允许 github-actions 推」。落地时降级为不配，理由：
# - classic 的 restrictions 需要分支已存在，而 test 由第一次叠合创建；ruleset 侧要精确放行
#   GITHUB_TOKEN 的推送，bypass actor 配置容易配错；
# - 一旦配错，compose-test job 推不上 test = develop 环境再也不更新，是整条链瘫痪级故障；
# - 而它防的是「人误推一条随时会被下一次叠合 force-push 覆盖的分支」，损失近乎为零。
# 收益/风险严重不对等，故留作已知未做项（记在 bringup §7）。人别推 test 就是了。
say "[test] 刻意不配保护（理由见脚本注释与 bringup §7）"

# ── 5. deploy-for-testing 标签（叠合部署的入口，仓库级只需建一次）───────────────
say "[label] deploy-for-testing"
if gh label list --limit 100 --repo "$REPO" | grep -q '^deploy-for-testing'; then
  echo "  已存在，跳过"
elif [ "$APPLY" = "1" ]; then
  gh label create deploy-for-testing --repo "$REPO" --color BFD4F2 \
    --description "把该 PR 叠合进 test 分支并部署到 develop 环境；摘掉/关 PR 后自动重新叠合"
  echo "  ✔ 已创建"
else
  echo "  [dry-run] gh label create deploy-for-testing"
fi

# ── 复核（只读）────────────────────────────────────────────────────────────────
say "复核：classic branch protection"
for branch in main dev; do
  printf '  %-6s ' "$branch"
  gh api "repos/${REPO}/branches/${branch}/protection" \
    --jq '{checks:(.required_status_checks.contexts//"无"),pr:(if .required_pull_request_reviews then "必走" else "不要求" end),force:.allow_force_pushes.enabled,del:.allow_deletions.enabled}' \
    2>/dev/null || echo '(未配置)'
done
echo "  ⚠️ dev 那行的 force:true 是 GitHub 的写不进去（见 §2 注释），**不代表能强推**——"
echo "     真正生效的是下面 dev-guardrails 的 non_fast_forward 规则。"

say "复核：rulesets"
gh api "repos/${REPO}/rulesets" --jq '.[] | "  \(.name)  target=\(.target)  \(.enforcement)"' 2>/dev/null || echo "  (无)"

say "复核：各分支实际生效的 ruleset 规则（这才是禁强推的真相）"
for branch in dev main; do
  printf '  %-6s ' "$branch"
  gh api "repos/${REPO}/rules/branches/${branch}" --jq '[.[].type] | join(", ") | if . == "" then "（无 ruleset 规则）" else . end' 2>/dev/null || echo '(查询失败)'
done

if [ "$APPLY" != "1" ]; then
  say "以上为 dry-run。确认无误后：APPLY=1 $0"
fi
