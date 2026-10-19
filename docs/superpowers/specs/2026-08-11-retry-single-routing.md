# 重试路径收敛成一处分流：四个入口别再给同一张卡不同答案

> 状态：设计稿 · 2026-08-11
> 分支：`fix/retry-single-routing`（终审整改 B 批 / 共四批；A 批「键盘归属仲裁」已合并 `49be06b2`）
> 来源：2026-08-10 对 31 个功能回合的全量终审。本批的四条由 `rv-canvas-provenance`、
> `rv-gen-failure-retry`、`rv-orphan-no-delete`、`rv-retry-guards` 四个互不通气的评审员各自撞到，
> 全部已由我对着 HEAD 代码逐行核实
> 关联：`2026-08-03-canvas-gen-failure-retry.md`（引入重试入口）、`2026-08-06-retry-lineage-and-no-discard.md`、
> `2026-08-07-retry-path-guards.md`（四道护栏；本稿推翻它验收过的一条，见 C3）

## 目的

**同一张失败卡，四个入口给四个不同答案，其中两条会重复扣费。**

> ⚠️ 2026-08-13 对账：本文全篇的「`retryable === false`」都应读作「内容审核类」——那个判据本身与 pgc 契约相反
> （`retryable` 是「调整后能否重试」，这类恒 `true`），已改为 `failure.category === 'content_policy'`。
> 本文要立的规矩（四个入口共用一份判据）不变，只是判据内容被订正，见 `2026-08-13-retry-route-content-policy.md`。

分流逻辑今天只长在**卡面**上（`GenErrorBody.tsx:40-54`）：`retryable === false` → 开预填表单、
`GEN_STATE_LOST`（孤儿）→ 不花钱的重新检查、其余 → 原样重发。而 `retryGeneration`
（`store/index.ts:698-727`）**本体没有这个分流**，只判 `!prov` 与 `prov.agent`。于是：

| 入口 | 内容审核拒绝的卡 | 孤儿卡 | 一批 n=4 的失败卡 |
|---|---|---|---|
| 卡面 `GenErrorBody` | 开预填表单 ✅ | 免费重新检查 ✅ | — |
| 属性面板 `AssetInspector:182` | **原样重发 → 必然二次失败 + 二次扣费** ❌ | **付费重发** ❌ | — |
| 批量菜单 `ContextMenu:106` | 已排除 ✅ | 已排除 ✅ | **N×n 扣费** ❌ |
| 资产列表行 | — | 文案写「失败」，与卡面「读不到状态」矛盾 ❌ | — |

另有一条独立但同链路的缺陷：**轮询兜底把仍在跑的任务判死，用户点「重试」会删掉在飞的付费产物**。

## 现状核实（全部为 HEAD 实读）

| 事实 | 位置 |
|---|---|
| `retryGeneration` 只判 `!prov` / `prov.agent`，无 retryable / stateLost 分支 | `src/store/index.ts:698-727` |
| 面板按钮唯一门控是 `busy = status === 'generating'` | `src/components/canvas/AssetInspector.tsx:71,181` |
| 卡面三路分流在此，且判据正确 | `src/components/canvas/nodes/GenErrorBody.tsx:40-54` |
| 批量谓词已排除 agent / retryable=false / 孤儿（**这部分是对的，不动**） | `src/lib/bulk-actions.ts:33-35` |
| 批量执行是逐张调 `retryGeneration`，`runRetry` 原样重发 `prov.req` | `ContextMenu.tsx:105-106` · `actions.ts:999` |
| 图像 `n` 上限 4 | `src/lib/gen-params.ts:86` |
| `fails: 0` 的重置被 `derived &&` 门住 —— base（video/3d）任务**从不清零** | `src/store/actions.ts:1855` |
| `MAX_FAILS = 5`；`DEADLINE_MS = 35min`；轮询间隔 10s ⟹ 一次长生成约 210 次请求 | `actions.ts:134-135` · `useCanvasPolling.ts:6` |
| 达上限调 `failGenTask(t.itemId, t.taskId)`，**不传 failure** → `markAssetsFailed(..., null)` | `actions.ts:1913` · `actions.ts:225-231` |
| `discardFailedCard` 只对 `GEN_STATE_LOST` 拒绝删除，其余一律 DELETE 远端 | `actions.ts:940-950` |
| `orphanFailure()` 已存在，`restoreGenTasks` 与 `recheckAsset` 都在用 | `actions.ts:162,208,975` |
| 列表行只按 `status === 'error'` 出「失败」 | `src/components/canvas/AssetListDrawer.tsx:118-120` |

## 约束（盘问结论）

- **C1 分流下沉进 `retryGeneration` 本体**，四个入口自然一致。同时抽一个纯函数
  `retryRouteFor(asset): 'recheck' | 'editForm' | 'resend' | 'emptyForm'` 供 UI 取按钮文案 ——
  路由与文案共用一份判据，避免「行为改了文案没改」。沿用 A 批的做法（守卫下沉 + 纯函数可单测）。
- **C2 批量下 `n` 收敛为 1**（Nick 拍板）。「重试 N 个」= 拿回 N 张：卡数 = 请求数 = 产物数 = 花销单位。
  只选其中 2 张就只回 2 张。不做「同批去重」那套启发式（只选 2 张仍回 4 张，多出来的用户没要）。
- **C3 孤儿卡在属性面板改走免费的「重新检查」**（Nick 拍板）。
  ⚠️ 这**推翻** `2026-08-07-retry-path-guards.md:210` 验收过的一条行为（孤儿卡在面板可付费重发）。
  推翻理由：同一张卡卡面写「重新检查」、面板写「以相同参数再生成」，语义相反；
  且孤儿的定义就是「服务端那份仍在飞」，此时该做的是再问一次状态，不是再买一份。
- **C4 轮询兜底改挂 `orphanFailure()`**：`MAX_FAILS` 与 `DEADLINE` 这两条兜底的语义都是
  「前端接不回状态」，不是「后端说失败了」—— 挂上它，出口自动收敛到不花钱的重新检查，
  `discardFailedCard` 也自动拒绝删除远端。
- **C5 `fails` 恢复「连续」语义**：去掉 `actions.ts:1855` 重置条件里的 `derived &&`。
  注释里「防 taskId 失效后无限重试」的本意是**持续**失败，不是 210 次请求里累计 5 次。
- **C6 不改批量谓词**：`isBulkRetryable` 的三条排除是对的（`rv-retry-guards` 已验），本轮不动。

## 方案

1. `src/lib/gen-retry.ts` 新增纯函数 `retryRouteFor(asset)`，把卡面那三路判据搬进来（唯一真相）。
2. `retryGeneration` 开头按它分流：`recheck` → `recheckAsset`；`editForm` → `openRetryForm`；
   `emptyForm` → 现有的空表单降级；`resend` → 现有 `runRetry` 路径。
3. `GenErrorBody` / `AssetInspector` 改用 `retryRouteFor` 取文案与图标，行为交给 `retryGeneration`。
4. `runRetry` 增加可选的「单张」口径：批量路径传入后把 `req.n` 覆写为 1（只对有 `n` 的 kind 生效）。
5. `actions.ts:1913` 与 DEADLINE 兜底改 `failGenTask(t.itemId, t.taskId, orphanFailure())`；
   `actions.ts:1855` 去掉 `derived &&`。
6. `AssetListDrawer` 的失败标记按 code 分流文案（复用 `canvas.genStateLost`）。

## 成功标准

1. 内容审核拒绝的卡：卡面、属性面板**都**开预填表单，不发付费请求。
2. 孤儿卡：卡面、属性面板**都**是免费的「重新检查」；批量菜单仍不出现重试项。
3. 选中一批 n=4 的 4 张失败卡点「重试 4 个」：发 4 个请求、每个 `n=1`，产出 4 张。
4. 只选其中 2 张：发 2 个请求，产出 2 张。
5. 轮询累计失败达上限（或超 DEADLINE）：卡标成孤儿态，按钮是免费的「重新检查」，
   点它**不发生成请求、不 DELETE 远端**。
6. 一次长生成期间偶发 5 次**非连续**网络错：任务不被判死（成功轮询即清零 `fails`）。
7. 列表行对孤儿卡显示「读不到状态」而非「失败」。
8. `retryRouteFor` 是纯函数且被表驱动单测覆盖；四个入口的路由**各有一条接线测试**。

## 明确不做

- **改 `isBulkRetryable` 的三条排除**：已验证正确（C6）。
- **给 video/3d/audio 也加「单张」口径**：它们的请求体没有 `n`，覆写无意义。
- **合并卡面与面板的按钮组件**：两处的视觉语境不同（卡内 danger 小按钮 vs 面板 bordered 全宽），
  本轮只统一**行为与文案来源**，不动组件形态。
- **给「重新检查」加轮询**：点一次问一次，不引入新的轮询循环。
