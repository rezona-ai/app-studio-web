# 仓库迁移到 rezonalab-game-web + 域名换 rezona.ai（设计稿）

日期：2026-07-30

## 背景

仓库从 `rezona-ai/taluna-game-web`（本地 `~/Documents/taluna/game-web`）迁到
`rezona-ai/rezonalab-game-web`（本地 `~/Documents/rezonalab/rezonalab-game-web`），
同时三套环境换用新域名：

| 环境 | 新域名 | 旧域名 |
|---|---|---|
| develop | `devlab.rezona.ai` | `tlndev.taluna.ai` |
| stage | `stalab.rezona.ai` | `tlnstage.taluna.ai` |
| production | `lab.rezona.ai` | `taluna.ai` |

cookie 制鉴权的 cookie 域随之从 `.taluna.ai` 变为 `.rezona.ai`。

## 目的

1. 新目录下是**同一个仓库**（保留完整 git 历史与 merge 分组，上线看板脚本继续可用），remote 指向新 GitHub 仓库。
2. 代码 / env / 活文档 / 测试断言里的后端基址与 cookie 域全量切到 `*.rezona.ai`。
3. 仓库自身标识（包名、persist key、仓库 URL 引用）改为 `rezonalab`。

## 约束（盘问共识）

- **迁移方式**：整段历史搬迁 —— 复制 `.git` 全历史 + 工作树，只改 `origin` URL；不新起 initial commit。
- **网关契约不变**：新域名下路径前缀与旧环境同构 —— pgc 仍挂 `/game/pgcserver`、koubou 仍 `/game/koubou`、
  biz-api 仍 `/tln/biz`、前端 basePath 仍 `/game`。故 `src/lib/backend-routes.ts` 与三个代理**不动**，只换域名。
- **基础设施名本轮不动**：k8s Deployment/HPA/PDB/NEG 与镜像名 `taluna-game-${ENV}`、GCP `rezonaai` /
  `rezonago-repo`、三个 urlmap 名保持原样。理由：这些对应云上已存在实体，改名等于新建资源 +
  LB backend-service/NEG 重挂，需单独一轮运维；本轮改了会让新名镜像部署上不了 LB。
  `tests/deploy/*.test.ts` 的部署契约断言同理不动。
- **品牌文案与主站契约 key 本轮不动**：页面 title `Taluna · Game Agent`、`LoadingScreen` 字标、
  `public/figma/icons/logo.svg`、11 个语言包里的「Taluna」保持；`taluna-config` /
  `taluna-agent-backend` 是与主站的跨应用契约（主站下发主题 / 语言），单方面改名会断掉同步。
- **历史设计稿不动**：`docs/superpowers/{specs,plans}/` 是当时的设计记录，保留原文不重写历史；
  只改「当下生效」的活文档（`CLAUDE.md` / `AGENTS.md` / `deploy/README.md` / `.env.example` / `loadtest/README.md`）。

## 方案

单一方案，按「搬仓库 → 换域名 → 换标识」三步推进，每步保持仓库可 lint / 测试 / 构建：

1. **搬仓库**：`.git` 整体复制到新目录（目标原 `.git` 为零提交空仓，仅有 remote 配置），
   `git remote set-url origin` 指向 `rezonalab-game-web`；工作树用 rsync 复制，排除
   `node_modules` / `.next` / `.pnpm-store` / 构建产物；`.env`（本地开发用，未跟踪）一并带过去。
2. **换域名**：按「先长后短」顺序替换，避免裸域名规则误伤子域：
   `tlndev.taluna.ai` → `devlab.rezona.ai`；`tlnstage.taluna.ai` → `stalab.rezona.ai`；
   `app.taluna.ai` → `app.rezona.ai`（仅测试常量）；`*.taluna.ai` / `.taluna.ai` → `.rezona.ai`；
   余下裸 `taluna.ai` → `lab.rezona.ai`。注释里的环境代称 `tlndev`/`tlnstage` 同步改 `devlab`/`stalab`。
3. **换标识**：`package.json` name、`AGENTS.md` 标题与 `repos/rezona-ai/...` 引用、zustand persist key
   `taluna-v4` → `rezonalab-v4`（新域名是新 origin，localStorage 本来就是空的，不存在草稿丢失）、
   `loadtest/taluna-read-baseline.js` → `rezonalab-read-baseline.js` 与其 env 变量 `TALUNA_BASE` → `REZONALAB_BASE`。

## 成功标准

- 新目录 `git log` 与旧仓库一致（tip `6b3cb60`），`origin` = `rezonalab-game-web`，工作树干净。
- 仓库内 `grep -rI "taluna\.ai\|tlndev\|tlnstage"` 除 `docs/superpowers/` 历史稿外零命中。
- `grep -rI "taluna-v4\|taluna-game-web\|TALUNA_BASE"` 除历史稿外零命中。
- `taluna-game`（k8s/镜像）、`taluna-config` / `taluna-agent-backend`（主站契约）、UI 品牌文案仍在。
- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 四项在新目录全绿。

## 迁移后待办（不在本轮）

- `.env` 里的 `DEV_COOKIE` 是旧域 session，换域后失效，需在 `devlab.rezona.ai` 重新取 dev cookie。
- GCP 侧：`devlab/stalab/lab.rezona.ai` 的证书、urlmap、backend-service 接入（`deploy/setup-lb.sh` 的
  `URL_MAP` 参数与 `deploy/README.md` 表格里的 urlmap 名待确认后更新）。
- 基础设施重命名（`taluna-game` → `rezonalab-game`）与品牌换名（含 logo 资产、主站契约 key）各自单独一轮。
