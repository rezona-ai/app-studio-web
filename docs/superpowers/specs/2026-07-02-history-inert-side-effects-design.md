# 历史消息副作用惰性化设计（资产生成事件 + 问答卡片）

> 日期：2026-07-02　状态：设计稿（已定稿）

## 一、背景与问题

三处副作用驱动当前都**扫 `messages`** 触发动作：

| 驱动 | 位置 | 副作用 |
|---|---|---|
| 图片/音频自动导入 | `src/client/useCanvasAutoImport.ts` | 调 `/canvas/items/import` 往画布落卡 |
| 视频/3D 异步任务 | `src/client/useAgentGenTasks.ts` | 落 generating 占位卡 + 登记轮询 |
| 问答/审批卡 | `src/koubou/apply-koubou.ts` `upsertPending` → `ChatPanel` | 弹出待处理交互卡 |

`messages` 混合了「本连接实时 WS 帧」与「非实时加载的历史」（localStorage 快照恢复、`/events?limit=xxx` REST 分页）。前两个驱动扫全量 `messages`，历史无论怎么恢复都会被当新事件重放：画布重复卡、重复导入/轮询请求。

## 二、根因

**历史其实只有两个非实时来源**：① localStorage 快照（`switchProjectSession`）；② `/events` 分页（`seedKoubouHistory` / `prependHistory`）。二者都**不是 WS 事件**。

- **资产**：`useCanvasAutoImport` / `useAgentGenTasks` 扫全量 `messages`，对上述两个历史来源同样触发。现有「预填 `importedByProject`」补丁是 per-browser 的 localStorage 记忆，换设备/清缓存即失效 → 换新环境必重放。
- **问答**：问答卡**本来就只在 WS 事件（`applyKoubou`）里创建**——`rebuild`（快照/REST 恢复）不建卡；`pendingInteractions` 不在 persist 白名单、`koubouByProject` 快照也不含它；且后端**确认重连时不重放** `ask_user_question.requested` 帧。三者合起来：重载后 pending 恒为空，只由 `onReady` 的后端权威 `pending_interactions`（不含已答）+ 实时 `requested` 帧填充 —— **问答已天然惰性**，无历史重放路径。

## 三、原则（用户定）

> **只有本 WS 连接实时新到的帧才触发副作用；历史无论从 localStorage 还是 REST 恢复，都不走 WS 事件路径，天然惰性。**

## 四、设计

### ① 资产：把触发从「扫 messages」搬进 WS `onEvent`

- 在 `useKoubouConnection` 的 `onEvent` 里：当实时 WS `claude.message`（`sdk_type==='UserMessage'`）帧携带 `tool_result` 且解析出 ready media（图/音）/ submitted task（视频/3D）时，才调 `importGeneratedAsset` / `registerAgentGenTask`。
- 新增纯函数 `eventAssets(e): { media: ReadyMedia[]; tasks: SubmittedTask[] }`（`src/lib/media-import.ts`），复用 `toolResultText` / `parseMediaItems` / `parseSubmittedTask` / `basename` / `mediaKindToAssetKind`；跳过 `is_error` 结果、跳过 video/3D 的 media（走 task）、跳过无 path 项。
- **删除** `useCanvasAutoImport.ts` / `useAgentGenTasks.ts`（及测试、`Workspace` 挂载）；`onEvent` 触发与「删 hook」同一提交完成，避免双导入窗口。
- **删除** `src/store/index.ts` 里 `ingestKoubou`(session.ready) 与 `seedKoubouHistory` 的「预填 `importedByProject`」两段及 `collectReadyMedia` 导入；`media-import.ts` 删去随之变死的 `collectReadyMedia` / `pendingImports`（及其测试）。
- **保留**：`onEvent` 内维持**串行导入链**（下一条能读到上一条已落库坐标，级联落位正确，原 hook 即串行）；`importGeneratedAsset`（内部 `importedByProject` 去重）/ `registerAgentGenTask`（内部 `agentTasksByProject` + `genTasks` 去重）作为兜底防重。

为什么覆盖新设备/换设备：来源 ①② 根本不进 `onEvent`；来源 ③（WS）里，`session.ready.visible_state` 是**单个 session.ready 事件**内的历史重建（不触发，因只在 `claude.message` 帧上触发），后端又不重放历史帧、且 REST 种子化把续传游标设为 latest。故只有真正实时的 `claude.message` 帧会触发——与浏览器本地记忆无关。画布真实卡始终由 `run.finished→loadCanvas()` 以 PGC 为准显示，`onEvent` 导入只负责实时生成的乐观落卡，惰性化不丢资产。

### ② 问答：`onReady` 以后端为权威（小加固）

- 问答已天然惰性（见根因），无需 `seenSequences` 之类的重放去重。
- 唯一小加固：`onReady` 把 `pending_interactions` 从「merge」改为「整体替换」（先清后设）。纯正确性提升：万一内存里残留一张后端已不认为 pending 的卡（如别 tab 处理过 / 超时），重连能清掉。不新增机制、不依赖持久化。

## 五、数据流（改后）

```
localStorage 快照 / REST /events 分页 → 重建 messages(历史) → 不触发任何副作用(不走 onEvent)
实时 WS claude.message(tool_result,带 media/task) → onEvent → eventAssets → importGeneratedAsset / registerAgentGenTask
实时 WS ask_user_question.requested / session.ready.pending_interactions → applyKoubou/onReady → 问答卡
run.finished(succeeded) → loadCanvas/loadVersions 以 PGC 为准兜底画布
```

## 六、影响面与边界

- **串行顺序**：`onEvent` 维持一条 per-连接的 promise 链，多条 media 顺序导入（保级联落位）。
- **在途视频/3D 任务**：由 `genTasksByProject` + `restoreGenTasks` 独立恢复轮询，与本改造无关。
- **去重降级**：`importedByProject` / `agentTasksByProject` 不再承担「挡历史」，仅作实时会话内/重连兜底防重（保留原逻辑，不动）。
- **问答**：`onReady` 改替换后，重连中正在作答的挂起卡仍在后端快照里 → 保留；已 resolve 的不在 → 清除。无回归。

## 七、测试（TDD，同目录 `*.test.ts(x)`）

- `src/lib/media-import.test.ts`：新增 `eventAssets` 用例——UserMessage tool_result 带 `media.tasks.status`(ready image) → 返回 media；带 `media.task_submitted`(video) → 返回 task；`is_error` 结果 → 跳过；非 `claude.message`/非 UserMessage → 空。删除 `collectReadyMedia` / `pendingImports` 相关用例。
- `src/client/useKoubouConnection` 触发：在 `onEvent` 上验证实时 media/task 帧触发 `importGeneratedAsset` / `registerAgentGenTask`（若 `useKoubouConnection` 直测成本高，则以 `eventAssets` 纯函数覆盖解析、以一条轻量集成用例覆盖「onEvent 收到帧→调 action」）。
- `src/koubou/apply-koubou.test.ts`：`onReady` 用 `pending_interactions` 整体替换（预置旧 pending，ready 后应被清；空 `pending_interactions` 清空所有）。
- 删除 `src/client/useCanvasAutoImport.test.tsx` / `useAgentGenTasks.test.tsx`（hook 删除）；改写 `src/store/koubou-seed.test.ts`（不再断言预填，改断言不预填）。

## 八、非目标 / 已否决备选

- **historyMsgCount 边界 + switchProjectSession 回填 + seenSequences seed**：上一版设计为覆盖「重放」而引入；因后端确认**不重放** requested 帧、且 onEvent 驱动天然不看历史来源，**全部不需要**，本版删去。
- 不改 Koubou/PGC 协议与后端。
- 不给每条消息加 `live` 标记（onEvent 源头分流已足够）。
