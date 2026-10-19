// PR 分支策略闸的 CI 入口：读 GitHub 注入的 base/head，判定不通过就打印原因并 exit 1。
// 纯逻辑在 ./lib（单测在 ./lib.test.ts），本文件只做 IO。
//
// 本地复现：GITHUB_BASE_REF=main GITHUB_HEAD_REF=dev pnpm exec tsx scripts/branch-policy/index.ts

import { checkBranchPolicy } from "./lib";

const base = process.env.GITHUB_BASE_REF ?? "";
const head = process.env.GITHUB_HEAD_REF ?? "";

// 非 PR 事件（push）两个变量都为空——不该跑到这里，但真跑到了也别把 CI 弄红
if (!base || !head) {
  console.log("非 pull_request 事件（GITHUB_BASE_REF / GITHUB_HEAD_REF 为空），跳过分支策略检查。");
  process.exit(0);
}

const result = checkBranchPolicy(base, head);

if (!result.ok) {
  console.error(`❌ 分支策略不通过：${head} → ${base}`);
  console.error("");
  console.error(result.reason);
  console.error("");
  console.error("完整口径见 docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md §5.5。");
  process.exit(1);
}

console.log(`✔ 分支策略通过：${head} → ${base}`);
