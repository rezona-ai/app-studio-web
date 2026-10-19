# 重发路径的两处修正：丢源素材与误删成功卡

> 状态：设计稿 · 2026-08-06
> 关联：`2026-08-03-canvas-provenance.md`（引入落库溯源与重发路径）、
> `2026-08-06-agent-asset-provenance.md`（agent 卡的溯源；本文两处都是评审那一轮时暴露出来的**既有** bug）

## 目的

属性面板的「以相同参数再生成」与失败卡的「重试」共用 `retryGeneration`。这条路上有两个 bug，
都不是 agent 溯源那一轮引入的，但那一轮把 agent 卡摘去走预填表单后，两类卡的行为分叉，问题才显出来。

### Bug A · 重发丢掉源素材与引用边

图生图的卡点「原参数重发」，产物退化成**纯文生**。

根因：`provenance.req` 存的是生成 action 的**入参**，而源素材与引用关系走的是另一条通道 `GenPlacement`
（`GenerateForm.tsx:301` 把 `sourceItemId` / `refItemIds` 放进 placement，`actions.ts:633` 提交时才把
`source_item_id` 拼进 body）。`runRetry`（`actions.ts:850`）只传 `{ spawnAt }` —— 于是：

- `source_item_id` 不下发 → 图生图 / 视频首帧 / 图生 3D 全退化成纯文生；
- `refItemIds` 不下发 → 新卡没有引用连线（body 里明明还带着 `ref_image_item_ids`）；
- 文本源的 `promptPrefix` 不再前置 → 那段设定正文丢失。

`actions.ts:847` 的注释「源资产/引用关系已由 req 里的 `source_item_id` 等字段承载」与代码不符，是这个 bug 的化石。

### Bug B · 对成功卡点「再生成」会把它删掉

`retryGeneration` 的非 agent 分支**无条件** `discardFailedCard`（`index.ts:704`），
而属性面板对**任何**有 provenance 的卡都渲染「以相同参数再生成」（`AssetInspector.tsx:160`，不限失败态）。
于是在一张**成功**的卡上点这个按钮 = 连服务端一起删掉再生成一张（`actions.ts:836-842` 真发 DELETE），
无确认、无撤销入口。

「丢弃失败卡 → 新占位卡落回原位」是失败卡重试的既定语义（视觉上原位变回 generating），
但把它套到成功卡上就是无声的数据丢失。

## 约束

1. **两条路的血缘规则必须同一处**：`runRetry`（直接重发）与 `openRetryForm`（开预填表单）
   都要从卡上重建血缘，各写一遍必然漂移。
2. **源卡须仍在画布且 `ready`**：已删 / 生成中的卡当生成输入会被后端拒。
   此前「无源」反而让请求“成功”地退化成纯文生，修好后要保持不崩。
3. **agent 卡与前端卡的文本源规则相反**，不可合并成一条：
   - 前端卡的 `provenance.req.prompt` 是**前缀之前**的原始 prompt → 原样带上文本源才能重现那次请求；
   - agent 卡的 prompt 是 koubou 写好的**完整**提示词 → 再经 `resolveTextRef` 前置一次会重复注入。
4. **删卡只发生在失败态**。成功卡的再生成是「再来一张」，不是「替换」。
   > ⚠️ **判据已由 `2026-08-07-retry-path-guards` 订正**：本轮用 `status === 'error'` 同时决定
   > 「删不删卡」与「占不占原位」，而后者的正确判据是**「原卡是否被丢弃」**——
   > `openRetryForm` 明明从不丢卡却仍对 error 卡传原卡中心的 `spawnAt`，新卡零偏移压住旧卡，
   > 等于把 bug B 的落位面留在了表单路上。现三条重发路径统一：丢了走 `pinAt`，没丢走 `nearAt`。
5 不改后端契约。

## 成功标准

1. 图生图的失败卡点重试 → 请求体带 `source_item_id`（等于原来那次的源卡），产物仍是图生图。
2. 多引用的卡点重试 → 新卡的 `reference.ref_item_ids` 与原卡一致（连线不丢）。
3. 文本源派生的卡点重试 → prompt 前缀重新前置（与原来那次的 body 逐字节一致）。
4. 源卡已被删 / 仍在生成中 → **不带** `source_item_id`，重发照常成功（退化成纯文生，不报错不崩）。
5. **成功**卡点「以相同参数再生成」→ 原卡还在画布上、**不发 DELETE**，新卡走常规避让落位（不叠在原卡上）。
6. **失败**卡点重试 → 行为不回退：原卡丢弃、新占位卡精确落回原位。
7. agent 卡走预填表单那条路不受影响（决策见上一轮设计稿）。
8. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 方案

### 1. 一处纯函数重建血缘

`src/lib/gen-retry.ts`（新）：

```ts
export interface RetryLineage { sourceItemId?: string; refItemIds?: string[] }

// 从卡上重建「重发时该传的 placement 血缘」。asset.parentId / refIds 正是当初 placement 落库的回显
export function retryLineage(asset: Asset, assets: readonly Asset[], prov?: AssetProvenance): RetryLineage
```

规则（对应约束 2、3）：

| 情形 | sourceItemId |
|---|---|
| 父卡不存在 / 非 `ready` | 不带 |
| 父卡既非 image 也非 text | 不带（生成接口只收图片源，文本源转 prompt 前缀；**rig3d / retexture 派生卡的父卡是一张 3D 卡**，漏进去会被表单预选成引用、凭空连出假血缘 —— 评审 I1）。<br>⚠️ **防御性收窄**：2026-08-07 核实**两个入口都够不到** 3D 父卡（`GenErrorBody` 被 `isDerived3d` 挡住、面板要求 `prov`、`retryGeneration` 无 `prov` 早退），该判据是防御而非在修实际路径；此前全仓无测试（改成 `return true` 整套仍全绿），已补 `gen-retry.test.ts` 一条并做过变异验证 |
| 前端卡（`prov.agent !== true`），父卡是图片或文本 | 带（含文本源，重现 `promptPrefix`）|
| agent 卡，父卡是文本 | **不带**（prompt 已完整，会重复注入）|
| agent 卡，父卡是图片且 `parentId` 真出自首帧字段 | 带 |
| agent 卡，父卡是图片但 `parentId` 出自尾帧 / omni 参考 | 不带（会把生成模式整体换掉）|

`refItemIds` 取 `asset.refIds` 中仍存在且 `ready` 的那些（同约束 2）。

本模块同时接住上一轮塞进 `openRetryForm` 的首帧判定，那段就从 store 里搬出来 ——
store 不该认识 koubou 的字段名。

### 2. `runRetry` 接血缘，`retryGeneration` 只在失败态丢卡

```ts
// actions.ts
const runRetry = (prov: AssetProvenance, topLeft: XY | undefined, lineage: RetryLineage) => { ... }
```

`topLeft` 改成可选：失败态传原位、成功态不传（走常规避让）。

⚠️ **落位不能走 `spawnAt`**（评审 C1）：`placeTarget` 里 `sourceItemId` 的优先级**高于** `spawnAt`，
而 lineage 恰恰会带来 `sourceItemId` —— 于是「有存活父卡的失败卡」会跳到父卡右侧，
原位语义就没了。故新增 `GenPlacement.pinAt`（**左上角**口径、优先级最高）承载精确锚点，
不动 `placeTarget` 既有的派生树形落位。

```ts
// index.ts retryGeneration
const lineage = retryLineage(asset, get().assets, prov);
if (asset.status !== 'error') {
  get().runRetry(prov, undefined, lineage);   // 成功卡:不丢卡、不占原位
  return;
}
get().discardFailedCard(pid, assetId);
get().runRetry(prov, asset.position, lineage);   // 左上角口径,runRetry 内转 pinAt
```

### 3. `openRetryForm` 改用同一处

把上一轮内联的「首帧 + ready + 图片父卡」判定换成 `retryLineage`，
`genForm.sourceId` 取它的 `sourceItemId`。前端卡因此也能带回文本源（此前一并丢了）。

## 明确不做

- **删卡加确认弹窗**：成功卡不再删卡，确认框就没有存在理由了。
- **给成功卡的再生成换个按钮文案**（如「再生成一张」）：文案属 UI 打磨，11 语言词条另算，本轮只修行为。
- **rig3d / retexture 的重发**：它们不落 provenance（`generateDerived3d` 调 `runGen` 时不传 `gen`），
  面板上本就没有再生成按钮，够不到这条路。
- **`n > 1` 批量生成的重发张数**：`provenance.req.n` 原样重发，与现状一致。

## 真机验收（2026-08-06，dev :3011 打 pgc dev，项目 1055）

制备：先让 agent 生成一张图（`url-bcf2c3d099bf`），再从它派生一次**图生图**（前端表单，源即那张图），
得到 `img-3929087b1223`（`status: ready`、`parentId: url-bcf2c3d099bf`、带 `provenance`）。

**bug 前提实证**：这张卡的 `provenance.req` 键集只有 `['prompt']` —— **确实不含 `source_item_id`**，
证实「源素材走 `GenPlacement` 不进 body」。

| 标准 | 结果 | 证据 |
|---|---|---|
| 1 重发带回 `source_item_id` | ✅ | 点「Regenerate with same settings」抓到的请求体：`{"prompt":"把这个飞船图标改成红色机身,其余保持一致","source_item_id":"url-bcf2c3d099bf"}` —— 而 `req` 里只有 `prompt`，该字段只能来自 `retryLineage` |
| 5 成功卡不删卡 | ✅ | 整次操作**一个 DELETE 都没发**（`deletes: []`）；原卡 `img-3929087b1223` 仍在 assets 里 |
| 5 新卡不叠在原卡上 | ✅ | 原卡 (1330,270)，新卡落 (1590,510) —— 走的是常规树形/避让落位，不是原位 |
| 2 引用边不丢 | ✅（源边） | 新卡 `img-f89841a2a639` 的 `parentId` 仍是 `url-bcf2c3d099bf`，血缘边保持；最终 `status: ready` |

### 未验到（如实记录）

- **标准 3（文本源 prompt 前缀重新前置）**：需要一张「文本卡派生」的失败卡，真机制造成本高。
  由 `provenance.test.ts` 的 `toEqual({ prompt: '世界观:蒸汽朋克\n\n一只猫', model: 'gpt-image-2' })` 逐字节钉住。
- **标准 4（源卡已删则不带该字段）**：同上，由单测覆盖。
- **标准 6（失败卡仍落回原位）**：需要真实生成失败。这条正是评审 C1 抓到的回归，
  已由 `失败卡重试 → 仍丢弃原卡并落回原位(即便有存活父卡)` 复现测试钉住（改前必红，评审变异验证亦红）。
  真机未触发失败，**不宣称已真机验证**。
