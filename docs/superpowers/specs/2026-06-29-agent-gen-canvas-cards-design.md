# Agent 生成资产：画布加载卡 + 复用轮询 Design

## 背景与问题

agent 在对话里生成资产走两阶段（见 `2026-06-17-agent-media-events-v2-design.md`）：

1. `submit_*_generation` 工具 → 结果 `media.task_submitted`（仅提交回执，**含 `task_id` / `kind`，不含资产**）：
   ```json
   { "type": "media.task_submitted", "kind": "video", "task_id": "gtask-...", "status": "pending", "next_tool": "..." }
   ```
2. `check_generation_tasks` 工具 → 结果 `media.tasks.status`（就绪态快照）。

当前前端**只在拿到就绪资产时**才有动作：`media.tasks.status` 里 `status==='ready'` 的 item 经 `useCanvasAutoImport` 自动导入画布；或在 `run.finished(succeeded)` 后由 `loadCanvas()` 从 PGC 拉取（`useKoubouConnection.ts:75`）。

**问题**：video/3d 生成耗时（分钟级），从「agent 提交任务」到「资产出现在画布」之间，画布上**没有任何反馈**——既没有加载卡，也无从感知进度。旧 spec 当初刻意去掉了「聊天里的生成态卡」（因为 agent 不保证把就绪状态发回聊天，聊天卡会永远停在「已提交」）。但**画布**这条路径有现成的、健壮的异步生成机制可复用，只是当前没接上 agent 触发源。

## 目标

agent 提交 video/3d 生成任务时（`media.task_submitted`），**立刻在画布落一张 `generating` 加载卡**，并用其 `task_id` **复用现有 `GenTask` / `pollGenTasks` 轮询**推进到 ready/失败，使 agent 生成资产与「用户点击生成」的异步流（`startAsyncGen`）体验一致。

## 关键事实（决定方案）

- **gtask 即 PGC 画布生成任务 id**（已与产品确认）：可直接喂给现有 `pollVideo`/`pollModel3d`（`GET /api/projects/{pid}/canvas/items/generate/{video|model3d}/{taskId}`），返回 `CanvasGenTask { task_id, status, item, failure }`。
- **agent 的 video/3d 生成会在 PGC 建出真实 canvas item**：`pollVideo` 返回的 `CanvasGenTask.item` 即它，`item_id` 是稳定身份。
- **`loadCanvas()` 在 `run.finished(succeeded)` 后触发**，且**整表替换** `assets`（`actions.ts:101`，按 `item_id` 经 `canvasItemsToAssets` 重建）。
- 现有 PGC 轮询端点**只有 video/3d**（按类型分），image/audio 同步生成、**无 poll 端点**。

→ 只要画布卡片**从一开始就用真实 `item_id` 作身份**，`loadCanvas` 的整表替换就按同 id 天然去重，与 `startAsyncGen` 流完全同构。

## 范围

- **仅 video/3d**。image/audio 继续走现有 `useCanvasAutoImport`（快、无 poll 端点）。
- 不改 agent 侧后端协议；不动聊天里的工具卡渲染（聊天仍按 v2 spec 只渲就绪预览，本设计只影响画布）。

## 数据流

```
claude.message(UserMessage.tool_result, submit_*_generation 的 media.task_submitted)
  → parseSubmittedTask(text)              [protocol.ts]   新增:取 {taskId, kind},仅放行 video/3d
  → foldResults 挂到 tool Part.submittedTask [apply-koubou.ts] 新增字段,纯函数不碰画布
  → useAgentGenTasks hook 扫描 messages    [client/]       新增:发现未处理 task → 调 action
  → registerAgentGenTask(taskId, kind)     [store/actions.ts] 新增:落加载卡 + 首拉 item + 登记 GenTask
  → useCanvasPolling + pollGenTasks         [既有]          零改动复用:推进 ready/失败兜底
```

## 协议层改动（`src/koubou/protocol.ts`）

新增纯函数（与 `parseMediaItems` 并列，互不影响）：

```ts
export interface SubmittedTask { taskId: string; kind: 'video' | 'model3d'; }

// 从 media.task_submitted 取 video/3d 的提交任务;非 task_submitted / 非 video|3d → null
export function parseSubmittedTask(text: string): SubmittedTask | null;
```

- 只认 `type === 'media.task_submitted'` 且 `kind` ∈ {`video`, `3d`/`model3d`}，归一 kind 到 `'video' | 'model3d'`（对齐 `GenTask.kind`）。
- 缺 `task_id` → null。其余类型（image/audio）→ null（交给既有 auto-import）。
- **只取契约约定字段**（`type`/`kind`/`task_id`），不加 camelCase 兜底（沿用反模式约束）。

## apply-koubou 改动（`src/koubou/apply-koubou.ts` + `store/types.ts`）

- `Part`（tool 分支）新增可选字段 `submittedTask?: SubmittedTask`。
- `foldResults` 回填 tool_result 时，对非 error 结果解析一次：`submittedTask: parseSubmittedTask(text) ?? undefined`（与现有 `media: parseMediaItems(text)` 同处）。
- `apply-koubou` 仍是纯函数、只维护 `KoubouState`（聊天切片），**不触碰画布 / ServerState**——画布动作由下游 hook + action 驱动，维持分层。

## 落卡与轮询（`src/store/actions.ts` 新增 `registerAgentGenTask`）

复用既有骨架（`addGenPlaceholder` / `settleGenPlaceholder` / `startAsyncGen` / `commitGenTasks`）：

1. **触发去重**（最先）：`taskId` 已在持久化 `agentTasksByProject[pid]` → 直接返回。
2. 落 `generating` 占位卡：`addGenPlaceholder(kind)`，落位用**视口中心 + `avoidOverlap`**（镜像 `importGeneratedAsset`；`media.task_submitted` 无 `source_item_id`，故**不连线**）。
3. 首拉一次 `pollVideo/pollModel3d(pid, taskId)` 取 `task.item`：
   - 拿到 item → **upsert 成真实 `item_id` 卡**：若该 `item_id` 已存在（`loadCanvas` 抢先拉上来的竞态），原位更新并删除占位卡；否则 `settleGenPlaceholder` 原位替换（保留占位卡当前坐标）。fire-and-forget 回写 `reference`（位置），`commitGenTasks` 登记 `GenTask { itemId: item_id, kind, taskId }`。
   - 任务级已失败（`FAILED_TASK_STATUSES` / item `error`）→ 走 `failGenTask`（删卡 + Toast + 清服务端残留），复用既有逻辑。
   - poll 成功但**暂无 item**（提交瞬间上游未就绪）→ 保留占位卡，登记 `GenTask { itemId: <占位卡 id>, kind, taskId }`；由 `pollGenTasks` 后续轮次首次拿到 item 时**适配真实 item_id**（见下）。
4. **首拉 RPC 成功返回后**（上述三分支：拿到 item / 任务失败 / 暂无 item，都属 RPC 成功）把 `taskId` 记入 `agentTasksByProject[pid]`（持久化，跨重渲/重连/历史重建去重）。**首拉 RPC 抛错（网络/PgcError）不记**——见容错，允许后续重试。
5. `await` 后均校验 `currentProjectId === pid`，过期响应丢弃（沿用既有约定）。

### `pollGenTasks` 的一处增量（适配「占位卡 → 真实 item」）

现有 `pollGenTasks` 假设 `t.itemId` 恒为真实 item_id（用户流如此）。新增的「首拉暂无 item」边缘场景里 `t.itemId` 可能是占位卡 id。增量：当某轮 poll 首次拿到 `task.item` 且 `t.itemId` 为 `pending_` 占位卡 → 用 `settleGenPlaceholder` 替换、并把该 `GenTask.itemId` 更新为真实 item_id（之后回到既有「原位更新」路径）。用户流 `t.itemId` 永不以 `pending_` 开头，分支不触发，**行为不变**。

> 取舍：也可在 `registerAgentGenTask` 里对「暂无 item」轮询重试到拿到 item 为止，但那会复制 `pollGenTasks` 的兜底逻辑。把适配点收敛进 `pollGenTasks` 单一轮询入口更内聚。

## 去重（三道，全部复用既有范式）

1. **触发去重** — 持久化 `agentTasksByProject: Record<string, string[]>`（镜像 `importedByProject` 语义，记已处理 `taskId`）。防 re-render / 重连重放 / 历史重建重复登记同一任务。切项目按既有约定保留各项目分桶；删项目清桶（对齐 `genTasksByProject` 的删除处理）。
2. **身份去重** — 画布卡用真实 `item_id` 作 id ⇒ `run.finished` 后 `loadCanvas` 整表替换按同 id 天然合并，不产生重复卡。`registerAgentGenTask` 首拉落卡走 **upsert-by-item_id**（非 `settleGenPlaceholder` 的盲目 append）：若 `loadCanvas` 已把同 `item_id` 拉上来，则原位更新并删占位卡，而非重复 add——吸收「loadCanvas 先到、首拉后到」竞态。
3. **路径分流** — `media-import.ts` 的 `collectReadyMedia` 收窄为**仅 image/audio**（`mediaKindToAssetKind` 结果为 video/3d 的 item 跳过）。video/3d 交本轮 task 路径独占，杜绝 `useCanvasAutoImport` 再走 from-url import 造第二张卡。

## 持久化与重连

- `agentTasksByProject` 入 persist 白名单（与 `genTasksByProject` / `importedByProject` 并列）。
- 刷新 / 重连后：`GenTask` 已由既有 `genTasksByProject` + `restoreGenTasks` 重连轮询（卡片用真实 item_id，`restoreGenTasks` 按 `assets` 中仍 `generating` 的 item 恢复任务），**无需新增恢复逻辑**。
- `agentTasksByProject` 仅作触发去重：刷新后 `media.task_submitted` 仍在历史里，若不持久化会被重新处理。持久化它，确保「已处理过的任务不再重复落卡」。
- 边缘:若「首拉暂无 item」窗口内刷新,本地占位卡(未持久化)与其 `GenTask{itemId: pending_}` 会丢失,`restoreGenTasks` 因无匹配 generating 资产而剪除该任务,且 `agentTasksByProject` 已记 taskId 故不再重新落卡——该资产最终仍由 `run.finished(succeeded) → loadCanvas` 拉上画布,仅这段窗口内没有中间加载卡。此为可接受取舍(gtask 即 PGC 任务 id,item 通常提交即建,该窗口极短)。

## 容错（沿用既有约定）

- `parseSubmittedTask`：非 JSON / 非对象 / 非 task_submitted / 非 video|3d / 缺 task_id → null（不误判）。
- 首拉 `pollVideo/pollModel3d` 网络失败：`registerAgentGenTask` 在 `guard` 内，PgcError → Toast；占位卡按失败移除（`removeGenPlaceholder`）。但**仍记 `taskId` 入去重集**？→ **否**：首拉失败不记，允许后续重渲重试（对齐 `importGeneratedAsset` 无 source_url 时「不记去重、可重试」的处理）。仅在成功登记 GenTask 后才记去重。
- 任务级失败 / 超时 / 连续 poll 失败：全部由既有 `failGenTask` / `pollGenTasks` 兜底，零新增。

## 不变式（必须维持）

- **位置归前端所有**：占位卡落位即定，`pollGenTasks` / `loadCanvas` 不覆盖已落位坐标；靠 fire-and-forget 回写 `reference` 让 `loadCanvas` 读回前端坐标。
- **`messages` 恒属于 `currentProjectId`**：切项目同一次 `set` 清会话态（既有 `selectProject`）；新 hook 与 action 内 `await` 后校验 pid。
- **唯一落库入口**：画布变更只经 store action；hook 只检测 + 派发，不直接改 store。

## 测试（TDD，同目录 `*.test.ts(x)`）

- `protocol.test.ts`：`parseSubmittedTask` — video/3d 提交→`{taskId,kind}`；image/audio→null；非 task_submitted→null；缺 task_id→null；malformed→null。
- `apply-koubou.test.ts`：submit 工具结果 → tool Part 带 `submittedTask`；非 media 结果不带。
- `media-import.test.ts`：`collectReadyMedia` 收窄后跳过 video/3d ready item、仍收 image/audio。
- `actions.test.ts`：`registerAgentGenTask` — 落占位卡 → 首拉 item → settle 成真实 item_id 卡 + 登记 GenTask；重复 taskId 跳过；首拉失败移除占位卡且不记去重；首拉暂无 item → 占位卡 + GenTask，后续 `pollGenTasks` 适配 item_id。

## 不在范围内

- image/audio 的画布加载卡（无 poll 端点；继续 auto-import）。
- 聊天里的生成态/进度卡（v2 spec 已定论去掉，本设计不回潮）。
- 进度百分比展示（`CanvasGenTask.progress` 暂不消费，与现有 video/3d 用户流一致仅转圈）。
