# 坐标批量落库：一次 PATCH 取代 N 个 PATCH + 前端限流层退役

> 状态：设计稿 · 2026-08-05
> 后端契约：`pgc-server` `docs/api/canvas.md` 的 `PATCH /api/projects/{project_id}/canvas/items`（批量更新）
> 取代：`2026-08-04-canvas-persist-reliability.md` 的约束 4（并发上限 6）与其「明确不做 · 批量坐标端点」一条

## 目的

上一轮做「坐标回写不再静默」时后端**没有**批量端点，前端只能用限流层顶住：
一次拖 32 张卡 / 整理上百张卡 = 上百个逐条 `PATCH /canvas/items/{item_id}`，
撞浏览器同域 HTTP/1.1 的 6 连接上限，把画布自己的轮询与预览图挤在后面。
于是有了 `createLimiter(6)` 共享闸门 + 同坐标在飞合并 + 逐条退避重试 + 失败聚合 Toast 四层机制。

后端现在给了批量端点（字段集与单条 PATCH 完全同构，单次 ≤500 条，每条独立 SAVEPOINT，
部分失败逐条回报而非整批 4xx）。**限流层的存在理由消失了**：

- 整理 120 张卡：120 个请求 → **1 个**请求。
- 闸门这层整段退役（`createLimiter` + `src/lib/concurrency.ts` 一并删除，不留 dead code）。
- 逐条退避重试塌缩成「整批瞬时错误才重试」。

这是一次**净删代码**的重构：外部可观测行为（坐标不回滚、失败聚合成一条 Toast、
同坐标不重复写）全部保持，实现从四层减到两层。

## 约束

1. **一次批量请求 = 一次 `PATCH /canvas/items`**，body `{ items: [{ item_id, reference, canvas_x, canvas_y }] }`。
   单次上限 500 条（后端超限**整批 422**，是用法错误不是数据问题）→ 前端按 500 分片。
2. **逐项失败一律不重试**：`failed[]` 里的每条都是服务端已裁决的结果（`CANVAS_ITEM_NOT_FOUND` /
   `CANVAS_GROUP_NOT_FOUND` / `CANVAS_TEXT_FIELD_INVALID` / `CANVAS_ITEM_UPDATE_FAILED`），
   重试打不通的东西只是把失败延后。**只有整批瞬时错误**（`NETWORK` / `TIMEOUT` / 5xx）走
   `retryAsync(POSITION_RETRY_DELAYS)` —— 坐标是幂等写，整批重发（含已成功项）无副作用。
3. **失败仍不回滚前端坐标**，仍聚合成一条 Toast（沿用 `notePositionFailure`）。
   `failed.length` 一次性计入计数器，**不是**一条一个 Toast。
4. **保留「同坐标在飞合并」**：批量化不解决这个问题——拖停时 ReactFlow 仍会连打两次回调，
   只是从「32 个重复请求」变成「2 个整批请求」。去重发生在**建 body 之前**（逐项过滤），
   整批被过滤空则不发请求。
5. **坐标同时写 `reference.position` 与顶层 `canvas_x` / `canvas_y`**，
   **所有**坐标回写路径一律如此（含 `adoptAgentItem` 的单卡回写 —— 它也走批量端点，单条一批）。
   读取口径不变（`reference.position` 优先、`canvas_x/canvas_y` 兜底，见 `map.ts:75`），
   但两套并存且只写一套是雷：分组框与批量端点都用顶层字段，服务端将来按坐标做事
   （删框的空间计算、按区域查询）就会读到旧值。**同写零成本，且不需要任何迁移**。
   顶层字段是 int → 取整再传（沿用既有 `Math.round`，见 `actions.ts:933` 等四处先例）。
6. **占位卡不回写**：`pending_` 前缀无后端 item，回写必 404（沿用既有过滤）。
7. **`await` 后校验项目上下文**：批量请求返回后若 `currentProjectId` 已变，丢弃结果不发 Toast
   （沿用仓库既有不变式）。
8. 纯逻辑（分片、body 构造）下沉 `lib/` 可单测；IO 留 action。

## 成功标准

1. 拖一个 32 张卡的选区 → 在飞请求 **1 个**（此前峰值 6、共 32 个）。
2. 一键整理 120 张卡 → **1 个**请求。
3. 501 张卡 → **2 个**请求，各 ≤500 条。
4. 整批断网 → 重试 2 次（共 3 个请求），坐标不回滚，出**一条** Toast。
5. 整批 4xx（如 422 用法错误）→ 不重试（1 个请求），出一条 Toast。
6. `failed[]` 里有 3 条 → 一条 Toast、count 为 3；`updated` 那些不计入。
7. 同一张卡、同一坐标的重复回写只进一次 body；坐标真变了的第二次照发。
8. 整批被在飞合并过滤空 → **不发**请求。
9. `placeAndLink`（创建落位）也走批量：一次生成 4 张图 → 坐标回写 **1 个**请求（此前 4 个）。
10. body 每项同时带 `reference.position` 与取整后的 `canvas_x` / `canvas_y`。
11. 请求返回时项目已切换 → 不发 Toast。

## 方案

| 文件 | 改动 |
|---|---|
| `src/lib/pgc/types.ts` | 加 `CanvasBatchUpdateItem`（`item_id` + 单条 PATCH 字段集）/ `CanvasBatchUpdateRequest` / `CanvasBatchUpdateFailure` / `CanvasBatchUpdateData` |
| `src/lib/pgc/client.ts` | 加 `batchUpdateCanvasItems(pid, items)` → `PATCH /api/projects/{pid}/canvas/items` |
| `src/lib/canvas-batch.ts`（新） | 纯函数：`positionBatchItem(asset)`（Asset → 一条 body 项，含 reference + 取整坐标）、`chunk(items, size)` |
| `src/store/actions.ts` | `persistAssetPositions` 重写为「过滤 → 建 body → 分片 → 每片一次批量请求」；删 `persistAssetPosition`、删 `positionGate`、删 `POSITION_WRITE_CONCURRENCY`；`placeAndLink` 第四条路径收编 |
| `src/lib/concurrency.ts` + 其单测 | **删除**（唯一调用方是退役的闸门） |
| `src/store/types.ts` | `ServerActions` 去掉 `persistAssetPosition` |

### `persistAssetPositions` 的新形状

```
ids → 去 pending_ → 查 asset → 同坐标在飞过滤 → items[]
    → 空则 return
    → chunk(500) → 每片 retryAsync(batchUpdateCanvasItems)
    → 整批抛错 ⇒ notePositionFailure(该片条数)
    → 返回 failed[] ⇒ notePositionFailure(failed.length)
    → finally 清在飞标记
```

`notePositionFailure` 从「一次 +1」改成「一次 +n」（签名加参数，默认 1）。

### 为什么删掉 `persistAssetPosition`（单条）

生产侧**已无调用方**：`AssetCanvas.tsx:685,755` 与 `store/index.ts:728` 三处都调复数版，
`tidyCanvas` 内部也是。它只剩单测在用 —— 那正是仓库反模式里「为测试而留的生产代码」。
测试改调 `persistAssetPositions([id])`，行为等价。

## 明确不做

- **`CANVAS_ITEM_NOT_FOUND` 时把卡从 store 摘掉**。诱人但越界：位置回写是个后台动作，
  让它顺手删用户眼前的卡，与「删除延迟窗口」等既有机制存在竞态，且这不是本轮要的行为变更。
  本轮所有逐项失败一视同仁计入聚合 Toast（与现状一致）。真实失败率有了再单独立项。
- **坐标口径迁移**（读取改以 `canvas_x/canvas_y` 为准、`reference.position` 退役）。
  约束 5 的「同写」已经消掉两套发散的风险，迁移本身是独立一轮的事，且要等分组落地后一起看。
- **批量端点的其余字段**（`name` / `group_id` / `content` / `text_format`）。
  端点字段集同构，但本轮只把坐标这条路径搬过来；重命名仍走单条 PATCH（一次一张，无批量压力）。
  `group_id` 等分组功能立项时再用。
- **分片并发限流**。分片数 = `ceil(n/500)`，要打出 7 个并发请求需要单次移动 3000+ 张卡；
  真到那个量级画布本身先垮。分片走 `Promise.all`，不再引入闸门。

## 真机验收（2026-08-05，dev :3011，pgc dev 环境，项目 Star Whisper-v82 / id 1044，33 张卡）

手法沿用 `2026-08-04-canvas-persist-reliability.md` 末尾那套：包 `window.fetch` **只**拦坐标那条
（collection 级 `PATCH /canvas/items`，其余请求照常）、`window.__store` 读写状态、
合成鼠标事件驱动真实 ReactFlow 拖拽。一处更正：**必须用 `MouseEvent` 而非 `PointerEvent`**
——RF 的 d3-drag 收 `mousedown`，合成 PointerEvent 完全不触发拖拽（首次尝试 0 请求，白跑一轮）。

已验：

1. **⌘A 全选 33 张卡后拖动** → 在飞请求 **1 个**，body **33 条**，33 个不同 id、**0 重复**，峰值 1。
   （此前同一操作是 32 个请求、峰值 6。）
2. **一键整理** → **1 个**请求、body **32 条**（一张原地未动不进 `moved`，与 `tidyCanvas` 的
   「只回写真正变位的卡」一致）。
3. **整批断网** → 请求 **3 个**（初次 + 200ms + 600ms 退避），33 张卡坐标**全部停在用户放的地方
   不回滚**，页面上**一条** Toast：`Couldn't save the position of 33 card(s)`，`params.count === 33`。
   ——这条同时是评审 I2 的真机对照：计数口径是**条数**（33）而非「失败一次」。
4. **逐项失败**（200 信封里 `failed[]` 3 条）→ 请求 **1 个**（**不重试**，符合约束 2），
   一条 Toast、`count === 3`。
5. **分片边界，直打真实端点**：500 条 → `200 {updated:0, failed:[500 条 CANVAS_ITEM_NOT_FOUND]}`；
   **501 条 → 整批 `422 VALIDATION_ERROR`**。契约与文档逐字一致，也正是必须前端分片的原因。
   （用不存在的 `item_id`，服务端只在 `failed[]` 回报，不写任何库。）
6. **前端分片** 501 条 → **2 个**请求、**500 + 1**，恰好避开上面那条 422。
   跨分片的失败聚合成**一条** Toast（`count === 4` = 片 1 的 3 条 + 片 2 的 1 条），
   顺带验到聚合是跨分片的、不是每片一条。
7. **约束 5 端到端**：把 33 张卡回写后 `GET /canvas/items` 核对 —— 33/33 **同时**有
   `reference.position` 与顶层 `canvas_x/canvas_y`，且两者**逐条一致（0 处不符）**。
   改动前只写 `reference` 那套，顶层列会留旧值/空值。
8. **收尾还原**：全部 33 张卡坐标还原到验收前基线（前端 in-memory 比对 **0 处不一致**），
   一次批量写回报 `updated: 33, failed: []`，刷新页面重载后抽查 3 张与基线逐字相符。

未验到的：

- **`await` 后项目切换丢弃过期响应**（成功标准 11）：真机要精确在批量请求在飞期间切项目，
  时序不可靠；由单测覆盖，且已做变异验证（删掉 pid 守卫该用例变红）。
- **`placeAndLink` 的 4 张图创建落位走 1 个请求**（成功标准 9）：要真花积分跑一次 4 张图生成，
  本轮按计划没做；由单测覆盖（断言 `batchUpdateCanvasItems` 1 次、`updateCanvasReference` 0 次）。

顺手核到的、下一轮要用的事实：

- **估价端点已上线，请求体确认是扁平**（F1 定论）：
  `POST .../generate/estimate {"type":"image","prompt":"test","n":2,"model":"gpt-image-2"}`
  → `200 {type:"image", credits:8, credits_min:null, credits_max:null, currency:"credit",
  model_id:"gpt-image-2", billable:true}`。**不是**嵌套形态。
- **分组 flag 在 dev 是关的**：`GET /canvas/groups` → `503 CANVAS_GROUPS_DISABLED`，
  且 `GET /canvas/items` 的 `groups` 为 **`null`**（≠ `[]`）——与文档「关闭时 null、开启但空时 []」一致。
  分组功能立项前要先让 pgc 在 dev 开 `pgc-canvas-groups`。
- `CanvasItemData` 确实已下发 `created_at`（如 `2026-08-03T07:39:05.576789Z`）与 `thumbnail_url` 键。
