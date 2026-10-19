# 实现计划：版本消耗积分接通拆分端点

设计稿：`docs/superpowers/specs/2026-08-31-version-credits-breakdown-design.md`

按「并存加新 → 原子切换 → 删旧」推进：任务 1–2 只加新（不影响现状），任务 3 原子切换数据来源，任务 4 删内联预埋。

## 任务 1：协议类型 + client 方法

- `src/lib/pgc/types.ts`：加 `VersionCreditsSegment` / `VersionCreditsData`（字段与注释照设计稿；null 语义写清）。
- `src/lib/pgc/client.ts`：加 `getVersionCredits(pid)`，默认超时档。

验证：`pnpm exec tsc --noEmit`。

## 任务 2：纯函数 `versionCreditsMap`（TDD）

`src/lib/pgc/map.ts` + `map.test.ts`。先写失败测试：

1. 正常段 → `{ v1: 300, v2: 120 }`。
2. `total_credits: null` 的段被丢弃（**且不回落 `asset_credits`**）。
3. `version_id: null`（在途段）被丢弃，即使 `total_credits` 有值。
4. `total_credits: 0` 保留（确实没花钱 ≠ 无数据）。
5. 空 `items` → `{}`。

验证：`pnpm exec vitest run src/lib/pgc/map.test.ts`。

## 任务 3：store action + 触发判据（TDD）

`src/store/actions.ts` 加 `loadVersionCredits`、`loadVersions` 接判据；`src/store/index.ts` 导出。测试落 `src/store/actions.version-credits.test.ts`（现有 store 测试文件布局照抄邻居）：

1. `loadVersions` 首载有 ready 版本 → `getVersionCredits` 被调 1 次，命中行拿到 `creditsSpent`。
2. ready 集合不变的重复 `loadVersions`（模拟 `pollVersions` 空转）→ 不再调。
3. 新版本变 ready → 再调 1 次。
4. 端点抛错 → `versions` 照常、`lastError` 未被写、不抛出。
5. 端点在飞期间切项目 → 数字不落到新项目。
6. 二轮返回不再包含某版本 → 该行 `creditsSpent` 被清成 undefined。

验证：`pnpm exec vitest run src/store/actions.version-credits.test.ts`。

## 任务 4：删内联预埋

- `src/lib/pgc/types.ts` 删 `VersionData.credits_spent` 及其注释。
- `src/lib/pgc/map.ts` `versionToVersion` 删该映射行。
- `src/lib/pgc/map.test.ts` 删两个内联映射用例（口径已由任务 2 用例接管）。
- `src/store/types.ts` `Version.creditsSpent` 注释改指新端点。

验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build`。

## 合并前

派干净上下文子代理基于 commit 范围独立评审（只给设计稿 + diff）；Critical / Important 修完再 `--no-ff` 合回 dev，合并结果上重跑完整验证。
