import { describe, expect, it } from "vitest";
import { decideTrailer } from "./lib";

const plain = "feat(canvas): 分组框缩放";

describe("主干分支不加 trailer", () => {
  it.each(["dev", "main", "test", "release/2026-08-28", "release/2026-09-03-b"])(
    "%s 上的提交不属于任何 feature",
    (branch) => expect(decideTrailer(branch, plain)).toEqual({ append: false }),
  );
});

describe("特性分支追加当前分支名", () => {
  it.each([
    ["feat/group-resize-snap-ui", "feat/group-resize-snap-ui"],
    ["fix/undo-gaps", "fix/undo-gaps"],
    ["chore/deps", "chore/deps"],
    ["docs/ci-cd", "docs/ci-cd"],
    // worktree 式分支名用 + 分隔，与 parseMergeSubject 认的命名空间一致
    ["worktree-feat+export-steam", "worktree-feat+export-steam"],
  ])("%s → Feature: %s", (branch, value) => {
    expect(decideTrailer(branch, plain)).toEqual({ append: true, value });
  });
});

describe("幂等：已有 Feature trailer 就不再追加", () => {
  // 这条是 cherry-pick 的命门：pick 过来的消息已带原分支名，
  // 若按当前 pick/* 分支名覆盖，feature 身份就串了。
  it("cherry-pick 到 pick/* 时保住原值", () => {
    const msg = `${plain}\n\nFeature: feat/group-resize-snap-ui`;
    expect(decideTrailer("pick/feat/group-resize-snap-ui", msg)).toEqual({ append: false });
  });

  it("在原分支上 amend 也不会追加第二条", () => {
    const msg = `${plain}\n\nFeature: feat/group-resize-snap-ui`;
    expect(decideTrailer("feat/group-resize-snap-ui", msg)).toEqual({ append: false });
  });
});

describe("pick/backport 分支不自动追加", () => {
  // 这两类分支上的提交要么是 cherry-pick 来的（已带 trailer，走幂等分支），
  // 要么是解冲突产生的 —— 身份应沿用原 feature，不能拿 pick/xxx 顶上。
  it.each(["pick/feat/x", "backport/npe-on-boot"])("%s 不追加", (branch) => {
    expect(decideTrailer(branch, plain)).toEqual({ append: false });
  });
});

describe("边界", () => {
  it("detached HEAD（分支名取不到）不追加", () => {
    expect(decideTrailer("", plain)).toEqual({ append: false });
    expect(decideTrailer("HEAD", plain)).toEqual({ append: false });
  });

  it("正文里出现 Feature: 字样但不在 trailer 区，不算已有", () => {
    const msg = `${plain}\n\n正文里提到 Feature: 这个词不该被当成 trailer\n\nFeature: feat/real`;
    // 末尾那条才是真 trailer，故仍判为已有
    expect(decideTrailer("feat/real", msg)).toEqual({ append: false });
  });

  it("正文提到 Feature: 但完全没有 trailer 区时，仍要追加", () => {
    const msg = `${plain}\n\n说明里写了 Feature: 某某，但这不是 trailer`;
    expect(decideTrailer("feat/x", msg)).toEqual({ append: true, value: "feat/x" });
  });

  it("空消息也照常追加（git 会拒绝空提交消息，这里只保证不崩）", () => {
    expect(decideTrailer("feat/x", "")).toEqual({ append: true, value: "feat/x" });
  });
});

// ── 评审（2026-08-28）暴露的两处真问题 ────────────────────────────────────────

describe("幂等必须扫全文，不能只看最后一段", () => {
  // 🔴 实测：git 的 `--if-exists doNothing` 也只认最后一段，两层幂等会同时失守，
  // 结果不是「漏贴」而是「贴错」—— 原身份被静默换成当前分支名，且不可逆。
  it("Feature 在倒数第二段时仍判为已有（否则身份会被覆盖）", () => {
    const msg = "feat: y\n\nFeature: feat/orig\n\nCo-Authored-By: Bob <b@x.com>";
    expect(decideTrailer("pick/current", msg)).toEqual({ append: false });
    expect(decideTrailer("feat/other", msg)).toEqual({ append: false });
  });

  it("键名大小写不敏感（git 的 trailer key 匹配就是不敏感的）", () => {
    expect(decideTrailer("feat/x", "s\n\nfeature: feat/orig")).toEqual({ append: false });
  });
});

describe("主干上的 merge commit 从 subject 回填身份", () => {
  // 🔴 不回填的话，`cherry-pick -m 1` 把 dev 的 merge 压成一条时身份全丢 ——
  // 那条 merge 产生在主干上、本来就没有 trailer。实测两种 pick 的差异见 spec §6。
  it.each([
    ["merge: feat/group-resize 分组框缩放", "feat/group-resize"],
    ["merge: 分组框缩放 (feat/group-resize)", "feat/group-resize"],
  ])("dev 上 %s → 回填 %s", (subject, value) => {
    expect(decideTrailer("dev", subject)).toEqual({ append: true, value });
  });

  it("GitHub 默认的 PR merge subject 解析不出分支名，不回填", () => {
    expect(decideTrailer("main", "Merge pull request #15 from rezona-ai/pick/x")).toEqual({
      append: false,
    });
  });

  it("主干上的普通提交仍然不贴", () => {
    expect(decideTrailer("dev", "fix: 直接在 dev 上改一行")).toEqual({ append: false });
  });

  it("回填也要幂等：已有 trailer 就不动", () => {
    expect(decideTrailer("dev", "merge: feat/a 标题\n\nFeature: feat/b")).toEqual({ append: false });
  });
});

describe("分支名不像分支名时不贴（贴了看板也会丢弃）", () => {
  // 看板只收含 / 或 + 的值；钩子若贴上 `Feature: hotfix`，看板静默丢弃 = 贴了等于没贴
  it.each(["hotfix", "experiment", "tmp"])("%s 不贴", (branch) => {
    expect(decideTrailer(branch, "feat: x")).toEqual({ append: false });
  });
});

describe("回填不依赖当前分支名（真机踩到）", () => {
  // 落地流程是「在临时分支上 --no-ff 合特性分支，再推 dev」，钩子看到的分支名不是 dev，
  // 原先把回填挂在「当前分支是主干」上 → 实际流程里从不触发（dev 上两条 merge 实测 trailer 为空）。
  // 改判「这条提交的 subject 解析得出 feature 分支名」，与在哪条分支无关。
  it.each(["land-fix", "dev", "main", "release/2026-08-28", "tmp-landing"])(
    "在 %s 上做特性分支的 merge，都回填原分支名",
    (branch) => {
      expect(decideTrailer(branch, "merge: feat/group-resize 分组框缩放")).toEqual({
        append: true,
        value: "feat/group-resize",
      });
    },
  );

  it("同步性合并不回填（把主干拉回特性分支）", () => {
    expect(decideTrailer("feat/x", "Merge branch 'origin/dev' into feat/x")).toEqual({
      append: true, // 落到「当前分支是 feat/x」这条常规规则上
      value: "feat/x",
    });
    // 在临时落地分支上做同步合并：既解析不出 feature，当前分支名也不像分支 → 不贴
    expect(decideTrailer("land-fix", "Merge branch 'origin/dev' into land-fix")).toEqual({
      append: false,
    });
  });
});
