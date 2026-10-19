# 「修改后重试」判据改按 category 判 —— 与 pgc 的 retryable 语义对账

> 触发：真机验收用例 **R07-6**（「不可重试 → 修改后重试」：内容审核类失败卡按钮应为「修改后重试」，
> 点击打开生成表单并预填原参数）**无法复现**。排查结论是前端 bug —— 判据读反了后端契约。

## 目的

让内容审核类失败卡真的走「修改后重试 → 预填表单」，而不是像今天这样显示「重试」并原样重发。

## 根因：`retryable` 的语义前后端相反

前端有两处判据读的是**同一个错误假设** —— 路由 `src/lib/gen-retry.ts:85` 与批量谓词
`src/lib/bulk-actions.ts:35`，都把 `retryable === false` 读作
**「原样重发必然再失败，所以要让用户先改」**：

```js
if (asset.failure?.retryable === false) return 'editForm';
```

而 pgc 的 `retryable` 是**「调整后是否还能重试」**——这一点其实早就写在我们自己的协议注释里
（`src/lib/pgc/types.ts:85`：`retryable: boolean;  // 调整后是否可重试`），只是 spec
`2026-08-03-canvas-gen-failure-retry.md:36` 当时按前一种含义写下了假设，没人回头对账。

内容审核类改了 prompt 当然能再试，所以后端给的是 **`True`**（`pgc-server/app/core/generation_failure.py`）：

| 来源 | `code` | `category` | `retryable` |
|---|---|---|---|
| `failure_from_moderation` :213-229（pgc 前置 422 拦截） | `INPUT_MODERATION_REJECTED` | `content_policy` | **True** |
| `_content_policy_failure` :232-240（上游事后终态拦截） | `PROVIDER_CONTENT_POLICY_VIOLATION` | `content_policy` | **True** |

于是内容审核卡落到 `resend` 分支：按钮写「重试」、点击原参数重发 → 必然再次被同一道闸门拦下
（前置拦截不调上游、不预留额度，所以不多扣费，但用户白等一轮、且完全没有被引导去改 prompt）。

反过来看真机上 `retryable === false` 的实际集合（同文件）：`PROVIDER_NOT_CONFIGURED`（未配 key）、
非 5xx 的 billing 失败（余额不足）、`GENERATION_FAILED` 兜底、legacy error 投影。**画布同步路径上这些
根本不会挂 failure**——`failure_from_app_error` 只被 `agent_gen_service.py:588` 用于 agent 任务落库，
画布侧 4xx 除内容审核外信封不带 `failure`（前端落 `null`）。所以 `editForm` 分支在真机上基本是死代码，
既有单测只因 fixture 自造 `retryable: false` 才是绿的。

**旁证**：`src/lib/pgc/client.test.ts:161` 那条照真机 422 抄下来的 fixture，
`INPUT_MODERATION_REJECTED` 写的正是 `retryable: true` —— 真相一直躺在仓库里。

## 终审处置（2026-08-13，干净上下文子代理评审，只给本 spec + `e0181059..a5ce036b` 的 diff）

Critical 无。评审独立枚举了 pgc 侧全部 `content_policy` 产出点，并逐条排除了我担心的破口：
派生 3D 卡在三处各自被挡在 `retryRouteFor` 之前（`GenErrorBody.tsx:45` / `AssetDetailBody.tsx:180`
的 `prov &&` 门 / `isBulkRetryable` 的 `!!a.provenance`）；`PROVIDER_INPUT_REJECTED` 只出自
agent 卡故已由 `prov.agent` 分支覆盖；migration `e3b7c9d1a4f6` 一次性加齐 5 列，
不存在「`category` 为 NULL 的 content_policy 行」。

已采纳并落实：

- **I1**：`store/index.ts` 的 `openRetryForm` 注释还写着被推翻的判据（「判据只有一份，但判据的说明有第二份且是错的」——
  正是本轮 bug 的成因形态）→ 改为按 `editForm` 路由表述。
- **I2**：plan 任务 4 的 fixture 清扫漏了两处，且漏掉的正是最扎眼的
  `gen-failure.test.ts` 里名叫 `moderationFailure` 的常量（`retryable: false`）与
  `actions.test.ts:1208`（同文件 `:1188` 已是 `true`，两条自相矛盾）→ 一并改成真机形态。
- **M5**：补一条不打桩 `openRetryForm` 的端到端护栏（`retry-routing.test.ts`），
  锁「表单真开出来 + `prefill` 带原参数 + 原卡仍在」—— 成功标准 1 此前只有「调到了」这一层。
  顺带修掉该文件的桩泄漏（`stubs()` 盖掉 action 而 `createInitialServerState()` 不含 actions，
  桩会漏进后续用例）。
- **M1 / M2 / M3 / M4**：文档订正，见上文与 `2026-08-03` 那条 ⚠️ 的范围扩写。

护栏有效性自验：临时把判据回滚成 `retryable === false` 再跑 `retry-routing.test.ts`，
3 条（含新护栏）翻红；还原后全绿 —— 不是选巧 fixture 的自证预言。

M6（真机结论待回填）见下节。

## 第二条根因：同步路径的上游拒绝根本没有 `failure`（2026-08-13 追加）

上面那条修完后 Nick 真机仍复现不出来：他用 **gpt-image-2 + 违规 prompt**，拦他的不是 pgc 前置审核，
而是**上游 OpenAI 的事后拒绝**。真机取证（dev）：

```
POST /canvas/items/generate/image  {"prompt":"…","model":"gpt-image-2"}
→ http=422
  { "success":false, "code":"ARTGEN_INPUT_REJECTED",
    "message":"Generation provider rejected the input: 抱歉，我不能帮助生成裸体或露骨色情内容的图片。",
    "data":null, "failure":null }
```

`failure` 是 **null**：画布**同步**生成（图像 / 音频）的上游错误走 `map_provider_error`
（`canvas_gen_service.py:769-775`），它构造 `AppError(code, message, 422)` 时不挂 `failure`
（`failure_from_app_error` 全仓唯一调用点是 `agent_gen_service.py:588`，画布路径不可达）。
于是卡上 `failure = null`：既没有可展示原因，也没有 `category` 供路由分流 → 落 `resend` →
「重试」原样重发 → 上游再拒。**第一条根因的修复对这条路径无效**，两者都得修。

处置（决策：前端补一层，本仓闭环）：

- 新增纯函数 `failureFromPgcError`（`src/lib/gen-failure-map.ts`）：信封自带 `failure` 优先；
  否则当 `code` 以 `_INPUT_REJECTED` 结尾（`map_provider_error` 明确约定的形态，非臆测字段）
  时投影出 `{ code, category: 'input_rejected', message: '', retryable: true }`；其余返回 `null`。
  - `category` 沿用后端 `failure_from_app_error` 对 `PROVIDER_INPUT_REJECTED` 用的同一个词
    （`generation_failure.py:156`）—— 后端将来真把 `failure` 挂上时自动同口径，这层投影可直接删掉。
  - **`message` 不投影**：后端那句是 `f"Generation provider rejected the input: {上游原文}"`，
    英文技术前缀不该进卡面；剥前缀等于赌它的拼接格式（臆测后端格式是仓库明列的反模式）。
    留空 → 卡面回退通用文案，与改动前一致。具体原因等 pgc 侧挂上已本地化的 `failure`。
- `retryRouteFor` 的 editForm 判据加 `category === 'input_rejected'`：「输入被拒」不论是内容政策
  还是首帧图不合格，原样重发都必然再拒，都该让用户先改。
- `isBulkRetryable` **改为委托** `retryRouteFor(a) === 'resend'`（仍自判 `status === 'error'`）：
  此前它手抄一份「agent / content_policy / 孤儿」排除清单，与路由函数各持一份 —— 本轮加
  `input_rejected` 就要两处各改一次。委托后「单卡与批量对同一张卡给同一个答案」不再靠人肉同步。

遗留（需 pgc 侧，不在本仓）：`map_provider_error` 的 400/422 分支应挂
`failure_from_app_error(...)`，前端才能拿到已本地化的具体原因（现在卡面只有通用文案）。

## 二级前提（不属本轮改动，但影响能否真机验收）

pgc 前置审核受 PostHog flag `pgc-content-moderation` 门控且 `default=False`
（`canvas_gen_service.py:1133`），审核器不可用还 fail-open 放行。flag 没开时连 422 都拿不到，
一张内容审核失败卡都造不出来。真机验收 R07-6 前需先确认该 flag 在 dev 已开。

## 约束

1. **判据只有一份**：四个入口（卡面 `GenErrorBody` / 属性面板 `AssetDetailBody` / 批量菜单 `ContextMenu` /
   store `retryGeneration`）都经 `retryRouteFor`，批量谓词经 `isBulkRetryable`；判据改动只落这两个函数，
   调用方不各判一遍（`2026-08-11-retry-single-routing` 立的规矩，不回退）。
2. **判据顺序不变**：孤儿（`GEN_STATE_LOST`）仍判在最前——`orphanFailure()` 的 category 是
   `client_state`、`retryable` 恒 true，靠后会被判成 resend，那正是「删掉仍在飞的付费产物」那条路。
3. **`retryable` 退出路由**：它的真实语义（调整后能否重试）对「该走哪条重试路」没有信息量 ——
   余额不足（`retryable=false`）该做的是充值后**原样重发**，送去开表单是错的；rate limited
   （`retryable=true`）该做的也是原样重发。故本轮把它从判据里摘掉，只保留协议类型与注释订正。
4. **两个 code 一起覆盖**：`INPUT_MODERATION_REJECTED`（pgc 前置）与 `PROVIDER_CONTENT_POLICY_VIOLATION`
   （上游事后）后端刻意用同一个 `category=content_policy` 以便统一 UI，故按 `category` 判而非枚举 code ——
   将来后端新增同类 code 不必再改前端。
5. 不改后端。pgc 的 `retryable` 语义自 `ab23a47` 起一致，是前端读错，不是它的 bug。

## 成功标准

1. `failure.category === 'content_policy'` 的失败卡：卡面与属性面板按钮文案是「修改后重试」，
   点击进 `openRetryForm` → 打开该类型生成表单、预填原参数，**且不发生成请求、不丢原卡**。
2. 两个 code（`INPUT_MODERATION_REJECTED` / `PROVIDER_CONTENT_POLICY_VIOLATION`）都命中，
   且 `retryable: true` 不影响命中（这正是真机的值）。
3. `retryable === false` 单独出现（如未配 key / 余额不足）不再走 `editForm`：有 provenance 走 `resend`
   （「重试」原样重发），无 provenance 走 `emptyForm`。
4. 批量重试计数与执行都排除 `content_policy` 卡（它们计入跳过数），不再按 `retryable` 排除。
5. 孤儿卡仍恒为 `recheck`（「重新检查」，不花钱）；agent 卡仍恒为 `editForm`。
6. `2026-08-03` / `2026-08-07` / `2026-08-11` 三份 spec 里以 `retryable === false` 表述该分支的条目
   留一行对账说明，指向本文。

## 影响面（真机行为变化）

- 内容审核类失败卡：「重试」→「修改后重试」，点击不再发请求而是开预填表单。
- 未配 key / 余额不足类失败卡（若后端将来在画布路径挂 failure）：不再被送去开表单，仍是「重试」。
- 批量重试：选区里的内容审核卡从「会被真发出去」变成「跳过」（此前 spec `2026-08-07` 声称已排除，
  但因同一误读在真机上并未生效）。
- **一格行为回退**（评审 M3）：无 `provenance` 且 `retryable === false` 的**非**审核类卡，
  路由由 `editForm` 退成 `emptyForm` —— 丢掉 `openRetryForm` 对 `sourceId` 的还原、文案从
  「修改后重试」变「重试」。真机窗口极窄（这类 failure 只出自 `failure_from_app_error`，
  其唯一调用点是 agent 任务，而 agent 卡有 `prov.agent=true` 仍走 `editForm`），接受。
- **判据精度上限由后端决定**（评审 M4）：pgc 的 `_is_content_policy` 是对 provider message 做子串匹配
  （`_CONTENT_POLICY_FRAGMENTS` 含 `copyright` / `版权` / `policyviolation`），所以上游一条恰好含这些词的
  瞬时错误会被归成 `content_policy`、进而开表单而不是重发。这是后端既有启发式，前端不另加兜底
  （臆测后端字段做兜底是仓库明列的反模式）。
