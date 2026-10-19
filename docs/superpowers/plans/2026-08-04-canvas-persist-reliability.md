# 实现计划：画布落位可靠性

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-persist-reliability.md`
> 分支：`feat/canvas-persist-reliability`

先纯逻辑（零风险、可单测），再接坐标回写，最后动视口与角标。每步系统保持可运行、每任务一次提交。

---

## T1 限流与重试（纯逻辑）

**改动**
- 新建 `src/lib/concurrency.ts` —— `runWithLimit<T>(tasks: (() => Promise<T>)[], limit): Promise<PromiseSettledResult<T>[]>`
  滑动窗口：任一任务落定就补下一个；单个失败不中断其余（返回 settled 结果，由调用方统计）。
- 新建 `src/lib/retry.ts`
  - `isTransient(err)` —— `PgcError` 的 `NETWORK` / `TIMEOUT` / `status >= 500` 为真；4xx 与非 PgcError 为假。
  - `retryAsync(fn, delays, sleep?)` —— 按 `delays` 退避重试，只在 `isTransient` 时重试；`sleep` 可注入以便测试不吃真实计时器。

**测试** 新建 `src/lib/concurrency.test.ts` / `src/lib/retry.test.ts`
- `runWithLimit`：在飞数**恒不超过 limit**（用计数器记录峰值）；结果顺序与入参一致；单个 reject 不影响其余；空数组 no-op；limit 大于任务数不卡死。
- `retryAsync`：瞬时错误重试到成功；连续失败按 `delays.length + 1` 次调用后抛出；4xx 只调 1 次；成功时不 sleep。

**验证**
```bash
pnpm exec vitest run src/lib/concurrency.test.ts src/lib/retry.test.ts
```

---

## T2 坐标回写：重试 + 聚合 Toast + 整理限流

**改动** `src/store/actions.ts`
- `persistAssetPosition` 包 `retryAsync`；最终失败时不回滚坐标，改计入闭包内的失败计数器，800ms 防抖后发**一条** Toast（`setError({ code: 'POSITION_SAVE_FAILED', message })`，文案带张数故在 store 里拼好——沿用 `UPLOAD` 那条先例）。
- `tidyCanvas` 的 `for (const id of moved) void persistAssetPosition(id)` 换成 `runWithLimit(moved.map(id => () => persistAssetPosition(id)), 6)`。

**测试** `src/store/actions.test.ts` 追加（既有文件已 mock `pgcApi`）
- 瞬时失败重试后成功 → 不发 Toast。
- 连续失败 → 坐标**不回滚**，发一条 Toast。
- 同一窗口内 3 张卡都失败 → 只发一条 Toast，文案含「3」。
- 4xx 失败只发一个请求（不重试）。
- `tidyCanvas` 对 20 张卡回写时在飞请求数 ≤ 6。

**验证**
```bash
pnpm exec vitest run src/store/actions.test.ts src/lib/concurrency.test.ts
```

---

## T3 视口不被 agent 劫持

**改动**
- `src/store/types.ts` —— `ServerState` 加 `agentNewAssetIds: string[]`（瞬态，不进 persist 白名单；`createInitialServerState` 补默认值）。
- `src/store/actions.ts` —— `addGenPlaceholders` 的 `opts` 加 `origin?: 'user' | 'agent'`（缺省 `'user'`，保持既有行为）：
  - `'user'` → 照旧 `ensureVisible(position)`；
  - `'agent'` → 不跑视口，把 id 追加进 `agentNewAssetIds`。
  `registerAgentGenTask` 传 `origin: 'agent'`。
- 切项目时清空 `agentNewAssetIds`（与既有「同一次 set 内清会话态」的不变式一处理）。

**测试** `src/store/actions.test.ts` 追加
- agent 路径建卡：`ensureVisible` 未被调用，id 进 `agentNewAssetIds`。
- 用户路径建卡：`ensureVisible` 照常被调用，`agentNewAssetIds` 不变。
- 切项目清空。

**验证**
```bash
pnpm exec vitest run src/store/actions.test.ts
```

---

## T4 「N 个新资产」角标

**改动**
- 新建 `src/components/canvas/NewAssetsBadge.tsx` —— 订阅 `useViewport()` 与容器尺寸，用 `align-guides.ts` 既有 `visibleRects` 反推「仍在视口外的那几个」；有则渲染 `.anim-pop-in` 药丸（搜索栏正下方居中），点击 `setCenter` 飞到第一个并清空。
- `AssetCanvas.tsx` 挂载它；卡被删 / 切项目时列表自然收敛（id 不在 `assets` 里就不算）。
- i18n × 11：`canvas.newAssets`（带 count 插值）。

**测试** 新建 `src/components/canvas/NewAssetsBadge.test.tsx` + `src/lib/align-guides.test.ts` 追加
- 纯函数：给定视口与资产，返回「仍在视口外」的 id 子集（视口内的、已不存在的都被剔除）。
- 组件：无越界 id → 不渲染；有 2 个 → 文案含「2」；点击调 `setCenter` 并清空 store 字段。

**验证**
```bash
pnpm exec vitest run src/components/canvas/NewAssetsBadge.test.tsx src/lib/align-guides.test.ts
```

---

## T5 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–9，重点四条**只有真机能验**的：
  1. 断网（DevTools offline）拖卡 → 不回滚 + 一条 Toast；恢复后再拖能存上
  2. 整理大画布时在飞 PATCH 数 ≤ 6（DevTools Network 计数）
  3. agent 在对话里提交生成 → 视口纹丝不动 + 角标出现
  4. 手动平移到新卡附近 → 角标自行消失
- 第 3 条需要真实 agent 生成，**会消耗积分**；若不想花，退而用 WS 事件回放或直接调 `registerAgentGenTask` 验证同一路径，并在验收记录里写明用的是哪种。
- 验收后删 `.env` 副本、停 dev、还原验收期间被挪动的卡片位置。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
