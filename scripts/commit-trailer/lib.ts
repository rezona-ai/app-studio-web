// `Feature:` trailer 的判定逻辑——纯函数层（无副作用，便于单测）。
// 契约见 docs/superpowers/specs/2026-08-28-board-trailer-identity-design.md §4.1/§4.2。
//
// 为什么要有这个 trailer：看板判定 feature 身份原先靠 merge commit 的 subject，而四线拓扑下
// main 上的 subject 由人在合 PR 时手写，GitHub 默认的 `Merge pull request #N from …` 会被判成
// 「不是 feature」（PR #15 已实发一次且不可逆）。trailer 随提交消息一起被 cherry-pick 复制，
// 因而在 dev / main / release 三条互不为祖先的线上都是同一个身份。

// 复用看板那边的分支名语法与 subject 解析：身份的「什么样的值算数」只能有一份定义，
// 两边各写一套正则迟早漂移（贴上去的值看板不收 = 贴了等于没贴）。
import { looksLikeBranch, parseMergeSubject } from "../release-board/lib";

export type TrailerDecision = { append: false } | { append: true; value: string };

/** 主干分支：其上的提交不属于任何 feature */
const TRUNK = new Set(["dev", "main", "test"]);

/** 这两类分支上的提交要么是 cherry-pick 来的（已带 trailer），要么是解冲突产生的 */
const CARRIER_PREFIXES = ["pick/", "backport/"] as const;

/**
 * 消息里是否已有 `Feature:` trailer。
 *
 * 🔴 **扫全文，不能只看最后一段**。`git interpret-trailers --if-exists doNothing` 也只认
 * 最后一段，所以「`Feature:` 在倒数第二段」（例如 trailer 之后又另起一段补了
 * `Co-Authored-By:`）时两层幂等会**同时失守**——git 会在末尾再贴一条，而 `%(trailers)`
 * 取最后那条，结果是原身份被**静默替换**成当前分支名。实测复现过，见 spec §6。
 *
 * 判错方向的取舍：扫全文可能把正文里顺口写的 “Feature: 某某” 当成已有 → 该提交拿不到
 * 身份，但有旧的 subject 源兜底；而只扫最后一段会**贴错身份**，不可逆。宁可漏贴。
 *
 * 大小写不敏感：git 的 trailer key 匹配就是不敏感的（实测 `feature:` 同样会被
 * `%(trailers:key=Feature)` 取到）。
 */
function hasFeatureTrailer(message: string): boolean {
  return message
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => /^feature:\s*\S/i.test(line.trim()));
}

/**
 * 决定是否给这条提交追加 `Feature:` trailer，以及取什么值。
 *
 * @param branch 当前分支名（detached HEAD 时传空串或 "HEAD"）
 * @param message 提交消息全文
 */
export function decideTrailer(branch: string, message: string): TrailerDecision {
  const b = branch.trim();

  // 取不到分支名（detached HEAD / rebase 中途）：宁可不加，也不要贴一个错的身份
  if (!b || b === "HEAD") return { append: false };

  // 🔴 幂等优先于一切：pick 过来的消息已带原分支名，绝不能按当前分支名覆盖成另一个身份
  if (hasFeatureTrailer(message)) return { append: false };

  // 特性分支的 merge commit 是那个 feature 在这条线上的落点，身份从 subject 回填。
  // 不回填的话，`cherry-pick -m 1` 把它压成一条搬到 main 时身份全丢（实测，见 spec §6）。
  // `git merge` 会触发 commit-msg 钩子（实测），所以回填可行。
  //
  // 🔴 **判据是「subject 解析得出 feature 分支名」，不是「当前分支是主干」**：本仓的落地流程是
  // 「在临时分支上 --no-ff 合特性分支，再 push 到 dev」，钩子看到的分支名是 `land-xxx` 而非 `dev`
  // ——挂在分支名上的版本在真实流程里**从不触发**（实测 dev 上两条 merge 的 trailer 都是空）。
  // 同步性合并不受影响：`Merge branch 'origin/dev' into …` / `'feat/a' into feat/b` 都解析为 null。
  const fromSubject = parseMergeSubject(message.split("\n")[0] ?? "");
  if (fromSubject && looksLikeBranch(fromSubject.branch)) {
    return { append: true, value: fromSubject.branch };
  }

  if (TRUNK.has(b) || b.startsWith("release/")) return { append: false };

  // pick/backport 分支上没有 trailer 的提交多半是解冲突产生的——身份应沿用原 feature，
  // 机器猜不出来，留给人手填，不拿 pick/xxx 顶上
  if (CARRIER_PREFIXES.some((p) => b.startsWith(p))) return { append: false };

  // 贴之前先过一遍看板的收值判据：看板只认含 `/` 或 `+` 的值，
  // 在 `hotfix` 这类分支上贴了也会被静默丢弃，等于没贴还徒增噪音
  if (!looksLikeBranch(b)) return { append: false };

  return { append: true, value: b };
}
