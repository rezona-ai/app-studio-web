# 实现计划：重试路径单一分流（终审整改 B 批）

> 设计稿：`docs/superpowers/specs/2026-08-11-retry-single-routing.md`
> 分支：`fix/retry-single-routing`（worktree 建在 `.orca/worktrees/`，从 dev 的合并结果切）

每个任务最小可独立测试、可独立评审；按铁律 1，每步先写复现该 bug 的失败测试。
A 批的三条教训带过来：**先提交再变异**（撤变异用反向替换，不用 `git checkout`）；
**每条新用例都要自问「不加这个修复它会不会照样绿」**；**断言别按了又按回原处、别不推时钟、别缺前置条件**。

## T1 · `retryRouteFor` 纯函数（无行为变更，先立唯一真相）

`src/lib/gen-retry.ts` 新增：

```ts
export type RetryRoute = 'recheck' | 'editForm' | 'emptyForm' | 'resend';
export function retryRouteFor(asset: Asset): RetryRoute
```

判据（从 `GenErrorBody.tsx:40-54` 与 `store/index.ts:704-715` 搬来，两处合一）：
`failure?.code === GEN_STATE_LOST` → recheck；`!provenance` → emptyForm；
`provenance.agent === true` → editForm；`failure?.retryable === false` → editForm；否则 resend。

> 顺序有讲究：孤儿判在最前（它同时可能 `retryable !== false`）；`!provenance` 在 agent 之前
> （无 prov 时读不到 `.agent`）。表驱动测试要把这两条顺序各钉一条。

测试 `src/lib/gen-retry.test.ts`：五种输入各一条 + 两条顺序守卫。**新函数，先红。**

## T2 · `retryGeneration` 按路由分流（成功标准 1、2 的行为侧）

`src/store/index.ts:698-727` 开头改成按 `retryRouteFor` 分派；卡面那三路 if 随之删掉
（`GenErrorBody` 只负责渲染，不再自己判 —— 否则又是两份判据）。

测试 `src/store/retry-routing.test.ts`（新文件）：
- 孤儿卡 → `recheckAsset` 被调用、`runRetry`/生成端点**未**被调用。**先红**（今天走 runRetry）。
- `retryable === false` 的卡 → `openRetryForm` 被调用，生成端点未被调用。**先红**。
- 普通失败卡 → 照旧 `runRetry`（不回归）。
- agent 卡 → 照旧 `openRetryForm`（不回归）。

## T3 · 四个入口接线（成功标准 1、2 的入口侧）

- `AssetInspector.tsx`：按钮文案/图标改用 `retryRouteFor`（recheck 时显示「重新检查」），
  `onClick` 仍调 `retryGeneration`。
- `GenErrorBody.tsx`：删掉本地三路判据，改用 `retryRouteFor` 取文案。
- 测试：面板对孤儿卡显示「重新检查」且点击不发生成请求（**先红**）；卡面行为不回归。

## T4 · 批量 `n` 收敛为 1（成功标准 3、4）

`runRetry` 加可选参数（如 `{ single: true }`），命中时对有 `n` 的 kind 覆写 `req.n = 1`；
`ContextMenu` 的批量循环传 `single`。单选路径不传，保持「原样重发含 n」的既有决策。

测试：
- 4 张同批失败卡（`prov.req.n === 4`）批量重试 → 生成端点被调 4 次，**每次 `n === 1`**。**先红**（今天 4 次 n=4）。
- 只选 2 张 → 调 2 次，每次 n=1。
- 单选路径重试一张 n=4 的卡 → 仍发 n=4（既有决策不回归）。

## T5 · 轮询兜底改挂孤儿态 + `fails` 恢复连续语义（成功标准 5、6）

- `actions.ts:1913`（MAX_FAILS）与 DEADLINE 那条兜底：`failGenTask(..., orphanFailure())`。
- `actions.ts:1855`：去掉 `derived &&`，成功轮询一律清零 `fails`。

测试（`src/store/actions.*.test.ts` 既有风格）：
- 连续 5 次 poll 抛错 → 卡的 `failure.code === GEN_STATE_LOST`。**先红**（今天是 null）。
- 4 次错 + 1 次成功 + 4 次错 → 任务仍在，未被判死。**先红**（今天 base 任务累计到 5 就死）。
- 被判孤儿的卡点重试 → 不发 DELETE、不发生成请求（与 T2 的孤儿路由同一条链）。

## T6 · 列表文案按 code 分流（成功标准 7）

`AssetListDrawer.tsx:118-120` 对 `GEN_STATE_LOST` 用 `canvas.genStateLost`（11 语已齐，无需补词条）。
测试：孤儿卡在列表行显示「读不到状态」，普通失败卡仍显示「失败」。

## T7 · 收尾

- 五步全绿（贴完整输出与退出码）。
- 变异验证：每条护栏逐个改坏→确认对应测试红→反向还原（**先提交**）。
- 真机复看：孤儿卡两个入口、批量重试 4 张看实际产出与扣费、长生成期断网一次不判死。
- 派干净上下文子代理做增量评审。

## 已知取舍

- **C3 推翻既有验收行为**：`2026-08-07-retry-path-guards.md:210` 明确验收过「孤儿卡在面板可付费重发」。
  本轮按 Nick 拍板改掉，spec 里已写明推翻理由。改完要回头在那份 spec 上补一行指路，别让两份文档对打。
- **`n` 覆写只对 image 生效**：其余 kind 的请求体没有 `n`（`gen-params.ts`），覆写是 no-op。
- **孤儿卡用户仍可重生成**：先「重新检查」确认真死，再走正常重试 —— 多一步，但不会重复付费。
