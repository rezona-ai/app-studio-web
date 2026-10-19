# Agent 资产生成事件 v2 适配 Design

## 背景

后端 `koubou-agent-py` 的 WebSocket 事件文档（`docs/websocket-events.md`）调整了 agent 在对话里生成资产的协议：**移除了原先的单发 `media.generated` 事件**。media 工具结果不再一步到位，而是两阶段，都以 `text` content block 嵌在 `claude.message` 里（文本是 JSON，需 `JSON.parse`，注意 SDK 会丢弃 `structuredContent`，只有 text block 的 JSON 到达前端）：

1. `submit_*_generation` 工具 → 结果 `media.task_submitted`：仅任务提交回执，**不含资产**。
   ```json
   { "type": "media.task_submitted", "kind": "image", "task_id": "gtask-...", "status": "pending", "next_tool": "mcp__media__check_generation_tasks" }
   ```
2. `check_generation_tasks` 工具 → 结果 `media.tasks.status`：状态快照，`items` **可含多条**，`status === "ready"` 才是就绪资产。
   ```json
   { "type": "media.tasks.status", "items": [
     { "task_id": "gtask-...", "kind": "image", "status": "ready", "progress": 100,
       "asset_path": "current/src/assets/slime.png", "preview_url": "https://.../slime.png" }
   ] }
   ```

关键差异 vs. 旧 `media.generated`：
- 字段 `path` → **`asset_path`**；`preview_url` 保留（`preview_base` 未配置时可能缺省）。
- 单对象 → **数组**（一次 check 可返回多条任务）。
- 新增中间态字段 `status`（`pending`/`running`/`ready`/`failed`）、`progress`、`task_id`。
- 失败：提交/查询本身的网关错误以 `is_error` tool_result 返回；**pgc 任务级失败**作为 `media.tasks.status` 里的 `failed` item 返回（非 `is_error`）。

## 目标

1. 协议层认新事件、丢弃 `media.generated`，把 media 工具结果归一为内部 `MediaItem[]`。
2. 对话工具卡只呈现**已就绪资产的预览**（与旧 `media.generated` 行为对齐）。
3. 就绪资产仍自动导入画布、历史就绪资产仍预填去重表——**下游链路零改动**。

> **修订（2026-06-17，实测后定稿）**：初版曾加「生成态反馈」（提交中/进度%/失败），实测发现 agent **不保证**把 `media.tasks.status` 的就绪/进度状态发回聊天——一次生成里聊天往往只有 `media.task_submitted` 这一条，资产是在 `run.finished(succeeded)` 后由前端 `loadCanvas()` 从 PGC 拉到画布的（见 `useKoubouConnection.ts`）。因此聊天里的中间态卡会永远停在「已提交」无法更新。结论：**去掉生成态反馈**，聊天只渲染确实拿到的就绪预览，生成完成与否以画布为准。

## 归一模型

```ts
// protocol.ts
export interface MediaItem {
  kind: string;              // image / video / audio / model3d
  path: string;              // asset_path 归一(相对 workspace 的 pgc 资产路径)
  previewUrl: string | null; // 可浏览预览直链(preview_base 已配置时)
}

// 返回 null = 不是 media 结果(交给通用文本渲染);
// 返回数组(可空)= 是 media 结果,仅含已就绪(status==='ready')资产。
export function parseMediaItems(text: string): MediaItem[] | null;
```

设计要点：
- **`null` vs. 数组**区分「非 media 结果」与「media 结果」。`media.task_submitted` 与未就绪的 `media.tasks.status` 都返回**空数组**（仍是 media 结果），使 ToolCard 据此**抑制原始 JSON 文本**（`media` 为数组时 truthy，沿用既有 `!part.media && part.result` 收敛逻辑），提交/进行中的卡片只显示工具名,不渲染就绪态前不存在的内容。
- 解析时即在协议层**只挑 `status==='ready'` 且有 `asset_path` 的 item**，故 `MediaItem` 不带 status/progress/error——避免为已删除的生成态 UI 留下死字段。
- **只取契约约定字段**（`asset_path`/`preview_url`），不加 camelCase 别名兜底。

## 数据流与边界

```
claude.message(UserMessage.tool_result text JSON)
   → parseMediaItems          [protocol.ts]            ← 改：认新事件
   → foldResults: part.media   [apply-koubou.ts]        ← 改：MediaItem[]
   → ToolCard 逐项渲染就绪预览                            ← 改：数组(仅就绪)
   → collectReadyMedia: 遍历 media → ReadyMedia[]        [media-import.ts] ← 改：遍历数组、读 asset_path
        ├─ useCanvasAutoImport → importGeneratedAsset   [不变]
        └─ store ingestKoubou 预填 importedByProject     [不变]
```

`collectReadyMedia` 输出契约 `ReadyMedia { filename, kind, previewUrl }` **保持不变**，因此 `store/index.ts`、`store/actions.ts`、`useCanvasAutoImport` 全部无需改动。

**不在范围内**：画布 `GenerateForm` 的视频/3D 异步生成（走 PGC REST + `useCanvasPolling`/`GenTask`）与 agent 对话 media 无关——agent 侧的轮询由后端自己调 `check_generation_tasks` 完成，前端不轮询。

## UI 行为（仅就绪预览）

工具卡内 `part.media`（仅含就绪项）逐项渲染（始终可见，不受折叠态影响）：

| 条件 | 呈现 |
| --- | --- |
| 就绪 + `previewUrl`，kind=image | `<img>` |
| 就绪 + `previewUrl`，kind=video | `<video controls>` |
| 就绪 + `previewUrl`，kind=audio | `<audio controls>` |
| 就绪 + 无 `previewUrl`，或 kind=3d/model3d | 不渲染（资产以画布为准） |

提交/进行中的工具卡（`media.task_submitted` 或未就绪 `media.tasks.status`）`media` 为空数组：只显示工具名，不显示原始 JSON，也不显示任何中间态文案。生成完成与否以右侧画布为准（`run.finished` 后 `loadCanvas`）。

## 容错

- 非 JSON / 非对象 / 未知 `type` → `parseMediaItems` 返回 `null` → 通用文本渲染（不误判为 media）。
- `media.tasks.status.items` 缺省或非数组 → 视作空数组（仍是 media 结果）。
- ready item 缺 `asset_path` → 解析时直接丢弃（无法 basename / 命名）。
- ready item 有 `asset_path` 但无 `preview_url` → 进入 `MediaItem`，但聊天不渲染预览、`importGeneratedAsset` 也因无 `source_url` 跳过（不记去重、可重试）。
