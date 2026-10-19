import { describe, expect, it } from "vitest";
import { checkBranchPolicy } from "./lib";

const ok = (base: string, head: string) => checkBranchPolicy(base, head).ok;
const reason = (base: string, head: string) => {
  const r = checkBranchPolicy(base, head);
  return r.ok ? null : r.reason;
};

describe("base = main", () => {
  it.each(["pick/canvas-group", "backport/hotfix-401", "docs/ci-cd", "chore/deps"])(
    "接受挑拣/回合/文档/杂务分支：%s",
    (head) => expect(ok("main", head)).toBe(true),
  );

  it("拒绝 head=dev —— 整条 dev 不进 main", () => {
    expect(ok("main", "dev")).toBe(false);
    expect(reason("main", "dev")).toContain("pick/");
  });

  it.each(["feat/group-resize", "fix/undo-gaps"])(
    "拒绝特性分支 %s —— 它基于 dev,diff 会连带整条 dev",
    (head) => expect(ok("main", head)).toBe(false),
  );

  // pick/ 是目录式前缀,不能被 pickle/ 之类前缀相同的分支名蒙混过关
  it("拒绝形似而非的 pickle/x、backported/x", () => {
    expect(ok("main", "pickle/x")).toBe(false);
    expect(ok("main", "backported/x")).toBe(false);
  });
});

describe("base = release/*", () => {
  it("只接受 backport/*", () => {
    expect(ok("release/2026-08-27", "backport/npe-on-boot")).toBe(true);
    expect(ok("release/2026-08-27-b", "backport/npe-on-boot")).toBe(true);
  });

  it.each(["pick/x", "feat/x", "dev", "main"])("拒绝 %s", (head) =>
    expect(ok("release/2026-08-27", head)).toBe(false),
  );
});

describe("base = dev", () => {
  it("拒绝主干反合 —— 会把两条线搅成交叉历史", () => {
    expect(ok("dev", "main")).toBe(false);
    expect(ok("dev", "release/2026-08-27")).toBe(false);
    expect(reason("dev", "main")).toContain("反合");
  });

  it("放行日常特性分支（dev 本就直推,少有 PR）", () => {
    expect(ok("dev", "feat/x")).toBe(true);
    expect(ok("dev", "pick/x")).toBe(true);
  });
});

describe("test 是机器分支", () => {
  it("既不能当 base 也不能当 head", () => {
    expect(ok("test", "feat/x")).toBe(false);
    expect(ok("dev", "test")).toBe(false);
    expect(ok("main", "test")).toBe(false);
    expect(reason("test", "feat/x")).toContain("机器");
  });
});

describe("其它 base 不管", () => {
  it("特性分支之间互开 PR 放行", () => {
    expect(ok("feat/a", "feat/b")).toBe(true);
  });
});

describe("ref 归一", () => {
  it("容忍 refs/heads/ 前缀", () => {
    expect(ok("refs/heads/main", "refs/heads/pick/x")).toBe(true);
    expect(ok("refs/heads/main", "refs/heads/dev")).toBe(false);
  });
});
