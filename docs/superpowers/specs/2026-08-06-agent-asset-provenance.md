# agent 生成资产的创作溯源落库

> 状态：设计稿 · 2026-08-06
> 关联：`2026-08-03-canvas-provenance.md`（前端自发起生成的溯源落库，已回合 dev）——本轮是它剩下的**最后一片空白**；
> `2026-08-04-agent-asset-lineage.md`（按 `task_id` 回溯 agent 工具入参连血缘，已回合 dev）——本轮复用它发现的同一条通路。

## 目的

画布上 agent 生成的卡，属性面板「提示词」那一整段**不渲染**，「以相同参数再生成」按钮**不出现**。
用户看到一张 agent 生成的满意图想微调重跑，只能自己把提示词凭记忆手打进生成表单。

而这些信息**前端早就握在手里**：`lineageForTask`（`lib/gen-lineage.ts:66`）已经按 `task_id`
在消息日志里定位到提交那次生成的 tool part，然后读它的 `input` —— 那就是 agent 那次生成的完整入参。
它只从里面挑了源素材 url 去连血缘线，`prompt` / `model` / `size` / `seconds` 等**全部原地丢掉**。

所以本轮的实质不是「去拿 prompt」，是**把导入那一刻手里已有的东西钉进资产**。

之所以不能就这么留在内存里，有三道会让它消失：

| 场景 | 后果 |
|---|---|
| 历史分页 | 冷启动只重建最近一页（`listEvents` 按 `beforeSequence` 每页 100，滚上去才续拉）。几天前那次生成的工具调用不在 `messages` 里 |
| 换设备 / 清缓存 | `messages` 是重建出来的，重建不到就没有 |
| 换会话 | `messages` 按项目隔离，而 agent 卡长期留在画布上 |

而「这张图当时用什么提示词生成的」恰恰是**隔几天才会问**的问题。

## 约束

1. **不需要 koubou 任何改动**。工具入参在 `Part` 的 `tool` 分支上（`store/types.ts:76` 的 `input: unknown`），
   `lineageForTask` 已在生产读它。跨仓协作从本轮的路径上彻底移除。
2. **不改后端契约**。provenance 走既有的 `reference.provenance`（`pgc/map.ts:193` 写、`:39` 读），
   后端顶层字段将来上线自动优先。
3. **零额外请求**。两条落点本来都要写一次 `reference`（同步导入的 `importGeneratedAsset`、
   异步 adopt 的 `positionBatchItem` 回写），provenance 搭顺风车。
4. **`req` 原样落库，不在写侧翻译**（决策 1）。koubou 那份入参与前端请求体是两套口径，
   `provenance.agent` 作**显式判别器**，归一只在读侧一处发生。
5. **未知模型别名不猜、不丢**。koubou 哪天加模型而前端映射表没跟上：原样显示那个字符串。
   宁可显示 `some-new-alias` 也不显示错模型、更不静默省略。
6. **有损是已知的、写进清单的**（见末节）。映射不全的地方用户要**看得见**，不能让它默默用错参数花钱。
7. **不回溯补历史卡**。本改动前已导入的 agent 卡没有 provenance，面板保持现状（同血缘那一轮的约束 7）。

## 成功标准

1. agent 在对话里生成的四类资产（image / audio 同步导入，video / 3d 异步登记）落卡后，
   其工具入参随 `reference.provenance` 落库，**刷新页面后仍读得到**。
2. 属性面板对 agent 卡显示：提示词（可复制）、模型、生成参数 —— 与前端自发起的卡**同一套渲染代码，零新分支**。
3. 模型那一格显示**模型选择器里的名称**（`Gemini 3.1 Flash Image`），不是裸 id、不是 koubou 别名。
   这一条**对前端自发起的卡同样生效** —— 它现在裸显示 `gpt-image-2`，`GEN_MODELS` 的 label 一直没用上。
4. 未知别名（映射表没有的值）：原样显示该字符串，不崩、不省略。
5. agent 卡的「以相同参数再生成」**打开预填表单**而非直接发请求（决策 2）：
   prompt / 参数 / 模型已填好，用户确认后手动点生成。前端自发起卡的直接重发行为**不回退**。
6. 预填表单里，源卡在画布上时把它**还原为引用源**（图生图仍是图生图），源卡不在画布上时引用那格为空。
7. `run.finished` 后台 `loadCanvas` 整表替换**赶在 fire-and-forget 回写之前**时，provenance 不丢失
   （与坐标 / 血缘 / 归属同款的「仅服务端缺失时取本地」保留）。
8. `provenance.agent` 判别器经 `reference` 往返**不被吃掉**（`provenanceOf` 是逐字段重建的白名单，漏了就静默丢）。
9. 无 `task_id` 的 media 事件（历史事件 / 后端未给）→ 不写 provenance，行为与现状一致，不报错。
10. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 现状要点（实现前必读）

- **两条落点都已经在算血缘，provenance 用同一次查找**：
  - 同步 image / audio：`importGeneratedAsset`（`actions.ts:1155`）—— `lineageForTask(messages, taskId, assets)`，
    随后 `writeCanvasItemFromUrl` 带 `reference` 落库。
  - 异步 video / 3d：`registerAgentGenTask`（`actions.ts:1517`）—— 同一次调用，先落占位卡，
    产物回来经 `adoptAgentItem` 原位替换。
- **`adoptAgentItem`（`actions.ts:521`）已有「前端所有字段跨 adopt 携带」的既成结构**（`lineage` 那个对象携带
  `parentId` / `refIds`，注释写明「别被服务端的 undefined 冲掉」）。provenance 属同一类，加进去即可。
  ⚠️ 但它的回写条件是 `if (lineage.parentId)` —— **纯文生的 agent 卡没有 parentId**，
  条件不放宽的话 provenance 只留在内存，下一次整表替换就冲掉。
- **`provenanceOf`（`pgc/map.ts:39`）逐字段重建**：`return { kind: p.kind, req: ..., at: p.at }`。
  新增的 `agent` 字段不在里面就会在每次读回时被静默吃掉（成功标准 8）。
- **`preserveFrontendOwned`（`pgc/map.ts:146`）不含 provenance**：坐标 / `parentId` / `refIds` / `groupId`
  都有「仅服务端缺失时取本地」，provenance 没有。异步路径的回写是 fire-and-forget，
  `run.finished` 的整表刷新完全可能赶在它前面（成功标准 7）。
- **`prefill` 只经 `parseGenPrefill` 消费**（`GenerateForm.tsx:121`），它按 `GEN_FIELDS` 白名单挑键，
  未声明的键（`name` / `output_path` / `source_urls`…）**一概不收** —— 所以原样落库的 koubou 专属字段无害，
  不需要在写侧或读侧剔除。
- **引用不从 `prefill` 还原**：`genForm.sourceId` 是独立字段。而 agent 卡的源卡血缘那一轮已经落库成
  `asset.parentId` —— 成功标准 6 由它满足，**不需要任何 url→item_id 映射**。
- `AssetInspector.tsx` 的模型那一格是 `<dd>{parsed.model}</dd>`，裸值。

## 契约事实（已核实）

pgc `docs/api/agent.md:52`：**「各参数块字段与画布生成一致（见 canvas.md 的生成接口速查），包括同一套模型白名单与
provider 参数校验。差异：源/参考素材以 URL 传入」**。所以 koubou 入参与前端请求体只差两处：模型别名、源素材口径。

koubou 的模型别名（`app/claude/tools/media.py:91`，提交给 pgc 前由它自己翻译，前端只看得到别名侧）：

| koubou 别名 | PGC model id |
|---|---|
| `gpt-image` | `gpt-image-2` |
| `gemini-flash-image` | `gemini-3.1-flash-image` |
| `seedance` | `dreamina-seedance-2-0-260128` |
| `seedance-fast` | `dreamina-seedance-2-0-fast-260128` |

3D 无别名（`model_version` 原样直传，与前端同名同值）；audio 无模型参数。

## 方案

### 1. 数据模型：加一个判别器

```ts
// store/types.ts
export interface AssetProvenance {
  kind: 'image' | 'video' | 'audio' | '3d';
  req: Record<string, unknown>;   // 原样落库:前端发起=PGC 请求体;agent=koubou 工具入参
  at: string;
  agent?: true;                    // 口径判别器(约束 4);缺省=前端口径
}
```

判别器用**显式字段**而不是嗅探键名（「有 `source_urls` 就是 agent」之类）——嗅探会在
koubou 或 pgc 任一侧改字段时静默错判，而判别器错了会红。

`agent` 为 `true` 时 `at` 是**导入 / 提交登记时刻**，不是产物生成时刻（⚠️ 2026-08-09：后端 canvas item
现已有 `created_at`，但那是**建卡时间**、口径不同，见 `specs/2026-08-08-canvas-time-dimension.md`；
前端只能自记；两者差几秒到几十秒）。这一点与前端自发起路径一致，不额外标注。

### 2. 读侧归一：一个纯函数，一处映射

`src/lib/agent-provenance.ts`（新）：

```ts
// koubou 工具入参 → 前端请求体口径。前端自发起的 provenance 原样返回(恒等)。
export function provenanceReq(prov: AssetProvenance): Record<string, unknown>
```

`agent !== true` → 直接返回 `prov.req`。
`agent === true` → 仅翻译模型别名（表在本文件，四条）；**认不出的别名原样保留**（约束 5）。
其余键一概不动 —— 未知键由 `parseGenPrefill` 的白名单吃掉（现状要点）。

两个读者都经它，别名表只此一处：

| 读者 | 改法 |
|---|---|
| `AssetInspector`（展示） | `parseGenPrefill(prov.kind, provenanceReq(prov))` |
| `store.openRetryForm`（预填） | `prefill: provenanceReq(asset.provenance)` |

### 3. 展示：模型 id → 选择器里的名称

`gen-models.ts` 加 `modelLabel(kind, value)`：查 `GEN_MODELS[kind]` 取 label，**查不到原样返回该值**。
`AssetInspector` 那一格改用它。这一条同时修好前端自发起卡的裸 id 显示（成功标准 3）。

### 4. 「再生成」对 agent 卡改走预填表单

`store.retryGeneration`：`asset.provenance?.agent` 为真 → 转 `openRetryForm(assetId)` 并返回，
不 `discardFailedCard`、不 `runRetry`（决策 2 —— 映射有损的地方要让用户看见，别默默花钱）。

`store.openRetryForm` 补引用还原（成功标准 6）：父卡存在**且为 image** 时带上 `sourceId: asset.parentId`。
限定 image 是因为 `sourceId` 在文本源下的语义是「把正文前置进 prompt」（`resolveTextRef`），
而 provenance 里的 prompt 是 agent 自己写的完整提示词，再前置一次会重复注入。
此条对前端自发起的失败卡同样生效 —— 它现在也丢了引用源，属同一处既有缺失。

> ⚠️ **本节已被后续修正**（见 `2026-08-06-retry-lineage-and-no-discard.md`）：「文本父卡不还原」只对
> agent 卡成立。前端自发起的卡的 `req.prompt` 是 `promptPrefix` **之前**的原文，必须带回文本源才能
> 重现那次请求 —— 两条相反的规则已分开，判定搬进 `lib/gen-retry.ts` 的 `retryLineage`。

### 5. 写侧：两条落点各挂一次

`lib/agent-provenance.ts` 再出一个写侧纯函数：

```ts
// 按 pgc 任务 id 回溯该次生成的工具入参,原样包成 provenance。
// 与 lineageForTask 同一次定位(同一个 part),找不到 / 无 input → undefined
export function agentProvenance(messages, taskId, kind, at): AssetProvenance | undefined
```

- `importGeneratedAsset`：`reference` 里加 `provenance`（与 `source_filename` / `parent_id` 并列），
  同时挂到 `set` 进 `assets` 的那份 Asset 上。
- `registerAgentGenTask`：算血缘的同一处算 provenance，**挂到占位卡上**（同失败路径 `actions.ts:597` 的做法），
  由 `adoptAgentItem` 携带到真实卡。

### 6. 三处「别被冲掉」的防线

| 位置 | 改法 | 不改的后果 |
|---|---|---|
| `provenanceOf`（`map.ts:39`） | 重建时带上 `...(p.agent === true ? { agent: true } : {})` | 判别器每次读回被吃掉 → agent 卡按前端口径解析 → 模型显示别名 |
| `preserveFrontendOwned`（`map.ts:146`） | `if (!ref.provenance && local.provenance) next.provenance = local.provenance` | 整表刷新赶在回写前 → provenance 消失（同时修好前端自发起路径的同一竞态） |
| `adoptAgentItem`（`actions.ts:521`） | 携带 `provenance`，且回写条件由 `if (lineage.parentId)` 放宽到「有血缘**或**有 provenance」 | 纯文生的 agent video/3d 卡 provenance 只在内存 |

## 明确不做

- **image 的 `transparent`**（决策 3）：前端 `GEN_FIELDS.image` 没有它，本轮不接（归 A 类另开一轮）。
  代价见「已知丢失」——这是本轮最大的一处有损，且 agent 用得很频繁。
- **rig3d / retexture 的 provenance**：koubou 有 `submit_rig3d_generation` / `submit_retexture_generation`，
  但 `AssetProvenance.kind` 只有四类，且这两类在前端是独立弹窗流程（`Derived3DForm`），
  预填与再生成语义都不同。单独一轮。
- **koubou 自建的 text 节点**（`create_canvas_text`）：那张卡不经前端导入，前端管不到（同血缘轮）。
- **回溯补历史 agent 卡**：见约束 7。
- **url → item_id 映射**：无消费者（引用不从 `prefill` 还原，源卡靠已落库的 `parentId`）。
  按「不留 dead code」不建。
- **面板标注「由 agent 生成」**：`asset.source` 与「来源」那一格已经在了，不叠第二处。
- **`sprite` 类**：Nick 明确不做精灵图。

## 已知丢失（映射不全的清单，逐类核对过）

四类的 prompt 与绝大多数参数都进得来。丢的是这些：

| 类型 | 丢失字段 | 影响 |
|---|---|---|
| image | `transparent` | **面板看不出这张图是透明底生成的；预填表单也丢它 → 再生成出来的图不透明**，与原图明显不同（决策 3 的代价） |
| 3d | `style` | 面板不显示、预填丢失；`GEN_FIELDS['3d']` 无此字段 |
| audio | `emo` | 同上（值是 dict，现有控件表达不了） |
| 四类 | `name` / `output_path` | koubou 专属（产物落点），前端无对应概念，本就不该还原 |
| image | `n` | koubou 工具入参无此字段（它恒发 1），预填按表单默认 1 |

**已在后续修掉的一处**（评审暴露，见 `2026-08-06-retry-lineage-and-no-discard.md`）：本轮曾把
「文本父卡不还原引用源」当成对所有卡通用的规则 —— 那对 agent 卡对、对前端自发起的卡**错**：
前端卡的 `provenance.req.prompt` 是 `promptPrefix` **之前**的原文，不带文本源就重现不出那次请求。
两条相反的规则已分开并搬进 `lib/gen-retry.ts` 的 `retryLineage`（store 不该认识 koubou 的字段名）。

另一处**已知偏差**（不是丢失，是显示了实际无效的值）：agent 在默认 Gemini 下若显式传 `quality`，
pgc 会静默忽略并在 `ignored_params` 回显，但面板会照实显示 `quality` —— 因为 `parseGenPrefill`
不看 `GEN_FIELDS` 的 `models` 限定。前端自发起的卡不会出现这个组合（UI 按模型隐藏了该字段）。
`ignored_params` 本身前端全仓未读（A 类另有一条），本轮不处理。

## 真机验收（2026-08-06，dev :3011 打 pgc dev，项目 1055 Star Whisper-v54）

**验收前基线**：画布 4 张卡全是历史 agent 导入卡，`provenance` 均为空 —— 与约束 7「不回溯补历史卡」一致。

| 标准 | 结果 | 证据 |
|---|---|---|
| 1 落库（同步 image） | ✅ | 让 agent 真生成一张图（`用 gemini 生成一张图:像素风的小飞船图标,透明背景`），新卡 `url-bcf2c3d099bf` 的 `provenance.req` 与该次 `mcp__media__submit_image_generation` 的 `input` **逐字段相同**：`prompt` / `name: pixel_spaceship_icon` / `model: gemini-flash-image` / `transparent: true` / `size: 1024x1024`，`agent: true` |
| 1 刷新后仍在 | ✅ | `page.reload()` 后 `provenance` 完好（`agent: true`、别名未变）。**`assets` 不进 persist**（只持久化会话/去重表等），故这份溯源是从 PGC `reference` 往返回来的 —— 这正是本轮的全部价值 |
| 2 面板显示 | ✅ | 面板渲染出 `PROMPT` 全文 + `MODEL & PARAMETERS`（`Model` / `Size`）+ `SOURCE: Generated` + `Regenerate with same settings`，与前端卡同一套渲染 |
| 3 模型显示名称 | ✅ | 面板显示 **`Gemini 3.1 Flash Image`**（不是裸 id、不是 koubou 别名 `gemini-flash-image`）|
| 5 再生成走预填表单 | ✅ | 点「Regenerate with same settings」→ 表单打开、`prefill.model` 已是 `gemini-3.1-flash-image`（别名翻译生效）、prompt 预填、卡片一张没丢；期间发出的 POST **只有 `generate/estimate`**（零副作用估价），**没有 `generate/image`** —— 没花钱 |
| 6 引用还原 | ✅（空态） | 这张是纯文生卡（无父卡）→ `genForm.sourceId` 为 null，引用格为空，符合「源卡不在画布上时为空」|
| 1 落库（异步 3d） | ✅（占位阶段已确认） | agent 生成 3D：占位卡 `pending_bO8LhK8R` 即带 `provenance`（`agent: true`，入参含 `name/prompt/style/texture/pbr/smart_low_poly/face_limit`），`genTasks` 登记 `gtask-5fcf94…`。产物 adopt 后的落库见下「未验完」|

**已知丢失真机复现**：该次 agent 图的入参含 `transparent: true`，面板**不显示**它 —— 与「已知丢失」清单一致（`GEN_FIELDS.image` 无此字段，决策 3 本轮不接）。3D 那次入参含 `style`，同属清单内。

**顺带确认**：上一轮的报价功能在预填表单里同样工作（派生表单显示 `54 credits`）。

### 未验到 / 未验完（如实记录）

- **异步路径 adopt 后的落库**：**未验到**（不是通过，也不是失败）。本次 3D 生成（Tripo，`gtask-5fcf9405…`）
  上游停在 `status: generating` / `progress: 0` 约 20 分钟后转 `failed`，**从未产出 item**，因此 adopt 那条分支
  一次都没走到。期间前端的 10 分钟超时兜底（`actions.ts:104` 的 `DEADLINE_MS`）已把该任务摘出轮询队列，
  而占位卡此前已被 `run.finished` 触发的 `loadCanvas` 整表替换抹掉 —— 最终画布上什么都没留下，
  这一次消耗约 4.9K credit（867.5K → 862.6K）。
  已确认的只是**占位阶段**：占位卡即带 `provenance`（`agent: true`，入参含 `name/prompt/style/texture/pbr/smart_low_poly/face_limit`）、`GenTask` 已登记。
  adopt 后的携带与回写由 4 条单测覆盖（含「loadCanvas 抢先 + 纯文生仍须回写」，评审已变异验证会红）。
  > 顺带实证了 A 类清单里的 `DEADLINE_MS 10→35min`：慢于 10 分钟的 3D 生成会被前端放弃，
  > 用户付了钱、画布上却什么都没有。与本轮改动无关，属独立一项。
- **成功标准 4（未知别名原样显示）**：需要 koubou 发一个映射表里没有的模型别名，真机无法制造。由单测覆盖。
- **成功标准 7（整表刷新赶在回写之前）**：竞态窗口极短，真机无法稳定触发。由 `map.test.ts` 的「服务端缺失时取本地」覆盖。
