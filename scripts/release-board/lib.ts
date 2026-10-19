// 功能上线看板——纯逻辑层（无副作用，便于单测）。
//
// **feature 身份是双源的**（2026-08-28 起）：
// - **trailer 源（主）**：提交消息里的 `Feature: <分支名>`，由 `.githooks/commit-msg` 自动贴。
//   它随消息被 cherry-pick 原样复制，所以在 dev / main / release 三条互不为祖先的线上是同一个值，
//   **不依赖任何人在合 PR 时手写 subject**。
// - **subject 源（兜底）**：`--no-ff` merge commit 的 subject（两种格式见 parseMergeSubject）。
//   钩子装上之前的存量提交没有 trailer，只能靠它认；它也提供「合入 dev 的时间」与人写的标题。
//
// 两源产出同一命名空间（分支名），并集去重，见 mergeFeatureSources。
// 契约见 docs/superpowers/specs/2026-08-28-board-trailer-identity-design.md。
//
// ⚠️ 合 pick PR 时 `--subject "merge: feat/<原分支名> <标题>"` 仍**推荐但不再是命门**：
// 缺了它 feature 照样认得出（trailer 顶着），只是标题列会退化成分支名、日期列拿不到合入时间。

export interface FeatureMerge {
  sha: string;
  /** ISO 提交时间 */
  date: string;
  title: string;
  branch: string;
}

export type EnvKey = "dev" | "stage" | "prod";

export interface EnvInfo {
  key: EnvKey;
  label: string;
  /** 展示用数据源（git 引用如 origin/dev，或 Actions workflow 名） */
  source: string;
  /** 该环境当前部署的 commit；从未成功部署时为 null */
  sha: string | null;
  /** 部署/提交时间（ISO）；未部署时为 null */
  date: string | null;
}

export interface BoardRow extends FeatureMerge {
  /** 各环境是否已包含该 merge commit */
  status: Record<EnvKey, boolean>;
}

export interface Board {
  generatedAt: string;
  envs: EnvInfo[];
  rows: BoardRow[];
  /** 按需求聚合后的视图（见 groupRows）；渲染层吃它，rows 保留作身份层原貌 */
  grouped: GroupedBoard;
  /** 统计窗口的人话描述（如「最近 3 个月」）；不传则不在头部标注 */
  windowLabel?: string;
}

// ── 需求聚合（2026-09-02 新增）─────────────────────────────────────────────
// 身份仍是分支名；聚合是身份之上的一层**视图**，由人维护的 epics.json 驱动（git 里没有
// 「fix/group-undo-gaps 属于画布分组框」这种信息，只能人给一次）。
// 契约见 specs/2026-09-02-board-epics-design.md。

export interface EpicSpec {
  title: string;
  /** 精确分支名（主） */
  branches: string[];
  /** 可选 glob，只支持 `*`——刻意不引入 minimatch，也刻意不鼓励：`*replay*` 会吞掉 UX 打磨分支 */
  globs?: string[];
}

export interface EpicsConfig {
  /** 分支名前缀命中即进表尾「工程内部」组，优先级高于 epic（docs/ 分支不许冒充功能） */
  internalPrefixes: string[];
  epics: EpicSpec[];
}

export const EMPTY_EPICS: EpicsConfig = { internalPrefixes: [], epics: [] };

export interface EpicStatus {
  hit: number;
  total: number;
}

export interface EpicRow {
  kind: "epic";
  title: string;
  members: BoardRow[];
  /** 最早成员的合入时间（需求首次落地） */
  date: string;
  /** 全部成员命中才算该环境上线；部分命中渲染成 n/m，不冒充 ✓ */
  status: Record<EnvKey, EpicStatus>;
}

export type SingleRow = BoardRow & { kind: "single" };
export type MainRow = EpicRow | SingleRow;

export interface GroupedBoard {
  /** 主表：聚合行与未归类单行按日期倒序混排 */
  main: MainRow[];
  /** 表尾「工程内部」组；没有命中 internalPrefixes 的分支时为 null */
  internal: EpicRow | null;
  /** 配置引用了窗口内不存在的分支等非致命问题，由副作用层打到 stderr */
  warnings: string[];
}

const INTERNAL_TITLE = "工程内部";

/** 只支持 `*` 的 glob：其余字符按字面匹配（分支名里的 `.` `+` 不能被当正则元字符） */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

function epicRowOf(title: string, members: BoardRow[]): EpicRow {
  const at = (iso: string) => Date.parse(iso);
  const count = (k: EnvKey): EpicStatus => ({
    hit: members.filter((m) => m.status[k]).length,
    total: members.length,
  });
  return {
    kind: "epic",
    title,
    members,
    date: members.reduce((min, m) => (at(m.date) < at(min) ? m.date : min), members[0].date),
    status: { dev: count("dev"), stage: count("stage"), prod: count("prod") },
  };
}

/**
 * 把身份层的行按 epics.json 聚合成视图。
 *
 * - 归类优先级：internalPrefixes > epic；未命中任何规则的行保持单行。
 * - 一个分支被**两个不同 epic** 命中是配置错误，直接抛（同一 epic 内精确名与 glob 双命中不算）。
 * - epic 引用的分支在当前窗口内不存在只进 warnings——`--since` 收窄时属正常现象。
 * - 窗口内一个成员都没有的 epic 不出行；只有一个成员的 epic 仍出聚合行，映射语义不随窗口翻形。
 * - 空配置恒等：main 就是原行原序的单行，internal 为 null。
 */
export function groupRows(rows: BoardRow[], config: EpicsConfig): GroupedBoard {
  const at = (iso: string) => Date.parse(iso);
  const warnings: string[] = [];
  const isInternal = (b: string) => config.internalPrefixes.some((p) => b.startsWith(p));
  const known = new Set(rows.map((r) => r.branch));

  // 分支 → epic 下标；先算归属再分桶，冲突检测与 glob 展开都在这一步
  const owner = new Map<string, number>();
  config.epics.forEach((epic, i) => {
    const claim = (branch: string) => {
      if (isInternal(branch)) {
        warnings.push(`需求「${epic.title}」引用的分支 ${branch} 命中 internalPrefixes，已归工程内部而非该需求`);
        return;
      }
      const prev = owner.get(branch);
      if (prev !== undefined && prev !== i) {
        throw new Error(
          `epics.json 配置错误：分支 ${branch} 同时归属「${config.epics[prev].title}」与「${epic.title}」`,
        );
      }
      owner.set(branch, i);
    };
    for (const b of epic.branches) {
      if (!known.has(b)) warnings.push(`需求「${epic.title}」引用的分支 ${b} 不在当前统计窗口内`);
      claim(b);
    }
    for (const g of epic.globs ?? []) {
      const re = globToRegExp(g);
      let hits = 0;
      for (const b of known) {
        if (!re.test(b)) continue;
        hits++;
        claim(b);
      }
      // glob 是「不鼓励」的写法，拼错了零命中不能静默——否则误配永远发现不了
      if (hits === 0) warnings.push(`需求「${epic.title}」的 glob ${g} 在当前统计窗口内没有命中任何分支`);
    }
  });

  const members = new Map<number, BoardRow[]>();
  const internal: BoardRow[] = [];
  const singles: SingleRow[] = [];
  for (const r of rows) {
    if (isInternal(r.branch)) {
      internal.push(r);
      continue;
    }
    const i = owner.get(r.branch);
    if (i === undefined) {
      singles.push({ ...r, kind: "single" });
      continue;
    }
    members.set(i, [...(members.get(i) ?? []), r]);
  }

  const epicRows = [...members.entries()].map(([i, ms]) => epicRowOf(config.epics[i].title, ms));
  const main: MainRow[] = [...epicRows, ...singles].sort((a, b) => at(b.date) - at(a.date));
  return {
    main,
    internal: internal.length ? epicRowOf(INTERNAL_TITLE, internal) : null,
    warnings,
  };
}

/**
 * 解析 merge commit subject。接受三种格式：
 * - 新：`merge: <分支名> <标题>`（分支名形如 feat/xxx、worktree-feat+xxx，紧跟 merge: 之后）
 * - 旧：`merge: <标题> (<分支名>)`
 * - 兜底：`Merge branch '<分支名>' [into dev|main]`（裸 `git merge --no-ff` 的 git 默认 subject，无标题可取）
 * `Merge pull request` / `merge: origin/xxx` 等同步性合并返回 null（不是 feature）。
 *
 * `titled` 区分「标题是人写的」与「标题是拿分支名顶上的」：只有兜底分支为 false。
 * collectFeatures 归并同分支多条 merge 时据此让标题让位（见那里的注释）。
 */
export function parseMergeSubject(
  subject: string,
): { title: string; branch: string; titled: boolean } | null {
  const s = subject.trim();
  // 分支名须含 `/`（feat/xxx）或 `+`（worktree-feat+xxx）——CJK 不入 \w，故「同步 main(...)」类不会误中
  const neo = /^merge:\s*([\w.+-]*[/+][\w.+-]+)\s+(.+)$/.exec(s);
  // `merge: origin/dev <标题>` 是把主干拉回特性分支的同步性合并，位置上冒充 feature 分支名，需剔除
  if (neo) return neo[1].startsWith("origin/") ? null : { title: neo[2], branch: neo[1], titled: true };
  // 括号内须长得像分支名（无空格等），排除 `merge: 合并 origin/dev(PR #38 ...)` 类同步性合并
  const legacy = /^merge:\s*(.+?)\s*\(([\w.+/-]+)\)\s*$/.exec(s);
  if (legacy) return { title: legacy[1], branch: legacy[2], titled: true };
  // 兜底：裸 `git merge --no-ff <分支>` 的 git 默认 subject。没有人写的标题可取，标题即分支名——
  // 迁移到 rezonalab 仓后有一批这种写法，靠它把看板行补回来（缺标题的行本身就是「没按约定写」的提示）。
  const bare = /^Merge branch '([^']+)'(?:\s+into\s+(\S+))?$/.exec(s);
  if (bare) {
    const [, branch, into] = bare;
    // 分支名须含 / 或 + 且非远端 ref：挡掉 `'main' into feat/x` / `'origin/dev' into feat/x` 这类主干拉回特性分支
    const looksFeature = /[/+]/.test(branch) && !branch.startsWith("origin/");
    // into 目标限定主干（或 git 省略后缀时）：`'feat/a' into feat/b` 是特性分支互合，不是落地
    const landed = into === undefined || into === "dev" || into === "main";
    // titled=false：标题是拿分支名顶上的，不是人写的——归并时应让位给同分支带标题的那条
    return looksFeature && landed ? { title: branch, branch, titled: false } : null;
  }
  return null;
}

/**
 * 从一批 merge subject 中收集 feature 分支名集合。
 * feature 身份用分支名而非 SHA：过滤式回合（rebase 重建）会改写 SHA，但 subject 不变，
 * 分支名在 dev 原始 merge 与 main 上重建的 merge 之间稳定。
 */
export function branchSetFromSubjects(subjects: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const s of subjects) {
    const parsed = parseMergeSubject(s);
    if (parsed) set.add(parsed.branch);
  }
  return set;
}

// ── trailer 源（2026-08-28 新增，与上面的 subject 源并存）──────────────────────
// 身份改用提交消息里的 `Feature:` trailer：它随消息被 cherry-pick 原样复制，因而在
// dev / main / release 三条互不为祖先的线上是同一个值，不再依赖人在合 PR 时手写 subject
// （GitHub 默认的 `Merge pull request #N from …` 会被 parseMergeSubject 判成非 feature，
// PR #15 已实发一次且不可逆）。契约见 specs/2026-08-28-board-trailer-identity-design.md。
//
// 两源产出**同一命名空间**（都是分支名），所以并集去重即可，同一 feature 不会计两次。

/**
 * 值须长得像分支名——字符集与 parseMergeSubject 认的那套对齐（`\w.+-` 加一个 `/` 或 `+`），
 * 并排除 `origin/`（subject 源对它是显式排除的，两源口径必须对称）。
 *
 * 收紧的理由：只判「含 / 或 +」会收下 `feat/a and more` 这类手填的带空格值，以及 `origin/dev`
 * 这种同步性合并冒充的分支名——它们会在看板上变成幽灵行。
 */
export const looksLikeBranch = (v: string) =>
  /^[\w.+-]*[/+][\w.+-]+$/.test(v) && !v.startsWith("origin/");

/** 从 `%(trailers:key=Feature,valueonly)` 的输出行收集分支名集合 */
export function branchSetFromTrailers(values: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (v && looksLikeBranch(v)) set.add(v);
  }
  return set;
}

/**
 * 从 `git log --format=%H%x09%cI%x09%(trailers:key=Feature,valueonly)` 的行里收集 feature 列表。
 *
 * 与 collectFeatures 的差别：扫的是**全部提交**而不只是 merge——trailer 贴在每条提交上，
 * 不依赖 merge 结构。同一分支多条提交按最早那条定「首次落地时间」，与 subject 源同口径。
 * 标题这里只能取分支名（trailer 里没有标题），合并时会让位给 subject 源，见 mergeFeatureSources。
 */
export function collectFeaturesFromTrailers(logLines: Iterable<string>): FeatureMerge[] {
  const at = (iso: string) => Date.parse(iso);
  const byBranch = new Map<string, FeatureMerge>();
  for (const line of logLines) {
    if (!line) continue;
    const [sha, date, rawBranch] = line.split("\t");
    const branch = (rawBranch ?? "").trim();
    if (!sha || !date || !branch || !looksLikeBranch(branch)) continue;
    const prev = byBranch.get(branch);
    if (!prev || at(date) < at(prev.date)) {
      byBranch.set(branch, { sha, date, title: branch, branch });
    }
  }
  return [...byBranch.values()].sort((a, b) => at(b.date) - at(a.date));
}

/** 看板默认只统计最近 3 个月——全量历史里绝大多数 feature 早已上线，看的人只关心近期动向 */
const DEFAULT_SINCE = "3.months.ago";

export interface SinceWindow {
  /** 传给 `git log --since` 的值；null = 不限（全量） */
  since: string | null;
  /** 渲染进看板头部，避免有人看到行数骤减以为数据丢了 */
  label: string;
}

/**
 * 解析时间窗：命令行 `--since=<git 时间表达式|all>` > 环境变量 `BOARD_SINCE` > 默认 3 个月。
 *
 * 时间窗**必须同时**作用于 feature 全集与各环境的「含有」集合——只掐一边会出现
 * 「行还在但列全暗」的假象。
 */
export function parseSinceArg(argv: string[], env: Record<string, string | undefined>): SinceWindow {
  const fromArgv = argv.map((a) => /^--since=(.+)$/.exec(a)?.[1]).find(Boolean);
  const raw = (fromArgv ?? env.BOARD_SINCE ?? DEFAULT_SINCE).trim();
  if (raw === "all") return { since: null, label: "全部历史" };
  return { since: raw, label: raw === DEFAULT_SINCE ? "最近 3 个月" : `最近 ${raw}` };
}

/**
 * 合并 subject 源与 trailer 源，按分支名去重，时间倒序。
 *
 * **两源都有时整条取 subject 源，trailer 源只在 subject 源缺席时兜底。**
 *
 * 不能取「两侧最早」：subject 源的时间是**合入 dev 的时间**（看板那一列的表头就是这么写的），
 * 而 trailer 源的时间是**该分支第一条提交的时间**——后者必然更早，取最早等于把这一列从
 * 「合入时间」悄悄换成「开工时间」，两个量不是一回事。标题同理：trailer 源拿不到人写的标题，
 * 只能拿分支名顶上。
 */
export function mergeFeatureSources(
  fromSubjects: FeatureMerge[],
  fromTrailers: FeatureMerge[],
): FeatureMerge[] {
  const at = (iso: string) => Date.parse(iso);
  const byBranch = new Map<string, FeatureMerge>();

  for (const f of fromSubjects) byBranch.set(f.branch, { ...f });
  for (const t of fromTrailers) if (!byBranch.has(t.branch)) byBranch.set(t.branch, { ...t });

  return [...byBranch.values()].sort((a, b) => at(b.date) - at(a.date));
}

/**
 * 从 `git log --merges --format=%H%x09%cI%x09%s` 的行里收集 feature 列表，按合入时间倒序。
 *
 * 不能用 `--first-parent` 收窄：dev 回合 main 后 tip 就是 main 上的 PR merge commit，
 * 沿 first-parent 走到的是 main 主干，那条线只有 GitHub 的 `Merge pull request #N`，
 * 一条 feature 也解析不出来（看板会整个空掉）。改为扫全部 merge，只靠 subject 认 feature。
 *
 * 同一分支可能有多条 merge（过滤式回合 main 会 rebase 重建 merge），**日期与 sha 取最早**那次——
 * 「合入 dev 时间」要的是首次落地时间，不是重建时间。
 * 但**标题单独取**「有标题的那条」：从 taluna-game-web 迁入画布线后，同一分支同时存在旧仓的裸
 * `Merge branch '<分支>'`（时间早、标题是拿分支名顶上的）与本仓重写的 `merge: <分支> <中文标题>`
 * （时间晚）。若跟着日期一并取最早，42 行看板标题会全退化成分支名。
 */
export function collectFeatures(logLines: Iterable<string>): FeatureMerge[] {
  // ISO 串带时区偏移，不能按字典序比大小
  const at = (iso: string) => Date.parse(iso);
  const byBranch = new Map<string, FeatureMerge & { titled: boolean }>();
  for (const line of logLines) {
    if (!line) continue;
    const [sha, date, subject] = line.split("\t");
    if (!subject) continue;
    const parsed = parseMergeSubject(subject);
    if (!parsed) continue;
    const prev = byBranch.get(parsed.branch);
    if (!prev) {
      byBranch.set(parsed.branch, { sha, date, ...parsed });
      continue;
    }
    const earliest = at(date) < at(prev.date) ? { sha, date } : { sha: prev.sha, date: prev.date };
    // 已有带标题的就守住它；否则用这条的（这条也可能是裸的，那就仍是分支名兜底）
    const titleSide = prev.titled ? prev : parsed;
    byBranch.set(parsed.branch, {
      ...earliest,
      branch: parsed.branch,
      title: titleSide.title,
      titled: prev.titled || parsed.titled,
    });
  }
  // titled 是归并期的内部标记，不进对外的 FeatureMerge 模型（显式挑字段而非解构丢弃，免留未用变量）
  return [...byBranch.values()]
    .map(({ sha, date, title, branch }) => ({ sha, date, title, branch }))
    .sort((a, b) => at(b.date) - at(a.date));
}

/** 由 dev 上的 feature 列表与各环境包含的 feature 分支名集合合成看板模型。 */
export function buildBoard(
  features: FeatureMerge[],
  envs: EnvInfo[],
  containsByEnv: Record<EnvKey, ReadonlySet<string>>,
  generatedAt: string,
  epics: EpicsConfig = EMPTY_EPICS,
): Board {
  const rows: BoardRow[] = features.map((f) => ({
    ...f,
    status: {
      dev: containsByEnv.dev.has(f.branch),
      stage: containsByEnv.stage.has(f.branch),
      prod: containsByEnv.prod.has(f.branch),
    },
  }));
  return { generatedAt, envs, rows, grouped: groupRows(rows, epics) };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  return iso.replace("T", " ").replace(/:\d{2}(\+|-|Z).*$/, "");
}


/**
 * 渲染自包含 HTML 看板（无外部依赖，亮暗色随系统）。
 *
 * 布局用 CSS grid 而非 `<table>`：聚合行要能展开成员，`<details>` 放不进表格结构。
 * 环境卡片的计数按**主表行**算——聚合行算 1，且全部成员命中才算命中；工程内部不计。
 * 否则同一需求会被数 13 次，「上线 n/m 个 feature」这句就不再说人话。
 */
export function renderHtml(board: Board): string {
  const { main, internal } = board.grouped;
  const rowHit = (r: MainRow, k: EnvKey) =>
    r.kind === "epic" ? r.status[k].hit === r.status[k].total : r.status[k];
  const envCount = (k: EnvKey) => main.filter((r) => rowHit(r, k)).length;
  const envCards = board.envs
    .map(
      (e) => `<div class="env"><div class="env-key ${e.key}">${e.label}</div>
<div class="env-ref">${escapeHtml(e.source)} <code>${e.sha ? escapeHtml(e.sha.slice(0, 7)) : "未部署"}</code></div>
<div class="env-meta">${e.date ? escapeHtml(fmtDate(e.date)) + " · " : ""}${envCount(e.key)}/${main.length} 个功能</div></div>`,
    )
    .join("\n");

  const cell = (on: boolean, k: EnvKey) =>
    on ? `<span class="c on ${k}">✓</span>` : `<span class="c off">—</span>`;
  const epicCell = (s: EpicStatus, k: EnvKey) =>
    s.hit === s.total ? cell(true, k) : `<span class="c part ${k}">${s.hit}/${s.total}</span>`;
  const single = (r: BoardRow) => `<div class="row">
<span class="c title">${escapeHtml(r.title)}</span>
<span class="c branch"><code>${escapeHtml(r.branch)}</code></span>
<span class="c date">${escapeHtml(fmtDate(r.date))}</span>
${cell(r.status.dev, "dev")}${cell(r.status.stage, "stage")}${cell(r.status.prod, "prod")}
</div>`;
  const epic = (r: EpicRow, extraClass = "") => `<details class="epic ${extraClass}">
<summary class="row">
<span class="c title"><span class="caret"></span>${escapeHtml(r.title)} <span class="count">${r.members.length} 个分支</span></span>
<span class="c branch"></span>
<span class="c date">${escapeHtml(fmtDate(r.date))}</span>
${epicCell(r.status.dev, "dev")}${epicCell(r.status.stage, "stage")}${epicCell(r.status.prod, "prod")}
</summary>
<div class="members">
${r.members.map(single).join("\n")}
</div>
</details>`;

  const bodyRows = main.map((r) => (r.kind === "epic" ? epic(r) : single(r))).join("\n");
  const internalBlock = internal ? epic(internal, "internal") : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>功能上线看板</title>
<style>
:root { --bg:#fafafa; --fg:#1a1a1a; --muted:#6b7280; --line:#e5e7eb; --card:#fff; --fill:#f3f4f6;
  --dev:#1fd4cf; --stage:#f59e0b; --prod:#22c55e; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111214; --fg:#e7e7ea; --muted:#9ca3af; --line:#2a2c31; --card:#1a1c1f; --fill:#22242a; }
}
* { box-sizing:border-box; }
body { margin:0; padding:32px 24px; background:var(--bg); color:var(--fg);
  font:14px/1.6 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
h1 { font-size:20px; margin:0 0 4px; }
.sub { color:var(--muted); margin-bottom:20px; }
.envs { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
.env { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; min-width:220px; }
.env-key { font-weight:600; }
.env-key.dev { color:var(--dev); } .env-key.stage { color:var(--stage); } .env-key.prod { color:var(--prod); }
.env-ref { margin-top:2px; }
.env-meta { color:var(--muted); font-size:12px; margin-top:2px; }
code { font-family:"SF Mono", ui-monospace, monospace; font-size:12px; background:var(--line); padding:1px 5px; border-radius:4px; }
.table-wrap { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:12px; }
.grid { min-width:720px; }
.row { display:grid; grid-template-columns: minmax(260px,1fr) 260px 150px 72px 72px 72px; border-bottom:1px solid var(--line); }
.row:last-child, .members .row:last-child { border-bottom:none; }
.c { padding:8px 14px; white-space:nowrap; }
.head .c { color:var(--muted); font-weight:500; font-size:12px; position:sticky; top:0; background:var(--card); }
.c.title { white-space:normal; }
.c.on { font-weight:700; text-align:center; }
.c.on.dev { color:var(--dev); } .c.on.stage { color:var(--stage); } .c.on.prod { color:var(--prod); }
.c.part { text-align:center; font-variant-numeric:tabular-nums; color:var(--muted); }
.c.off { color:var(--muted); text-align:center; }
.c.date, .c.branch { color:var(--muted); font-size:12px; }
details.epic { border-bottom:1px solid var(--line); }
details.epic:last-child { border-bottom:none; }
details.epic > summary { list-style:none; cursor:pointer; border-bottom:none; }
details.epic > summary::-webkit-details-marker { display:none; }
details.epic > summary .title { font-weight:600; }
.caret { display:inline-block; width:0; height:0; margin-right:8px; vertical-align:middle;
  border-left:5px solid var(--muted); border-top:4px solid transparent; border-bottom:4px solid transparent; transition:transform .15s; }
details[open] > summary .caret { transform:rotate(90deg); }
.count { color:var(--muted); font-weight:400; font-size:12px; margin-left:6px; }
.members { background:var(--fill); border-top:1px solid var(--line); }
.members .row .title { padding-left:34px; }
details.internal { margin-top:16px; }
details.internal > summary .title { color:var(--muted); }
</style>
</head>
<body>
<h1>功能上线看板</h1>
<div class="sub">生成于 ${escapeHtml(fmtDate(board.generatedAt))}${board.windowLabel ? ` · 统计范围 <b>${escapeHtml(board.windowLabel)}</b>` : ""} · 以 GitHub 为准：dev=origin/dev · stage/prod=Actions 最近一次成功部署的 commit</div>
<div class="envs">
${envCards}
</div>
<div class="table-wrap">
<div class="grid">
<div class="row head"><span class="c">Feature</span><span class="c">分支</span><span class="c">合入 dev 时间</span><span class="c">dev</span><span class="c">stage</span><span class="c">prod</span></div>
${bodyRows}
</div>
</div>
${internalBlock ? `<div class="table-wrap">\n${internalBlock}\n</div>` : ""}
</body>
</html>
`;
}
