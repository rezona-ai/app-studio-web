# Koubou WebSocket 完整对话能力 — 设计文档

> 日期：2026-06-09
> 目标：用 Koubou WebSocket 协议实现**完整对话能力**,替换现有 `/api/agent/ws` 的 mock 脚本对话链路。
> 后端契约权威来源:`docs/websocket-events.md`(rezona-ai/koubou-agent-py)+ 实测 Koubou OpenAPI(`http://8.232.44.61/openapi.json`)。
> WS 地址:`ws://8.232.44.61`。

---

## 1. 背景与现状

### 1.1 现状

- **对话链路是纯 mock**:`server.ts` 在 `/api/agent/ws` 接 WS,`src/server/ws.ts` 调 `runAgent()`(`agent.ts`/`intent.ts`/`scripts.ts`)按意图返回**硬编码演示脚本**,无真实 LLM。
- **协议是手写 Claude SDK 子集**:`src/agent-protocol/{frame,messages,tools}.ts`,客户端帧 `{kind:'user_input'|'abort'}`,换行分帧。
- **画布/版本是真实后端**:走 PGC REST(`/api/pgc/[...path]` 代理 + 服务端 token)+ 2.5s 轮询,与对话解耦。mock agent 的 `generate_assets/derive_variants/build_version` 工具效果只是占位,实际画布由 PGC 驱动。
- **状态**:zustand store(`src/store/`),`applyMessage` 是协议→状态的唯一入口;消息模型 `Message.parts`(text/thinking/tool/asset-ref/action)。

### 1.2 已实测验证的事实(2026-06-09)

- **鉴权 = `pgc_bearer` 模式**。`POST /auth/ws-ticket` 无 Bearer 返回 401;链路 = PGC `POST /api/auth/login` 拿 `access_token` → Koubou `POST /auth/ws-ticket`(Bearer)拿 `{ ticket, expires_in_seconds: 60 }` → `?ws_ticket=` 连 WS。**ticket 仅 60s 有效**。
- **服务端已持有 PGC token**(`src/server/pgc/auth.ts` 的 `getToken()`),Koubou ticket 可直接复用,无需前端拿 PGC 凭证。
- **project_id 映射**:Koubou `project_id`(文档称 string)= PGC 项目数字 id 的字符串。实测 `/projects/2/ws` 生效。
- **Koubou 额外 HTTP 接口**:`GET /projects/{pid}/sessions`、`GET /projects/{pid}/sessions/{sid}`。响应信封 `{ code:0, message:"ok", data }`(注意与 PGC 的 `{success,...}` 不同)。
- **WS 分帧**:每条 WS message 即一个完整 JSON envelope,**无需换行分帧**(实测 `JSON.parse(message)` 直接可用)。
- **session.ready 实测 payload**:`project_id, session_id, visible_state, active_run, pending_interactions, permission_mode`,与文档一致;新建会话 `active_run=null`、`messages=[]`、`permission_mode="default"`。

---

## 2. 已确认的关键决策

1. **实现范围 = 完整协议**:核心对话 + 工具审批 + AskUserQuestion + 权限模式切换 + 增量重连(`after_sequence`/sequence 跟踪/interaction 去重)+ steering + 多模态图片附件 + `media.generated` 预览。分阶段落地,核心先跑通。
2. **连接方式 = 浏览器直连 + 服务端签发 ticket**。浏览器直连 `ws://8.232.44.61`;Next.js 新增 Koubou HTTP 代理负责签 ticket(凭证留服务端)。
3. **会话模型 = 单会话自动恢复**。每个 PGC 项目维持一个当前会话,`session_id`+`lastSequence`+消息按项目持久化;切项目自动恢复,刷新用 `after_sequence` 续传,「新对话」按钮建新 session。
4. **画布/版本保持 PGC 驱动**,不再由 agent 工具效果改写;`run.finished(succeeded)` 后刷新 `loadCanvas()/loadVersions()`(沿用现有 `result` 后刷新逻辑)。

---

## 3. 总体架构

```
浏览器                                         Next.js (服务端)              Koubou (8.232.44.61)
──────                                         ──────────────               ────────────────────
useKoubouConnection (hook)
  │
  ├─ GET /api/koubou/auth/ws-ticket ──────────► /api/koubou/[...path]  ───► POST /auth/ws-ticket
  │     ← { ticket, expires_in_seconds:60 }       (注入服务端 PGC Bearer)      (复用 getToken())
  │
  └─ new WebSocket(
       ws://.../projects/{pid}/ws?ws_ticket=...                       ← 新建会话
       ws://.../projects/{pid}/sessions/{sid}/ws?ws_ticket=...        ← 恢复
       ...&after_sequence={lastSequence}                              ← 续传
     )
       ↕ Koubou envelope(每条 WS message 一个 JSON)
  KoubouClient → onEvent → applyKoubou(reducer) → zustand → React UI
```

**单向数据流**:WS message → `onEvent` → `ingestKoubou(event)` → `applyKoubou(state, event)` → store → React。发送侧:UI → `client.sendXxx()` → WS。

---

## 4. 模块设计

### 4.1 服务端:Koubou HTTP 代理(`src/app/api/koubou/[...path]/route.ts`)

镜像现有 `/api/pgc/[...path]`(`src/server/pgc/proxy.ts` 模式):

- `GET|POST|PATCH|DELETE` 转发到 `KOUBOU_BASE_URL`,注入服务端 PGC `Authorization: Bearer`(`getToken()`),401 时 `invalidateToken()` 重登重试一次。
- 一个路由覆盖:`POST /auth/ws-ticket`(签 ticket)、`GET /projects/{pid}/sessions`、`GET /projects/{pid}/sessions/{sid}`。
- 透传响应体与状态码;Koubou 信封 `{code,message,data}` 由前端解析。

### 4.2 协议层(`src/koubou/protocol.ts`,取代 `src/agent-protocol/*`)

- **客户端事件**类型:`user.message` / `user.steer` / `run.interrupt` / `tool.approval` / `ask_user_question.answer` / `session.set_permission_mode`,统一 `{ type, payload, event_id? }`。
- **服务端事件** envelope:`{ type, project_id, session_id, payload, event_id, run_id, sequence, created_at }`,`type` 联合见 §5。
- **Claude SDK 形状**:content block 判别联合(`text` / `thinking` / `tool_use` / `tool_result` / `server_tool_use` / `advisor_tool_result`);`sdk_type` 联合(`AssistantMessage` / `UserMessage` / `SystemMessage` / `ResultMessage` / `StreamEvent` / 其余未知);`StreamEvent.event` 沿用 raw stream event(`content_block_start/delta/stop` 等)。
- **关闭码常量**:`4400/4401/4403/4404/4000`。
- **纯函数**:`isFullMessage(sdkType)`(是否 `AssistantMessage|UserMessage|SystemMessage|ResultMessage`)、`parseMediaGenerated(text): MediaGenerated | null`、`classifyClose(code): 'reauth'|'recreate'|'superseded'|'fatal'|'retry'`。
- 对**未知** `type` / `sdk_type` / 缺字段一律容错(忽略或降级展示)。

### 4.3 Koubou WS 客户端(`src/koubou/client.ts`,取代 `ws-client.ts`)

```ts
createKoubouClient({
  wsBaseUrl, projectId,
  sessionId?, afterSequence?,
  mintTicket: () => Promise<string>,   // 拉 /api/koubou/auth/ws-ticket
  onEvent: (e: ServerEvent) => void,
  onStatus: (s: ConnStatus) => void,
  factory?,                            // 测试注入 fake WebSocket
}): KoubouClient
```

- **连接**:每次连接前 `await mintTicket()`(60s TTL,现拿现连);按三态拼 URL:无 `sessionId`→新建;有 `sessionId`→恢复;有 `afterSequence`→追加 `&after_sequence=`。
- **解析**:每条 WS message 当作单个 JSON envelope(无缓冲分帧)。
- **发送方法**:`sendUserMessage(message, parentToolUseId?)`、`steer(content)`、`interrupt()`、`approveTool(id, approved)`、`answerQuestion(id, answers)`、`setPermissionMode(mode)`、`close()`。仅 `OPEN` 时发送。
- **关闭码处理**(`classifyClose`):
  - `4401` reauth → 重新 `mintTicket()` 后重连(带 `after_sequence`)。
  - `4404` recreate → 清本地 `sessionId`,改为新建连接。
  - `4000` superseded(被新连接/多标签页顶替)→ 不自动重连,上报状态。
  - `4400` fatal → 上报错误,不自动重连。
  - 其余/网络断开 retry → 指数退避(1s→8s)重连,带 `after_sequence`。

### 4.4 状态层

**reducer `src/koubou/apply-koubou.ts`(取代 `store/apply-message.ts`)** — 纯函数 `applyKoubou(state, event): state`:

| 事件 | 状态变更 |
| --- | --- |
| `session.ready` | 由 `visible_state.messages` 重建历史(MessageView→Message);`permission_mode`→`permissionMode`;`active_run`→`runStatus`/`activeRunId`;`pending_interactions`→`pendingInteractions`(按 `interaction_id` 去重) |
| `run.started` | `runStatus='running'`,`activeRunId=run_id` |
| `claude.message` `StreamEvent` | 更新当前 assistant 流式草稿(text/thinking/tool input 增量);`sequence=null` 不更新 `lastSequence` |
| `claude.message` `AssistantMessage` | 按 `message_id` 校正/落定草稿(无草稿则新增 bubble);权威覆盖 |
| `claude.message` `UserMessage` | `tool_result` 块按 `tool_use_id` 回填到对应 tool_use part,`is_error` 标记;`parseMediaGenerated` 解析 media 预览 |
| `claude.message` `SystemMessage` | 记录 `model` |
| `run.interrupted` | `runStatus='idle'`,清 `activeRunId` |
| `run.finished` | `runStatus= status==='succeeded'?'idle':'error'`,清 `activeRunId`(hook 侧触发画布/版本刷新) |
| `tool.approval.requested` | 写入 `pendingInteractions[id]`(去重) |
| `ask_user_question.requested` | 写入 `pendingInteractions[id]`(去重) |
| `permission_mode.changed` | `permissionMode=mode` |
| `error` | 写 `lastError`;`stale tool approval`/`stale question answer` 时按 `payload.interaction_id` 删除对应 `pendingInteractions` |

- **sequence 去重/跟踪**:维护 `seenSequences`(Set);收到非空 `sequence` 且已见→忽略(重连重放与 ready 去重);未见→处理并更新 `lastSequence`。
- **interaction 去重**:`pendingInteractions` 以 `interaction_id` 为键,重复 `*.requested` 覆盖即幂等;解决(approve/answer/stale)后删除。
- **草稿落定**:`StreamEvent` 草稿与完整 `AssistantMessage` 用 `message_id` 关联;完整消息到达即以其 content 为权威覆盖草稿。

**store 改造(`store/types.ts` + `index.ts`)**:

- 会话切片:`messages`、`runStatus`、`activeRunId`、`permissionMode`、`pendingInteractions: Record<string, PendingInteraction>`、`sessionId`、`lastSequence`、`model`。
- **按项目持久化**:`koubouByProject: Record<string, { sessionId: string; lastSequence: number; messages: Message[] }>`;`selectProject` 时换出当前、换入目标;刷新恢复时用其 `lastSequence` 作 `after_sequence`。
- `Part` 调整为 Claude block 语义:`text` / `thinking` / `tool { id, name, input, status, result?, isError?, media? }`;移除 mock 专属 `asset-ref` / `action`。
- 新 action:`ingestKoubou(event)`、`setRunStatus`、`upsertPending`/`resolvePending`、`setPermissionMode`、`startNewSession`(清当前项目会话开新连接)。移除 mock `ingest`。

### 4.5 连接 hook(`src/client/useKoubouConnection.ts`,取代 `useAgentConnection.ts`)

- 监听 `currentProjectId`;变化时换入该项目的 `{sessionId, lastSequence, messages}` 并(重)建连接。
- `mintTicket` = `fetch('/api/koubou/auth/ws-ticket').then(解 Koubou 信封.data.ticket)`。
- `onEvent`→`ingestKoubou`;`run.finished(succeeded)` 且有 `currentProjectId`→`loadCanvas()`+`loadVersions()`。每个非空 `sequence` 同步 `lastSequence` 持久化。
- `onStatus`→`setConn`;重连策略在 client 内,hook 反映状态。
- 返回 `clientRef`,供 `ChatPanel`/`Composer` 调发送方法。

### 4.6 UI 组件

- `Composer.tsx`:`send()` 改调 `client.sendUserMessage({ role:'user', content })`。有图片附件→多模态 `content` blocks(`{type:'text'}` + `{type:'image',source:{type:'base64',media_type,data}}`);否则纯文本字符串。`@mention` refs 折进文本。**运行中发送 = steering**(`client.steer(text)`);停止按钮→`client.interrupt()`。
- `MessageItem`/`ToolCard`/`ThinkingBlock`:适配 Claude block。`tool_use` 显示工具名 + 脱敏 input(截断 JSON);`tool_result` 显示文本,或 `media.generated` 预览(`preview_url` 渲染图/视频)。
- 新增组件(置于对话流下方,按 `interaction_id` 去重渲染):
  - `ToolApprovalCard.tsx`:展示 `tool_name`+脱敏 `input`,批准/拒绝→`client.approveTool(id, bool)`。
  - `QuestionCard.tsx`:按 `questions` 渲染选项,单/多选,提交→`client.answerQuestion(id, answers)`(answers 以问题文本为 key、选中 `label`/label 数组为值)。
  - `PermissionModeMenu.tsx`:切换权限模式→`client.setPermissionMode(mode)`。
- 「新对话」入口(`ChatPanel` 头部):`startNewSession()`。

### 4.7 装配与清理

- `Workspace.tsx`:`useAgentConnection()` → `useKoubouConnection()`;`ChatPanel`/`Composer` 接新 client 类型。
- **退役 mock**:删除 `src/server/{agent,intent,scripts,ws}.ts`(及测试)、`src/agent-protocol/*`、`src/client/{ws-client,useAgentConnection}.ts`、旧 `store/apply-message.ts`(及测试)。`server.ts` 移除 `/api/agent/ws` upgrade,简化为纯 Next 自定义 server(保留自定义 server 骨架以最小改动)。

---

## 5. 协议事件清单(对接核对用)

**客户端→服务端**:`user.message`(`{message:{role,content},parent_tool_use_id?}`)、`user.steer`(`{content}`)、`run.interrupt`(`{}`)、`tool.approval`(`{interaction_id,approved}`)、`ask_user_question.answer`(`{interaction_id,answers}`)、`session.set_permission_mode`(`{mode}`)。

**服务端→客户端**:`session.ready`、`run.started`、`claude.message`、`run.interrupted`、`run.finished`、`tool.approval.requested`、`ask_user_question.requested`、`permission_mode.changed`、`error`。

**可重放(带 sequence)**:`run.started/finished/interrupted`、`error`、完整 `claude.message`(`AssistantMessage/UserMessage/SystemMessage/ResultMessage`)、`tool.approval.requested`、`ask_user_question.requested`。
**不重放(sequence=null)**:`session.ready`、流式 `claude.message`(`StreamEvent` 等增量)、`permission_mode.changed`。

---

## 6. 关键流程

### 6.1 新建会话
连 `/projects/{pid}/ws` → 收 `session.ready` 存 `session_id` → 发 `user.message` → `run.started`(loading)→ 持续 `claude.message` → `run.finished`(清 loading + 刷新画布/版本)。

### 6.2 连接已有会话(无本地缓存)
连 `/projects/{pid}/sessions/{sid}/ws` → `session.ready` → 用 `visible_state.messages` 渲染历史 → 用 `active_run` 恢复 loading → 用 `pending_interactions` 直接弹审批/提问(唯一来源,不依赖重放)。

### 6.3 刷新恢复(有本地缓存)
读 `koubouByProject[pid]`(sessionId/lastSequence/messages)→ 连 `?after_sequence={lastSequence}` → `session.ready` 校正 run/pending(以服务端为准)→ 处理后续重放/实时事件。**去重**:同 `interaction_id` 可能同时出现在 `pending_interactions` 与重放流,以 id 为键去重;同 `sequence` 重放以 `seenSequences` 去重;重放完整 `claude.message` 覆盖断线期间草稿。

---

## 7. 错误与边界处理

- `error` 事件→`lastError`;`stale *` 按 `interaction_id` 清弹窗;`run already active` 提示(理论上前端按 `runStatus` 已禁用重复发送)。
- 关闭码按 §4.3 分类处理。
- 一个 session 同一时刻最多一个 active run、一个控制 WS;多标签页时新连接顶替旧连接(旧连接收 `4000`)。
- 对未知事件/`sdk_type`/缺字段容错。

---

## 8. 范围边界(YAGNI)

- **不做**多会话列表 UI(单会话自动恢复;`GET /sessions` 仅在无本地 session 时用于「恢复最近会话」,可选,首期可省)。
- **不做**画布资产由 agent 工具效果改写(画布仍 PGC 驱动)。
- **不做**非图片多模态(音视频附件上传走画布 PGC,不进对话 content)。
- **不做** `thinking.signature` 处理(后端已去除)。
- 多副本部署不在范围(后端当前假设单进程)。

---

## 9. 文件布局

```
新增:
  src/app/api/koubou/[...path]/route.ts     Koubou HTTP 代理(签 ticket / sessions)
  src/koubou/protocol.ts                    协议类型 + 纯 helper
  src/koubou/client.ts                       WS 客户端
  src/koubou/apply-koubou.ts                 事件→状态 reducer
  src/client/useKoubouConnection.ts          连接 hook
  src/components/chat/ToolApprovalCard.tsx   工具审批
  src/components/chat/QuestionCard.tsx       AskUserQuestion
  src/components/chat/PermissionModeMenu.tsx 权限模式切换
  + 对应 *.test.ts(x)

改造:
  src/store/types.ts, src/store/index.ts     会话切片 + 按项目持久化 + Part 模型
  src/components/chat/{Composer,MessageItem,ToolCard,ThinkingBlock,ChatPanel}.tsx
  src/components/workspace/Workspace.tsx      换 hook
  server.ts                                   移除 /api/agent/ws
  .env / .env.example                         KOUBOU_BASE_URL / NEXT_PUBLIC_KOUBOU_WS_URL

删除(退役 mock):
  src/server/{agent,intent,scripts,ws}.ts (+ tests)
  src/agent-protocol/*
  src/client/{ws-client,useAgentConnection}.ts (+ ws-client.test.ts)
  src/store/apply-message.ts (+ apply-message.test.ts)
```

---

## 10. 测试(vitest,沿用现有风格)

- **reducer `apply-koubou`**:ready 重建历史/恢复 run/pending、流式增量、完整 `AssistantMessage` 校正、`tool_use`↔`tool_result` 关联、`media.generated` 解析、run 生命周期、sequence 去重、interaction 去重、`stale` 清理、permission_mode。
- **协议 helper**:`isFullMessage`、`parseMediaGenerated`、`classifyClose`。
- **client**:URL 构造(新建/恢复/续传)、关闭码→动作映射、ticket 重签、发送 envelope 形状(注入 fake WebSocket,沿用 `ws-client.test.ts` 模式)。
- **组件**:`ToolApprovalCard`/`QuestionCard` 交互(testing-library,沿用 `MessageItem.test.tsx` 模式)。

---

## 11. 配置

```
# .env / .env.example 新增
KOUBOU_BASE_URL=http://8.232.44.61          # 服务端:签 ticket / sessions REST
NEXT_PUBLIC_KOUBOU_WS_URL=ws://8.232.44.61  # 浏览器:拼 WS URL
```

---

## 12. 分阶段落地

1. 配置 + Koubou HTTP 代理(ticket)。
2. 协议类型 + helper。
3. WS 客户端(URL/关闭码/重连/ticket 重签/发送)。
4. store 会话切片 + `apply-koubou` reducer。
5. 连接 hook + `Workspace` 装配 + 退役 mock(核心对话跑通)。
6. 对话 UI:Composer 发送/steer/interrupt;MessageItem block 渲染;media 预览。
7. 交互组件:审批 + 提问 + 权限模式;pending 恢复。
8. 增量重连/刷新恢复(`after_sequence`、按项目持久化、去重);端到端冒烟。
