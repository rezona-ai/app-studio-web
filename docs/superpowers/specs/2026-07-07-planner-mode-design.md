# Planner 模式（任务清单悬浮卡）设计稿

- 日期：2026-07-07
- 工作项：Meegle 13295481「planner模式」
- 后端契约：koubou-agent-py `docs/websocket-events.md` §任务清单（TaskCreate / TaskUpdate / TaskList / TaskGet）
- 设计稿：Figma `TALUNA-DEVELOPER-SITE` node `2841:62478`（深色稿，卡片 308×175）

## 背景与目标

agent 用任务清单工具（`TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`，取代旧 `TodoWrite`）跟踪多步骤工作。当前前端把这些调用当普通 tool_use 渲染成零散 ToolCard，用户看不到聚合的计划与进度。

目标：在 Chat 面板 Composer 上方固定悬浮一张**可折叠的任务清单卡**，随 WS 事件实时更新任务状态，形态对齐 Claude Code CLI 的 todo 面板范式（清单常驻输入框附近，工具调用本体在消息流中折叠为极简形态）。

## 后端契约要点（只依赖这些）

- **没有整单快照型独立事件**：清单变更以普通 `tool_use` content block 出现在 `claude.message` 里，前端按 run/session 累积维护清单状态。
- **ID 与状态机只从 `tool_use_result` 取**（`UserMessage` payload 顶层，与文件 diff 同通道）。但 result 不含文案新值：`TaskCreate` 结果只有 `{id, subject}`（无 activeForm/description），`TaskUpdate` 结果只有字段名 `updatedFields` 与 `statusChange`。**文案字段（subject / description / activeForm）从已落定的 `AssistantMessage` 的 `tool_use.input` 补齐**——落定消息的 input 是完整 JSON（不解析流式 `input_json_delta` 半截增量），但保留模型写错的原始键，需做别名兜底（`active_form → activeForm`、`id`/`task_id → taskId`）。
- `tool_use_result` 形状：

| 工具 | 形状 |
| --- | --- |
| `TaskCreate` | `{"task": {"id": "1", "subject": "..."}}` |
| `TaskUpdate` | `{"success": true, "taskId": "1", "updatedFields": [...], "statusChange": {"from": "...", "to": "..."}}` |
| `TaskList` | `{"tasks": [{"id", "subject", "status", "blockedBy"}, ...]}` —— 全量快照，用于整单校正 |
| `TaskGet` | `{"task": {"id", "subject", "description", "status", "blocks", "blockedBy"}}` |

- 任务 ID 是按创建顺序从 1 递增的字符串；`TaskUpdate` 用结果里的 `statusChange.from/to` 驱动状态机（比入参可靠）。
- `status`：`pending` / `in_progress` / `completed` / `deleted`；**`deleted` 表示删除**，前端应把该项从清单移除。
- `activeForm`（现在进行时文案）在 in_progress 态优先展示，缺省回退 `subject`。
- `owner` / `addBlocks` / `addBlockedBy` / `metadata` 是多 agent 协作字段：解析时容忍存在，不当异常，不渲染。
- 不要与 `TaskStartedMessage` / `TaskProgressMessage` / `TaskNotificationMessage` 混淆——那是后台任务生命周期事件，与任务清单无关。

## 数据层

### 类型与解析（`src/koubou/protocol.ts`）

```ts
type PlanTaskStatus = 'pending' | 'in_progress' | 'completed';
interface PlanTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: PlanTaskStatus;
}
```

新增两个纯函数，与 `parseFileDiff` 同风格、同测试策略：

- `parseTaskResult(toolName, toolUseResult)`：归一四种工具的 `tool_use_result` 为判别 union（`create` / `update` / `snapshot` / `get`），畸形输入返回 `null`。
- `parseTaskInput(toolName, input)`：从落定的 `tool_use.input` 提取文案字段 `{subject?, description?, activeForm?, taskId?}`，做别名兜底（`active_form → activeForm`、`id`/`task_id → taskId`），畸形输入返回 `null`。

### reducer（`src/koubou/apply-koubou.ts`）

`KoubouState` 新增 `tasks: readonly PlanTask[]`。`UserMessage` 分支在现有 `parseFileDiff` 同一位置调 `parseTaskResult`；`tool_use_result` 归属哪个工具由 `foldResults` 现有的 `tool_use_id → tool_use part` 匹配取得工具名。

状态机（result 驱动 ID/状态，input 补文案）：

- `create` → 追加 `{id, subject, status: 'pending'}`；`description` / `activeForm` 从同一 `tool_use` part 的落定 input（`parseTaskInput`）补齐。
- `update` → 按 `taskId` 应用 `statusChange.to`；`updatedFields` 中出现的文案字段（`subject` / `description` / `activeForm`）取对应 input 的新值；`to === 'deleted'` → 从数组移除；`taskId` 不存在时忽略（容错，不抛）。
- `snapshot`（TaskList）→ 整单替换，顺序按后端 `tasks[]`；已有项的 `activeForm` / `description`（快照不含）按 id 保留合并。
- `get` → 按 `task.id` 合并补齐字段（不改变顺序）。

持久化与恢复：`tasks` 随会话快照与 `messages` 同检查点持久化（只在 `sequence != null` 时落盘）；冷启动 `rebuildHistory` 重放事件日志自然重建；`switchProjectSession` 随快照整体切换。不做多 run 历史清单回看，`tasks` 恒为当前会话最新清单。

## UI（`src/components/chat/PlanCard.tsx`）

挂载：`ChatPanel` 内、Composer 上方，absolute 悬浮不占流；`tasks.length > 0` 才渲染；进出场 `.anim-collapse-in` / `useExitTransition`。

### 设计稿对照（Figma node `2841:62478`）

| 设计稿节点 | 精确值 | 实现映射 |
| --- | --- | --- |
| 卡片容器 | `rounded-20px`，bg `Surface/03 #2c2c2e`，border `Stroke/01 #454545`，`px-8 py-12` | `rounded-[20px]` + `bg-[var(--color-pop)]` + `border border-[var(--color-line)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]`（语义令牌双主题适配；mock 为深色稿） |
| 标题 "Task list" | Inter Bold 15px，white 85%，与列表间距 16px | `text-[15px] font-bold text-[var(--color-ink)]` |
| 任务行文本 | IBM Plex Mono 12px，white 90%，行距 16px，图标↔文本间距 16px | `font-[var(--font-mono)] text-[12px] text-[var(--color-ink)]`；completed 行转 `--color-muted` + 删除线 |
| check-circle（completed） | 14px，描边 `tln/signal #14b8a6` | SVG 登记 `figAsset` 走 `FigIcon`，颜色映射 `--color-teal`（项目规则：进度/高亮一律品牌青，不引入第二种青） |
| spinner（非 completed） | 16px 弧形 | 不用导出 PNG：in_progress 复用项目现有 teal spinner（动画）；pending 同形静态弧、muted 色不转动（mock 未区分两态，按语义补） |

### 已拍板的 mock 未覆盖项

1. **宽度**：对齐 Composer 宽度（同 SkillPopover「宽度对齐输入框」范式），非 mock 固定 308px。
2. **折叠**：标题行右侧加 chevron，点击标题行折叠为仅标题一行；设计稿补充折叠态后再对齐。
3. **进度计数**：折叠态标题后带 mono 小计数（如 `2/4`）；展开态严格按 mock 不加。
4. **圆角**：按设计稿 20px（项目既有档位 16/24 之外的设计稿明确值）。

### 行为

- 任务行：状态图标 + 文本；in_progress 行显示 `activeForm`（缺省回退 `subject`）。
- 列表限高约 40vh，内部 `.scrollbar-auto` 滚动。
- 折叠状态 `planCollapsed` 为 UIState（进 store、**不持久化**，默认展开）。
- run 结束后清单保留显示；下次 run 的 TaskCreate/TaskList 自然覆盖重建。
- 消息流中 Task 类工具调用**不隐藏**，渲染为折叠的极简 pill（复用 `toolPill` 语汇，如「Updated plan」，不展开入参）——对齐 Claude Code：transcript 时序完整，主呈现在悬浮卡。
- 降低动态：spinner 动画进 `prefers-reduced-motion: reduce` 禁用列表。
- 无障碍：折叠按钮带 `aria-label`；清单容器 `aria-live="polite"`。

## 明确不做（临时版边界）

- 不渲染 `blockedBy` / `owner` / `metadata`（解析容忍、不展示）。
- 不做点击任务滚动定位、不做吸附。
- 不做多 run 历史清单回看。
- 折叠态视觉是临时方案，等设计稿补充后对齐。

## 测试

- `protocol.test`：`parseTaskResult` 四种形状 + 畸形输入（缺字段 / 非对象 / 未知工具名）返回 null；`parseTaskInput` 别名兜底（`active_form` / `task_id`）与畸形输入。
- `apply-koubou.test`：create（含 input 补 activeForm）→ update(in_progress) → update(deleted) → TaskList 校正（保留 activeForm 合并）的序列测试；`tasks` 随快照持久化 / 恢复；未知 taskId 的 update 不抛。
- `PlanCard.test`：空清单不渲染；折叠/展开；进度计数；activeForm 回退 subject；completed 样式。

## 资产

- check-circle SVG → `public/figma/icons/` 并登记 `figAsset`。
- Figma 导出的 spinner PNG 不使用，删除。
