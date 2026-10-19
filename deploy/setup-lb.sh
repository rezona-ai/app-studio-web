#!/usr/bin/env bash
# 一次性 SRE 操作（不进 CI）：把 rezonalab-game-web 的 GKE standalone NEG 接到现有外部 HTTPS LB，
# 并在 url-map 加一条 /game/* path rule。幂等，可重复执行。
#
# 前置：先跑过一次 deploy（_deploy.yml）让 GKE 按 Service 注解自动建出 zonal NEG
#       rezonalab-game-web-${ENV}-neg，本脚本才能挂载它。
#
# 用法（三个环境对外前门 url-map，path matcher 均为 rezona-lab）：
#   ENV=develop    URL_MAP=rezona-lab-dev-urlmap   ./deploy/setup-lb.sh   # devlab.rezona.ai
#   ENV=stage      URL_MAP=rezona-lab-stage-urlmap ./deploy/setup-lb.sh   # stalab.rezona.ai
#   ENV=production URL_MAP=rezona-lab-prod-urlmap  ./deploy/setup-lb.sh   # lab.rezona.ai
set -euo pipefail

PROJECT="${PROJECT:-rezonaai}"
ENV="${ENV:?需指定 ENV=develop|stage|production}"
URL_MAP="${URL_MAP:?需指定 URL_MAP（该环境对外 LB 的 url-map）}"
REGION="${REGION:-us-east1}"

NEG="rezonalab-game-web-${ENV}-neg"
BACKEND="rezonalab-game-web-${ENV}-backend"
HEALTHCHECK="rezonalab-game-web-${ENV}-health-check"
PATH_MATCHER="rezona-lab"             # rezona-lab-*-urlmap 现有的 path matcher
MAX_RATE_PER_ENDPOINT=100

g() { gcloud --project="$PROJECT" "$@"; }

echo "==> 1) 健康检查（HTTP /game，端口 8080=Pod 容器端口）"
# NEG 容器原生 LB 直达 Pod:8080（非 Service:80），健康检查也必须探 8080。
# 端口须在集群健康检查防火墙白名单内（80/8080/8170/...），否则探不到 → 502。
g compute health-checks describe "$HEALTHCHECK" --global >/dev/null 2>&1 || \
  g compute health-checks create http "$HEALTHCHECK" --global \
    --request-path=/game --port=8080 \
    --check-interval=10s --timeout=5s --healthy-threshold=1 --unhealthy-threshold=3
# 幂等纠偏：确保端口为 8080
g compute health-checks update http "$HEALTHCHECK" --port=8080 >/dev/null 2>&1 || true

echo "==> 2) backend-service（WS：timeout=3600；EXTERNAL_MANAGED + HTTP）"
g compute backend-services describe "$BACKEND" --global >/dev/null 2>&1 || \
  g compute backend-services create "$BACKEND" --global \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --protocol=HTTP \
    --port-name=http \
    --timeout=3600 \
    --health-checks="$HEALTHCHECK"
# 确保已存在的 backend-service 也是 3600（幂等纠偏）
g compute backend-services update "$BACKEND" --global --timeout=3600

echo "==> 3) 把 zonal NEG 全部挂到 backend-service（动态发现 zone）"
ZONES=$(g compute network-endpoint-groups list \
          --filter="name=${NEG}" --format="value(zone)")
if [ -z "$ZONES" ]; then
  echo "!! 找不到 NEG ${NEG}；先跑一次 deploy 让 GKE 建出 NEG 再执行本脚本。" >&2
  exit 1
fi
for Z in $ZONES; do
  ZONE_SHORT="${Z##*/}"
  if g compute backend-services describe "$BACKEND" --global \
       --format="value(backends[].group)" | grep -q "/${ZONE_SHORT}/networkEndpointGroups/${NEG}"; then
    echo "   - ${ZONE_SHORT} 已挂载，跳过"
  else
    echo "   - 挂载 ${ZONE_SHORT}"
    g compute backend-services add-backend "$BACKEND" --global \
      --network-endpoint-group="$NEG" \
      --network-endpoint-group-zone="$ZONE_SHORT" \
      --balancing-mode=RATE \
      --max-rate-per-endpoint="$MAX_RATE_PER_ENDPOINT"
  fi
done

echo
echo "==> 4) url-map path rule（手动执行，避免误改共享 ${URL_MAP}）"
echo
echo "    ⚠️ ${URL_MAP} 是**五方共用**的（本前端 / pgc 后端 / koubou agent / Rezona Canvas / biz-api）。"
echo "       gcloud compute url-maps patch 是**整体替换 pathMatchers**、不是增量合并——"
echo "       2026-07-29 实际发生过：三人先后各自 patch，后两位把第一位加的规则冲掉，"
echo "       pgc 与 Rezona Canvas 的规则全丢、对外返回错后端，无人发现直到用户撞到。"
echo "       因此**只能走 export → 改 → 逐条 diff → import**，绝不用裸 patch。"
echo
cat <<EOS
    # 1) 导出并备份
    gcloud compute url-maps export ${URL_MAP} --project=${PROJECT} --global --destination=/tmp/um.yaml
    mkdir -p ~/lb-backups && cp /tmp/um.yaml ~/lb-backups/${URL_MAP}-BACKUP-\$(date +%Y%m%d-%H%M%S).yaml
    # 落 ~/lb-backups 而非 ~/Desktop：跳板机无桌面；秒级时间戳避免同日多次改动互相覆盖

    # 2) 在 pathMatchers[name=${PATH_MATCHER}].pathRules 里**追加**（不动别人的规则与 default）：
      - paths:
        - /game
        - /game/*
        service: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/${BACKEND}

    # 3) 逐条 diff 确认只多了自己这条，别人的规则与 default 未变，再导入
    diff /tmp/um.yaml /tmp/um-new.yaml
    # 手工执行不加 --quiet：保留那次交互确认，它是碰共享资源前的最后一道人工闸门
    gcloud compute url-maps import ${URL_MAP} --project=${PROJECT} --global --source=/tmp/um-new.yaml
EOS
echo "    （/game 与 /game/* 都要，前者兜住裸前缀，后者含 /game/_next/* 资源与 /game/api/*）"
echo "    ⚠️ pgc 占更长前缀 /game/pgcserver{,/*}、koubou 占 /game/koubou{,/*}，"
echo "       GCLB 按最长前缀优先，三者共存无需调序。"
echo
echo "完成 1-3。第 4 步确认后，${ENV} 环境的 /game 即指向 GKE rezonalab-game-web-${ENV}。"
