// commit-msg 钩子入口：按需给提交消息追加 `Feature:` trailer。
// 判定逻辑在 ./lib（单测在 ./lib.test.ts），本文件只做 IO。
//
// 由 .githooks/commit-msg 调用，参数是 git 传进来的消息文件路径。
// 任何异常都不阻断提交——钩子的职责是「顺手贴个身份」，不是质量闸；
// 拦不住的漏网由看板的旧 subject 解析兜底。

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { decideTrailer } from "./lib";

const msgPath = process.argv[2];
if (!msgPath) process.exit(0);

function currentBranch(): string {
  try {
    // --quiet + 失败兜底：detached HEAD 时 symbolic-ref 会非零退出
    return execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

try {
  const message = readFileSync(msgPath, "utf8");
  const decision = decideTrailer(currentBranch(), message);
  if (!decision.append) process.exit(0);

  // 交给 git 自己拼 trailer：段落分隔、已存在时的处理都按 git 的规则来，
  // 手写字符串拼接迟早在「消息末尾有无空行」这类细节上出错。
  const updated = execFileSync(
    "git",
    ["interpret-trailers", "--if-exists", "doNothing", "--trailer", `Feature: ${decision.value}`],
    { input: message, encoding: "utf8" },
  );
  writeFileSync(msgPath, updated);
} catch {
  // 贴不上就算了，绝不因此让提交失败
  process.exit(0);
}
