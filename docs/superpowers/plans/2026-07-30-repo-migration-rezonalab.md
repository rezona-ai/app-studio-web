# 仓库迁移到 rezonalab-game-web + 域名换 rezona.ai（实现计划）

日期：2026-07-30 · 设计稿：`docs/superpowers/specs/2026-07-30-repo-migration-rezonalab-design.md`

## 任务拆解

### T0 搬仓库（已完成）

- 复制 `.git` 全历史 + rsync 工作树到 `~/Documents/rezonalab/rezonalab-game-web`；
  `git remote set-url origin https://github.com/rezona-ai/rezonalab-game-web.git`。
- 验证：`git log --oneline -3` tip 为 `6b3cb60`、`git status` 干净、`git remote -v` 指向新仓库。

### T1 域名映射

涉及文件（`docs/superpowers/` 历史稿排除在外）：

- `.env.example`（`PGC_BASE_URL` / `NEXT_PUBLIC_PGC_BASE_URL` / `DEV_COOKIE` 注释）
- `.github/workflows/deploy_dev.yml` · `deploy_dev_pr.yml` · `deploy_stage.yml` · `deploy.yml`
- `deploy/README.md`（域名表 + curl 示例）· `deploy/setup-lb.sh`（用法注释）· `deploy/k8s-deployment.yaml`（注释）
- `loadtest/taluna-read-baseline.js`
- `CLAUDE.md`（cookie 域描述）
- 代码注释：`src/server/{cookie.ts,biz/proxy.ts,koubou/proxy.ts,koubou/ws-proxy.ts,pgc/proxy.ts,pgc/inject-base.ts}`、
  `src/lib/{auth.ts,backend-routes.ts,biz/client.ts,koubou/client.ts,pgc/client.ts,pgc/url.ts}`
- 测试断言：`src/lib/{auth,host-config,pgc/url}.test.ts`、`src/koubou/wsBase.test.ts`、
  `src/server/pgc/inject-base.test.ts`、`src/components/preview/PreviewPanel.test.tsx`、
  `src/app/share/[code]/[version]/route.test.ts`

替换顺序（先长后短）：`tlndev.taluna.ai`→`devlab.rezona.ai`、`tlnstage.taluna.ai`→`stalab.rezona.ai`、
`app.taluna.ai`→`app.rezona.ai`、`.taluna.ai`→`.rezona.ai`、裸 `taluna.ai`→`lab.rezona.ai`；
注释代称 `tlndev`→`devlab`、`tlnstage`→`stalab`。

验证：`pnpm exec vitest run`（受影响的断言全绿）+ `grep -rI "taluna\.ai\|tlndev\|tlnstage" --exclude-dir=docs` 零命中。

### T2 仓库标识改名

- `package.json` name → `rezonalab-game-web`
- `AGENTS.md` 标题与 `repos/rezona-ai/taluna-game-web` → `rezonalab-game-web`
- persist key：`src/store/index.ts` → `rezonalab-v4`；同步 `src/store/actions.test.ts` 断言与
  `src/lib/agent-backend.ts` 注释
- `loadtest/taluna-read-baseline.js` → `loadtest/rezonalab-read-baseline.js`（`git mv`），
  env `TALUNA_BASE` → `REZONALAB_BASE`，同步 `loadtest/README.md`

验证：`pnpm exec vitest run src/store/actions.test.ts` + 全量 `pnpm test`。

### T3 活文档同步

- `CLAUDE.md` 项目概览的仓库名 / 本地目录名；persist key 段落改 `rezonalab-v4`；
  修掉一处已过期表述（防白闪内联脚本现在硬编码的是主站契约 key `taluna-config`，不再是 persist key）。
- 保持不动的清单（k8s/镜像名、GCP 实体、主站契约 key、品牌文案）在 CLAUDE.md 中无需改动。

验证：`pnpm lint`。

### T4 完成前全量验证

`pnpm install` → `pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，四项全绿并留输出。

## 提交拆分

1. `docs(repo): 补仓库迁移与域名切换的设计稿与实现计划`
2. `chore(repo): 后端基址与 cookie 域全量切到 rezona.ai 新域名`
3. `chore(repo): 包名 / persist key / 仓库引用改 rezonalab`

推送到新 remote 由 Nick 确认后再做（新仓库首次 push 需要建立 main/dev 上游）。
