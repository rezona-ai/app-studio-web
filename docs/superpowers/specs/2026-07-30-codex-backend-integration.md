# Codex backend 接入设计稿

- 日期：2026-07-30
- 上游契约：`koubou-agent-py` `docs/frontend/codex-backend-integration.md`、`docs/websocket-events.md`、`docs/http-api.md`、`docs/realtime-history-design.md`
- 相关既有设计稿：`2026-07-23-model-per-project.md`（模型记忆）、`2026-07-23-run-rest-tracking.md`（run REST 跟跑）、`2026-07-24-refresh-recovery-state-design.md`（刷新恢复）

## 目的

后端已上线第二个 agent backend `codex`（Codex app-server），与既有 `cc`（Claude Agent SDK）共用会话 / 输入 / 审批 / run 生命周期 / 历史回放基础设施，但 **agent 消息事件不同**（`codex.message` vs `claude.message`）、skill 调用串不同（`$name` vs `/name`）、模型列表不同。

本期目标：**把 codex 链路在前端完整打通并可验证**——一个开关切过去后，对话渲染、工具卡片、审批、历史恢复、断线重连、构建/版本刷新、资产落画布都工作，且不劣于 cc 会话的可用性。本期**不做**产品化的 backend 切换入口。

## 现状（已核实）

| 事实 | 位置 |
| --- | --- |
| backend 硬编码 `cc` | `src/lib/koubou/client.ts` 的 `?backend=cc`（models / skills）；`buildWsUrl` 不带 `backend` 参数（服务端缺省 `cc`） |
| skill 前缀硬编码 `/` | `src/lib/skills.ts`（`getActiveSlash` / `splitSkillTokens`）、`SkillPopover`、`Composer`；store 的 `skills: string[]` 只存 slug |
| 一项目一会话 | `koubouByProject[String(pid)]`，`resolveSession` 取后端最近一条会话，不区分 backend |
| 模型列表全局一份 | `useModelList` 拉一次 `?backend=cc` 写 `availableModels`；`?backend=cc` 的列表里已含 `gpt-5.6/5.5/5.4`、`grok-4.5`、`glm-5.2`（走 cc 多 provider），**与 codex 列表 ID 重叠** |
| dev 后端就绪 | `?backend=codex` → 默认 `gpt-5.5`，列表 `gpt-5.6 / gpt-5.5 / gpt-5.4 / grok-4.5`；skills 6 个，`invocation` 为 `$name` |
| 无 permission mode | 代码里无 `permission_mode` 任何引用 |
| build/checkpoint 未接 | `applyKoubou` 只处理 `build.failed`（转 error 气泡）；版本刷新靠 `run.finished(succeeded)` 后 `loadVersions` |
| 心跳已接 | `src/koubou/client.ts` 收 `server.heartbeat` 即回 `client.ping`；`classifyClose(4408)` 落 `retry`（符合文档「瞬时断线 + 标准重连」） |
| 计划卡由 Claude 任务工具驱动 | `apply-koubou.ts` 的 `applyTaskResults` ← `TaskCreate/TaskUpdate/TaskList/TaskGet` 的 `tool_use_result` |
| 资产自动落画布依赖 claude 形态 | `parseMediaItems` / `parseSubmittedTask` 读 `claude.message` 的 text block JSON；`importFromLiveEvent` 只认 `claude.message` |

## 约束

1. **backend 建会话时固定**，attach 不带 `backend`；换 backend 只能在项目下新建 session。
2. **codex 只在 run 空闲时切模型 / 权限模式**，活跃 run 期服务端返回 `run already active` 错误。
3. **codex 的可回放内容只有 `item/completed`**；plan / goal / usage / delta / `turn/completed` 全为瞬时态，断线窗口内必然丢失（可接受）。
4. **同一 `item.id` 的 live 增量与 `item/completed` 必须合并为一个 UI item**。
5. 沿用项目既有分层：协议层纯类型 + 纯函数 reducer、`store` 唯一落库入口、副作用只在 `client/` hooks；不得为 codex 另起一条绕过 store 的数据流。
6. 未知 `method` / 未知 `item.type` / 新增字段必须容错，不得中断 WS 消费循环。
7. 不引入硬编码色值 / 新按钮种类 / 一次性 keyframes（复用 `globals.css` 令牌与既有组件）。
8. 新增用户可见文案补齐 11 语（`en` 为单一真相源）。

## 决策（盘问共识）

| 议题 | 结论 |
| --- | --- |
| backend 入口 | **不暴露 UI**。`?agent=codex` / `?agent=cc` 查询参数切换并落 localStorage，每浏览器独立生效；不加构建期 env |
| 渲染深度 | `item/completed` 支持 `agentMessage` / `reasoning` / `commandExecution` / `fileChange` / `mcpToolCall` + 未知降级；live 只做 `agentMessage`、`reasoning` 文本增量 + `turn/plan/updated` → 现有 PlanCard |
| 会话归属 | 本地快照按 **项目 + backend** 分槽；`resolveSession` 改为「挑最近一条 backend 匹配的会话」 |
| UI 复用 | codex item **映射到现有 `Message` / `Part` 模型**（不新建 codex 专用视图组件）：`agentMessage`→text、`reasoning`→thinking、`commandExecution` / `fileChange` / `mcpToolCall`→tool part |
| MCP form 审批 | 识别为 form 类后**降级为仅可拒绝** + 「暂不支持此类请求」提示（避免「批准缺 content → 交互永久 pending」死挂） |
| 画布联动 | **对等打通**：media 结果解析抽成与 backend 无关的纯函数，codex 侧从 `mcpToolCall` 的 `item.result.structuredContent`（兼容 `content[].text`）提取，复用现有占位卡 / 轮询登记 |

### 明确不做（本期排除项）

- permission mode 选择器：只从 `session.ready.permission_mode` 读取并存入 store（供后续迭代与调试观测），**不做切换 UI**，不发 `session.set_permission_mode`。
- `thread/goal/*`、`thread/tokenUsage/updated`、`turn/diff/updated`、`item/commandExecution/outputDelta`、`item/fileChange/patchUpdated`、`item/mcpToolCall/progress`：不渲染（现 UI 无承载位置）。
- composer 的 video / audio / PDF / 3D 结构化 content block 输入扩展（现状仍按文本引用发送，两个 backend 同等待改，属独立需求）。
- 跨 backend 的会话列表 / 切换 UI；两个 backend 模型列表合并展示。
- `single` backend。

## 设计

### 1. backend 解析与开关

新增 `src/lib/agent-backend.ts`（纯逻辑 + 一处 localStorage 读写，独立于 zustand `persist`）：

```ts
export type AgentBackend = 'cc' | 'codex';
export const AGENT_BACKEND_KEY = 'taluna-agent-backend';
// ?agent=codex|cc 优先(并写回存储);否则读存储;否则 'cc'
export function resolveAgentBackend(search: string, read: () => string | null): AgentBackend
export function normalizeBackend(v: unknown): AgentBackend | null   // 校验词表,非法值当无
```

- **不进 `taluna-v4` persist 切片**：该 key 被 `src/app/layout.tsx` 的防白闪内联脚本硬编码引用，改其形状风险高；backend 开关是调试性开关，用独立 key 更清晰（与主题 `taluna-config` 同范式）。
- store 新增 `UIState.agentBackend`，初值 `'cc'`；`useAgentBackend`（新 hook，或并入 `useProjectBootstrap`）在挂载时解析一次写入 store。
- **backend 的最终权威是 `session.ready.backend`**：`onReady` 用它校正 `KoubouState.backend`；本地开关只决定「新建会话时用哪个 backend」以及「预选哪个渲染器」。

`KoubouState` 新增：

```ts
backend: AgentBackend;              // 当前会话的 backend(ready 校正;默认取开关值)
permissionMode: string | null;      // 只读观测,本期不给 UI
```

### 2. 建连与 attach

`buildWsUrl` 增加 `backend?: AgentBackend`：**仅新建会话（无 sessionId）时**拼 `backend=`，attach 不带（文档：会话沿用持久化的 backend 与 model）。`useKoubouConnection` 传入 `useStore.getState().agentBackend`。

`createKoubouClient` 透传 backend 参数；重连时 sessionId 已存在，天然走 attach 分支。

### 3. 会话分槽与 resolveSession

- 快照 key：`sessionSlotKey(pid, backend)` = `cc` → `String(pid)`（**保持现状，老快照零迁移**）；`codex` → `${pid}:codex`。
- 读写点：`switchProjectSession`、`useKoubouConnection` 的检查点持久化、`capPersistedSessions`（按 key 计数不变）。
- `resolveSession` 增加 backend 过滤：`listSessions` 返回的 `SessionSummary` 带 `backend`，只在匹配项里挑最近一条；无匹配 → 新建。
- `genTasksByProject` / `importedByProject` / `agentTasksByProject` / `viewportByProject` **仍按项目 key**（画布资产是项目级，跨会话共享）。

### 4. 模型与 skills 按 backend

- `koubouApi.listModels(backend)` / `listSkills(backend)`：拼 `?backend=`；skills 返回 `{ name, invocation }[]`。
- store `skills: SkillDef[]`（`{ name, invocation }`），`lib/skills.ts` 泛化：
  - `getActiveSkillToken(text, caret, prefixes)`：激活前缀由 skills 的 `invocation` 首字符集合决定（cc→`/`，codex→`$`）。
  - `splitSkillTokens(text, skills)`：按完整 `invocation` 串匹配，不再假定 `/`。
- `useModelList` / `useSkillList` 依赖 `agentBackend` 重新拉取；切 backend 时 `availableModels` 整体替换，`resolveSelectedModel` 回落到新列表内（避免把 `claude-opus-5` 带进 codex 会话 → 4400）。
- 模型记忆 `modelByProject` 同样按项目 + backend 分槽（否则切回 cc 会记住 codex 模型）。
- codex 下 `runStatus === 'running'` 时 ModelSelector 禁用（`Select` 加 `disabled`）。
- **偏离文档处**：文档要求「发送后保持旧值，收 `model.changed` 再提交 UI」。本期采用「乐观提交 + `model.changed` / `session.ready.model` 校正」，理由：running 期已禁用选择器，冲突窗口只剩「刚点完选择器同时 run 启动」的极窄竞态，而挂起态会让选择器出现「点了没反应」的观感倒退。reducer 消费 `model.changed` 做权威校正即可。

### 5. codex.message reducer

新增 `src/koubou/apply-codex.ts`（纯函数，`applyKoubou` 在 `case 'codex.message'` 分流；`claude.message` 仅当 `state.backend === 'cc'` 处理，反之亦然）。

协议类型进 `protocol.ts`：`CodexMessagePayload { method, payload, task_list? }`、`CodexItem`（`id` + `type` + 宽松字段）、`CodexTask`。

**method → 行为**

| method | 行为 |
| --- | --- |
| `item/completed` | 按 `item.type` 映射成一条 assistant `Message`（`id = item.id`）；已存在同 id（草稿或重放）则原位替换 |
| `item/started` | `agentMessage` / `reasoning` 建 `generating` 草稿（`id = item.id`）；其他类型建对应 tool part 卡（status `generating`） |
| `item/agentMessage/delta` | 按 `itemId` 追加 text |
| `item/reasoning/summaryTextDelta`、`item/reasoning/textDelta` | 按 `itemId` 追加 thinking |
| `turn/plan/updated` | `tasks` = `task_list.tasks` 映射为 `PlanTask`（优先 `task_list`，缺失时降级读 `payload.plan[]` 的 `step`/`status`，`inProgress`→`in_progress`） |
| `turn/started` / `turn/completed` / 其他已知瞬时 method | 无副作用（run 终态以 `run.finished` 为准） |
| 未知 method | 原样返回 state |

**item.type → Part 映射**

| item.type | 映射 |
| --- | --- |
| `agentMessage` | `{ type:'text', text: item.text }` |
| `reasoning` | `{ type:'thinking', text: summary 拼接 ?? item.text }`（字段缺失则丢弃该 item） |
| `commandExecution` | tool part：`name='Bash'`、`input={command,cwd}`、`result=aggregatedOutput`、`status` 由 item.status 归一（失败 → `error`，附 `exitCode`） |
| `fileChange` | `changes[]` **每项一个 tool part**：`name='Edit'`(kind=update)/`'Write'`(add)/`'Delete'`，`input={file_path}`，`diff` 由新增纯函数 `parseUnifiedDiff` 归一成既有 `FileDiff`（DiffView 直接复用） |
| `mcpToolCall` | tool part：`name = tool`（或 `server.tool`）、`input=arguments`、`result` = 结构化结果 JSON 文本；media 结果经统一解析挂 `media` / `submittedTask` |
| `webSearch` / `plan` / `dynamicToolCall` / `imageGeneration` / `imageView` | 通用 tool part（`name = item.type`，input 取原 item 去掉大字段） |
| 其他 / 未知 | 忽略（不成泡，保观测靠 devtools） |

**身份与合并**：`item.id` 即 `Message.id`（也即 tool part 的 `id`）。live 草稿与 completed 同 id → 原位替换，天然满足「合并为一个 UI item」。turn footer 锚点 `lastMessageId` 在每次新增/落定时 patch 当前 running 轮（与 claude 路径一致）。

`reasoning` 与后续 `agentMessage` 是两条独立 Message（分别渲染折叠推理块与正文）——不做跨 item 合并，`ThinkingBlock` 现有样式可独立成立。

### 6. 审批

- `ApprovalInteraction` 增 `method?: string`；`onReady` 的 `pending_interactions[].request.method` 一并带出。
- `ToolApprovalCard` 按 method 出标题文案：命令 / 文件修改 / 权限 / URL 授权 / 表单（4 个新 i18n key + 1 个降级提示，11 语）。
- form 类判定：`method === 'mcpServer/elicitation/request' && input.mode !== 'url'` → 只渲染「拒绝」+ 不支持提示；`tool.approval` 仍原样回传 `interaction_id`，`approved:false`。
- `tool.approval.resolved` / `pending_interactions.cancelled`：现状仅 `ask_user_question.answered` 会清 pending；补齐这两个事件按 `interaction_id` 幂等清 pending（cc 同样受益）。

### 7. 历史、重连、build/checkpoint

- 历史种子化 / 翻页 / gap 补偿（`seedHistory` / `prependHistory` / `backfillSessionGap`）全部复用，但 `rebuild()` 需要按 backend 分支重放 `codex.message`（与 live 同一映射函数，保证冷启动与 live 一致）。
- `checkpoint.created` → `loadVersions()` + `loadCanvas()`（幂等；与 `run.finished(succeeded)` 现有刷新并存，先到者生效）。
- `build.started` / `build.succeeded`：本期不出 UI（`build.failed` 维持现有 error 气泡）。
- `credit.insufficient`：现有分流（积分模态）不变，两个 backend 通用。

### 8. 资产落画布

把 media 结果解析从「claude text block」中解耦：

```
protocol.ts: parseMediaPayload(json: unknown): MediaItem[] | null      // 现 parseMediaItems 的 JSON 层
             parseSubmittedTaskPayload(json: unknown): SubmittedTask | null
```

- cc 路径：`text` → `JSON.parse` → 上述纯函数（行为不变）。
- codex 路径：`item.result.structuredContent` 优先，回退 `item.result.content[].text` 逐条 `JSON.parse`。
- `importFromLiveEvent` / `importMediaFromEvent` 增加 `codex.message` 分支，复用同一 `MediaItem[]` / `SubmittedTask` 出口，占位卡 / `GenTask` 登记 / 去重表全部复用。

## 成功标准

**功能（在 dev 后端真实 codex 会话上验证）**

1. `?agent=codex` 后：建连 URL 带 `backend=codex&model=<codex 模型>`，`session.ready.backend === 'codex'`。
2. 模型选择器只列 codex 模型；skill picker 插入 `$name`；发送后后端识别为原生 skill（`user.message` 回显保留 `$name`）。
3. 一次「做个小游戏」请求端到端：正文流式逐字 → 命令卡 / 文件修改卡（带 diff）→ 计划卡随 `turn/plan/updated` 推进 → `run.finished` 收口，footer 显示模型 + 耗时。
4. 刷新页面：历史（正文 / 工具卡 / diff / 审批 / build / checkpoint）从 REST events 恢复；进行中 run 显示运行中并能收到后续事件。
5. 审批：命令类可批准 / 拒绝并推进；form 类只出拒绝按钮且拒绝后弹窗消失。
6. `checkpoint.created` 后版本时间线出现新版本且预览可切。
7. agent 生成的图片进画布（占位卡 → 原位替换）。
8. `?agent=cc` 切回：仍连到原 cc 会话、渲染无变化（回归零倒退）。

**工程**

9. `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test` 全绿；新增纯逻辑（backend 解析、槽位 key、codex reducer、`parseUnifiedDiff`、skills 泛化、media 解析解耦）有单测且**先写失败测试**。
10. 未知 method / 未知 item.type / 缺字段 item 有明确的「不崩、不成泡」测试用例。
11. 新增文案 11 语齐全（含 `zh-TW` 不折叠）。

## 真实抓帧核对（2026-07-30，dev 后端 · gpt-5.6 会话）

一次真实回合（「先 ls current，再一句话概述工程结构」）抓到的上游帧，与文档对照结论：

| 观察 | 结论 |
| --- | --- |
| `item/agentMessage/delta` payload = `{ delta, itemId, threadId, turnId }` | 与实现一致（读 `delta` / `itemId`） |
| `agentMessage` item = `{ id, text, type }` | 与实现一致 |
| `commandExecution` item = `{ command, cwd, status, exitCode, aggregatedOutput, commandActions, durationMs, processId, source, id, type }` | 与实现一致；多出的字段被忽略 |
| `item/started` → `delta` → `item/completed` 三者 `item.id` / `itemId` **同值** | 「同 id 合并为一个 UI item」成立，草稿→落定就是原位替换 |
| **后端把用户自己的输入也作为 item 下发**：`item/completed` + `item.type='userMessage'`（带 sequence，文本在 `content[].text`） | 必须忽略 —— live 已有 Composer 乐观气泡、历史另有 `user.message` 信封重建，渲染它会出现**重复用户气泡**。已被「未知 item.type 静默忽略」天然覆盖，并补真实帧回归测试锁死 |
| 另见 `hook/started`、`hook/completed`、`thread/tokenUsage/updated`、`turn/started`、`turn/completed` | 均为瞬时通知，本期不呈现（无副作用） |
| **新建会话带非本 backend 的模型 → `error: invalid model` + 关闭码 4400**（直连 dev 后端复现） | `classifyClose(4400)='fatal'` **不重连**，页面会死在 fatal 且刷新复发（`selectedModel` 是持久化的）。故追加 `modelBackend`（记录 `availableModels`/`selectedModel` 所属 backend）：建连只带确属当前 backend 的模型，不确定就不带（服务端用该 backend 默认模型），跨 backend 也不再继承模型选择 |

## 风险

| 风险 | 应对 |
| --- | --- |
| ~~Codex item 实际字段与文档表格有偏差~~ | 已用真实帧核对（见上节），字段一致；实现仍保持「宽松读取 + 缺字段降级」以适应 app-server 演进 |
| `fileChange.changes[].diff` 具体形态未在文档给出示例，本次抓帧也未覆盖（只读回合） | `parseUnifiedDiff` 接受 unified diff 文本（`@@` 头 / `+-` 前缀 / 跳过 `\ No newline` 与 git header），也接受 `{diff}` 包裹；无法解析时 tool part 不挂 diff（只显文件名），不崩。真实文件修改回合出现后需再核对一次 |
| 两个 backend 的 reducer 在同一 `KoubouState` 上共存导致串味 | 事件自带身份（一个会话只下发其中一种），故按事件类型分流、**不**按 `state.backend` 门控（避免 ready 未到时误吞帧）；跨 backend 错配由「快照按项目+backend 分槽 + 会话恢复只认同 backend」在源头挡住 |
| 模型 ID 重叠（`gpt-5.5` 两边都有）导致记忆串用 | `modelByProject` 按项目 + backend 分槽；`modelBackend` 把「当前选择」也绑定到 backend；`setAvailableModels` 回落校验 |
