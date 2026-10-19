# 从 taluna-game-web 迁入画布线 54 个 merge 组（设计稿）

日期：2026-08-14

## 背景

2026-07-30 的仓库迁移（见 `2026-07-30-repo-migration-rezonalab-design.md`）把仓库整段搬到
`rezona-ai/rezonalab-game-web`。搬迁后**两仓各自继续开发**，形成一次真实的分叉：

| | 本仓 `rezonalab-game-web` | 旧仓 `taluna-game-web` |
|---|---|---|
| 共同祖先 | `4b89c004`（fix(board): 上线看板改扫全部 merge） | 同 |
| 其后提交 | 119 笔 / 20 个 first-parent 条目 | 386 笔 |
| 内容主线 | 品牌换名、部署上线（GKE/LB/巡检）、订阅与额度、Post to Rezona、Rez1 模型、上线看板 | 画布线：分组 / 撤销 / 对齐吸附 / 列表视图 / 批量操作 / 键盘 / 血缘与出处 / 生成失败重试 / 时间维度 / lightbox |

旧仓在共同祖先之后还有两笔 —— `ac750411`（上传上限提到 20MB）与 `a52f117e`（Codex backend 接入合并组）——
**这两笔的内容本仓已有等价实现**（`git cherry` 判定 3 笔等价，`src/lib/agent-backend.ts`、
`src/koubou/apply-codex.ts` 等均在位）。故迁移起点定为 `a52f117e`。

## 目的

把旧仓 `a52f117e..dev` 的全部实现迁入本仓 dev，**保留 merge 组**——本仓 dev 的 first-parent 链上
仍能看到这 54 个回合，而不是被压成一坨。

## 约束（盘问共识）

- **迁移机制 = 逐组增量 merge**。按旧仓 first-parent 时序，对 54 个条目依次 `git merge <sha>`，
  每组在本仓产出一个 merge commit。不重排、不跳过——跳过会让后续组的 3-way 基准失真。
  否决的两个方案：一次性 `git merge taluna/dev`（19 处冲突全挤在一起、first-parent 链只剩一条，
  出事定位不到组）；按组 cherry-pick 重建同名分支（冲突要按 384 笔逐条重放，工作量最大而收益只是历史更"干净"）。
- **落点 = worktree 分支 + fast-forward 回 dev**。在 `.orca/worktrees/migrate-taluna-canvas`
  的 `feat/migrate-taluna-canvas` 上做完 54 组，回 dev 走 **fast-forward**（**不是** `--no-ff`）。
  用 `--no-ff` 会把 54 个组重新压到二级历史，与"保留 merge 组"自相矛盾。
- **冲突取并集，本仓已上线行为不得回退**。机械冲突自行解，每处写中文注释说明为什么这么合，
  并补覆盖两边行为的测试。只有当两边语义真的不能并存、必须舍一时才停下来问。
- **每组验证 `lint + tsc + test`**（实测 ≈40s）；`pnpm build` 只在发生冲突的组与全部完成后各跑一次。
  任一组不绿就地修到绿再进下一组，不攒债。
- **不派子代理评审、不跑 `/walkthrough`**（本轮明确排除）。
- **不碰 `deploy/` 与部署 workflow**：旧仓在迁移区间内对 `deploy/`、`.github/workflows/deploy*.yml`、
  `scripts/` 一个字没改，两仓最危险的分歧点（namespace / 镜像仓 / 域名 / LB url-map）天然不在迁移面内。
- **不推远端、不删 worktree 与分支**：收工前问。

## 迁移面（实测）

`a52f117e..taluna/dev`：386 笔提交，`git cherry` 判定 339 笔在本仓无等价。

- **54 个 first-parent 条目** = 42 个 merge commit + 12 笔直提
- **`src` + `tests` 258 文件**、**`docs` 79 文件**（全是 `superpowers/{specs,plans}/` 下与各功能配对的
  新增设计稿与计划，零冲突）、**`.github` 1 文件**（`ci.yml` 增 `pnpm test:tz` 步骤）
- 一次性试合并的规模：290 文件 `+31338 / -732`，**19 个文件冲突**

### 预判的 19 个冲突文件

| 文件 | 撞车原因 |
|---|---|
| `.gitignore` / `eslint.config.mjs` / `vitest.config.ts` | 两仓**各自独立**做了 worktree 落点迁 `.orca/worktrees`（本仓 `deea3bb8` vs 旧仓 `19e2a9d9`），同一件事的两份实现 |
| `src/store/actions.ts` / `src/store/types.ts` / `src/lib/pgc/client.ts` | 本仓订阅与额度线 vs 旧仓画布线改同一批 action / 类型 |
| `src/i18n/locales/{zh,zh-TW,ja,ko}.ts` / `src/i18n/i18n.test.ts` | 两边各自往同一批语言包加文案 |
| `src/components/canvas/GenerateForm.tsx` / `nodes/NodeCard.tsx` | 生成表单与卡片同时被额度线和画布线改 |
| `src/components/preview/UserInfo.tsx` / `UserInfo.test.tsx` | 账户条：本仓加订阅入口，旧仓改语言下拉 |
| `src/components/ui/TopupModal.tsx` / `InsufficientCreditsModal.tsx` / `InsufficientCreditsModal.test.tsx` | 额度弹窗两边都改 |
| `package.json` | 依赖 + `test:tz` 脚本 |

## 方案

### 第 0 步：spec 与 plan 落盘

本文件与配套 plan 落 `docs/superpowers/{specs,plans}/`，作为迁移分支的首个提交。

### 第 1 步：54 组按序 merge

按下表顺序（旧仓 first-parent 由老到新）执行 `git merge <sha>`：

| # | sha | 组 |
|---|---|---|
| 1 | `444e61bd` | fix(toast) 卡片宽度上限改按视口 |
| 2 | `bf85b5cc` | fix(chat) 打断回复按轮幂等 |
| 3 | `02bd8431` | docs run 起始时刻设计稿 |
| 4 | `18c79435` | fix(chat) 用 updated_at 补 run 起始时刻 |
| 5 | `530082b8` | fix(server) requestTimeout 提到 3600s |
| 6 | `e2a65b9b` | PR#90 fix/select-clamp-and-mobile-i18n |
| 7 | `db4ca973` | worktree-feat+fullscreen-preview-instant-loading |
| 8 | `9bec73ec` | worktree-feat+canvas-undo |
| 9 | `97363b27` | feat/canvas-search-jump |
| 10 | `b3161291` | worktree-feat+card-drag-and-hover-plus |
| 11 | `14d989d9` | worktree-fix+reduce-motion-display-none |
| 12 | `0a171ca3` | fix(canvas) 节点重建带回 RF 尺寸 |
| 13 | `109020d0` | feat/canvas-gen-failure-retry |
| 14 | `ef5acc29` | feat/canvas-provenance |
| 15 | `258b1b26` | feat/canvas-list-view |
| 16 | `9ea17623` | feat/canvas-bulk-actions |
| 17 | `53d3dc15` | feat/canvas-align-guides |
| 18 | `390c1294` | feat/canvas-persist-reliability |
| 19 | `82016f22` | feat/canvas-input-browse |
| 20 | `11ca0ecf` | feat/canvas-keyboard |
| 21 | `2ea8c6ad` | feat/canvas-task-visibility |
| 22 | `1129dc6c` | feat/agent-asset-lineage |
| 23 | `19e2a9d9` | chore worktree 迁 .orca/worktrees ⚠️冲突 |
| 24 | `59248303` | fix(pgc) listProjects 分页续拉 |
| 25 | `c24bb634` | feat/canvas-batch-position |
| 26 | `3713de89` | feat/canvas-groups |
| 27 | `d1070206` | feat/canvas-estimate |
| 28 | `9013d325` | feat/agent-provenance |
| 29 | `44c91ad0` | fix/gen-task-deadline-and-placeholder |
| 30 | `333da98b` | fix/orphan-gen-task-no-delete |
| 31 | `39970603` | fix/retry-path-guards |
| 32 | `78cb6570` | chore/test-fake-timer-reset |
| 33 | `ea0054b7` | fix/inflight-placeholder-persist |
| 34 | `49b0a6b8` | fix/undo-and-overlay-guards |
| 35 | `3575188a` | fix/credit-and-visibility-guards |
| 36 | `b47829ed` | docs 交接文档同步 P2-3 |
| 37 | `18c1a815` | fix/canvas-list-and-feel |
| 38 | `217e0236` | docs 交接文档同步 P2-2 |
| 39 | `8e01afe3` | feat/canvas-time-dimension |
| 40 | `fce05439` | docs 交接文档 P1-4 |
| 41 | `52fad257` | feat/lightbox-action-bar |
| 42 | `d3e35fb2` | docs 交接工作完成清理文档 |
| 43 | `49be06b2` | fix/keyboard-layer-guards |
| 44 | `7e8de464` | fix/retry-single-routing |
| 45 | `61eb8693` | fix/drag-commit-guards |
| 46 | `8fb91a0d` | fix/provenance-and-badge-consistency |
| 47 | `c8d59891` | feat/canvas-ux-refinements |
| 48 | `55947b78` | feat/canvas-ux-refinements-2 |
| 49 | `7a2d9319` | feat/canvas-group-theming-menu |
| 50 | `0d4af6d8` | feat/canvas-group-title-and-key-delete |
| 51 | `12e35a72` | feat/canvas-group-a11y-and-menu-debts |
| 52 | `5ee2a15d` | fix/retry-route-content-policy |
| 53 | `8fad964c` | fix/input-rejected-route |
| 54 | `b0e4e477` | fix/retry-form-replace |

第 36 / 38 / 40 / 42 组是交接文档的更新与最终清理，净效果为零，仍按序 merge 以保持组数与历史完整。

**merge subject 写法**：42 个 merge commit 写本仓约定的 `merge: <原分支名> <中文一句话>`；
12 笔直提沿用原 subject。

### 第 2 步：品牌与配置收口

- `src/app/full/[pid]/[vid]/page.tsx` 的 `'Taluna · Preview'` 是整个迁移面里**唯一**一行带旧品牌字样的
  新增代码，改成本仓口径。
- `.github/workflows/ci.yml` 新增的 `Test (DST timezone)` 步骤依赖 `package.json` 的 `test:tz` 脚本，
  合并 `package.json` 时确保带上，否则这层夏令时守护形同虚设。

### 第 3 步：修上线看板解析器

**问题**：`scripts/release-board/lib.ts` 的 `collectFeatures` 扫全部 merge（不能用 `--first-parent`，
理由见该函数注释），按分支名归并，**同分支保留最早那条**。迁移后旧仓原始的 42 个
`Merge branch 'feat/xxx' into dev` 成为本仓 dev 的可达祖先，日期早于新建的 merge，于是看板取到裸格式那条，
走 `parseMergeSubject` 的兜底分支 —— **标题退化成分支名**（`feat/canvas-groups` 而非中文标题）。
环境列判定不受影响（按分支名查各环境是否包含）。

**修法**：把归并拆成两个维度 —— **日期仍取最早**（"合入 dev 时间"要的是首次落地时间，原意图保留），
**标题优先取能解析出真标题的那条**（`merge: <分支> <标题>` / `merge: <标题> (<分支>)` 两种新旧格式），
仅当同分支所有 merge 都是裸格式时才回落到分支名。约 5 行改动 + 单测，作为第 55 组单独一个提交。

### 第 4 步：回合与文档

- 分支全绿后 fast-forward 回 dev，在合并结果上重跑完整 `lint + tsc + test + build`。
- 更新 `CLAUDE.md`：画布线带来的新机制（分组 / 撤销 / 对齐吸附 / 列表视图 / 键盘层 / 血缘与出处 /
  生成失败重试路径 / 时间维度）与新增的 `pnpm test:tz` 守护写回仓库指南，保持指南与代码实况一致。
- 删除本地路径 remote `taluna`。

## 成功标准

1. `git log --first-parent --oneline e231a56a..dev` 恰好 57 条，且顺序为：spec/plan 落盘 1 条 →
   54 个迁移组（sha 与本文表格逐行对应）→ 看板解析器修正 1 条 → `CLAUDE.md` 更新 1 条。
2. `git cherry dev taluna/dev a52f117e` 无 `+` 输出（旧仓该区间的实现全部落地）。
3. 合并结果上 `pnpm lint` 无 error、`pnpm exec tsc --noEmit` 通过、`pnpm test` 全绿、`pnpm test:tz` 全绿、
   `pnpm build` 成功 —— 每步留完整命令 + 输出 + 退出码。
4. `pnpm exec vitest run scripts/release-board` 全绿，且 `pnpm board` 产出的 `release-board.html` 里
   42 个新组显示中文标题（不是分支名）、dev ✓ / stage ✗ / prod ✗。
5. 本仓已上线的订阅、额度、Post to Rezona、Rez1、GA4 相关测试全部仍绿——并集合并没有回退已上线行为。
6. `grep -rIn "Taluna" src tests` 除历史设计稿外零命中（`docs/superpowers/` 为当时记录，不改）。
7. 工作树干净，`deploy/`、`.github/workflows/deploy*.yml`、`scripts/lb-route-audit/` 相对 dev 零改动。

## 风险与不做

- **风险：并集合并掩盖语义冲突**。19 个冲突文件里 `store/actions.ts` 最险 —— 订阅轮询与画布生成任务
  轮询共用 action 骨架。缓解：该文件的每处冲突都补一条覆盖两边行为的测试，不只让编译过。
- **风险：旧仓 42 个原始 merge 进入历史后，`git log --merges` 的口径变了**。除看板外，
  根目录 `RULES.md` 里关于 merge subject 的约定不受影响；本轮只修看板解析器，不改约定。
- **不做**：不重写旧仓历史设计稿的品牌字样；不动 k8s / 镜像 / LB 资源名；不把迁移分支推远端。
