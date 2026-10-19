# 上线看板的 feature 身份改用 commit trailer · 设计稿

日期：2026-08-28 · 状态：待批准

## 1. 目的

`scripts/release-board`（`pnpm board`）判定「某个 feature 走到了哪一环」，靠的是**扫 merge commit 的
subject**（`parseMergeSubject`：`merge: <分支名> <标题>`）。这套判据在 2026-08-27 的四线拓扑改造
（`docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md`）之后出现三个问题：

1. **正确性从机制保证退化成人工纪律。** 旧流程 PR head 是 `dev`，`main` 直接继承 dev 的全部 merge
   commit，subject 天然一致，不需要任何人工动作。新流程 `main` 上的 feature 身份**完全由 pick PR
   的 merge subject 决定**，而 GitHub 默认的 `Merge pull request #N from …` 被 `parseMergeSubject`
   显式判 `null`。
2. **已实发一次且不可逆。** PR #15 用默认 subject 合入 `main`（`Merge pull request #15 from
   rezona-ai/pick/compose-order`），`fix/compose-order` 在 `main` 的历史里解析不出来，看板上该行的
   stage / prod 列**永远不会亮**。cherry-pick 出来的提交虽带正确 subject，但它是单亲提交，而看板只扫
   `--merges`。要修只能重写 `main` 历史，代价远大于收益。
3. **`backport/*` 是盲区。** feature 全集只取 `origin/dev`，只在 release / main 线上的补丁不会显示为
   「未上线」，而是**根本没有这一行**。

**目标**：把 feature 身份从「人手写的 merge subject」换成「随提交内容一起走的结构化字段」，让
GitHub 生成的默认 merge subject 不再影响任何判定。

## 2. 备选机制与实测（2026-08-28）

| 机制 | 跨 cherry-pick 跟随 | 覆盖 dev 侧 | 实测结论 |
|---|---|---|---|
| **GitHub Label** | — | ❌ | 只能挂 PR / Issue。`dev` 是直推、**没有 PR**，前半程（何时进 dev）标不上，无法作为身份源 |
| **git notes** | ❌ | ✅ | 绑在 SHA 上，cherry-pick 换 SHA 即丢；还要单独 push / fetch `refs/notes/*` |
| **commit trailer** | ✅ | ✅ | 临时仓实测：`Feature: feat/demo-x` 跨 cherry-pick 原样保留，`git log --format='%(trailers:key=Feature,valueonly)'` 原生可统计 |
| **patch-id（`git cherry`）** | 内容匹配、零约定 | ✅ | **本仓实测不可行**：`git cherry origin/main origin/dev` 仅 3 条匹配、72 条误判为未上线——`cherry-pick -m 1` 把整个 merge 压成一条，指纹全变 |

选 **commit trailer**。

## 3. 决策（盘问结论）

| # | 题 | 结论 | 理由 |
|---|---|---|---|
| 1 | trailer 的值 | **分支名**（`Feature: feat/xxx`） | 与现有看板同一命名空间，164 个存量 feature 不用重新定义；钩子能从当前分支名自动取值，人不用想；新旧两套解析器产出同一命名空间，双源并存期不会把同一 feature 计两次 |
| 2 | 钩子分发 | **版本化 `.githooks/` + `package.json` 的 `prepare`** | 零新依赖；钩子进仓可评审；`pnpm install` 即生效。不引入 husky（本仓目前没有任何钩子，为一个 trailer 拉整套工具链偏重） |
| 3 | 看板全集口径 | **`dev ∪ main`** | 稳态下 `release ⊆ main`（release 从 main 切），取两条即可。⚠️ 限定见 §6 |

## 4. 方案

### 4.1 trailer 契约

```
feat(canvas): 分组框缩放(把手 UI + 边缘对齐 + 硬下限)

Feature: feat/group-resize-snap-ui
```

- **键名** `Feature`，值是**该改动最初所在的特性分支名**（含 `/` 或 `+`，与 `parseMergeSubject` 认的
  命名空间一致）。
- **一条提交至多一个 `Feature:`**。重复出现时取第一条并在 CI 告警。
- 主干上的提交（`dev` / `main` / `test` / `release/*`）**不加** trailer——它们不属于任何 feature。

### 4.2 自动追加（`.githooks/commit-msg`）

在特性分支上提交时自动追加，规则：

1. 当前分支属于主干（`dev` / `main` / `test` / `release/*`）→ **不追加**。
2. 消息里**已有** `Feature:` trailer → **不追加**（幂等）。这条是 cherry-pick 的命门：pick 过来的
   消息已带原分支名，绝不能再按当前 `pick/*` 分支名覆盖成另一个身份。
3. 当前分支是 `pick/*` / `backport/*` → **不追加**（这两类分支上的提交要么是 cherry-pick 来的、
   已带 trailer，要么是解冲突产生的，身份应沿用原 feature，靠人在极少数情况下手填）。
4. 其余情况 → 追加 `Feature: <当前分支名>`，用 `git interpret-trailers --if-exists doNothing` 保证
   幂等与格式正确。

> ✅ **实测结论（2026-08-28，git 2.50.1）：`cherry-pick` 不触发 `commit-msg` 钩子。** 把一条单亲、
> 无 trailer 的提交 pick 到装有钩子的特性分支上，结果仍无 trailer——钩子没有按当前分支名贴上去。
> 这正是想要的行为：pick 只搬运身份，不重新定义身份。
>
> 由此有两条推论：① 规则 2/3 在 cherry-pick 路径上其实用不到，但**必须保留**——`git commit --amend`
> 与未来可能变化的 git 行为都会走到它们，幂等是硬要求不是优化；② **钩子装上之前产生的提交
> 永远拿不到 trailer**（除非 amend），这类存量只能靠旧的 subject 解析兜底，正是 §4.4 保留双源的原因。

### 4.3 `core.hooksPath` 的坑（已实发）

本仓的 `core.hooksPath` 曾是 **local 配置、指向 `/Users/nickhopps/Documents/taluna/game-create-platform/.git/hooks`**
——一个**不存在的旧仓路径**，导致所有钩子静默失效（2026-08-28 发现并解除，实测解除后 `commit-msg`
恢复调用）。所以 `prepare` 脚本必须：

- 幂等，且只写**仓库级** local 配置，不碰 global；
- 值用**相对路径** `.githooks`（写绝对路径就是上面这个事故的来源——换机器 / 换目录即失效）；
- 在文档里写明解除方式（`git config --local --unset core.hooksPath`）与自查命令。

### 4.4 看板改造（`scripts/release-board`）

**身份解析双源并存**：

- **新源**：扫提交的 `Feature:` trailer（`git log --format='%H%x09%cI%x09%(trailers:key=Feature,valueonly)'`），
  **扫全部提交，不限 `--merges`**。
- **旧源**：保留 `parseMergeSubject` 扫 merge subject，作存量历史兜底。
- 两源产出同一命名空间（分支名），并集去重即可，同一 feature 不会计两次。

**全集**：`origin/dev ∪ origin/main` 的 feature 并集（当前实测 `在 main 但不在 dev` = 0，改造后
`backport` 场景才会出现非零）。

**各环境的「含有」判定**：从该环境部署的 commit 出发，取其可达提交的 trailer 集合 ∪ 旧 subject 集合。

**性能**：实测扫 `origin/dev` 全部 2219 条提交取 trailer 耗时 **26ms**，不需要任何优化。

### 4.5 CI 兜底（可选，本轮列为不做）

「PR 内提交缺 `Feature:` trailer 就告警」这类检查留待钩子跑一段时间后再评估——钩子已经把绝大多数
情况自动化，先不叠第二层。

## 5. 成功标准

1. 新建特性分支提交一次，`git log -1 --format='%(trailers:key=Feature,valueonly)'` 输出该分支名；
   在 `dev` 上直接提交则输出为空。
2. 把该提交 cherry-pick 到 `pick/*` 分支，trailer **值不变**（不被改写成 `pick/xxx`）。
3. 用 GitHub **默认 subject** 合一个 pick PR 进 `main`，`pnpm board` 仍能认出该 feature 并点亮相应列
   ——这是本轮的核心验收点（#15 那类事故不再可能）。
4. `pnpm board` 的 feature 总数 ≥ 改造前（实测 164），且不出现同一 feature 两行。
5. 存量 164 个 feature 的行与列状态与改造前一致（旧解析器兜底未回归）。
6. `pnpm test` 全绿（含 `scripts/release-board/lib.test.ts` 新增的 trailer 解析用例）。

## 6. 取舍与已知限制

- **`release ⊆ main` 只在稳态成立**：`backport/*` 合进 `release/*` 之后、成对 pick 回 `main` 之前，
  那段补丁只在 release 线上，此时 `dev ∪ main` 的全集会漏掉它。判断为可接受——该窗口本就要求尽快
  关闭，而漏报恰好是「忘了回 pick 到 main」的提示信号。若将来窗口常态化，再把 `release/*` 纳入全集。
- **不回填存量**：164 个已有 feature 不补 trailer，靠旧解析器兜底。回填要重写历史，代价不成比例。
- **`fix/compose-order` 永久失真**：PR #15 造成的那一条无法挽回（见 §1.2），改造后新增 feature 不受
  影响，但这一行的 stage / prod 列会一直是暗的。在看板或文档里留一行说明，避免有人拿它对账时被绊住。
- **另有 6 个 pre-hook feature 同样失真**（2026-09-03 实发，见 §6.5）：内容已在 stage / prod，
  但 `main` 上两个身份源皆空，四行需求的 stage / prod 列显示 `n/m` 而非 ✓。同样不回填。
- **分支名仍是身份**：一个需求拆成多条分支时看板上是多行。若将来要按需求聚合，再加 `Ticket:` 字段，
  与本方案不冲突（trailer 天然可扩展）。


## 6.1 评审处置（2026-08-28，干净上下文子代理）

采纳前逐条回源验证，其中三条自己重跑了实验：

| # | 结论 | 处置 |
|---|---|---|
| C1 | `cherry-pick -m 1` 把 dev 的 merge 压成一条时身份全丢——那条 merge 产生在主干上、本无 trailer | **采纳，且从机制上根治**：实测 `git merge` **会**触发 `commit-msg` 钩子，故让主干上形如 `merge: <分支名> <标题>` 的 merge commit 也回填 trailer；手册同时删掉 `-m 1` 这个并列选项并写明对照实测（`-m 1` → 空；`<m>^1..<m>` → `{feat/x}`） |
| I1 | `hasFeatureTrailer` 只看最后一段 → 「`Feature:` 在倒数第二段」时**贴错身份**（不是漏贴） | **采纳**。自己复现：`git interpret-trailers --if-exists doNothing` 也只认最后一段，两层幂等同时失守，`feat/orig` 被静默换成 `pick/current`。改为扫全文、大小写不敏感；判错方向从「贴错」变成「不贴」，后者有 subject 源兜底 |
| I2 | 上述行为零测试守护（变异存活） | **采纳**，补用例 |
| I3 | 「合入 dev 时间」列被悄悄改成了「首次提交时间」 | **采纳方案①**：两源都有时**整条取 subject 源**，trailer 源只在 subject 源缺席时兜底 |
| I4/I5 | `lib.ts` 文件头与 6 处文档仍是旧口径 | **采纳**，逐处改写。顺带核实**禁 squash 仍成立但理由变了**：实测 trailer 被挤进正文中段后 `%(trailers)` 取不到（返回空），两源同时失效 |

**Minor 处置**：M1（`looksLikeBranch` 收紧为 `^[\w.+-]*[/+][\w.+-]+$` 并排除 `origin/`）· M2（补两处变异缺口的用例）· M3（钩子贴之前先过 `looksLikeBranch`，`hotfix` 这类不含 `/` 的分支不贴）· M6（钩子失败往 stderr 告警，不再全静默）· M7（补 unset 与自查命令）· M8（`prepare` 加 `2>/dev/null`）· M9（基线数字 135 → 实测 164）**均已修**。

**记录不改**：M4（空值 `Feature:` 时两层规则口径不一，方向安全）· M5（一条提交带两个 `Feature:` 时两函数口径不一——设计稿 §4.1 说的「取第一条」未实现，实际是环境集合收两个、全集跳过；属边界，钩子不会产生这种输入）。

## 6.2 新增能力：统计窗口（用户 2026-08-28 提出）

看板默认只统计**最近 3 个月**，`pnpm board --since=6.months` / `--since=all` 覆盖，也认 `BOARD_SINCE`。

- 时间窗**同时**作用于 feature 全集与三个环境的「含有」集合——只掐一边会出现「行还在但列全暗」的假象。
- 窗口值渲染进看板头部与终端输出，避免行数骤减被误读成数据丢失。
- 顺带**去掉了两个 `-N` 上限**（原 1000 / 10000）：越过是静默少认 feature、无任何报错，而全量扫一遍仅约 30ms（实测 2229 条提交）。真要控规模用 `--since`，它至少会把窗口标出来。
- 实测：默认 3 个月与 `--since=all` 同为 164（本仓最早的 merge 也才 2026-06，全落在窗内）；`--since=2.weeks` 得 67，证明过滤确实生效。


## 6.3 真机落地踩到的四件事（2026-08-28）

**共同点：四条全是「跑起来」才暴露的，读代码和评审都发现不了。**

1. **`cherry-pick <m>^1..<m>` 这条命令本身是错的**（手册里照抄多年）。该区间**包含 merge commit 自身**，
   pick 到它必然报 `is a merge but no -m option`。正确写法 `<m>^1..<m>^2`（`^2` = 特性分支那一侧）。
2. **`-m 1` 压扁会丢身份**：压扁后消息就是主干那条 merge commit 的消息，而它本无 trailer。
   实测 `-m 1` → 空、`<m>^1..<m>^2` → `{feat/x}`。→ 促成了 merge commit 的 subject 回填。
3. **🔴 回填判据一开始挂错了维度，修复形同虚设**。第一版判「当前分支是主干」，而本仓落地流程是
   「在临时分支 `land-xxx` 上 `--no-ff` 合特性分支，再 push 到 `dev`」——钩子看到的分支名从来不是
   `dev`，**回填在真实流程里从不触发**（实测 `dev` 上两条 merge 的 trailer 都是空）。改判
   「这条提交的 subject 解析得出 feature 分支名」，与当前分支无关。
   **这条错误评审发现不了**：代码忠实实现了 spec，是 spec 本身对不上真实落地流程。
   连带收获：修好后连 `-m 1` 压扁也能保住身份（源头 merge 自己带 trailer 了），第 2 条从
   「靠人记得别用 `-m 1`」升级成机制保证。
4. **验证方法本身两次失效，结论作废重测**：① 在 `dev` 上测「主干不贴 trailer」——切过去时
   `.githooks/` 还不在工作树里，钩子根本不存在；② 为切分支先 `git stash`，把待验的改动一起藏了，
   跑的是旧代码。**教训：验钩子前先确认钩子文件在工作树里、改动没被 stash 走。**

## 6.4 T6 核心验收结论（2026-08-28，真机）

PR #17 **故意用 GitHub 默认 subject 合入 `main`**（`Merge pull request #17 from rezona-ai/pick/board-trailer`）：

| 判据 | 结果 |
|---|---|
| 旧判据（扫 merge subject） | **0** —— 改造前该 feature 就此永久丢失 |
| 新判据（扫 trailer） | **5** |
| `pnpm board` | 165 行，`docs/board-trailer-identity` 在且仅一行 |

即 `main` 上的 feature 身份**完全由 trailer 承载、与 subject 无关**，设计稿 §5 第 3 条成立。

> ⚠️ **这条结论只覆盖钩子装上（2026-08-28）之后产生的提交**。T6 验的是 `docs/board-trailer-identity`
> 自己——它的提交带 trailer。对**更早的存量 feature**，分支侧提交一条 trailer 都没有，身份只在 dev
> 那条 merge commit 的 subject 里，此时默认 subject 合入 = 身份两源皆空。2026-09-03 已实发六次，
> 见 §6.5。
`pnpm build` 由该 PR 的 CI 跑通（本机 Google Fonts 域不可达，多次失败均与改动无关）。

## 6.5 pre-hook 存量在挑拣时丢身份（2026-09-03 实发，六次）

**症状**：`dev` 上 15 个 feature 一次性 pick 上 `main`（PR #20）、并一路发到 stage / prod 之后，
`pnpm board --since=all` 里有四行需求的 stage / prod 列仍显示 `n/m`：

| 需求 | 显示 | 缺的分支 |
|---|---|---|
| agent 错误透传与重试 | 1/4 | `feat/agent-error-passthrough-retry`、`fix/agent-error-bubble-polish`、`fix/retry-bubble-polish` |
| 游戏导出 | 2/3 | `feat/export-play-bundle` |
| 回放播放器 | 8/9 | `fix/share-boot-loading-stuck` |
| 对话连接韧性与刷新恢复 | 9/10 | `fix/refresh-restore-turn-model-and-subagents` |

**内容没丢**：`git diff --stat dev origin/main` 输出为空，prod 跑的 commit 与 `dev` 工作树逐字节一致。
暗的是**身份标记**，代码全在线上。`dev` 认 175 个 feature，`main` 只认 169，差集正好这 6 个。

**根因（两个前提叠在一起才出事）**：

1. 这 6 个 feature 的分支侧提交产生于**钩子装上之前**，`git log --format='%(trailers:key=Feature,valueonly)' <m>^1..<m>^2`
   逐条为空——它们的身份**只**存在于 `dev` 上那条 merge commit 的 subject 里。
2. `cherry-pick <m>^1..<m>^2` 搬的是分支侧提交，**恰好把那条 merge commit 排除在外**（`^2` 是特性分支
   那一侧，merge 自己不在区间内），于是 subject 源也没跟过去。

两个源同时空 → `main` 上认不出这个 feature。实测分界干净：

```text
2026-08-24  feat/export-play-bundle                       提交=6   带 trailer=0
2026-08-24  fix/share-boot-loading-stuck                  提交=3   带 trailer=0
2026-08-25  fix/refresh-restore-turn-model-and-subagents   提交=9   带 trailer=0
2026-08-26  feat/agent-error-passthrough-retry            提交=20  带 trailer=0
2026-08-27  fix/agent-error-bubble-polish                 提交=7   带 trailer=0
2026-08-27  fix/retry-bubble-polish                       提交=13  带 trailer=0
--- .githooks/commit-msg 装上（2026-08-28）---
2026-08-28  feat/share-remix-toggle                       提交=6   带 trailer=6
2026-09-02  feat/export-steam-package                     提交=11  带 trailer=2
```

**🔴 §6.4 与手册那句「`--subject` 推荐但不再是命门」害了这一次。** 那句话的射程只到「钩子装上之后
产生的 feature」，文档没写出这个限定，照信就会漏。对 pre-hook 存量，`--subject` **仍是命门**。

**三个候选做法，在一份从 `b1259499`（PR #20 之前的 `main`）起的丢弃克隆里逐个实测**（2026-09-03，
基准 feature `fix/share-boot-loading-stuck`，钩子按 GitHub 侧口径关掉）：

| 做法 | subject 源命中 | trailer 源命中 | 判定 |
|---|---|---|---|
| A `cherry-pick -m 1 <m>` | **0** | **0** | ❌ 身份全丢 |
| B `^1..^2` + 合入写 `--subject "merge: <分支名> <标题>"` | **1** | 0 | ✅ |
| C `^1..^2` + 给每条补 `Feature:` trailer，默认 subject 合入 | 0 | **3** | ✅ |

**🔴 A 不可用，和直觉相反。** `-m 1` 的产物是**单亲提交**（实测 `parents=b1259499`，只有一个），
它的 subject 虽然确实是 `merge: fix/share-boot-loading-stuck …`，但 subject 源那一路是
`git log --merges --format=%s`（`index.ts:65`）——**只扫 merge commit**，单亲提交根本不在扫描范围内；
而 pre-hook 的源头 merge 自己没有 trailer，trailer 源也空。§6.3 第 2 条那句「修好后连 `-m 1` 压扁
也能保住身份」**只对钩子装上之后产生的 merge 成立**（那种 merge 自己带 trailer），对 pre-hook 存量不成立。

**推荐 C，其次 B**：

- **C**：pick 完在 pick 分支上补贴 trailer，`git rebase <base> --exec "git commit --amend --no-edit --trailer 'Feature: <分支名>'"`。
  重写的是一条一次性 pick 分支的历史（不是共享历史），代价可以忽略；好处是**身份不依赖合并时的 subject**，
  用 GitHub 默认 subject 合入也认得出，且提交粒度一条不丢。**一条 PR 混多个 feature 时只有这条可用**——
  各段提交贴各自的分支名即可。
- **B**：一个 feature 一条 pick PR，合入时写 `--subject`。简单，但 subject 只能承载一个分支名，
  混装 PR 用不了，且看板的日期列会记成合入 main 的时间而非合入 dev 的时间。

**判据（挑拣后立刻自查，别等看板）**：

```bash
# trailer 源：pick 分支上认不认得出
git log --format='%(trailers:key=Feature,valueonly)' <base>..<pick 分支> | grep -c '^<分支名>$'
# subject 源：合入 main 之后才有得查（PR 的 merge commit 是 subject 的载体）
git log --merges --format=%s <base>..origin/main | grep -c 'merge: <分支名>'
# 两者相加为 0 = 身份没跟过去；main 还没合就还来得及改
```

**本次处置：只归档，不回填。** 让这四行变 ✓ 需要往 `main` 补一条带 6 个 `Feature:` trailer 的提交，
且因 prod 的 sha 已冻结在 `release/2026-09-04`，还要新切 release 重发生产——为一列显示重发生产不划算。
攒到下次发 prod 时一起带上，或就这么留着（内容在线上，账对得上）。

## 7. 明确不做

- 不引入 husky 或任何新的开发依赖。
- 不改 `parseMergeSubject` 的现有行为（只新增 trailer 源，旧逻辑原样保留作兜底）。
- 不改看板的三列语义（dev = `origin/dev`；stage / prod = 对应部署 workflow 最近一次成功 run 的
  `headSha`），也不把 `test` 分支纳入看板——它是临时叠加态，不代表落地。
