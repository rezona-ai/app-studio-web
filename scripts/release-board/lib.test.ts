import { describe, expect, it } from "vitest";
import {
  branchSetFromSubjects,
  branchSetFromTrailers,
  buildBoard,
  collectFeatures,
  collectFeaturesFromTrailers,
  escapeHtml,
  mergeFeatureSources,
  parseMergeSubject,
  parseSinceArg,
  renderHtml,
  type EnvInfo,
  type FeatureMerge,
  type BoardRow,
  type EnvKey,
  type EpicsConfig,
  globToRegExp,
  groupRows,
  EMPTY_EPICS,
} from "./lib";

describe("parseMergeSubject", () => {
  it("解析约定格式的 feature merge", () => {
    expect(parseMergeSubject("merge: 生成弹窗支持拖动与落点跟随 (feat/generate-form-drag)")).toEqual({
      title: "生成弹窗支持拖动与落点跟随",
      branch: "feat/generate-form-drag",
      titled: true,
    });
  });

  it("worktree 分支名（含 + 号）也能解析", () => {
    expect(parseMergeSubject("merge: 一键整理纳入引用边 (worktree-feat+tidy-ref-edges)")).toEqual({
      title: "一键整理纳入引用边",
      branch: "worktree-feat+tidy-ref-edges",
      titled: true,
    });
  });

  it("解析新格式（分支名在前，无括号）", () => {
    expect(parseMergeSubject("merge: fix/history-page-50 滚顶翻页每次手势凑满 50 条可见消息")).toEqual({
      title: "滚顶翻页每次手势凑满 50 条可见消息",
      branch: "fix/history-page-50",
      titled: true,
    });
    // 标题含括号也不误入旧格式分支
    expect(
      parseMergeSubject("merge: feat/replay-optimizations 回放优化——断点续播(复用重连机制)"),
    ).toEqual({
      title: "回放优化——断点续播(复用重连机制)",
      branch: "feat/replay-optimizations",
      titled: true,
    });
  });

  it("新格式的 worktree 分支名（无斜杠，含 + 号）也能解析", () => {
    expect(parseMergeSubject("merge: worktree-feat+plan-tasks-reset-per-run 任务清单按轮独立")).toEqual({
      title: "任务清单按轮独立",
      branch: "worktree-feat+plan-tasks-reset-per-run",
      titled: true,
    });
  });

  it("裸 `Merge branch '<分支>'`（git 默认 subject）也算 feature，标题取分支名", () => {
    expect(parseMergeSubject("Merge branch 'feat/rezona-publish-direct' into dev")).toEqual({
      title: "feat/rezona-publish-direct",
      branch: "feat/rezona-publish-direct",
      titled: false,
    });
    // worktree 分支名（无斜杠，含 + 号）
    expect(parseMergeSubject("Merge branch 'worktree-feat+codex-backend-integration' into dev")).toEqual({
      title: "worktree-feat+codex-backend-integration",
      branch: "worktree-feat+codex-backend-integration",
      titled: false,
    });
    // 在 main 上合并时 git 不带 `into <目标>` 后缀
    expect(parseMergeSubject("Merge branch 'fix/list-projects-paging'")).toEqual({
      title: "fix/list-projects-paging",
      branch: "fix/list-projects-paging",
      titled: false,
    });
  });

  it("裸 `Merge branch` 的同步性合并 / 特性分支互合仍不算 feature", () => {
    // 主干拉回特性分支：源分支名不含 / 或 +
    expect(parseMergeSubject("Merge branch 'main' into feat/x")).toBeNull();
    expect(parseMergeSubject("Merge branch 'origin/dev' into feat/x")).toBeNull();
    // 特性分支互合不是「落地到主干」
    expect(parseMergeSubject("Merge branch 'feat/a' into feat/b")).toBeNull();
  });

  it("同步性合并不算 feature", () => {
    expect(parseMergeSubject("Merge pull request #28 from rezona-ai/dev")).toBeNull();
    expect(parseMergeSubject("Merge branch 'main' into dev")).toBeNull();
    // 括号内不是分支名（含空格/#）的也不算
    expect(parseMergeSubject("merge: 合并 origin/dev(PR #38 PDF 附件原生文档块)")).toBeNull();
    // 新格式位置上出现远端 ref：把主干拉回特性分支的同步性合并，不是 feature
    expect(
      parseMergeSubject("merge: origin/dev 收敛两套 APK 导出实现,保留设计稿版 UI"),
    ).toBeNull();
  });

  it("裸格式标记 titled=false，两种带标题格式标记 titled=true", () => {
    expect(parseMergeSubject("Merge branch 'feat/canvas-groups' into dev")).toEqual({
      title: "feat/canvas-groups",
      branch: "feat/canvas-groups",
      titled: false,
    });
    expect(parseMergeSubject("merge: feat/canvas-groups 画布分组框")).toEqual({
      title: "画布分组框",
      branch: "feat/canvas-groups",
      titled: true,
    });
    expect(parseMergeSubject("merge: 画布分组框 (feat/canvas-groups)")).toEqual({
      title: "画布分组框",
      branch: "feat/canvas-groups",
      titled: true,
    });
  });
});

describe("collectFeatures", () => {
  // 输入是 `git log --merges --format=%H%x09%cI%x09%s` 的行（不限 first-parent）：
  // dev 回合 main 后 tip 会落到 main 线上，那条线只有 GitHub 的 PR merge，必须靠 subject 而非拓扑筛 feature。
  it("从 log 行收集 feature，跳过 PR / 同步性合并", () => {
    expect(
      collectFeatures([
        "aaa\t2026-07-30T11:55:10+08:00\tMerge pull request #85 from rezona-ai/dev",
        "bbb\t2026-07-29T14:54:30+08:00\tmerge: feat/credit-dynamic-refresh 积分消耗动态刷新余额",
        "ccc\t2026-07-22T15:17:22+08:00\tmerge: origin/dev 收敛两套 APK 导出实现",
        "ddd\t2026-07-10T09:00:00+08:00\tmerge: 生成弹窗支持拖动 (feat/generate-form-drag)",
        "",
      ]),
    ).toEqual([
      { sha: "bbb", date: "2026-07-29T14:54:30+08:00", title: "积分消耗动态刷新余额", branch: "feat/credit-dynamic-refresh" },
      { sha: "ddd", date: "2026-07-10T09:00:00+08:00", title: "生成弹窗支持拖动", branch: "feat/generate-form-drag" },
    ]);
  });

  it("同一分支多条 merge 只留最早那次（过滤式回合 main 会重建 merge）", () => {
    const rows = collectFeatures([
      "new\t2026-07-22T15:19:26+08:00\tmerge: feat/rig-preview 动作预览菜单悬浮化",
      "old\t2026-07-20T10:00:00+08:00\tmerge: feat/rig-preview 动作预览菜单悬浮化",
    ]);
    expect(rows).toEqual([
      { sha: "old", date: "2026-07-20T10:00:00+08:00", title: "动作预览菜单悬浮化", branch: "feat/rig-preview" },
    ]);
  });

  it("结果按合入时间倒序，与 log 输入顺序无关", () => {
    const rows = collectFeatures([
      "aaa\t2026-07-10T09:00:00+08:00\tmerge: feat/a 甲",
      "bbb\t2026-07-20T09:00:00+08:00\tmerge: feat/b 乙",
    ]);
    expect(rows.map((r) => r.branch)).toEqual(["feat/b", "feat/a"]);
  });

  // 从 taluna-game-web 迁入画布线后，同一分支会同时存在旧仓的裸 merge（早）与本仓重写的
  // `merge: <分支> <中文标题>`（晚）。「取最早」是为了拿首次落地时间，不该连标题一起退化成分支名。
  it("同分支既有裸格式又有带标题格式：日期取最早，标题取有标题的那条", () => {
    const rows = collectFeatures([
      "new\t2026-08-14T18:00:00+08:00\tmerge: feat/canvas-groups 画布分组框——圈成一组",
      "old\t2026-08-05T10:00:00+08:00\tMerge branch 'feat/canvas-groups' into dev",
    ]);
    expect(rows).toEqual([
      {
        sha: "old",
        date: "2026-08-05T10:00:00+08:00",
        title: "画布分组框——圈成一组",
        branch: "feat/canvas-groups",
      },
    ]);
  });

  it("同分支全是裸格式时，标题仍回落成分支名", () => {
    const rows = collectFeatures([
      "new\t2026-08-14T18:00:00+08:00\tMerge branch 'feat/only-bare' into main",
      "old\t2026-08-05T10:00:00+08:00\tMerge branch 'feat/only-bare' into dev",
    ]);
    expect(rows).toEqual([
      { sha: "old", date: "2026-08-05T10:00:00+08:00", title: "feat/only-bare", branch: "feat/only-bare" },
    ]);
  });
});

const envs: EnvInfo[] = [
  { key: "dev", label: "dev", source: "origin/dev", sha: "d".repeat(40), date: "2026-07-13T10:00:00+08:00" },
  { key: "stage", label: "stage", source: "Deploy (stage)", sha: "s".repeat(40), date: "2026-07-12T10:00:00+08:00" },
  { key: "prod", label: "prod", source: "Deploy (production)", sha: null, date: null },
];

const features: FeatureMerge[] = [
  { sha: "aaa", date: "2026-07-13T09:00:00+08:00", title: "新功能A", branch: "feat/a" },
  { sha: "bbb", date: "2026-07-10T09:00:00+08:00", title: "功能<B>", branch: "feat/b" },
];

describe("branchSetFromSubjects", () => {
  it("从 merge subject 列表收集分支名，跳过同步性合并", () => {
    expect(
      branchSetFromSubjects([
        "merge: feat/model-selector-kimi-gpt56 模型选择器补充 GPT-5.6 与 Kimi K3",
        "merge: 生成弹窗支持拖动与落点跟随 (feat/generate-form-drag)",
        "Merge pull request #63 from rezona-ai/pr/main-sync-no-touch-edit",
        "Merge branch 'main' into dev",
      ]),
    ).toEqual(new Set(["feat/model-selector-kimi-gpt56", "feat/generate-form-drag"]));
  });
});

describe("buildBoard / renderHtml", () => {
  const board = buildBoard(
    features,
    envs,
    { dev: new Set(["feat/a", "feat/b"]), stage: new Set(["feat/b"]), prod: new Set() },
    "2026-07-13T12:00:00+08:00",
  );

  it("按分支名标记上线状态（rebase 重写 SHA 不影响判定）", () => {
    expect(board.rows[0].status).toEqual({ dev: true, stage: false, prod: false });
    expect(board.rows[1].status).toEqual({ dev: true, stage: true, prod: false });
  });

  it("渲染的 HTML 含转义后的标题与环境数据源", () => {
    const html = renderHtml(board);
    expect(html).toContain("功能&lt;B&gt;");
    expect(html).not.toContain("功能<B>");
    expect(html).toContain("Deploy (stage)");
    expect(html).toContain("1/2 个功能"); // stage 命中 1 个
  });

  it("从未成功部署的环境显示未部署", () => {
    const html = renderHtml(board);
    expect(html).toContain("未部署");
    expect(board.rows.every((r) => !r.status.prod)).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("转义 & < > \"", () => {
    expect(escapeHtml(`a&b<c>"d"`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;");
  });
});

// ── trailer 身份（2026-08-28 新增，与 subject 解析双源并存）────────────────────
// 背景：四线拓扑下 main 上的 feature 身份原先只由人手写的 merge subject 决定，
// GitHub 默认 subject 会被判成「不是 feature」。trailer 随消息被 cherry-pick 复制，
// 在三条互不为祖先的线上是同一身份。两源产出同一命名空间（分支名），并集去重。

describe("branchSetFromTrailers", () => {
  it("从 trailer 值收集分支名，忽略空行", () => {
    expect(branchSetFromTrailers(["feat/a", "", "fix/b", "feat/a"])).toEqual(
      new Set(["feat/a", "fix/b"]),
    );
  });

  it("剔除不像分支名的值（无 / 也无 +）", () => {
    expect(branchSetFromTrailers(["feat/a", "随手写的中文", "dev"])).toEqual(new Set(["feat/a"]));
  });

  it("容忍值两侧空白", () => {
    expect(branchSetFromTrailers(["  feat/a  "])).toEqual(new Set(["feat/a"]));
  });
});

describe("collectFeaturesFromTrailers", () => {
  const line = (sha: string, date: string, branch: string) => `${sha}\t${date}\t${branch}`;

  it("同一分支多条提交，取最早那条的时间与 sha", () => {
    const rows = collectFeaturesFromTrailers([
      line("bbb", "2026-08-02T10:00:00+08:00", "feat/x"),
      line("aaa", "2026-08-01T10:00:00+08:00", "feat/x"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sha: "aaa", branch: "feat/x" });
  });

  it("无 trailer 的行直接跳过", () => {
    expect(collectFeaturesFromTrailers([line("aaa", "2026-08-01T10:00:00+08:00", "")])).toEqual([]);
  });

  it("按时间倒序", () => {
    const rows = collectFeaturesFromTrailers([
      line("aaa", "2026-08-01T10:00:00+08:00", "feat/old"),
      line("bbb", "2026-08-05T10:00:00+08:00", "feat/new"),
    ]);
    expect(rows.map((r) => r.branch)).toEqual(["feat/new", "feat/old"]);
  });
});

describe("mergeFeatureSources：两源并集去重", () => {
  const f = (branch: string, date: string, title: string, sha = branch) => ({ sha, date, title, branch });

  it("同一 feature 两源都有时只保留一行，整条取 subject 源", () => {
    const merged = mergeFeatureSources(
      [f("feat/x", "2026-08-05T10:00:00+08:00", "来自 subject")],
      [f("feat/x", "2026-08-01T10:00:00+08:00", "来自 trailer")],
    );
    expect(merged).toHaveLength(1);
    // subject 源的时间是「合入 dev」，trailer 源的是「该分支第一条提交」——不是一个量
    expect(merged[0].date).toBe("2026-08-05T10:00:00+08:00");
  });

  it("只在一侧出现的 feature 都保留", () => {
    const merged = mergeFeatureSources(
      [f("feat/only-subject", "2026-08-01T10:00:00+08:00", "A")],
      [f("feat/only-trailer", "2026-08-02T10:00:00+08:00", "B")],
    );
    expect(merged.map((r) => r.branch).sort()).toEqual(["feat/only-subject", "feat/only-trailer"]);
  });

  // trailer 那侧没有人写的标题（值就是分支名），标题该让位给 subject 源
  it("标题优先取 subject 源（trailer 源的标题就是分支名，信息量更低）", () => {
    const merged = mergeFeatureSources(
      [f("feat/x", "2026-08-05T10:00:00+08:00", "人写的中文标题")],
      [f("feat/x", "2026-08-01T10:00:00+08:00", "feat/x")],
    );
    expect(merged[0].title).toBe("人写的中文标题");
  });

  it("结果按时间倒序", () => {
    const merged = mergeFeatureSources(
      [f("feat/old", "2026-08-01T10:00:00+08:00", "A")],
      [f("feat/new", "2026-08-09T10:00:00+08:00", "B")],
    );
    expect(merged.map((r) => r.branch)).toEqual(["feat/new", "feat/old"]);
  });
});

// ── 评审（2026-08-28）补的守护 ────────────────────────────────────────────────

describe("collectFeaturesFromTrailers 的值过滤（此前无用例，变异可存活）", () => {
  const line = (sha: string, date: string, v: string) => `${sha}\t${date}\t${v}`;

  it("丢弃不像分支名的值", () => {
    expect(
      collectFeaturesFromTrailers([
        line("aaa", "2026-08-01T10:00:00+08:00", "hotfix"),
        line("bbb", "2026-08-01T10:00:00+08:00", "feat/a and more"),
        line("ccc", "2026-08-01T10:00:00+08:00", "origin/dev"),
      ]),
    ).toEqual([]);
  });
});

describe("mergeFeatureSources：日期与 sha 都只认 subject 源", () => {
  const f = (branch: string, date: string, title: string, sha: string) => ({ sha, date, title, branch });

  // subject 源给的是「合入 dev 的时间」，trailer 源给的是「该分支第一条提交的时间」——
  // 后者必然更早，若取最早，那一列就从「合入时间」悄悄变成了「开工时间」。
  it("两源都有时，date/sha/title 全部取 subject 源", () => {
    const merged = mergeFeatureSources(
      [f("feat/x", "2026-08-05T10:00:00+08:00", "人写的标题", "subject-sha")],
      [f("feat/x", "2026-08-01T10:00:00+08:00", "feat/x", "trailer-sha")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      date: "2026-08-05T10:00:00+08:00",
      sha: "subject-sha",
      title: "人写的标题",
    });
  });

  it("subject 源缺席时才用 trailer 源", () => {
    const merged = mergeFeatureSources([], [f("feat/only", "2026-08-01T10:00:00+08:00", "feat/only", "t")]);
    expect(merged[0]).toMatchObject({ sha: "t", date: "2026-08-01T10:00:00+08:00" });
  });
});

describe("parseSinceArg：时间窗参数", () => {
  it("默认 3 个月", () => {
    expect(parseSinceArg([], {})).toEqual({ since: "3.months.ago", label: "最近 3 个月" });
  });

  it("--since=6.months 覆盖", () => {
    expect(parseSinceArg(["--since=6.months"], {}).since).toBe("6.months");
  });

  it("环境变量 BOARD_SINCE 覆盖默认，但优先级低于命令行", () => {
    expect(parseSinceArg([], { BOARD_SINCE: "1.year" }).since).toBe("1.year");
    expect(parseSinceArg(["--since=2.weeks"], { BOARD_SINCE: "1.year" }).since).toBe("2.weeks");
  });

  it("--since=all 表示全量（不传 --since 给 git）", () => {
    expect(parseSinceArg(["--since=all"], {})).toEqual({ since: null, label: "全部历史" });
  });

  it("label 里带上窗口值，供看板头部标注", () => {
    expect(parseSinceArg(["--since=6.months"], {}).label).toContain("6.months");
  });
});

// ── 需求聚合（2026-09-02 新增）─────────────────────────────────────────────
// 契约见 specs/2026-09-02-board-epics-design.md：身份仍是分支名，聚合只是身份之上的一层视图。
describe("groupRows", () => {
  const row = (branch: string, date: string, st: Partial<Record<EnvKey, boolean>> = {}): BoardRow => ({
    sha: branch,
    date,
    title: `标题 ${branch}`,
    branch,
    status: { dev: true, stage: false, prod: false, ...st },
  });
  const rows = [
    row("feat/a1", "2026-08-05T10:00:00+08:00", { stage: true }),
    row("feat/a2", "2026-08-01T10:00:00+08:00"),
    row("fix/b", "2026-08-03T10:00:00+08:00", { stage: true, prod: true }),
    row("docs/x", "2026-08-09T10:00:00+08:00", { stage: true }),
    row("chore/y", "2026-07-01T10:00:00+08:00"),
    row("feat/solo", "2026-08-07T10:00:00+08:00"),
  ];
  const cfg: EpicsConfig = {
    internalPrefixes: ["docs/", "chore/"],
    epics: [{ title: "需求 A", branches: ["feat/a1", "feat/a2"] }],
  };
  const epicOf = (g: ReturnType<typeof groupRows>, title: string) => {
    const e = g.main.find((r) => r.kind === "epic" && r.title === title);
    if (!e || e.kind !== "epic") throw new Error(`缺少聚合行 ${title}`);
    return e;
  };

  it("精确名归入需求；成员日期取最早；状态给 hit/total", () => {
    const epic = epicOf(groupRows(rows, cfg), "需求 A");
    expect(epic.members.map((m) => m.branch)).toEqual(["feat/a1", "feat/a2"]);
    expect(epic.date).toBe("2026-08-01T10:00:00+08:00");
    expect(epic.status).toEqual({
      dev: { hit: 2, total: 2 },
      stage: { hit: 1, total: 2 },
      prod: { hit: 0, total: 2 },
    });
  });

  it("未归类分支保持单行；主表按日期倒序混排聚合行与单行", () => {
    const g = groupRows(rows, cfg);
    expect(g.main.map((r) => (r.kind === "epic" ? r.title : r.branch))).toEqual([
      "feat/solo", // 08-07
      "fix/b", // 08-03
      "需求 A", // 最早成员 08-01
    ]);
  });

  it("internalPrefixes 命中的分支不进主表，落到 internal 组；日期同样取最早", () => {
    const g = groupRows(rows, cfg);
    expect(g.internal?.members.map((m) => m.branch)).toEqual(["docs/x", "chore/y"]);
    expect(g.internal?.date).toBe("2026-07-01T10:00:00+08:00");
    expect(g.internal?.status.stage).toEqual({ hit: 1, total: 2 });
    expect(g.main.some((r) => r.kind === "single" && r.branch.startsWith("docs/"))).toBe(false);
  });

  it("internalPrefixes 优先于 epic：写进需求的 docs/ 分支仍进工程内部", () => {
    const g = groupRows(rows, { ...cfg, epics: [{ title: "需求 A", branches: ["feat/a1", "docs/x"] }] });
    expect(epicOf(g, "需求 A").members.map((m) => m.branch)).toEqual(["feat/a1"]);
    expect(g.internal?.members.map((m) => m.branch)).toContain("docs/x");
  });

  it("glob 只支持 *，且精确名与 glob 同命中一个分支不算冲突", () => {
    const g = groupRows(rows, {
      internalPrefixes: [],
      epics: [{ title: "A 族", branches: ["feat/a1"], globs: ["feat/a*"] }],
    });
    expect(epicOf(g, "A 族").members.map((m) => m.branch)).toEqual(["feat/a1", "feat/a2"]);
  });

  it("glob 的 . 与 + 按字面匹配，不是正则元字符", () => {
    expect(globToRegExp("a.b").test("aXb")).toBe(false);
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
    expect(globToRegExp("w+a*").test("wwa")).toBe(false);
    expect(globToRegExp("w+a*").test("w+a-x")).toBe(true);
  });

  it("glob 零命中 / 精确名被 internalPrefixes 吃掉：各推一条 warning", () => {
    const g = groupRows(rows, {
      internalPrefixes: ["docs/"],
      epics: [{ title: "A", branches: ["docs/x"], globs: ["feat/nope*"] }],
    });
    expect(g.warnings).toEqual([
      expect.stringMatching(/docs\/x.*internalPrefixes/),
      expect.stringMatching(/feat\/nope\*.*没有命中/),
    ]);
  });

  it("internal 行不出现在主表任何位置（单行或聚合成员）", () => {
    const g = groupRows(rows, cfg);
    const inMain = g.main.flatMap((r) => (r.kind === "epic" ? r.members.map((m) => m.branch) : [r.branch]));
    expect(inMain.some((b) => b.startsWith("docs/") || b.startsWith("chore/"))).toBe(false);
  });

  it("同一分支归到两个需求：抛错并指出分支名", () => {
    expect(() =>
      groupRows(rows, {
        internalPrefixes: [],
        epics: [
          { title: "甲", branches: ["feat/a1"] },
          { title: "乙", branches: [], globs: ["feat/a*"] },
        ],
      }),
    ).toThrow(/feat\/a1/);
  });

  it("需求引用了当前窗口内不存在的分支：只告警不抛错", () => {
    const g = groupRows(rows, {
      internalPrefixes: [],
      epics: [{ title: "A", branches: ["feat/a1", "feat/ghost"] }],
    });
    expect(g.warnings).toEqual([expect.stringContaining("feat/ghost")]);
  });

  it("需求在窗口内一个成员都没有：不渲染成空行", () => {
    const g = groupRows(rows, { internalPrefixes: [], epics: [{ title: "全在窗外", branches: ["feat/ghost"] }] });
    expect(g.main.some((r) => r.kind === "epic")).toBe(false);
  });

  it("单成员需求仍渲染为聚合行，标题用需求名（映射语义不随窗口翻形）", () => {
    const g = groupRows(rows, { internalPrefixes: [], epics: [{ title: "独苗", branches: ["feat/solo"] }] });
    expect(epicOf(g, "独苗").members).toHaveLength(1);
  });

  it("空配置恒等：全部原行按原序作为单行输出，internal 为 null", () => {
    // 身份层给出的 rows 恒按日期倒序（mergeFeatureSources 保证），这里按同一口径造输入
    const sorted = [...rows].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const g = groupRows(sorted, EMPTY_EPICS);
    expect(g.internal).toBeNull();
    expect(g.warnings).toEqual([]);
    expect(g.main.map((r) => (r.kind === "single" ? r.branch : "epic"))).toEqual(sorted.map((r) => r.branch));
  });
});

describe("renderHtml：聚合行", () => {
  const mk = (branch: string, date: string, stage: boolean) => ({
    f: { sha: branch, date, title: `T-${branch}`, branch } satisfies FeatureMerge,
    stage,
  });
  const feats = [
    mk("feat/a1", "2026-08-05T10:00:00+08:00", true),
    mk("feat/a2", "2026-08-01T10:00:00+08:00", false),
    mk("docs/x", "2026-08-09T10:00:00+08:00", true),
    mk("feat/solo", "2026-08-07T10:00:00+08:00", false),
  ];
  const board = buildBoard(
    feats.map((x) => x.f),
    envs,
    {
      dev: new Set(feats.map((x) => x.f.branch)),
      stage: new Set(feats.filter((x) => x.stage).map((x) => x.f.branch)),
      prod: new Set(),
    },
    "2026-09-02T12:00:00+08:00",
    { internalPrefixes: ["docs/"], epics: [{ title: "需求 <A>", branches: ["feat/a1", "feat/a2"] }] },
  );
  const html = renderHtml(board);

  it("聚合行 summary 的 stage 列显示 n/m，展开后含成员标题；需求标题经转义", () => {
    expect(html).toContain("需求 &lt;A&gt;");
    expect(html).not.toContain("需求 <A>");
    expect(html).toContain('class="c part stage">1/2');
    expect(html).toContain("T-feat/a1");
    expect(html).toContain("T-feat/a2");
  });

  it("工程内部组落在表尾", () => {
    expect(html.lastIndexOf("工程内部")).toBeGreaterThan(html.lastIndexOf("feat/solo"));
    expect(html).toContain("T-docs/x");
  });

  it("环境卡片按主表行数计（聚合行算 1，工程内部不计）", () => {
    // 主表 = 需求 A + feat/solo = 2；stage 全命中的主表行 = 0（需求 A 只命中 1/2）
    expect(html).toContain("0/2 个功能");
    expect(html).toContain("2/2 个功能"); // dev 全命中
  });

  it("不传配置时渲染与旧版一致：无 details、无工程内部", () => {
    const plain = renderHtml(buildBoard(feats.map((x) => x.f), envs, { dev: new Set(), stage: new Set(), prod: new Set() }, "2026-09-02T12:00:00+08:00"));
    expect(plain).not.toContain("<details");
    expect(plain).not.toContain("工程内部");
    expect(plain).toContain("0/4 个功能");
  });
});
