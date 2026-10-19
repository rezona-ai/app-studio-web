# 合并策略对齐三仓 · 实现计划

设计稿：`docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md`
分支：`chore/merge-strategy`（worktree `.claude/worktrees/chore+merge-strategy`，基于 `origin/dev`）

任务按「可独立测试 + 可独立评审」拆分，顺序即依赖顺序。T5 是唯一的机制替换，按
「并存加新 → 原子切换 → 删旧」推进。每个任务一个 commit。

---

## T1 · 分支策略纯逻辑 + 单测（无副作用）

**做什么**：新建 `scripts/branch-policy/lib.ts`，导出
`checkBranchPolicy(base: string, head: string): { ok: true } | { ok: false; reason: string }`，
按设计稿 §5.5 ① 的表判定。同目录 `lib.test.ts` 覆盖表里每一行 + 边界（`release/2026-08-27-b`、
`pick/` 前缀但形如 `pickle/x` 不得误中、`test` 作 base/head 均拒）。

**TDD**：先写 `lib.test.ts` 跑红，再实现。

**验证**：`pnpm exec vitest run scripts/branch-policy/lib.test.ts`

**评审点**：判定表与设计稿 §5.5 ① 逐行对应；拒绝原因文案能让人知道该改成什么分支名。

---

## T2 · `ci.yml` 接入 `branch-policy` job

**做什么**：`scripts/branch-policy/index.ts` 读 `GITHUB_BASE_REF` / `GITHUB_HEAD_REF`，调 T1 的纯函数，
不通过则打印原因 + `exit 1`。`ci.yml` 新增 job（`if: github.event_name == 'pull_request'`），与
`quality` 并列、不互相 `needs`（分支名错不该挡住测试结果）。

本 job **要**进 `main` / `release/*` 的 required checks（T6 一并配）：不进的话分支名合错只是个红叉，
`gh pr merge` 照样能合，批准数 0 时尤其容易顺手合掉，设计稿 §6 成功标准第 1 条「被拒绝」也就只在
「红叉 = 拒绝」的宽松读法下成立。「required check 对直推也生效」那条**只约束 `dev`**
（`rezonalab-dev-bringup.md §7`），`main` / `release/*` 本就只走 PR，加了不波及 dev 的直推节奏；
该 job 在 PR 事件上恒运行，不会因 skip 卡死 PR。（初版计划把它整个排除在 required 之外，
理由张冠李戴，已按评审 I4 改正。）

**验证**：本地 `GITHUB_BASE_REF=main GITHUB_HEAD_REF=dev pnpm exec tsx scripts/branch-policy/index.ts`
预期 exit 1；换 `pick/x` 预期 exit 0。真机验证留到 T8。

---

## T3 · `_deploy.yml` 部署源校验

**做什么**：在 checkout（改 `fetch-depth: 0`）之后加一步 `Validate deploy source`：显式
`git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main +refs/heads/dev:… +refs/heads/test:… '+refs/heads/release/*:refs/remotes/origin/release/*'`，
再按 `environment` 断言（设计稿 §5.5 ②），失败打印实际 SHA 与期望来源后 `exit 1`。

**验证**：`tests/deploy/` 新增断言——`_deploy.yml` 含该步骤且三个环境的期望来源与设计稿一致
（照现有 `tests/deploy/manifest.ts` 的读 YAML 方式）。`pnpm exec vitest run tests/deploy`。

**评审点**：浅 checkout 假阴性已被 `fetch-depth: 0` + 显式 fetch 排除；`release/*` 的 refspec 通配写对。

---

## T4 · stage / prod 入参对齐 koubou

**做什么**：
- `deploy.yml`：`branch` 入参去掉 `default`、加 `required: true`，description 改为
  「部署源 release 分支（如 `release/2026-08-27`；无默认，必须显式填）」；文件头注释同步。
- `deploy_stage.yml`：保留 `default: main`，description 补「对齐 koubou stage 口径」。

**验证**：`tests/deploy` 新增断言（prod 的 `branch` 无 `default` 且 `required: true`；stage 默认 `main`）。

**评审点**：GitHub 对 `workflow_dispatch` 的 `required: true` + 无 default 确实会拦住空提交（T8 真机验）。

---

## T5 · 标签叠合部署（机制替换，三步走）

### T5a 并存加新
`deploy_dev_pr.yml` 新增 `compose-test-branch` job（设计稿 §5.3）：触发加 `push: branches: [dev]`；
列出所有带标签 open PR → 逐个 `--no-ff` 合到 `dev` 基线 → 成功 force-push `test` 并 output SHA；
冲突则 `merge --abort` + 在该 PR 上 `gh pr comment` 说明与哪条冲突 + 跳过部署。
`deploy-pr` job 改为消费 `compose-test-branch` 的 SHA。**此时 `deploy_dev.yml` 的 push 触发仍在**，
两条链都指向 develop，靠 `concurrency: deploy-develop` 串行——短暂重复部署，无害。

### T5b 原子切换
删掉 `deploy_dev.yml` 的 `on.push.branches: [dev]`，`workflow_dispatch` 默认 ref 由 `main` 改 `dev`
（旁路直发用）。develop 的唯一常态部署源变为 `test`。

### T5c 删旧
删掉 `redeploy-dev` job（叠合链天然覆盖了它：摘标签/关 PR 都会重新叠合一次，无标签时 `test == dev`）。
`tests/deploy/deploy-for-testing-contract.test.ts` 同步改写：参数一致性断言保留，
`redeploy-dev` 相关断言换成「compose job 存在且基线是 dev」「deploy_dev.yml 无 push 触发」。

**验证**：`pnpm exec vitest run tests/deploy` + T8 真机三场（单 PR / 双 PR 叠合 / 制造冲突）。

**评审点**：force-push `test` 的权限（`permissions: contents: write`）、并发下两次叠合的先后
（`concurrency: deploy-develop` 不取消进行中的，后一次拿到的是最新标签集合，可接受）。

---

## T5.5 · 🔴 前置：把这批 workflow pick 上 `main`（评审 C1）

**为什么是前置**：`workflow_dispatch` 跑的是**所选 ref 上的 workflow 文件**，Actions 页面 ref 默认就是
`main`。`dev` 与 `main` 互不为祖先，所以在 pick 上 `main` 之前，从网页点 "Deploy (production)" 跑的
仍是旧文件（`branch` 默认 `main`、不必填、无部署源校验）——**一键就能把 `main` tip 发到 prod**。
设计稿 §6 成功标准第 2 条在此之前必然不通过，T8 也无从验起。

**做什么**：本批合入 `dev` 后，从 `origin/main` 切 `pick/merge-strategy-workflows`，把
`.github/workflows/*` 与 `scripts/branch-policy/`、`tests/deploy/` 一并 cherry-pick，
PR base=main，`gh pr merge --merge --subject "merge: chore/merge-strategy <标题>"`。

**验证**：`git show origin/main:.github/workflows/deploy.yml | grep -A3 branch:` 看到 `required: true`
且无 `default`；`git show origin/main:.github/workflows/_deploy.yml | grep "Validate deploy source"` 有输出。

---

## T6 · 分支保护 / ruleset（手工，需确认后执行）

**做什么**（`gh api`，逐条 diff 后再改；🔴 删除类/影响线上的操作先问 Nick）：
- `release/*` ruleset：禁直推、必走 PR、required check `quality`、禁强推禁删。
- `test` ruleset：禁人工推送（bypass 名单只留 `github-actions[bot]`），允许 force-push。
- `main` / `dev` 现有保护**不动**。

**验证**：`gh api repos/:owner/:repo/rulesets` 输出逐条核对；本地试推 `test` 预期被拒。

---

## T7 · 文档同步

- `docs/deploy/rezonalab-dev-bringup.md §7`：分支保护表加 `release/*` 与 `test` 两行，注明日期。
- `docs/deploy/cicd-onboarding.md`：§1.5（两条护栏）、§5.2（日常发布流程 + 晋级 main）、§5.3（标签部署）
  按新拓扑改写；新增「pick / backport 流程」小节，含 §5.2 那条 `--subject` 红线；
  §2.1 的 workflow 全景表同步。手册头部「最后核实日期」更新。
- 根 `CLAUDE.md`：「部署与 basePath」段里分支保护那一句改成指向 §7 的新表；补一行 release 分支口径。
- `scripts/release-board`：**代码不改**，但在 `lib.ts` 头部注释补一句「main/release 上的 feature 靠 pick PR
  的自定义 merge subject 认同一条」——这是新流程下唯一会让看板失真的操作点。

---

## T8 · 真机验收（按设计稿 §6 六条逐条跑，输出贴回 spec）

顺序：先 T2/T4 的拦截类（开一个废弃 PR 试 base=main head=dev；空 ref dispatch prod），
再 T3（故意从 `main` dispatch prod，预期被校验拦下），最后 T5 三场叠合。
**任一条不过就停下改，不往下走。**

---

## 合并与评审

1. 全部任务完成后在本分支跑完整验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build`。
2. 派干净上下文子代理，基于 `origin/dev..chore/merge-strategy` 的 diff + 本 spec 独立评审
   （不给会话历史）；Critical / Important 修完再合，Minor 记回 spec。
3. `git merge --no-ff chore/merge-strategy -m "merge: chore/merge-strategy 合并策略对齐三仓..."` 进 `dev`，
   合并后在合并结果上重跑完整验证。
4. 🔴 清理 worktree / 删分支**先问 Nick**。
