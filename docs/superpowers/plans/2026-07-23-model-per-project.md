# 实现计划:模型选择按项目区分

对应设计稿:`docs/superpowers/specs/2026-07-23-model-per-project.md`

## 任务 1:store 落 `modelByProject`(TDD)

- `src/store/model-selection.test.ts` 先补失败用例:
  - `setSelectedModel` 在有 `currentProjectId` 时写入 `modelByProject[pid]`;无项目时只写视图。
  - `switchProjectSession` 载入目标项目记忆;无记忆沿用当前值(全局兜底);记忆不在 `availableModels` 时回落首项;`availableModels` 为空时先信记忆。
  - `setAvailableModels` 回落不冲掉映射条目。
- 改 `src/store/index.ts`:
  - `UIState` 增 `modelByProject: Record<string, string>`,初始 `{}`。
  - `setSelectedModel` / `switchProjectSession` 按 spec 改写。
  - `partializeAppState` 增 `modelByProject`;persist `version: 2`(`migrate` 旧快照无该字段 → 初始值兜底,无需搬数据)。
- 验证:`pnpm exec vitest run src/store/model-selection.test.ts`

## 任务 2:prelude 落映射(TDD)

- `src/store/studio-prelude.test.ts` 补用例:带 model 的 prelude 在 createProject 成功后 `modelByProject[新pid]` 已写入。
- `applyStudioPrelude`:pid 落地后 `if (prelude.model) get().setSelectedModel(prelude.model)` 再写一次。
- 验证:`pnpm exec vitest run src/store/studio-prelude.test.ts`

## 任务 3:全量回归

- `pnpm exec tsc --noEmit && pnpm test`(重点看 studio-share / studio-remix / Composer / ModelSelector / useProjectBootstrap)。
