# 实现计划：「修改后重试」判据改按 category 判

spec：`docs/superpowers/specs/2026-08-13-retry-route-content-policy.md`

判据只长在两个纯函数里（`retryRouteFor` / `isBulkRetryable`），故任务按「判据 → 批量谓词 → 调用方回归 →
fixture 对齐真机 → 文档对账」拆。每个任务先红后绿。

## 任务 1：`retryRouteFor` 换判据

- 红：`src/lib/gen-retry.test.ts`
  - `category === 'content_policy'` + `retryable: true`（真机的值）→ `editForm`；两个 code 各一条
    （`INPUT_MODERATION_REJECTED` / `PROVIDER_CONTENT_POLICY_VIOLATION`）。
  - `retryable === false` 且 `category` 非 content_policy（如 `provider_unavailable`）→ `resend`（有 prov）。
  - 顺序回归：孤儿卡（`GEN_STATE_LOST` + `client_state` + `retryable: true`）仍 `recheck`；
    `content_policy` 判在 `!provenance` 之前（无 prov 的内容审核卡仍 `editForm`，不退成 `emptyForm`）。
  - 改写既有两条以 `retryable: false` 表达「内容审核类」的用例（:142、:169）—— 那不是真机形态。
- 绿：`src/lib/gen-retry.ts` 的 `retryRouteFor` 把 `failure?.retryable === false` 换成
  `failure?.category === 'content_policy'`，注释写明 retryable 的真实语义与为何不用它。

## 任务 2：`isBulkRetryable` 换同一判据

- 红：`src/lib/bulk-actions.test.ts`
  - `content_policy` + `retryable: true` 的卡**不**算可批量重试（现状绿→红的关键用例）。
  - `retryable === false` 且非 content_policy 的卡**算**可批量重试。
  - 改写 :66 那条（fixture 是 `retryable: false`）。
- 绿：`src/lib/bulk-actions.ts:33-35` 同步换判据 + 注释订正。

## 任务 3：调用方回归（不改生产代码，只锁行为）

- `src/components/canvas/nodes/GenErrorBody.test.tsx`：`content_policy` + `retryable: true` 的卡
  文案是「修改后重试」（:86 那条 fixture 改真机形态）。
- `src/store/retry-routing.test.ts`：:53 那条「retryable === false → 开预填表单」改成
  `content_policy` 形态，并补一条「`retryable === false` 非 content_policy → 真发生成请求」。
- `src/components/canvas/ContextMenu.test.tsx`：:213-216 批量重试用例的 blocked fixture 改真机形态
  （`retryable: true`），断言不变（仍不发）。

## 任务 4：把仓库里与真机不符的 fixture 一并对齐

纯 fixture 订正，避免下次又按错误形态推理：

- `src/store/actions.assetgen.test.ts:155`（`PROVIDER_CONTENT_POLICY_VIOLATION` 写成 `retryable: false`）→ `true`。
- `src/components/canvas/nodes/ImageNode.test.tsx:112`（content_policy + `retryable: false`）→ `true`。
- `src/lib/pgc/types.ts:85` 注释补一句：这是「调整后能否重试」，不是「能否原样重发」，重试路由不看它。

## 任务 5：文档对账

- `2026-08-03-canvas-gen-failure-retry.md`（约束 4 / 成功标准 6-7）、`2026-08-07-retry-path-guards.md`
  （成功标准 8）、`2026-08-11-retry-single-routing.md`（分流描述）各补一行：该分支判据已由
  `retryable === false` 改为 `category === 'content_policy'`，指向本轮 spec。原文不删（保留当时的推理轨迹）。

## 验证

`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，四步全绿（贴命令与退出码）。
真机验收 R07-6 待 `pgc-content-moderation` flag 在 dev 确认开启后再跑，结论回填 spec。
