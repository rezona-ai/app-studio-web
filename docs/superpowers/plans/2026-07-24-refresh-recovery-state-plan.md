# 刷新后恢复最新版本与完整轮次脚注 — 实现计划

日期：2026-07-24
设计稿：`docs/superpowers/specs/2026-07-24-refresh-recovery-state-design.md`

## 任务 1：锁定历史窗口截断回归

涉及文件：

- `src/koubou/apply-koubou.test.ts`
- `src/koubou/apply-koubou.ts`

步骤：

1. 新增失败测试：持久化完成轮次的 `run.started` 在窗口外，而锚点 AssistantMessage 与
   `run.finished` 在最新页内，`seedHistory` 应保留该轮模型、起止时间与状态。
2. 单独运行该用例，确认因 `turns` 被重建为空而失败。
3. 让历史重建接收不可变的轮次基线，按 `runId` 合并窗口事件，并过滤不可见的已结束轮次。
4. 新增/调整幂等测试，确认窗口内完整轮次不会与基线重复。
5. 运行整个 `apply-koubou.test.ts`。

验证命令：

```bash
pnpm exec vitest run src/koubou/apply-koubou.test.ts
```

## 任务 2：锁定冷启动版本回退

涉及文件：

- `src/store/actions.test.ts`
- `src/store/actions.ts`

步骤：

1. 将冷启动测试改为期望选择最高 `index` 的版本，先确认旧实现失败。
2. 补充接口返回顺序无保证的用例。
3. 提取/使用按 `index` 求最新版本的纯决策，调整 `loadVersions` 冷加载分支。
4. 保留现有 pending、出新版本自动前进、无新版本保持人工选择测试。
5. 运行整个 `actions.test.ts`。

验证命令：

```bash
pnpm exec vitest run src/store/actions.test.ts
```

## 任务 3：集成验证与差异审查

涉及文件：本次全部改动。

步骤：

1. 运行两组定向测试。
2. 运行与 CI 一致的完整质量门。
3. 检查 `git diff --check`、分支落点与最终差异，确认没有带入其他 worktree 改动。
4. 条件允许时使用 Chrome 再次刷新同一项目，确认预览为最新版本且耗时脚注仍存在。

验证命令：

```bash
pnpm exec vitest run src/koubou/apply-koubou.test.ts src/store/actions.test.ts
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
git diff --check
git status --short --branch
```
