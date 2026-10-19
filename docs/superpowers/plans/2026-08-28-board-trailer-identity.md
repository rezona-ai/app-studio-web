# 看板 feature 身份改用 commit trailer · 实现计划

设计稿：`docs/superpowers/specs/2026-08-28-board-trailer-identity-design.md`
分支：`docs/board-trailer-identity`（基于 `origin/dev`）

按「并存加新 → 原子切换 → 删旧」推进；本轮**只到并存**——旧的 `parseMergeSubject` 永久保留作存量
兜底（设计稿 §7 明确不删），所以没有「删旧」这一步。

---

## T1 · 钩子纯逻辑 + 单测（无副作用）

**做什么**：`.githooks/` 下的判定逻辑不写在 shell 里，下沉成可测的纯函数
`scripts/commit-trailer/lib.ts`：

```ts
decideTrailer(branch: string, message: string): { append: false } | { append: true; value: string }
```

规则见设计稿 §4.2：主干分支不加 · 已有 `Feature:` 不加（幂等）· `pick/*` `backport/*` 不加 ·
其余追加当前分支名。同目录 `lib.test.ts` 覆盖四条规则 + 边界（`detached HEAD`、分支名含 `+`、
消息里 `Feature:` 出现在正文而非 trailer 区）。

**TDD**：先写测试跑红，再实现。

**验证**：`pnpm exec vitest run scripts/commit-trailer/lib.test.ts`

---

## T2 · 钩子本体与安装

**做什么**：
- `.githooks/commit-msg`：调 `scripts/commit-trailer/index.ts`（读 `$1` 消息文件、取当前分支），
  需要追加时用 `git interpret-trailers --if-exists doNothing --trailer "Feature: <v>"` 就地改写。
- `package.json` 加 `"prepare": "git config --local core.hooksPath .githooks || true"`，
  **相对路径**（设计稿 §4.3：绝对路径正是那次死配置的成因），`|| true` 防非 git 环境（CI 装依赖）报错。

**验证**（真机，逐条给命令与预期输出）：
1. 特性分支上空提交 → `git log -1 --format='%(trailers:key=Feature,valueonly)'` 输出该分支名；
2. `dev` 上空提交 → 输出为空；
3. 重复 `git commit --amend` → 仍只有一条 trailer；
4. cherry-pick 到 `pick/*` → 值不变（不被改写成 `pick/xxx`）——**同时确认 cherry-pick 到底触不触发
   `commit-msg` 钩子，把实测结论写回 spec §4.2 那条待确认注记**。

⚠️ 每条验证产生的临时提交/分支当场清理，不留在 `dev` 上。

---

## T3 · 看板解析双源并存（纯逻辑，TDD）

**做什么**：`scripts/release-board/lib.ts` 新增
`branchSetFromTrailers(lines)` 与 `collectFeaturesFromTrailers(logLines)`，与现有
`branchSetFromSubjects` / `collectFeatures` **并列**，不改后者一行。再加一个合并层：同一命名空间
（分支名）取并集去重；`collectFeatures*` 合并时日期取最早、标题取「有标题的那条」（沿用现有归并语义）。

**验证**：`pnpm exec vitest run scripts/release-board/lib.test.ts`，新增用例覆盖：只有 trailer /
只有 subject / 两者都有（不得计两次）/ 两者标题不同时的取舍。

---

## T4 · 看板接线（副作用层）

**做什么**：`scripts/release-board/index.ts`
- feature 全集：`origin/dev ∪ origin/main`（设计稿 §4.4）；
- 各环境「含有」集合：该环境部署 commit 可达提交的 trailer 集合 ∪ 旧 subject 集合；
- `git log` 的 format 改成同时取 subject 与 trailer，一次遍历拿两样，避免跑两遍。

**验证**：`pnpm board` 与改造前对比——feature 总数 ≥ 135、无重复行、存量行的列状态一致
（设计稿 §5 的第 4、5 条）。改造前的基线先存一份 `release-board.html` 备比对。

---

## T5 · 文档

- `CLAUDE.md`：把「pick PR 必须带 `--subject`」从**命门**降级为**建议**，写明真正的身份源是 trailer。
- `docs/deploy/cicd-onboarding.md` §5.2：同上；补一句「默认 subject 也能被认出来了」。
- 设计稿 §4.2 回填 cherry-pick 钩子行为的实测结论。
- 在看板文档处留一行：`fix/compose-order` 因 PR #15 的默认 subject 永久失真，非 bug。

---

## T6 · 核心验收（设计稿 §5 第 3 条）

**用 GitHub 默认 subject 合一个 pick PR 进 `main`，`pnpm board` 仍认得出该 feature。**
这条过了才说明真的摆脱了人工纪律。可以拿 T5 的文档提交本身当载体，不必额外造探针。

---

## 合并与评审

1. 本分支跑完整验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build`。
2. 派干净上下文子代理，基于 spec + `origin/dev..HEAD` 的 diff 独立评审；Critical / Important 修完再合。
3. `--no-ff` 合入 `dev`，在合并结果上重跑完整验证；再 `pick/*` PR 上 `main`。
4. 🔴 清理 worktree / 删分支先问 Nick。
