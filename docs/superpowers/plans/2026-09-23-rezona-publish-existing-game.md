# Rezona 发布到已导入游戏 —— 实现计划

spec：`docs/superpowers/specs/2026-09-23-rezona-publish-existing-game-design.md`

每个任务先写失败测试，再写实现，跑通后单独提交。

## T1 契约层：类型 + API + 埋点类型

- `src/lib/pgc/types.ts`：`RezonaPublishRequest.game_id?`、`RezonaGameData`、`RezonaGameListData`。
- `src/lib/pgc/client.ts`：`pgcApi.rezona.listGames(pid)` → `GET /api/projects/${pid}/rezona/games`。
- `src/lib/analytics/events.ts`：`game_export_submit.rezona_mode?`。
- 测试：`client.test.ts` 断言 listGames 的方法 / 路径（沿用该文件既有 fetch mock 范式）。

## T2 纯逻辑：目标与错误映射

- `src/lib/rezona/publish.ts`：`PublishTarget`、`defaultTarget`、`targetValue` / `targetFromValue`、`mapRezonaError` 增 `REZONA_GAME_NOT_FOUND` + `resetTarget`。
- 测试：`publish.test.ts`。

## T3 `ui/Select` 增 `placeholder`

- value 无匹配且传了 placeholder → 触发钮显示 placeholder、菜单无选中点；不传时行为不变。
- 测试：`Select.test.tsx` 两条（有 placeholder / 无 placeholder 回落第一项不变）。

## T4 `PublishForm` 目标行

- 新 props：`target`、`games`、`gamesState`、`onTargetChange`、`onRetryGames`、`onTargetMenuOpenChange`。
- 渲染：列表 ready 且非空 → 标签 + Select；loading → 骨架；error → 「加载失败 · 重试」；ready 且空 → 不渲染。
- CTA 禁用：`!versionReady || gamesState !== 'ready' || target === null`。
- i18n 11 语言补 key（T4 内完成，`i18n.test.ts` 守护键对齐）。
- 测试：`PublishForm.test.tsx`。

## T5 `RezonaPublishModal` 接线

- 打开即拉列表；默认目标；切换目标换幂等键；请求体按目标带 / 不带 `game_id`；NOT_FOUND 清空 + 重拉；Esc 在菜单展开时让位；埋点 `rezona_mode`。
- 测试：新建 `RezonaPublishModal.test.tsx`（mock `pgcApi`）。

## T6 收口

- 全量验证：lint / tsc / test / test:tz / build。
- 干净上下文子代理按 spec + diff 评审；Critical / Important 修复，Minor 记 spec。
- `--no-ff` 合入 dev，合并结果上重跑验证；`epics.json` 登记分支。
