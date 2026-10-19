# 功能上线看板 实现计划

对应设计稿：`../specs/2026-07-13-release-board.md`

## 步骤

1. `scripts/release-board/lib.ts`：纯函数层（可单测，无副作用）
   - `parseMergeSubject(subject)`：解析 `merge: <标题> (<分支>)`，非 feature 合并返回 null；
   - `buildBoard(features, envSets)`：把 feature 列表与各环境的 merge-commit 集合合成看板模型；
   - `renderHtml(board)`：渲染自包含 HTML（含转义）。
2. `scripts/release-board/lib.test.ts`：解析 / 合成 / 转义的单测（Vitest，同目录）。
3. `scripts/release-board/index.ts`：副作用层
   - 先 `git fetch origin --tags` 同步远端；dev 取 `origin/dev` 尖；
   - stage / prod 经 `gh run list --workflow "Deploy (stage)|(production)" --status success --limit 1` 取实际部署的 `headSha`（缺本地对象时按 sha 补拉）；
   - `git log --first-parent --merges` 枚举 origin/dev feature；`git rev-list --merges <sha>` 得各环境集合；
   - 写 `release-board.html` 并打印路径。
4. `package.json` 加 `"board": "tsx scripts/release-board/index.ts"`；`.gitignore` 加 `release-board.html`。

## 验收

- `pnpm board` 在本仓库跑通，生成看板且 dev ⊇ stage ⊇ prod 的包含关系合理；
- lint / tsc / test 全绿。
