# 积分动态更新 + 版本消耗展示（实现计划）

2026-07-28 · 设计稿：`docs/superpowers/specs/2026-07-28-credit-dynamic-refresh-design.md`

每个任务独立可测、独立提交。纯逻辑先写失败测试再实现（TDD）。

## 任务 1 · `refreshBalance` action

**文件**：`src/store/actions.ts`（新增）· `src/store/index.ts`（导出）· `src/store/actions.test.ts`（用例）

- 只调 `pgcApi.getBalance()`，成功 `set({ credit })`，失败静默（不经 `guard`）。
- 在飞合流：模块级 `let balanceInflight: Promise<void> | null`，在飞时返回同一 promise，结束置空。
- 加入 `ServerActions` 类型与返回对象。

**验证**：`pnpm exec vitest run src/store/actions.test.ts`
用例：成功写 `credit` / 失败不写 `toast` 且不抛 / 并发两次只发一次请求。

## 任务 2 · 生成与轮询两个漏斗接入

**文件**：`src/store/actions.ts` · `src/store/actions.test.ts`

- `runGen`：`await call(...)` 成功后 `void refreshBalance()`（`catch` 分支不调；ABORTED 也不调）。
- `pollGenTasks`：任务进终态（ready / failed）后 `void refreshBalance()`。

**验证**：`pnpm exec vitest run src/store/actions.test.ts`
用例：`generateImage` 成功后触发；失败不触发；异步任务轮询到终态后触发。

## 任务 3 · 共享可见性门控 + 在途兜底轮询

**文件**：`src/client/useVisibilityGatedInterval.ts`（新，从 `useCanvasPolling` 抽出）· `src/client/useCanvasPolling.ts`（改用共享）· `src/client/useBalanceRefresh.ts`（新）· `src/client/useBalanceRefresh.test.tsx`（新）· `src/components/workspace/Workspace.tsx`（挂 hook）

- 门控逻辑整体搬移，行为不变（`useCanvasPolling` 现有测试须仍绿）。
- `useBalanceRefresh`：`active = runStatus === 'running' || genTasks.length > 0`，间隔 15s。

**验证**：`pnpm exec vitest run src/client`
用例：running 时按间隔 tick；idle 且无 genTasks 时零 tick；hidden 时跳过。

## 任务 4 · agent run 结束搭车刷新

**文件**：`src/client/useKoubouConnection.ts`（`run.finished` 既有分支）· 对应测试

在既有 `loadCanvas`/`loadVersions` 旁加 `void refreshBalance()`（成功与失败态都刷——失败的 run 也可能已扣费）。

**验证**：`pnpm exec vitest run src/client/useKoubouConnection.test.tsx`

## 任务 5 · 版本消耗字段预埋（映射层）

**文件**：`src/lib/pgc/types.ts` · `src/lib/pgc/map.ts` · `src/store/types.ts` · `src/lib/pgc/map.test.ts`

- `VersionData` 增 `credits_spent?: number | null`（注释标注「后端契约提案，待确认」）。
- `versionToVersion` 映射 `creditsSpent`：仅 `typeof === 'number'` 时带上。

**验证**：`pnpm exec vitest run src/lib/pgc/map.test.ts`
用例：数字 → 映射；`null` → `undefined`；缺失 → `undefined`。

## 任务 6 · 版本时间线渲染消耗

**文件**：`src/components/preview/VersionTimeline.tsx` · `src/components/preview/VersionTimeline.test.tsx` · `src/i18n/locales/*.ts`（11 个，`preview.versionSpend`）

- 版本名右侧紧跟 `⚡ + formatCredit`，恒 `--color-teal`，`title=preview.versionSpend`（精确值插值）。
- `creditsSpent === undefined` 不渲染该元素。
- 行高保持 60px，版本名仍是唯一 truncate 让位者。

**验证**：`pnpm exec vitest run src/components/preview/VersionTimeline.test.tsx`

## 收尾验证

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

## 后续（不在本轮）

把设计稿「后端契约提案」节的 `credits_spent` 发给后端确认口径与字段名；字段名若变更，只需改 `types.ts` + `map.ts` 两处。
