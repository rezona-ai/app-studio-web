# 回放 Onboarding 播放器（Replay Player）设计

- 日期：2026-07-09
- 关联需求：回放 onboarding（新用户零积分看一段 agent 建游戏的过程，再用真实 prompt 续接）
- 上游文档：`koubou-agent-py` PR #129 —— `docs/frontend/replay-onboarding-integration.md`（跨 pgc + koubou 前端对接指南）、`docs/http-api.md`（clone 端点契约）
- 后端契约（Apifox 项目 8405123，均已 released）：
  - pgc `Start Replay`（entityId 484626520）：`POST /api/replay/templates/{template_id}/start`
  - pgc `Finalize Replay`（entityId 484626521）：`POST /api/replay/projects/{project_id}/finalize`
  - pgc `Update Replay State`（entityId 484626522）：`POST /api/replay/projects/{project_id}/state`
  - koubou `clone-from-template`：`POST /projects/{project_id}/sessions/clone-from-template`（PR #129 `docs/http-api.md`，Apifox 尚未重导，以 PR 文档为准）
  - koubou `List Session Events`（entityId 472626339）：已含 `after_sequence` query 参数

## 目标

新用户从 landing page 点模板进来后，workspace **进入即回放**：把模板会话的完整事件历史按原节奏在现有对话/画布管线里重演一遍（消息逐条渲染、图像/音频/文本素材落画布），全程零积分、输入框禁用；回放结束后这个项目**就是一个正常项目**——用户可直接用真实（计费）prompt 在同一 session 上续接。

范围只覆盖 **workspace 侧的回放与续接**。模板入口（画廊、点模板触发首个 `start`）在 landing page（另一前端），不在本仓库。

## 范围边界（已与 Nick 确认）

| 决策点 | 结论 |
|---|---|
| 入口 | 在 landing page；workspace 只实现回放。landing 触发首个 `start` 后跳转，URL 带 `?replay_template=<template_id>` |
| provisioning 归属 | landing 只做首个 `start`；`clone-from-template` + `finalize` 由 workspace 进入时自己完成 |
| status 真相源 | workspace 进入时**自己再调一次 `start`**（幂等去重）拿 `{ target_project_id, status }`——`Get Project` 不含回放态字段，`start` 是唯一能读 status 的入口，也天然覆盖刷新/换设备恢复（PR 文档 §4） |
| `finalize` 的版本号 | 固定传 `{ current_version_id: "v1" }`——回放项目由 `start` 建出时 `current_version_id` 恒为 NULL（从未有过版本），系统中任何新项目的首个稳定版本号必为 `v1`，是该状态机下唯一自洽取值 |
| 完成标记 | 回放播完（含 skip）调 `state=completed`，失败不阻断续接 |
| 续接 | 回放结束后在**同一 clone session** 上以 `afterSequence` 增量续接，不重放历史、不再种子化（否则冲掉已回放的完整消息列表） |
| 倍速 / skip | 纯前端；倍速 1x/2x/4x，skip = 剩余队列瞬时 flush（终态与看完全程一致） |
| 视频/3D 素材回放导入 | 不在本期（PR 文档 U10）；本期模板只含图像/音频/文本 |
| provisioning 失败自动重试 | 不做；失败即进内联错误态 + Toast，用户可刷新重试 |

## 后端契约要点（只取文档字段，不臆测）

- **`start`** → `ReplayStartData { target_project_id:int, template_id:string, status:string }`。`status ∈ {provisioning, ready, completed}`。幂等：重复开通同模板返回既有项目 + 当前 status。模板不存在/下架 → 404 `REPLAY_TEMPLATE_NOT_FOUND`；未登录 → 401。**不回源三元组**（前端只持 `template_id`）。
- **`clone-from-template`**（koubou 信封 `{code,message,data}`，`code===0` 成功）：请求体 `{ template_id }`，路径 `project_id` 为 `target_project_id`。→ `{ session_id, already_provisioned }`。target 身份取鉴权上下文（不由请求体指定）。错误：`403`（未白名单/禁用）、`409 REPLAY_ALREADY_PROVISIONED`（已有 session → 改查既有会话，勿重克隆）、`429`（配额）、`503`（DB 未启用）。
- **`finalize`** → `ReplayProjectStateData { project_id, status }`，请求体 `{ current_version_id }`（`^v\d+$`）。把版本指针落库 + status → `ready`。已 ready/completed 上重复调是 no-op（不回退指针），可幂等重试。非回放/他人项目 → 404/403。
- **`state`** → 同 `ReplayProjectStateData`，请求体 `{ status }`（`^(ready|completed)$`）。单向跃迁 `provisioning → ready → completed`，跳级 → 409。
- **`events`**：`limit`（≤100）、`before_sequence` / `after_sequence`（互斥）。返回 `SessionEventsPage { events, oldest_sequence, newest_sequence, latest_sequence, has_more }`。事件按 `sequence` 升序、与 WS 帧同构。

## 端到端序列（workspace 侧）

```
useProjectBootstrap 挂载 → 检出 ?replay_template=<template_id>（新增第 4 分支，优先级高于 loadProjects）
  │
  └─ store.enterReplay(templateId)：
       1. set replay = { phase:'provisioning', templateId, ... }   ← 先置位,useKoubouConnection 随即早退出
       2. pgc start(templateId) → { target_project_id, status }     ← 幂等,刷新/换设备也走这条
       3. selectProject(target_project_id)                          ← 复用现有 action:同步 ?project= + 清空会话态
       4. 按 status 分流:
       │
       ├─ provisioning → clone-from-template → finalize({current_version_id:"v1"}) → play(session_id)
       │       · 409 REPLAY_ALREADY_PROVISIONED → listSessions 取既有 session,直接 play
       │       · 403 / 429 / 503 / 网络错误      → replay.phase='error' + Toast
       │
       ├─ ready       → listSessions 取 clone session → play(session_id)
       │                （克隆完成但未播完就掉线/刷新的中间态恢复）
       │
       └─ completed   → 剥掉 ?replay_template → set replay=null → 当正常项目进入
                        （不再回放,避免重复导入素材;useKoubouConnection 正常续接）
  │
  ├─ play(sessionId)：拉全量事件 → 按 sequence 排序 → 按节奏 dispatch 进 apply-koubou 管线
  │
  └─ 播完 / skip：持久化会话快照 → state=completed（失败不阻断）→ replayHandoff={sessionId,afterSequence}
                  → 剥 ?replay_template → set replay=null → useKoubouConnection 据 handoff 增量续接
```

## 设计

### 1. 数据层

**`src/lib/pgc/`（REST client）**
- `types.ts` 追加：`ReplayStartData` / `ReplayProjectStateData`（字段与 Apifox 契约一一对应，snake_case，不加别名）。
- `client.ts` 追加：
  - `startReplay(templateId: string): Promise<ReplayStartData>` → `POST /api/replay/templates/{templateId}/start`
  - `finalizeReplay(projectId: number, currentVersionId: string): Promise<ReplayProjectStateData>` → `POST /api/replay/projects/{projectId}/finalize`
  - `updateReplayState(projectId: number, status: 'ready' | 'completed'): Promise<ReplayProjectStateData>` → `POST /api/replay/projects/{projectId}/state`
  - 错误沿用现有 `PgcError` 归一。

**`src/lib/koubou/client.ts`（koubou HTTP client）**
- `koubouApi.cloneFromTemplate(projectId, templateId): Promise<{ session_id: string; already_provisioned: boolean }>` → `POST /projects/{projectId}/sessions/clone-from-template`，body `{ template_id }`；走现有 `koubou()` helper（`code===0` 成功，`KoubouError` 归一，`already_provisioned` 字段解析但当前不消费）。
- `koubouApi.listEvents` 扩展：opts 增 `afterSequence?: number`（映射 `after_sequence` query，与 `beforeSequence` 互斥）。现有调用点不受影响。

### 2. store：replay 切片（`src/store/`）

新增瞬态 UIState 字段（**不持久化**，对齐 `genForm`/`addMenu` 等"打开态进 store"约定）：

```ts
type ReplayPhase = 'provisioning' | 'cloning' | 'finalizing' | 'playing' | 'skipping' | 'error';
interface ReplayState {
  phase: ReplayPhase;
  templateId: string;
  projectId: number | null;    // start 返回的 target_project_id
  sessionId: string | null;    // clone 返回的 session_id
  total: number;               // 全量事件条数（进度用）
  cursor: number;              // 已 dispatch 到第几条
  speed: 1 | 2 | 4;
  errorCode?: string;
}
// 续接握手参数:回放路径 → 连接路径的单向数据流(非防副作用的簿记开关)
interface ReplayHandoff { sessionId: string; afterSequence: number }
```

store 加 `replay: ReplayState | null`、`replayHandoff: ReplayHandoff | null`。

**新增 ServerActions（`actions.ts`）**：

- `enterReplay(templateId: string)`：编排上面的 provisioning + 分流。每个 `await` 后校验 `get().replay?.templateId === templateId`（防 await 期间用户又切走/重新进入）。`start` 前先 `set({ replay: {...provisioning} })`，让 `useKoubouConnection` 在随后的 `selectProject` 触发 currentProjectId 变化时早退出。经 `cloning`/`finalizing` 中间 phase，成功后置 `phase='playing'`、`sessionId`。
  - clone `409` → `koubouApi.listSessions` 取既有 session 兜底后继续。
  - 其余 provisioning 错误 → `set({ replay: { ...phase:'error', errorCode } })` + `setError`（Toast）。
- `setReplayCursor(n: number)`：写 `replay.cursor`（进度摘要，供 UI）。
- `setReplaySpeed(s: 1|2|4)`：写 `replay.speed`。
- `skipReplay()`：仅置 `phase='skipping'`（不读队列）；`useReplayPlayer` 监听到该 phase 去 flush。
- `completeReplay(snapshot)`：持久化会话快照到 `koubouByProject[pid]`（sessionId/lastSequence/messages/turns/tasks，与 live onEvent 检查点同构）→ `void updateReplayState(pid, 'completed').catch(()=>{})`（失败不阻断）→ `set({ replayHandoff: { sessionId, afterSequence: lastSequence }, replay: null })` → 剥掉 URL 的 `?replay_template`（保留 `?project`）。

**派发驱动在 hook（§4），不在 store**：事件队列可能上千条，不进 store（非持久化大数组）；store 只持 `total/cursor/speed` 摘要。`useReplayPlayer` 拥有队列，逐跳直接调 `ingestKoubou` + `importFromReplayEvent` 派发、调 `setReplayCursor` 推进；到尾（或 skip flush 完）由 hook 组装快照调 `completeReplay`。store 侧只提供编排（`enterReplay`）、摘要 setter、收尾（`completeReplay`）——避免"store action 读 hook ref"的分层错位。

**素材导入分流**：新增 `importFromReplayEvent(e)`，与 `importFromLiveEvent` 共用 `eventAssets` 解析出的 `media`（图像/音频/文本原位导入），但**丢弃 `tasks`**（video/3D 生成任务）——回放的是早已结束的死任务 id，送进 `registerAgentGenTask` 会轮询失败并弹 Toast（PR 文档 §3.4）。串行 import 链复用 live 的落位保证。

### 3. 连接隔离与续接（`useKoubouConnection`）

`useKoubouConnection` 现状：项目进入即 `resolveSession`（猜最新会话）+ `listEvents(50)` 种子 + WS 建连。回放路由下这会**剧透结局**，续接时 50 条种子还会**整体重建冲掉完整回放消息**（`seedHistory` 用整页替换 `messages`）。故：

- **回放期早退出**：hook 订阅 `replayActive = useStore(s => s.replay != null)`，加入 effect 依赖数组。`replayActive` 为真时 effect 直接 `return`（不建连、不种子、不挂 online/visibility 监听）。回放把 `replay` 置 null 的那一刻，effect 依赖变化自然重跑。
- **续接走 handoff**：effect 重跑时若 `replayHandoff != null`，**跳过 `resolveSession` 与 50 条种子**，直接用 `handoff.sessionId` + `afterSequence=handoff.afterSequence` 建连（增量续传，绕开 500 条 `seenSequences` 窗口），建连后清空 `replayHandoff`。这是回放路径向连接路径传参的单向数据流，不是"记得跳过 seed"的防御开关——它携带真实的续接坐标。快照已由 `completeReplay` 落到 `koubouByProject`，`switchProjectSession` 会把完整回放消息载回，无需再种子。

### 4. 播放器副作用（`src/client/useReplayPlayer.ts`）

纯调度的 hook（连接/轮询/IO 隔离在 `client/` 的既有约定）：

- 拉全量事件队列存 hook 内 ref（`ServerEvent[]`，可能上千条，不进 store）：`listEvents` 循环 `afterSequence` 翻页到 `has_more=false` → 按 `sequence` 升序合并 → 一次性 `set({ replay: { ...total, cursor:0, phase:'playing' } })`。
- 节奏：`delay = clamp(created_at 差值ms, floor=200, cap=8000) / speed`（负/零差值取 floor；cap 防源里的分钟级生成等待卡住回放；PR 文档 §3.2）。`speed` 读 `replay.speed`，改速即时生效于下一跳。
- 逐跳 `setTimeout`：派发 `queue[cursor]`（`ingestKoubou` + `importFromReplayEvent`）→ `setReplayCursor(cursor+1)` → 排下一跳；队列耗尽即组装快照调 `completeReplay`。
- `phase==='skipping'`（由 skip 控件置位）时清定时器，同步 flush `queue[cursor:]`（同一派发路径，无延时）→ `completeReplay`——保证 skip 终态与看完全程一致（PR 文档 §5）。
- 卸载 / `replay` 变 null 时清定时器。降低动态无关（无视觉动画）。

挂在 `Workspace`（或 `ChatPanel`）内，与 `useKoubouConnection`/`useCanvasPolling` 并列。

### 5. UI

- **交互事件降级**：`ToolApprovalCard` / `QuestionCard` 渲染前判断 `replay != null` → 只渲染纯文本摘要、不出可操作按钮（模板本不该产出这类事件，属兜底；PR 文档 §3.5、§7）。
- **Composer 禁用**：`<textarea>` 与发送按钮在 `replay != null` 时 `disabled`（当前实现连正常 run 中都不禁输入框，此为本次新增能力），完成后启用。禁用态给一句 `aria-label` / placeholder 说明"回放中"。
- **回放控制条**：Chat 顶部一条轻量条（复用 `Segmented` 选 1x/2x/4x + 一个 `IconButton` skip），显示 `cursor/total` 进度。**无 Figma 稿**，只用既有令牌/基础组件拼；像素级视觉留待后续对稿，本期以能用 + 不破坏令牌体系为准。
- **provisioning / error 态**：Chat 区展示内联占位（复用 `LoadingScreen` 骨架微光表 provisioning；error 态一句文案 + 复用 Toast），不新增 keyframes。
- i18n 六语（en 真相源）：控制条、进度、禁用提示、错误文案、交互事件降级摘要标签，含 `aria-label`。

### 6. 错误处理

- provisioning 三步任一失败：`replay.phase='error'` + 已知 `PgcError`/`KoubouError` 经 `setError` → Toast；未知错误照抛（沿用 `guard` 约定）。不自动重试，用户刷新重来（`start` 幂等，安全）。
- `state=completed` 失败：吞掉（`.catch(()=>{})`），不阻断续接；下次刷新 `start` 会重新判断 status（容忍偶发"看过但没记上"，下次重播一遍——素材导入按 `(project,asset)` 幂等，不会重复落卡）。
- 非法事件帧：`ingestKoubou` 内既有 `try/catch` 已兜底。

### 7. 测试（与源码同目录）

- `pgc/client.test.ts`：三个 replay 端点的 URL/body/信封解析 + 错误转 `PgcError`。
- `koubou/client.test.ts`：`cloneFromTemplate` body/信封；`listEvents` 带 `after_sequence` 的 query 组装。
- `store/actions.test.ts`：`enterReplay` 各 status 分流（provisioning 全链 / ready 兜底 listSessions / completed 直接剥参）、clone 409 兜底、finalize 固定 v1、`importFromReplayEvent` 丢弃 tasks、`completeReplay` 落快照 + 置 handoff + state=completed 失败不阻断。
- `koubou/apply-koubou`：回放 dispatch 出的 messages 终态与看完全程一致（skip flush 后 == 全量顺序 dispatch）。
- `useReplayPlayer`：注入假定时器/假 events，验证节奏 clamp、倍速、skip flush、卸载清理（对齐 `createKoubouClient` 的依赖注入 + `flush()` 微任务测试范式）。
- `useKoubouConnection`：`replayActive` 早退出（不建连/不种子）；`replayHandoff` 存在时跳过 seed、按 afterSequence 建连并清空 handoff。
- `Composer` / `ToolApprovalCard` / `QuestionCard`：回放态禁用 / 降级纯文本。

## 不在本期范围

- Landing page 本身（模板画廊、首个 `start` 触发 UI）。
- 视频/3D 模板素材的回放导入（PR 文档 U10）。
- 回放控制条的像素级视觉对稿（无 Figma，先能用）。
- provisioning 失败的自动重试 / 退避。
- 回放进度的持久化（刷新即从 `start` 的 status 重新决策，不做"续播到第几条"）。
