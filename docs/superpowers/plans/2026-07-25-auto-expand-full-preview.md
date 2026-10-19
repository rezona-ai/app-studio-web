# 实现计划：游戏生成新版本后自动展开最大宽度预览

对应设计稿：`docs/superpowers/specs/2026-07-25-auto-expand-full-preview-design.md`

## 任务 1：新增版本边缘检测测试（TDD）

- 新增 `src/components/workspace/Workspace.test.tsx`，隔离连接、画布和弹窗等非目标副作用。
- 先覆盖以下行为并确认测试以预期原因失败：
  - 已有版本列表增加新 ID 后，`workspace.previewWidth` 写为当前最大宽度；
  - 冷启动从空列表载入首个版本不展开；
  - 相同版本列表刷新不展开。
- 验证：`pnpm exec vitest run src/components/workspace/Workspace.test.tsx`

## 任务 2：接入自动展开并保留恢复宽度

- 修改 `src/components/workspace/Workspace.tsx`：
  - 订阅 `versions` 并保存上一版 ID 集合；
  - 提取复用的最大宽度展开函数；
  - 新版本出现时自动展开并沿用现有持久化；
  - 保留 `lastNormalPreviewW`，保证手动恢复回到展开前宽度。
- 运行任务 1 测试，确认转绿。
- 验证：
  - `pnpm exec vitest run src/components/workspace/Workspace.test.tsx`
  - `pnpm exec tsc --noEmit`

## 任务 3：完整回归验证

- 检查改动范围与格式。
- 运行项目全部本地门：
  - `pnpm lint`
  - `pnpm exec tsc --noEmit`
  - `pnpm test`
  - `pnpm build`
- 检查 `git diff --check` 与最终 worktree 状态。
