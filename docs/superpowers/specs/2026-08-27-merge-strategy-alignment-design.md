# 合并策略对齐三仓（go-rezona / game-server / koubou-agent）· 设计稿

日期：2026-08-27 · 状态：已批准（四题盘问结论见 §3）

## 1. 目的

本仓现行合并策略是「特性分支 `--no-ff` 合 `dev` 直推 → `dev` 整条 PR 进 `main` → stage/prod 手动
dispatch 默认 `main`」。它在单人单线时够用，但有三处结构性缺口，且都已被兄弟仓解决过：

1. **`main` 的内容完全由 `dev` 决定**，没有选择性上线的余地——想只发一个特性做不到，只能连带 `dev` 上
   全部未验证内容一起走。
2. **develop 环境同一时刻只能承载一份代码**，打 `deploy-for-testing` 标签就把别人正在验的东西顶掉，
   且对方收不到任何通知（现行 `deploy_dev_pr.yml` 是覆盖式单 PR）。
3. **prod 发布源没有冻结点**：`deploy.yml` 默认 ref = `main`，`main` 一直向前走，想给线上打补丁就只能
   连带尚未验证的新内容一起发。

对齐目标（用户 2026-08-27 给定）：
1. `main` 不能直接合入代码，只能走 PR；
2. `dev` 可以单独演进，与 `main` **不存在依赖**（互不为祖先是刻意的）；
3. `deploy-for-testing` 标签部署对齐 go-rezona（多 PR 叠合）；
4. prod / stage 部署方式对齐 koubou（stage 默认 `main`；prod 只能从 release 分支发、无默认值）。

## 2. 三仓现状调研（2026-08-27 回源核对）

| 仓 | 分支拓扑 | 晋级 | 测试环境 | 护栏 |
|---|---|---|---|---|
| **game-server（pgc）** | 集成分支只有 `dev` / `main`，血缘不变量 **`main ⊆ dev`** 全程 FF | 机器 FF push `main`，绑定已验证 SHA，绝不 squash/rebase | 无标签部署；共享 dev 只反映 `dev` 分支 | `ci.yml` 分支策略闸（`scripts/check_pr_branch_policy.py`）+ `_deploy.yml` 部署源校验 + 血缘校验；分叉三途径与拓扑修复流程成文（`docs/deploy/ci-cd.md §1.5.1`） |
| **go-rezona** | `main` 主干 + 机器分支 `test` | PR 合 `main` | `deploy_test.yml`：`test` = `main` + **全部**带 `deploy-to-test` 标签 PR，逐个 `--no-ff` 叠合后 force-push；冲突则 `merge --abort` 并**整次跳过部署**（保留上一版）；主干推进/打摘标签/PR 推新提交都重叠一遍 | 成文的冲突处理两策（等前 PR 合并 / 摘对方标签抢占） |
| **koubou-agent** | `dev` / `main` / `release/YYYY-MM` **三条互不为祖先**（实测 `main...dev` = 3/81），靠 `chore/pick-*-to-main`、`chore/backport-*-to-release` 挑拣搬运 | 无整线晋级 | dev：push `dev` 自动部署 | 明确选择**不加** CI 闸，靠人；已知短板与重启条件成文（`docs/dev-productionization.md §3.F`） |

**本仓实测事实**（`git rev-list --left-right --count origin/main...origin/dev` = `2 23`）：`main` 独占的
两条正是 GitHub PR 桥接 commit（`a39dae5a` #9、`77fadda3` #10）。即**现行模型每发一次版必然新增一条
main-only commit，pgc 的 `main ⊆ dev` 不变量在本仓天然不成立**——这与目标 2 同向，故本轮不引入该不变量。

## 3. 决策（四题盘问结论）

| # | 题 | 结论 | 关键理由 |
|---|---|---|---|
| 1 | `main` 的 PR head 从哪来 | **从 `main` 切 `pick/*` 挑拣分支** | 特性分支从 `dev` 切出，PR base=`main` 的 diff 会连带 `dev` 领先 `main` 的**全部**内容——目标 2 下「直接拿原分支开 PR」不成立。照 koubou 的 `chore/pick-*-to-main` 模式 |
| 2 | 标签叠合部署的基线 | **基线 = `dev`，机器分支 `test`** | 本仓 develop 环境的主干是 `dev` 而非 `main`；`main` 在目标 2 下会长期落后，在它上面验新特性常常跑不起来 |
| 3 | release 分支怎么切 | **按需从 `main` 切 `release/YYYY-MM-DD`** | 不绑月份，分支短命、几乎不需 backport；日期式与本仓 docs/specs/plans 的 `YYYY-MM-DD` 同一套心智，排序即时序。同日再切加 `-b` 后缀 |
| 4 | 护栏强度 | **CI 硬闸 + 部署源校验** | 新口径的纪律点比原来多得多（`pick/*` 才进 `main`、`backport/*` 才进 `release/*`、prod 只能从 `release/*` 发、`test` 禁人工推），全靠人记不住；koubou 自列的已知短板正是「多 session 并发需人工注意漂移」 |

## 4. 目标拓扑

```text
                 ┌── deploy-for-testing 标签 ──┐
feat/xxx ──(本地 --no-ff)──▶ dev ──(机器叠合)──▶ test ──push──▶ develop 环境
   │                          │                                 (devlab.rezona.ai)
   │                          └── 无标签 PR 时 test == dev
   │
   └──(cherry-pick)──▶ pick/xxx ──(PR, merge commit)──▶ main ──dispatch──▶ stage 环境
                                                         │                (stalab.rezona.ai)
                                                         └──(按需切)──▶ release/YYYY-MM-DD
                                                                          │  ▲
                                                              dispatch ───┘  └── backport/xxx (PR)
                                                              prod 环境
                                                            (lab.rezona.ai)
```

四条线的所有权与写入方式：

| 分支 | 所有者 | 怎么写入 | 部署去向 |
|---|---|---|---|
| `feat/*` `fix/*` … | 人 | 从 `origin/dev` 切 | 打标签可上 develop |
| `dev` | 人 | 本地 `--no-ff` 合特性分支后直推（**保持现状，不加 PR 要求**） | 经 `test` 上 develop |
| `test` | **机器** | 只由 `deploy_dev_pr.yml` force-push；**人工推送一律拒绝** | develop |
| `main` | 人（**只经 PR**） | `pick/*` / `backport/*` / `docs/*` / `chore/*` 开 PR | dispatch → stage |
| `release/YYYY-MM-DD` | 人（**只经 PR**） | 从 `main` 切；补丁经 `backport/*` PR | dispatch → prod |

**不变量**（本仓版，与 pgc 的 `main ⊆ dev` 刻意不同）：

- `dev` 与 `main` **互不为祖先是正常态**，任何工具与文档都不得把二者分叉当异常报警。
- `release/YYYY-MM-DD` **必须**是从 `main` 上某个 commit 切出的（`main` 上的某祖先可达），即
  `git merge-base --is-ancestor` 方向为「release 的切点 ∈ main 历史」；`backport/*` 合入后 release 会
  领先该切点，这是正常的。
- `test` 的第一父恒是 `origin/dev` 的 tip；无标签 PR 时 `test` 与 `dev` 同 SHA。

## 5. 各条的具体口径

### 5.1 `main` 只经 PR（目标 1）

- 现有分支保护（必走 PR、required check `quality`、批准数 0、`enforce_admins=false`）保留不动。
- PR head 只接受 `pick/*` / `backport/*` / `docs/*` / `chore/*`；**显式拒绝 head=`dev`**——否则「整条 dev
  进 main」的老路会自己走回来，目标 2 名存实亡。
- 合入一律 **merge commit，禁 squash**（沿用现有理由：`scripts/release-board` 靠扫 merge subject 认 feature）。

### 5.2 pick 流程与 release-board 的衔接（易漏的一条）

`release-board` 的 feature 全集取自 `origin/dev` 的 merge commit，各环境的「是否已含该 feature」靠
`mergeBranchSetOf(sha)`——即**该环境 commit 可达的 merge subject 里的分支名集合**。所以：

> 🔴 **pick PR 合入 `main` 时，merge commit 的 subject 必须写成 `merge: <原特性分支名> <标题>`**，
> 与 `dev` 上那条 merge 的 subject 一字不差。用 `gh pr merge <N> --merge --subject "merge: feat/xxx 标题"`。
> 默认 subject 是 `Merge pull request #N from …`，`parseMergeSubject` 对它**显式返回 null**，看板上该
> feature 的 stage / prod 列会永远是未上线。

`board` 的 dev 列继续读 `origin/dev`（不改读 `test`）：`test` 是临时叠加态，不代表落地。

### 5.3 标签叠合部署（目标 3）

改造 `deploy_dev_pr.yml` 为 go-rezona 形态：

- 触发：`pull_request` 的 `labeled/unlabeled/synchronize/reopened/closed` + **`push: branches: [dev]`**。
- 合成 job：checkout `dev` → 列出**所有** open 且带 `deploy-for-testing` 的 PR → 依次
  `git fetch origin pull/<N>/head` + `git merge --no-ff` → 成功则 force-push 到 `test` 并输出 merged SHA。
- **冲突处理**：`git merge --abort`，`merge_status=conflict`，**跳过部署**（develop 保持上一版），并在
  冲突的那个 PR 上留一条评论说明与谁冲突。冲突处理两策（等前 PR 合入 / 摘对方标签抢占）写进手册。
- 部署 job 消费合成出的 SHA，参数与 `deploy_dev.yml` 逐项一致（现有
  `tests/deploy/deploy-for-testing-contract.test.ts` 继续守）。
- `deploy_dev.yml` 的 `push: branches: [dev]` 触发器**撤销**——develop 的唯一部署源变成 `test`，否则
  推 dev 会同时触发两条链、互相顶。`workflow_dispatch` 手动入口保留（默认 ref 改 `dev`，供叠合链
  故障时旁路直发）。
- 两个 workflow 共用 `concurrency: deploy-develop`（现状即如此）不变。

**取舍记录（不采纳 go-rezona 的两处）**：① 它的基线是 `main`，本仓取 `dev`（见 §3 决策 2）；
② 它冲突时只在日志里写一行，本仓加 PR 评论——本仓没有 Lark 通知（`LARK_WEBHOOK_URL` 未配置），
不留痕就等于没人知道 develop 停在旧版。

### 5.4 stage / prod（目标 4）

| 环境 | 触发 | ref 入参 | 对齐来源 |
|---|---|---|---|
| stage | 仅 `workflow_dispatch` | `branch`，**默认 `main`** | koubou `deploy_lab_stage.yml` |
| prod | 仅 `workflow_dispatch` | `branch`，**无默认值、`required: true`**，描述写明「必须是 `release/YYYY-MM-DD`」 | koubou `deploy_lab_prod.yml` |

release 分支生命周期：准备上线时从 `origin/main` 切 `release/<切分支当天日期>`；prod 从它 dispatch；
上线后若要打补丁，从该 release 切 `backport/<主题>`、PR base=release，**并成对地 pick 一份回 `main`**
（漏了下次切 release 就会回归——koubou 的 `chore/backport-*-to-release` 与 `chore/pick-*-to-main`
成对出现正是这条纪律的痕迹）。回滚 = 重新 dispatch 上一条 release 分支。

### 5.5 护栏（目标 4 的硬化，决策 4）

**① `ci.yml` 新增 `branch-policy` job**（纯逻辑下沉到 `scripts/branch-policy/`，同目录单测）：

| PR base | PR head | 结果 |
|---|---|---|
| `main` | `pick/*` `backport/*` `docs/*` `chore/*` | 允许 |
| `main` | `dev` | 拒绝——`dev` 不整条进 `main`（目标 2） |
| `main` | 其它（含 `feat/*` `fix/*`） | 拒绝——特性分支基于 `dev`，diff 会连带整条 dev |
| `release/*` | `backport/*` | 允许 |
| `release/*` | 其它 | 拒绝 |
| `dev` | `main` / `release/*` | 拒绝——禁止主干反合，会把两条线搅成交叉历史 |
| `dev` | 其它 | 允许（`dev` 日常直推，本就少有 PR） |
| 任意 | 任意 | `test` 既不能当 base 也不能当 head |

**② `_deploy.yml` 新增部署源校验步骤**（在 checkout 之后、构建之前，失败 `exit 1`）：

| environment | 断言 |
|---|---|
| `production` | checkout SHA 必须可从某条 `origin/release/*` 达到 |
| `stage` | checkout SHA 必须可从 `origin/main` 达到 |
| `develop` | checkout SHA 必须可从 `origin/test` 或 `origin/dev` 达到 |

需要 `fetch-depth: 0` 且显式刷新远端引用（照抄 pgc `ci.yml` 的 `git fetch --no-tags origin +refs/…`
写法）——浅 checkout 下 `merge-base --is-ancestor` 会给出假阴性。

**③ 分支保护**：`release/*` 加 ruleset（禁直推、必走 PR、required check `quality`、禁强推禁删）；
`test` 加 ruleset（禁人工推送，只放行 `github-actions[bot]`；允许 force-push，机器就是靠它写的）。
`dev` 维持「禁强推禁删、不加 required check」不变——理由沿用 `rezonalab-dev-bringup.md §7`：required
check 对直推同样生效，加了等于封死 dev。

## 6. 成功标准

1. `gh pr create --base main --head dev` 被 CI 拒绝；`--head pick/x` 通过。
2. `gh workflow run "Deploy (production)"` 不填 ref 时被 GitHub 拒绝（`required: true`）；填 `main` 时被
   部署源校验拦下并打印「production 只能从 release/* 部署」。
3. 两个 PR 同时带 `deploy-for-testing` 时，develop 上跑的是 `dev` + 两个 PR 的叠合体；摘掉其一后重新
   叠合，另一个仍在。
4. 制造一次叠合冲突：develop 保持上一版不动，冲突 PR 上出现说明评论。
5. 走一遍 pick 流程后 `pnpm board` 里该 feature 的 stage 列点亮，且 feature 总数不变（没被认成两条）。
6. `pnpm test` 全绿（含新增的 `scripts/branch-policy/` 单测与既有 `tests/deploy/` 契约测试）。

## 6.1 评审处置（2026-08-27，干净上下文子代理，基于 spec + `origin/dev..HEAD` diff）

**Critical 1 条、Important 4 条已修**；采纳前逐条回源验证，其中两条自己重跑了变异实验：

| # | 结论 | 处置 |
|---|---|---|
| C1 | `workflow_dispatch` 跑的是所选 ref 上的 workflow 文件，`main` 未更新前 prod 校验形同虚设，而手册已写「洞已堵上」 | **采纳**。新增前置任务 T5.5（把 workflow pick 上 `main`）；手册 §2.1 那句改成「`main` 落地后才生效」并标红 |
| I1 | `release-board` 的 `latestDeploy` 取 run 的 `headSha`（= `--ref`），不是 `branch` 入参；省 `--ref` 会让 prod 列点亮 `main` 全部 feature | **采纳**（已复核 `index.ts:17,22`）。手册命令统一加 `--ref`，`index.ts` 头部补不变式 |
| I2 | `deploy-source-contract` 用 `toContain` 子串匹配，挡不住「悄悄改宽」 | **采纳**。自己变异复现：把 stage 的 ALLOWED 追加 ` refs/remotes/origin/dev` 后测试仍全绿。改成 `ALLOWED="…"` 全等匹配 + 新增「结尾必须 exit 1」断言，两处变异现已都能抓住 |
| I3 | 手册 §2.7 等多处仍在教已删除的 `deploy-pr` / `redeploy-dev`，附录 D 与 `deploy/README.md` 同样过期 | **采纳** |
| I4 | `branch-policy` 未进 required，只是红叉、仍可合 | **采纳**。加进 `main` / `release/*` 的 required checks（`dev` 保持零 required——required check 对直推生效这一条只约束 `dev`，不是不能给别的分支加） |

**Minor 处置**：M1（fork PR 打标签会 403 红整条链）、M2（`git merge --abort` 在非冲突失败时以 128 中止、吞掉冲突评论）、M3（多 refspec fetch 全有全无 + 注释误导）、M4（评论没说与谁冲突）、M5（`namespace` 漏在防漂移 KEYS 外）、M6/M7（过期注释与死代码兜底）**均已修**——前两条是本轮新代码里的真 bug，不是风格问题。

以下 Minor **记录不改**：

- **M8**：`for-each-ref 'refs/remotes/origin/release/*'` 的 `*` 不跨斜杠，`release/2026-09-01/x` 会被判非法。本设计规定的命名（`release/YYYY-MM-DD`，同日加 `-b`）不含二级斜杠，属约定外输入；真出现时报错信息不解释原因，可接受。
- **M9**：`GITHUB_HEAD_REF` 在 fork PR 下只是 fork 里的分支名，fork 的 `pick/x` 会被放行。对 `main` 真正的门是分支保护与 required check，`branch-policy` 只是引导性判据，不做加固。
- **M10**：旧 spec `2026-07-22-deploy-for-testing-label.md` 未标废止——历史 spec 保留原貌即可，本文 §5.3 已是新真相。

## 6.2 真机验收结论（2026-08-27）

落地序列：合入 `dev`（`d621ac58`）→ pick PR [#11](https://github.com/rezona-ai/rezonalab-game-web/pull/11)
合入 `main`（`0706d267`）→ 跑 `deploy/setup-branch-protection.sh APPLY=1`。

| §6 判据 | 结果 |
|---|---|
| 1 `pick/*` 通过 / `head=dev` 被拒 | ◐ 放行侧真机通过（PR #11 的 `branch-policy` = pass 28s）；拒绝侧只在本地验（`GITHUB_BASE_REF=main GITHUB_HEAD_REF=dev` → exit 1） |
| 2 prod 填错 ref 被拦 | ✅ 用 `origin/main` 上真正会执行的那段脚本（抽出后代入 GitHub 会传的实参）在 `main` 的 checkout 上跑：`production` + `ref=main` → `❌ production 只能从 release/* 部署…` exit 1；切出 `release/2026-08-28` 后同一脚本 → `✔ 可从 origin/release/2026-08-28 达到` exit 0。**未真机 dispatch prod**（该动作被 harness 权限闸拦下，且真机跑一次的信息量与此等价） |
| 3 双 PR 叠合 | ✅ `test` = `dev` + `merge: pr-13` + `merge: pr-14`，两个探针文件都在 |
| 4 叠合冲突不部署 + PR 留痕 | ✅ `compose-test` success / `deploy` **skipped** / PR 上留言并点名对方（`与 dev 基线或已叠合的 #14 冲突`）/ `test` 分支未被动 / 整条 run 仍是 `success`（手册记的判读陷阱如实复现） |
| 5 pick 后看板不把 feature 认成两条 | ✅ `pnpm board` 161 个 feature，`chore/merge-strategy` 只有一行；`main` 上也只解析出一条 |
| 6 `pnpm test` 全绿 | ✅ dev 合并结果 311 文件 4234 passed；pick 分支 4029 passed |

**计划外验到的**：部署源校验实测放行 `test`（日志 `✔ 部署源合法:d621ac58… 可从 origin/test 达到`）·
`test` 分支由首次叠合自动创建且无标签时与 `dev` 同 SHA · 推 `dev` 只触发叠合链、旧
`Deploy (develop)` 一次未触发（双链打架已消除）· `branch-policy` 在 push 事件上正确 `skipping`。

### 两条实测澄清的语义

- **部署源校验判 commit，不判 ref 名**。刚从 `main` tip 切完 release、两者同 SHA 时，`-f branch=main`
  发 prod 也会放行（发的是同一个冻结快照）。它真正拦的是 `main` 走到 release 切点之后的 commit。
  手册 §5.2 已按这个口径改写——别把「填 `main` 一定被拦」当判据。
- **叠合读的是 job 启动时的实时标签状态，不是事件快照**。所以短时间内连续打摘标签会自动收敛到
  最终状态（实测：连摘两个标签后，先触发的那次 run 合成出的就是纯 `dev`），不会留半截。

### 落地期踩到的四件事

1. **`Wait for rollout` 首跑超时**（`1 out of 2 new replicas`，5min 判死）。`Status` 步骤显示
   `2/2 READY / UP-TO-DATE 1`——`maxUnavailable=0 + maxSurge=1` 在 Autopilot 上等新节点。
   **重跑失败 job 即全绿**，与本轮改动无关（未碰 manifest / 资源 / rollout 参数，镜像 tag 仍是
   `dev-<sha7>`）。已记进手册排障表。
2. **classic protection 写不进 `dev` 的 `allow_force_pushes`**，改用 ruleset `dev-guardrails`。
   细节与查法见 `docs/deploy/rezonalab-dev-bringup.md §7`。
3. **叠合顺序是反的**（真机验收挖出）：`pulls.list` 默认「新的在前」，而冲突时被中止、被留言的是
   迭代到的那一个——于是造成冲突的新 PR 顺利叠入、无辜的老 PR 背锅（实测返回 `[14, 13]`，#14
   制造冲突却是 #13 收到告警），与 §5.3 的处置策略正好相反。已改为按 PR 号升序，契约测试钉住。
4. **🔴 一次自伤：拿真强推去验规则，被 admin bypass 放行，`dev` 被推回旧 commit**（已恢复到
   `d621ac58`，无内容丢失；回滚那次触发的旧链路部署已 cancel）。两条教训：**共享分支上不拿破坏性
   操作当探针**，规则是否挂上查 `rules/branches/<b>` 就够；**`git push --dry-run` 不走服务端规则
   检查**，不能用它证明「拦得住」。由此把 `dev-guardrails` 的 bypass 清空（用户 2026-08-27 决定）。

## 7. 明确不做

- **不引入 `main ⊆ dev` 血缘不变量与分叉报警**（pgc 有，本仓目标 2 下它是错的）。
- **不引入自动晋级链与 `PROMOTE_TOKEN`**（pgc 自己都刻意不配；本仓单人维护，属过度工程）。
- **不引入部署后验证门 / 观察窗 / 自动回滚 / feature flag 硬闸**（pgc 有，属发布策略而非合并策略，
  另起一轮；本轮只把「代码怎么流到各环境」定下来）。
- **不改 `dev` 的直推节奏**（不给 `dev` 加 PR 要求或 required check）。
