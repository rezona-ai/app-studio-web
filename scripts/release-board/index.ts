// 功能上线看板——副作用层：完全以 GitHub 数据为准。
// dev = origin/dev；stage = main 系手动 dispatch；prod = release/YYYY-MM-DD 手动 dispatch。
//（两者「当前上线内容」只存在于 Actions 部署记录里，故只能查 run。）
//
// 🔴 latestDeploy 取的是 run 的 **headSha**（= dispatch 时 `--ref` 所指的 SHA），**不是** `branch`
// 入参。两者不一致时看板会失真：从 `main` dispatch 去发 `release/2026-08-27`，prod 列会点亮
// `main` 上全部 feature（含本次 release 没带出去的）。所以 dispatch 必须写
// `gh workflow run "Deploy (production)" --ref release/X -f branch=release/X`，两处同值。
// 手册 §5.2 有同款红字。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  branchSetFromSubjects,
  branchSetFromTrailers,
  buildBoard,
  collectFeatures,
  collectFeaturesFromTrailers,
  EMPTY_EPICS,
  mergeFeatureSources,
  parseSinceArg,
  renderHtml,
  type EnvInfo,
  type EpicsConfig,
  type FeatureMerge,
} from "./lib";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// 时间窗：`--since=<git 时间表达式|all>` > `BOARD_SINCE` > 默认 3 个月。
// 必须**同时**作用于 feature 全集与各环境的「含有」集合，只掐一边会出现「行还在但列全暗」的假象。
const sinceWindow = parseSinceArg(process.argv.slice(2), process.env);
const sinceArgs = sinceWindow.since ? [`--since=${sinceWindow.since}`] : [];

/** workflow 显示名 → 最近一次成功 run 的 { sha, date }；从未成功部署返回 null。 */
function latestDeploy(workflow: string): { sha: string; date: string } | null {
  const out = execFileSync(
    "gh",
    ["run", "list", "--workflow", workflow, "--status", "success", "--limit", "1", "--json", "headSha,createdAt"],
    { encoding: "utf8" },
  );
  const runs = JSON.parse(out) as Array<{ headSha: string; createdAt: string }>;
  if (!runs.length) return null;
  return { sha: runs[0].headSha, date: runs[0].createdAt };
}

/** 确保 commit 对象在本地可用（部署自已删除的分支时 fetch origin 可能带不下来，按 sha 补拉）。 */
function ensureCommit(sha: string): void {
  try {
    git("cat-file", "-e", `${sha}^{commit}`);
  } catch {
    git("fetch", "--quiet", "origin", sha);
  }
}

/**
 * 环境部署点可达的全部 feature 分支名集合（不限 first-parent：dev 合入 main 后仍是祖先）。
 * 以分支名而非 merge SHA 为身份——过滤式回合 main 会 rebase 重建 merge（SHA 全变，subject 不变）。
 */
function mergeBranchSetOf(sha: string | null): Set<string> {
  if (!sha) return new Set();
  const fromSubjects = branchSetFromSubjects(
    git("log", ...sinceArgs, "--merges", "--format=%s", sha).split("\n").filter(Boolean),
  );
  // trailer 源：扫全部提交（不限 --merges）——trailer 贴在每条提交上，不依赖 merge 结构。
  // 这一路让 GitHub 默认的 `Merge pull request #N from …` 不再影响判定。
  const fromTrailers = branchSetFromTrailers(
    git("log", ...sinceArgs, "--format=%(trailers:key=Feature,valueonly)", sha).split("\n"),
  );
  return new Set([...fromSubjects, ...fromTrailers]);
}

/**
 * 给定若干 ref 的**并集**可达的 feature 列表，按时间倒序（多个 ref 传给 `git log` 是并集且去重，
 * 不是拼接——实测 `origin/dev origin/main` 得 2229 条，而非两者相加的 4363）。
 *
 * 双源：subject 源只有 merge commit 带得动分支名；trailer 源扫全部提交。
 * 口径与 mergeBranchSetOf 一致（不限 first-parent）——理由见 lib.ts 的 collectFeatures。
 *
 * **刻意不设 `-N` 上限**：越过上限是静默少认 feature、没有任何报错，而全量扫一遍仅 ~30ms
 * （实测 2229 条提交）。真要控规模用 `--since`，它至少会把窗口标在看板头部。
 */
function listFeatures(refs: string[]): FeatureMerge[] {
  const log = (...args: string[]) =>
    execFileSync("git", ["log", ...sinceArgs, ...args, ...refs], { encoding: "utf8" }).split("\n");
  return mergeFeatureSources(
    collectFeatures(log("--merges", "--format=%H%x09%cI%x09%s")),
    collectFeaturesFromTrailers(log("--format=%H%x09%cI%x09%(trailers:key=Feature,valueonly)")),
  );
}

// 全部判定基于远端数据：先同步 origin
git("fetch", "--quiet", "--tags", "origin");

const devRef = "origin/dev";
const [devSha, devDate] = git("log", "-1", "--format=%H%x09%cI", devRef).split("\t");
const stage = latestDeploy("Deploy (stage)");
const prod = latestDeploy("Deploy (production)");
for (const d of [stage, prod]) if (d) ensureCommit(d.sha);

const envs: EnvInfo[] = [
  { key: "dev", label: "dev", source: devRef, sha: devSha, date: devDate },
  { key: "stage", label: "stage", source: "Deploy (stage)", sha: stage?.sha ?? null, date: stage?.date ?? null },
  { key: "prod", label: "prod", source: "Deploy (production)", sha: prod?.sha ?? null, date: prod?.date ?? null },
];

// 全集取 origin/dev ∪ origin/main：稳态下 release ⊆ main（release 从 main 切），故不必再扫 release。
// ⚠️ 限定：backport/* 合进 release 之后、成对 pick 回 main 之前那个窗口，补丁只在 release 线上，
// 此时会漏一行——该窗口本就要求尽快关闭，漏报恰好是「忘了回 pick 到 main」的提示信号。
// 见 specs/2026-08-28-board-trailer-identity-design.md §6。
// 需求归属映射由人维护（git 里没有这种信息）。文件不存在 → 空配置，看板行为与未聚合时完全一致；
// 配置冲突（一个分支归两个需求）由 groupRows 抛错，这里不兜——冒充成功的看板比没有看板更糟。
// 这是一份预期会频繁手改的文件：JSON 语法错误 / 少个键都要报成带路径的人话，而不是裸 TypeError 栈。
const epicsPath = resolve(import.meta.dirname, "epics.json");
function loadEpics(path: string): EpicsConfig {
  if (!existsSync(path)) return EMPTY_EPICS;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`❌ ${path} 不是合法 JSON：${(e as Error).message}`);
    process.exit(1);
  }
  const fail = (what: string): never => {
    console.error(`❌ ${path} 形状不对：${what}`);
    process.exit(1);
  };
  const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
  const cfg = raw as Partial<EpicsConfig> | null;
  if (!cfg || typeof cfg !== "object") return fail("顶层须是对象");
  if (!isStrArr(cfg.internalPrefixes)) return fail("internalPrefixes 须是字符串数组");
  if (!Array.isArray(cfg.epics)) return fail("epics 须是数组");
  cfg.epics.forEach((e, i) => {
    if (!e || typeof e.title !== "string") fail(`epics[${i}].title 须是字符串`);
    if (!isStrArr(e.branches)) fail(`epics[${i}]「${e.title}」.branches 须是字符串数组`);
    if (e.globs !== undefined && !isStrArr(e.globs)) fail(`epics[${i}]「${e.title}」.globs 须是字符串数组`);
  });
  return cfg as EpicsConfig;
}
const epics = loadEpics(epicsPath);

const board = buildBoard(
  listFeatures([devRef, "origin/main"]),
  envs,
  { dev: mergeBranchSetOf(devSha), stage: mergeBranchSetOf(stage?.sha ?? null), prod: mergeBranchSetOf(prod?.sha ?? null) },
  new Date().toISOString(),
  epics,
);
for (const w of board.grouped.warnings) console.warn(`⚠️ ${w}`);

const outPath = resolve(process.cwd(), "release-board.html");
writeFileSync(outPath, renderHtml({ ...board, windowLabel: sinceWindow.label }));
const desc = (e: EnvInfo) => `${e.key}=${e.sha ? e.sha.slice(0, 7) : "未部署"}`;
const epicCount = board.grouped.main.filter((r) => r.kind === "epic").length;
const singleCount = board.grouped.main.length - epicCount;
const internalCount = board.grouped.internal?.members.length ?? 0;
console.log(
  `已生成看板：${outPath}（${sinceWindow.label}，${board.rows.length} 个分支 → ${epicCount} 个需求 · ${singleCount} 个未归类 · ${internalCount} 个工程内部；${envs.map(desc).join(" · ")}）\n` +
    `  统计范围可调：pnpm board --since=6.months / --since=all（或设 BOARD_SINCE）；需求归属改 ${epicsPath}`,
);
