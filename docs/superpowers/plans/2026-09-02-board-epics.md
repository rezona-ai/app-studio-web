# 上线看板按需求聚合 · 实现计划

对应设计稿：`docs/superpowers/specs/2026-09-02-board-epics-design.md`。分支 `feat/board-epics`，全程 TDD，
每个任务独立可测、独立可评审。

## T1 纯逻辑：`groupRows` 归类与状态（`lib.ts` + `lib.test.ts`）

- 新类型 `EpicsConfig` / `EpicRow` / `GroupedBoard`。
- 失败测试先行：精确名归类 · glob（仅 `*`）归类 · `internalPrefixes` 优先于 epic · 冲突 throw ·
  缺失分支进 warnings · 日期取最早成员 · 状态 `{hit,total}` · 单成员 epic 仍聚合 · 空配置恒等。
- 主表按 date 倒序混排，工程内部固定表尾。
- 验证：`pnpm exec vitest run scripts/release-board/lib.test.ts`。

## T2 渲染：`renderHtml` 吃 `GroupedBoard`

- 聚合行 `<details>`：summary 含标题 / 成员数 / 日期 / 三列（✓ 或 `n/m`）；展开后成员用单行格式。
- 环境卡片计数改按主表行数（聚合行算 1，工程内部不计）。
- 失败测试先行：HTML 含 `n/m`、成员展开、工程内部落表尾、计数正确。

## T3 副作用层：`index.ts` 读 `epics.json`

- 文件不存在 → 空配置；解析失败 / 冲突 → 报错退出并指名分支。
- warnings 打 stderr；终端摘要加「N 个需求 · M 个未归类 · K 个工程内部」。

## T4 首版映射 `scripts/release-board/epics.json`

- 由 173 个现有分支起草，Nick 审阅。
- 验证：`pnpm board` 真跑，主表行数下降；`mv epics.json` 走开再跑，行数回到 173。

## T5 文档与收口

- CLAUDE.md 看板段落补一句：映射在 `epics.json`，未归类单行是「补映射」提示。
- 全量 `pnpm test` / `pnpm lint` / `pnpm exec tsc --noEmit`。
- 干净上下文子代理评审 → 处置 → `--no-ff` 回合 dev。
