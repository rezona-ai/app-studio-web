// PR 分支策略——纯逻辑层（无副作用，便于单测）。
// 口径见 docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md §5.5 ①。
//
// 本仓四条线互不为祖先是**目标**（dev 自由演进、main 只收挑拣、release 是冻结快照），
// 所以这里判的是「谁能合进谁」，而不是 pgc 那种血缘祖先关系。

export type PolicyResult = { ok: true } | { ok: false; reason: string };

/** 机器分支：只由 deploy_dev_pr.yml force-push，人不碰 */
const MACHINE_BRANCH = "test";

/** 允许合进 main 的 head 前缀 */
const MAIN_HEAD_PREFIXES = ["pick/", "backport/", "docs/", "chore/"] as const;

/** 去掉 GitHub 环境变量里可能带的 refs/heads/ 前缀 */
function normalize(ref: string): string {
  return ref.trim().replace(/^refs\/heads\//, "");
}

const isRelease = (b: string) => b.startsWith("release/");
// 目录式前缀匹配：`pick/x` 中而 `pickle/x` 不中（前缀常量自带尾部 `/`）
const hasPrefix = (b: string, prefixes: readonly string[]) => prefixes.some((p) => b.startsWith(p));

/**
 * 判定一个 PR 的 base ← head 是否被允许。
 * 未列入的 base（如特性分支互开 PR）一律放行——策略只管四条主干。
 */
export function checkBranchPolicy(baseRef: string, headRef: string): PolicyResult {
  const base = normalize(baseRef);
  const head = normalize(headRef);

  if (base === MACHINE_BRANCH || head === MACHINE_BRANCH) {
    return {
      ok: false,
      reason: `\`${MACHINE_BRANCH}\` 是机器分支（由 deploy_dev_pr.yml 叠合后 force-push），不参与 PR。`,
    };
  }

  if (base === "main") {
    if (head === "dev") {
      return {
        ok: false,
        reason:
          "整条 dev 不进 main：main 的内容若由 dev 决定，两线独立演进（选择性上线）就没了。" +
          "改从 origin/main 切 pick/<主题>，cherry-pick 该特性的提交后再开 PR。",
      };
    }
    if (!hasPrefix(head, MAIN_HEAD_PREFIXES)) {
      return {
        ok: false,
        reason:
          `head \`${head}\` 不能合进 main：特性分支基于 dev，其 PR diff 会连带 dev 领先 main 的全部内容。` +
          `合进 main 的 head 只能是 ${MAIN_HEAD_PREFIXES.map((p) => `\`${p}*\``).join(" / ")}。`,
      };
    }
    return { ok: true };
  }

  if (isRelease(base)) {
    if (!head.startsWith("backport/")) {
      return {
        ok: false,
        reason:
          `release 分支是冻结的上线快照，只收补丁：head 必须是 \`backport/*\`，当前是 \`${head}\`。` +
          "（补丁记得成对 pick 一份回 main，否则下次切 release 就会回归。）",
      };
    }
    return { ok: true };
  }

  if (base === "dev") {
    if (head === "main" || isRelease(head)) {
      return {
        ok: false,
        reason: `禁止主干反合：把 \`${head}\` 合回 dev 会让两条线变成交叉历史，此后互相都不干净。`,
      };
    }
    return { ok: true };
  }

  return { ok: true };
}
