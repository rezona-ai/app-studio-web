# agent 产物的血缘归因：从工具入参认源，纯前端

> 状态：设计稿 · 2026-08-04
> 分支：`feat/agent-asset-lineage`
> 关联：`2026-08-04-mention-item-id.md`（让 koubou 带 item_id 回来的跨仓方案）——**本方案取代它**作为血缘的实现路径，
> 那条分支挂着不合（它剩下的价值只是「agent 能按 id 指名卡片」，不是血缘的前置条件）。

## 目的

**agent 在对话里做图生图 / 图生 3D 时，产物落到画布上是一张孤立卡，没有连回它实际引用的源卡。**

现状：

- 用户自己在画布上发起的派生生成**早就有血缘**：`GenPlacement { sourceItemId, refItemIds }` →
  `placeTarget` 走 `childPosition` 落在父卡右侧、`placeAndLink` 写 `parentId` / `refIds` / `source:'derived'`
  并回写 `reference`（`src/store/actions.ts:390-421`）。
- agent 产物这条路**明确留空**：`registerAgentGenTask` 里写着
  `addGenPlaceholders(assetKind, 1, { origin: 'agent' });  // 无 source_item_id 不连线`（`actions.ts:1210`），
  同步产物的 `importGeneratedAsset` 也只写 `reference.source_filename`（`actions.ts:912`）。
- 于是「照 @这张图做个 3D」的产物与源图在画布上毫无关系，用户看不出派生关系。

**归因信息前端已经握在手里**，不需要任何后端改动：`apply-koubou.ts:452` 在完整 `AssistantMessage`
落定时把 `tool_use.input` 存进 tool part，而 agent 调生成工具时填的正是源 **url**
（`source_urls` / `source_url` / `last_frame_url` / `ref_image_urls` / `ref_video_urls`）。
这些 url 要么就是我们自己在 mention token 里发出去的，要么是 agent 前一步产物的 pgc preview url
（那张卡也已自动导入画布）——都能按 `preview.src` 精确 match 回画布卡。

**归因来自 agent 实际提交的入参，不是「记住上一轮 @过什么」的猜测**：不会连出假血缘（用户 @图只是让 agent
参考风格描述、实际提交纯文生图 → 无源 url → 不连线），也不会漏连（agent 拿自己上一步产物作源 → 那张卡在画布上 → 连上）。

## 约束

1. **零后端改动、零跨仓依赖**：只读已有的 `tool_use.input` 与 `media.tasks.status`，不新增协议字段。
2. **归因是纯函数**：url 抽取与 match 下沉 `src/lib/` 单测；副作用（落卡 / 回写 reference）留在 store。
3. **复用既有落位与连线机制**：走 `GenPlacement` + `placeTarget`/`placeAndLink`，
   **不新造** parentId 写入路径、不新造落位算法。归因到源卡 → `childPosition` 父卡右侧树形
   （与用户自发起派生完全一致）；无源 → 保持现状「视口中心 + 避让」。
4. **多源语义沿用既有字段**：首个匹配 → `reference.parent_id`（主源，决定落位），其余 → `ref_item_ids`
   （`map.ts:16-18` 已有的口径，`assetReference` 已会吐回）。
5. **宁可少连不错连**：url match 不到任何画布卡 → 不连线、按现状落位。不做模糊猜测（不按"上一轮 @过谁"兜底）。
6. **首版只做 url 归因**：绑骨 `submit_rig3d_generation` / 重纹理 `submit_retexture_generation` 的源是
   `source_task_id`（pgc `gtask-*`），要连线得额外维护持久的 taskId → item_id 映射（GenTask 完成即移除），
   **不做**，保持现状。
7. **不回溯已有孤立卡**：只对本次新导入 / 新登记的任务生效。历史卡不批量补连（去重表挡着也不会重导）。
8. **`await` 后校验上下文**：沿用既有 `if (get().currentProjectId !== pid) return;` 口径。

## 成功标准

1. 对话里让 agent「照 @这张图生成一张新图」→ 新卡落在源卡右侧，画布上有连线，
   `reference.parent_id` = 源卡 item_id（刷新后连线仍在）。
2. 图生 3D（`source_url`）、视频首帧（`source_url`）、视频参考图（`ref_image_urls`）同样连上。
3. 多源（`source_urls` 两张以上）→ 首个进 `parent_id`（落位以它为父），其余进 `ref_item_ids`，
   画布上多条连线。
4. 纯文生图（无源 url）→ **不连线**，落位与现在一字不差。
5. agent 拿自己上一步产物作源 → 连到那张卡（链式血缘）。
6. 源 url match 不到画布卡（外部 url / 卡已删）→ 不连线，不报错、不阻断导入。
7. 异步视频 / 3D：**占位卡出现时就已落在父卡右侧并连线**（不是等产物回来才跳位）。
8. 刷新后重连种子化历史 → 不重复导入（`importedByProject` 去重照旧），不产生重复连线。
9. 切项目 / `await` 期间切项目 → 不把连线写到另一个项目的卡上。
10. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` 全绿。

## 方案

### 标识链

```
submit_image_generation(tool_use id=toolu_x, input.source_urls=[urlA,urlB])
        │ 结果 media.task_submitted { task_id: gtask-y }   ← foldResults 挂回同一个 tool part
        ▼
tool part { id: toolu_x, input: {...source_urls}, result/submittedTask 带 gtask-y }
        │
check_generation_tasks → media.tasks.status { items:[{ task_id: gtask-y, status:'ready', asset_path, preview_url }] }
        ▼
importGeneratedAsset（同步产物）/ registerAgentGenTask（异步 video/3D）
```

**配对键是 `task_id`**，而 `input` 与提交回执已经被 `foldResults` 折叠在**同一个 tool part** 上
（`apply-koubou.ts:487` 把结果原文存进 `part.result`，`types.ts:61`）——所以归因是对 `messages`
的**纯函数**：按 taskId 找到那个 part（从 `part.result` 认 `media.task_submitted.task_id`），
读它的 `input`。既不用在事件解析层多传 `tool_use_id`，也不用改 `apply-koubou`。

### 改动

| 文件 | 职责 |
|---|---|
| `src/lib/gen-lineage.ts`（新） | `sourceUrlsFromInput(input)` 按字段名白名单抽 url；`matchAssetsByUrl(urls, assets)` → `{ sourceItemId?, refItemIds? }`；`lineageForTask(messages, taskId, assets)` 串起两者 |
| `src/koubou/protocol.ts` | `MediaItem` 加 `taskId?`（`media.tasks.status` 的 `task_id`，现在被丢掉）；新增 `parseSubmittedTaskId(text)` 取**任意 kind** 的 task_id（`parseSubmittedTaskPayload` 只放行 video/3D，那是 GenTask 登记门槛，语义不动） |
| `src/lib/media-import.ts` | `ReadyMedia` 透传 `taskId` |
| `src/store/actions.ts` | `importGeneratedAsset`：有 taskId → `lineageForTask` → 落位走 `placeTarget({sourceItemId})`、reference 带 `parent_id`/`ref_item_ids`；`registerAgentGenTask`：同样解析后把 `GenPlacement` 交给 `addGenPlaceholders`（占位卡即连线，成功标准 7） |

url match 口径：先按 `resolveAssetUrl` 归一后**全等** match `preview.src`；不中再按 **basename 唯一命中**兜底
（同名多卡则视为歧义、不连）。归一是必须的：mention token 里发的是绝对 url，而 `preview.src` 也已归一过。

### 为什么不是「记住上一轮 @过的 item_id」

那个做法零成本但归因是猜的，四种情况会错：多引用 × 多产物无从配对、用户 @图但 agent 实际走纯文生图（假血缘）、
agent 用自己产物或 workspace 文件作源（漏连）、异步任务跨轮完成时"上一轮"的窗口对不上。
读 `tool_use.input` 同样是纯前端，但归因是**事实**而非猜测，成本只多一个纯函数。

## 明确不做

- **绑骨 / 重纹理的血缘**：见约束 6。
- **koubou 侧任何改动**：本方案不需要；`feat/mention-item-id` 分支与其 handoff 暂缓。
- **回溯补连历史孤立卡**：见约束 7。
- **koubou 自建的 text 节点（`create_canvas_text`）血缘**：那张卡不经前端导入，前端管不到。
- **按语义/时间的模糊归因兜底**：见约束 5。
