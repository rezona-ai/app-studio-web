# Agent 对话错误透传 + 应用层自动重试 + 补齐 steer 入口 — 设计稿

> 日期：2026-08-25 · 分支：`feat/agent-error-passthrough-retry`

## 背景

对话栏的 agent 侧错误当前只有一条终点：`error` 事件 / `run.finished{status:failed}` → `pushErrorBubble` → 一条 danger 气泡，然后回合就结束了。两个问题：

1. **看不到上游到底报了什么**。`resolveErrorMessage(code, fallback, t)` 在命中 code 时用译文**覆盖**后端原文；而上游动态异常（`payload.type` 有值）全部落进同一条通用码 `AGENT_RUN_ERROR`，界面只显示一句「agent 运行出错」。真正的 `AnthropicOverloadedError: Overloaded` / 上游 5xx / 超时文案被丢弃，用户与排障都拿不到线索。
2. **瞬时故障没有任何自愈**。传输层**已有**重连（`client.ts` 的 `scheduleReconnect`，`min(1000·2ⁿ, 8000)` 无限退避 + `classifyClose` 分流 + 心跳看门狗 + `ReconnectBanner`），但它只管**连接断了**。连接好端端开着、run 却因上游过载失败，属于**应用层**失败，传输层完全不介入 —— 用户只能自己把同一句话再发一遍。

盘问期间还查出第三件事，一并收进本轮：**回合进行中插话（steer）只实现了一半**。`Composer.tsx:395` 在 `runStatus === 'running'` 时把发送按钮整个替换成停止按钮，但输入框没禁用、`onKeyDown` 的 Enter 也没有 runStatus 门控（`Composer.tsx:339`），于是 steer 只能靠回车触发，界面上没有任何入口。既有测试（`Composer.test.tsx:551`）正是用 `keyDown Enter` 触发的，佐证这条路径可达而不可见。

## 目的

- agent 侧错误**透传上游原文**，同时不牺牲现有四语本地化。
- 对**瞬时故障**自动自愈，界面持续展示进度，至多 10 次；全部失败后才正式报错。
- 补齐 steer 的可见入口。

## 约束（盘问结论）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 触发范围 | **按错误类别判定**，业务错误不重试。 |
| 2 | 可重试判据 | **黑名单**：已编码的业务错误不重试，其余（含所有动态异常）一律当瞬时故障。 |
| 3 | 重试动作 | **按 run 跑到哪一步分两种**：本轮**未产生任何助手输出** → 原样重发上一条用户消息；**已有返回或已有 `tool_use`** → 改发**隐式 `continue`**（不推用户气泡），不让 agent 从头重做已经花过钱的部分。 |
| 4 | 重试节奏 | **复用传输层同一套退避** `min(1000·2ⁿ, 8000)`：1s→2s→4s→8s 封顶。 |
| 5 | 进度 UI | **就地复用那条错误气泡的位置**：等待期显示「重试中 n/10」+ spinner + 本次上游原文 + 取消；成功即消失；10 次全败定格为正式错误气泡（完整原文 + 手动重试）。全程只占一条，不刷屏。 |
| 6 | 原文透传 | **译文主行 + 原文可展开**，所有错误统一口径 —— 不按错误类型分两支判据。 |
| 7 | continue 可见性 | 只在发送当次不推用户气泡；它**必然进后端事件日志**，刷新 / 重连重建历史时会作为普通用户气泡出现，**接受**。不臆造后端字段去藏它。 |
| 8 | steer 入口 | **两个按钮并排**：running 且输入框有内容时，停止按钮旁多出发送按钮；无内容时仍只有停止。 |

「至多 10 次」的口径 = **重试 10 次**（含首次执行共最多 11 次 run）。resend 与 continue 共用同一个计数器。

## 非目标

- 不动传输层重连的任何参数与状态机（两套机制职责分明，见下）。
- 不做 redo / 不做重试历史留档（每次失败的原文只在当次气泡上展示，最终失败保留最后一次）。
- 不给积分不足做产品级交互 —— 它由 `credit.insufficient` 分流到模态，根本不走 error 气泡，天然不进本路径。

## 与传输层重连的边界

| | 传输层（已有） | 应用层（本轮新增） |
|---|---|---|
| 管什么 | 连接断了 | 连接开着、run 失败了 |
| 信号 | WS `close` / 心跳看门狗 | `error` 事件 / `run.finished{failed}` |
| 动作 | 重建 socket（原 `event_id` 冲刷积压命令） | 重发消息 / 发 continue（**新** `event_id`，新开一轮 run） |
| 上限 | 无限退避（ticket 连续失败 5 次止） | 10 次 |
| UI | `ReconnectBanner` 内联条 | 对话尾部重试气泡 |

**互不调用**：应用层重试不去调 `reconnect()`；断连期间应用层只**暂停**发送（不空转倒计时、不把命令丢进积压队列 —— 积压队列的重放语义是「原 `event_id` 冲刷」，而重试要的恰恰是新 `event_id`）。连接进入 `fatal` / `superseded` 时应用层重试立即终止并落正式错误：这两态不会自动恢复，继续等只会挂着。

## 详细设计 · A 部分：错误透传与自动重试

### ① 纯函数层 `src/lib/agent-retry.ts`（新增）

```ts
export const MAX_AGENT_RETRIES = 10;
export type RetryMode = 'resend' | 'continue';

// 黑名单:必然再失败的业务错误不重试。口径与 i18n/errors.ts 的 KOUBOU_MESSAGE_CODES 对齐 ——
// 那 6 条是后端固定文案(参数非法 / 状态冲突 / 已失效交互),重发只会被原样再拒一次。
// BUILD_FAILED 同理(构建产物本身有问题,重跑不变)。
// 刻意**不**列 RUN_ABANDONED:孤儿 run 恰恰是瞬时故障(属主 Pod 没了),正是该重试的那类。
const NON_RETRYABLE: ReadonlySet<string>;

export function isRetryableAgentError(code: string | undefined): boolean;
// 退避与传输层同一语汇;attempt 从 0 起
export function retryDelayMs(attempt: number): number;
```

### ② 错误原文归一 `src/i18n/errors.ts`（扩展）

新增纯函数，与 `classifyKoubouError` 同源同处：

```ts
// 上游原文详情:有异常类名时拼成 `Type: message`,否则原样 message。
// 截断上限防超长堆栈把持久化的 messages 撑爆(detail 随 error part 落盘)。
export function koubouErrorDetail(p: { message?: unknown; type?: unknown }): string | undefined;
```

`resolveErrorMessage` 保持不变 —— 主行仍是「命中 code 用译文、未命中回退原文」，本轮只是**额外**把原文带到 UI，不改覆盖语义。

### ③ 协议层 `src/koubou/protocol.ts`

`error` part 扩一个可选字段：`{ type: 'error'; text: string; code?: string; detail?: string }`。`detail` = 上游完整原文，命中 code 时也带（决策 6：统一口径）。

### ④ 状态 `src/store/types.ts`

`KoubouState` 加两个**瞬态**字段（**不进** `partializeAppState`，**不进** `sessionSnapshot`）：

```ts
// 最后一次 sendUserMessage 的原始 payload,供 resend 模式原样重发。
// 不能从用户气泡反推:气泡里是渲染文本,与实际发给后端的 koubouText(@[type]<url> token /
// attachment 标签 / image 内容块)不是一回事。
// kind='steer' 表示最后一次发送走的是插话路径 —— 该路径一律不自动重试(见取舍 4)
lastSend: { kind: 'message'; content: string | ContentBlock[] } | { kind: 'steer' } | null;

// 应用层自动重试上下文。phase='waiting' 等退避到点,'running' 已发出在跑
agentRetry: {
  attempt: number;                 // 已用掉的重试次数,1 起
  mode: RetryMode;                 // 本次要发什么:原样重发 / continue
  phase: 'waiting' | 'running';
  nextAt: number | null;           // waiting 期的到点时刻;null = 正在跑
  text: string;                    // 主行 fallback
  code?: string;
  detail?: string;                 // 本次上游原文
} | null;
```

**为什么必须瞬态**：重试上下文（要重发的 payload）跨不了刷新，落盘只会留下一条永远转圈的「重试中 3/10」。刷新后什么都不留（中间态本就不写进 `messages`），用户看到的是那条消息后面没有回复，可自行重发。

### ⑤ Reducer `src/koubou/apply-koubou.ts`

现有两个失败入口（`onError` 的非 stale 分支、`run.finished{failed}` 内嵌 error）收敛到同一个纯函数：

```ts
function failAgentTurn(state, { code, fallback, detail, runId }): KoubouState
```

判定顺序（全在 reducer 内完成，保持纯函数、locale 中立）：

1. `lastSend == null` 或 `lastSend.kind === 'steer'` → 推正式错误气泡（含 detail）。
2. `!isRetryableAgentError(code)` → 推正式错误气泡。
3. 已重试满 `MAX_AGENT_RETRIES` → 推正式错误气泡（含**最后一次**的 detail），清 `agentRetry`。
4. 否则 → **不推气泡**，置 `agentRetry`，`mode` 按下述判定。

**`mode` 判定（决策 3 的落点）**：取该 run 的 `TurnMeta.lastMessageId` —— 它在助手消息落定 / 流式开篇时被 patch（`apply-koubou.ts:427 / 469 / 806 / 826`），是「本轮已有助手输出」的现成可靠信号，`tool_use` 作为助手消息的 part 天然包含在内。

- `lastMessageId == null`（run 没跑起来，或跑起来一个字没吐）→ `mode: 'resend'`
- `lastMessageId != null`（已有返回 / 已调过工具）→ `mode: 'continue'`
- 应用层 `error` 事件压根没有对应 run（`run_id` 无匹配 turn）→ `mode: 'resend'`

`mode` **每次失败重新判定**，不沿用上一次：一次 resend 之后 agent 吐了半句又崩，下一次就该转成 continue。

清空时机（同样在 reducer）：`run.finished{succeeded}` → `agentRetry = null`。

> `nextAt` 需要 `Date.now()`，会让 reducer 不纯。故 reducer 只出 `attempt`（该等第几档），`nextAt` 由 store action 层补 —— 时钟属于副作用层。

### ⑥ 副作用 `src/client/useAgentRetry.ts`（新增 hook）

`client` 实例是 `useKoubouConnection` 的 ref，store 拿不到 —— 故执行侧必须落在 `client/` 层（与仓库分层一致：连接 / 计时 / IO 在 hooks）。

职责：订阅 `agentRetry`，`phase==='waiting'` 时按 `nextAt` 设一次性定时器；到点且 `connStatus==='open'` 才发送并置 `phase='running'`：

- `mode==='resend'` → `client.sendUserMessage(lastSend.content)`
- `mode==='continue'` → `client.sendUserMessage({ role: 'user', content: 'continue' })`，**不** `pushUserMessage`

非 open 则挂起，等 `connStatus` 变 open 后立即补发；进 `fatal`/`superseded` → `cancelAgentRetry('fatal')` 落正式错误。切项目 / 卸载清定时器。

`continue` 固定英文、不随界面语言变 —— 它是发给 agent 的指令，不是给人看的文案。

### ⑦ Store actions

- `markPendingSend(payload)`：现有 action 扩参，顺带记 `lastSend` 并清 `agentRetry`（用户手动发送 = 新一轮计数，也意味着放弃上一条的重试）。
- steer 路径：记 `lastSend = { kind: 'steer' }`（见取舍 4）。
- `cancelAgentRetry(reason)`：把当前 `agentRetry` 的 text/code/detail 落成正式错误气泡并清空。供取消按钮与 fatal 兜底共用。
- `retryAgentNow()`：正式错误气泡上的手动重试入口（attempt 从 0 起重新计）。

### ⑧ UI

- **`src/components/chat/AgentRetryBubble.tsx`（新增）**：订阅 `agentRetry`，渲染在消息列表**尾部**（与 `MessageSkeleton` 同位置），视觉沿用现有 error 气泡的 danger 配色 —— 位置与观感都「就地」，但**不写进 `messages`**，因此不落盘、不刷屏，倒计时每秒 tick 也只重渲它自己（不碰 `MessageItem` 列表的 memo）。内容：`重试中 n/10` + spinner + 本次上游原文（同款可展开详情）+ 「取消」。
- **`src/components/chat/MessageItem.tsx`**：error 分支主行不变，下方加默认收起的「详情」（`<details>`），展开为等宽完整原文 + 一键复制；正式错误气泡附「重试」按钮（`retryAgentNow`）。
- **i18n**：四语补 `chat.retry.progress`（`{{n}}/{{max}}` 插值）、`chat.retry.cancel`、`chat.error.detail`、`chat.error.copy`、`chat.error.retry`。
- 令牌 / 动效全部复用既有：danger 软底、`.anim-collapse-in`、`IconButton`，不新增 keyframes 与色值。

## 详细设计 · B 部分：补齐 steer 入口

### ⑨ `src/components/chat/Composer.tsx`

- `runStatus === 'running' && !replayActive` 时，按钮区渲染**停止 + 发送并排**；`canSend` 为假（输入框空）时只渲染停止，与今天一致。两个按钮都复用 `IconButton` + `submitVariant`，不新增按钮种类、不新增布局层。
- 发送按钮的 `aria-label` 在 running 态用一条独立文案（四语补 `chat.composer.steer`），与「发送」区分 —— 语义确实不同（打断并接续，不是新开一轮）。
- **顺带修一个既有 bug**：steer 分支下图片附件被静默丢弃。现有 `send()` 里 `tokenFolded` / `inlined` 都 `filter(a => a.kind !== 'image')`，而 image 只在非 steer 分支被组装成原生 image 内容块；于是 running 时带图发送，用户气泡显示了图（`mediaParts` 无条件推），agent 却什么都收不到。修法：steer 路径把 image 也折成 `@[image]<url>` token —— `MENTION_TYPE.image = 'image'` 是既有契约（`refs.ts:26`，画布 @提及图片走的就是这条），不臆造新字段。

## 测试

| 层 | 文件 | 覆盖 |
|---|---|---|
| 纯函数 | `src/lib/agent-retry.test.ts` | 黑名单命中/不命中、退避序列封顶 8s、`MAX` 边界 |
| 纯函数 | `src/i18n/errors.test.ts` | `koubouErrorDetail` 的 `Type: message` 拼装 / 无 type / 超长截断 |
| Reducer | `src/koubou/apply-koubou.retry.test.ts` | 可重试错误不推气泡只置 `agentRetry`；业务错误直接推气泡；**`lastMessageId` 为空 → `mode:'resend'`、非空 → `mode:'continue'`**；mode 每次失败重判；第 11 次落正式错误；`lastSend` 为空 / 为 steer 不重试；`run.finished{succeeded}` 清态 |
| Hook | `src/client/useAgentRetry.test.ts` | 假计时器 + `FakeWS`：到点按 mode 分别发原 payload / `continue`；continue 不推用户气泡；断连期挂起、open 后补发；fatal 终止；卸载清定时器 |
| UI | `MessageItem.test.tsx` / `AgentRetryBubble.test.tsx` | 详情折叠与复制、进度文案、取消落正式错误 |
| UI | `Composer.test.tsx` | running 有内容 → 停止与发送并排且都可点；running 空输入 → 只有停止；点发送触发 `steer`（不再只有回车能触发）；running 带图发送 → 图折成 `@[image]<url>` 进 steer 文本 |

## 成功标准

1. 上游动态异常在对话栏能看到**完整原文**（展开详情），四语主行不受影响。
2. 瞬时故障自动自愈：没跑起来的原样重发、已有产出的发 continue；界面持续显示 `n/10` 与倒计时，可随时取消；成功后气泡消失、正常回复接上。
3. 业务错误**零重试**，行为与今天一致（只多了详情）。
4. 刷新 / 切项目 / 断连 fatal 都不留永久转圈气泡。
5. running 态点发送按钮即可插话，带图插话图片不再丢。
6. `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build` 全绿。

## 明示取舍

1. **continue 刷新后可见**（决策 7）：它真实存在于后端事件日志，前端不藏。代价是历史里会出现用户没打过的 `continue` 气泡。
2. **continue 的效果依赖 agent 的理解**：前端只能保证把 `continue` 发出去，agent 是接着上次的进度做、还是重新开始，前端约束不了。相比原样重发，它把「重复执行已花钱动作」的概率降低了，但不是消除。
3. **黑名单会随后端文案漂移**：后端应用层错误无机器码，黑名单靠 message 文案匹配。上游改文案 → 该错误从黑名单掉出去 → 变成「白烧 10 次」而不是静默失效。这是选黑名单相对白名单换来的失效方向（宁可多试不可漏试）。
4. **steer 触发的失败一律不重试**：重试的重发对象是 `lastSend`，而 steer 内容不进 `lastSend`；若对 steer 失败做自动重试，resend 会重发更早那条已跑过的消息（整轮重做且丢掉用户真正想说的话），continue 又会让 agent 继续原任务、同样丢掉 steer 内容。故该路径整体排除。代价是插话遇到瞬时故障没有自愈。
5. **无总时长上限**：只限次数不限总时长。agent 每轮跑很久才失败时，10 次可能拖很长。不加总时长闸门是为了机制简单 —— 用户可见进度、可随时取消。
6. **`detail` 随 `messages` 落盘**：正式错误气泡的原文会进 localStorage 快照，故做长度截断。重试中间态不落盘。

## 实现回填（2026-08-25 本轮落地后补记）

实现期与本稿不一致、或本稿没覆盖而由实现拍板的地方，逐条记在这里，评审以此为准：

1. **`error` part 的落点是 `src/store/types.ts` 而非 `protocol.ts`**。`Part` 判别联合本来就住在 store 类型里，协议层没有它。
2. **重试发出后的兜底（本稿缺）**：`markPendingSend` 那条 45s `SEND_TIMEOUT` 只服务用户手动发送，且它会清 `agentRetry`（手动发送 = 放弃自愈），重试路径不能复用 —— 复用等于一发出就把自己的状态清了。故 `useAgentRetry` 自行设 45s 定时器，到点仍 `phase==='running'` 且 run 没开跑就按本次失败推进。不加这道，进度会永远停在「重试中 n/10」。
3. **`mode` 加了单调性**：进过 `continue` 就不再退回 `resend`。本稿只写了「每次失败重判」，但兜底路径（发出后 run 永不开跑）拿不到 `runId`，纯按 `lastMessageId` 重判会把已有产出的会话退化成从头重发。产出是不可撤销的事实，判定只能单向。
4. **steer 用独立 action `markSteerSent`**，不是本稿 ⑦ 写的「`markPendingSend` 记 steer」—— 后者会置乐观计时并起 45s 兜底，而 steer 不开新轮，两件事必须分开。
5. **手动重试按钮只挂最后一条错误气泡**（本稿未定）：判据 `lastSend` 可重发 + 无进行中重试 + 无在跑的 run + 该消息是 `messages` 末条。给历史里的旧错误挂重试等于诱导重跑一遍。selector 返回布尔，流式期每 token 一次的数组变化不会扇出重渲。
6. **i18n 是 11 语不是本稿写的四语**（`de/en/es/fr/ja/ko/pt/ru/vi/zh-TW/zh`，`i18n.test.ts` 递归断言 key 与 en 完全一致）；手动重试的键名是 `chat.retry.manual`，不是本稿 ⑧ 写的 `chat.error.retry`。
7. **`run.finished{failed}` 但不带 `error` 对象的帧沿用既有行为**：既不推气泡也不重试。本稿没提这个边界，实现刻意不扩大改动面。

### 本轮验证输出

`pnpm lint` 0 error（12 warning 均为既有 `_`-前缀变量）· `pnpm exec tsc --noEmit` 退出码 0 · `pnpm test` 307 files / 4117 passed, 4 skipped · `pnpm test:tz` 4 passed / 1 skipped · `pnpm build` Compiled successfully。

## 补记（2026-08-25 晚）：决策 2 的前提被后端契约推翻

读 `rezonalab-koubou-agent` 的 `docs/websocket-events.md` §上游/模型侧失败 + `app/sessions/actor.py:2795-2960` 后确认：**后端有机器码，而且已经算好了 `retryable`**。本稿决策 2「后端应用层错误无机器码，只能匹配文案」沿用自 2026-06-30 那份错误本地化设计稿，对这一族**已经过时**。

`error` payload 实际有四种形状：

| 形状 | 场景 |
|---|---|
| `{message}` | 协议/操作类（`run already active`、`invalid model`…）——这一族确实无机器码，决策 2 对它仍然成立 |
| `{message, interaction_id}` | stale 交互（只清弹窗，不进本路径） |
| `{type, message}` | Claude run 执行异常（`type` 是异常类名）/ 孤儿 run（`type: "OrphanedRun"`） |
| `{code, message, api_error_status, retryable}` | **上游/模型侧失败 —— 过载 / 限流 / 5xx 正是走这支** |

第四族的后端分类（`_ERROR_MARKER_CODES` / `_classify_status`）：

| code | 触发 | `retryable` |
|---|---|---|
| `upstream_unavailable` | 429 / 408 / 5xx、rate_limit、server_error | true |
| `upstream_auth_failed` | 401 / 403、billing_error | **false** |
| `upstream_error` | 其余 4xx（400/404/409/422…） | **false** |
| `output_limit` | 输出 token 上限截断 | **false** |
| `budget_exceeded` | 本轮达成本上限 | **false** |
| `execution_error` / `run_error` | 兜底 | true |

**照本稿实现会出的两个错**（已修，见 commit `8fabf982`）：

1. 这族 payload 没有 `type`、`message` 也不在 `KOUBOU_MESSAGE_CODES` 里 → `classifyKoubouError` 给出 `code: undefined` → `isRetryableAgentError(undefined)` 为 true → 四类**明确不可重试**的失败被白烧 10 次（约 70s）。鉴权/计费是账号级问题，`budget_exceeded` 更是越试越花钱。
2. `koubouErrorDetail` 只读 `type`/`message`，而这族的信息在 `code` 与 `api_error_status` 里 → detail 退化成与主行完全重复的同一句脱敏英文。后端 `MessageError.raw`（真正的上游原文）**只进服务端 trace、绝不下发**（`public()` 不含它），所以「透传上游具体报错」能拿到的上限就是这个脱敏结构，而其中唯一有信息量的两个字段恰好被丢了。

**修正后的口径**：`payload.retryable` 在场即以它为准（后端权威判定），缺失时才回落前端黑名单；四个不可重试的后端码也一并进黑名单，作为 `retryable` 漏发时的降级兜底（不是第二份判据——`retryable` 永远优先）。后端 code **原样**进 `ERROR_KEYS`（snake_case，不做大小写归一，归一就是臆造），配 11 语译文让主行说人话；`detail` 拼成 `code (HTTP nnn): message`，异常类名仍优先于 code。

### 本轮范围外、但已确认存在的前端缺口

`code: "output_limit"` 后端要求前端**按 `run_id` 丢弃这一轮已累积的流式正文**——服务端开着 `include_partial_messages`，判定截断之前增量已经流给客户端了，极端情况是十几万 token 的重复文本（lab-prod 2026-08-12 实测单轮 561 KB / 587 KB）；且它的 run 收尾是 `interrupted` 而非 `failed`。`src/` 全库搜不到任何 `output_limit` 处理。建议另开一轮，不塞进本轮。

## 决策 2 修正（2026-08-25 晚，最终口径）：黑名单 → 白名单

**只有确证该重试的才自动重试，其余一律落报错 + 手动重试。**

白名单只有两项：

1. **后端 `retryable === true`** —— 主力判定。上游过载 / 限流 / 5xx / 408 全靠它，是后端按 HTTP 状态码与错误标记算好的权威结论。`retryable` 正反两向都压过前端表：后端说 `false` 就绝不重试。
2. **`RUN_ABANDONED`（孤儿 run）** —— 唯一的前端判定项。属主 Pod 没了，重试必然正确，而后端这条路径不下发 `retryable`。

刻意排除、落手动重试的：

- **`AGENT_RUN_ERROR`（Claude 执行异常）**：异常类名千奇百怪，可能是 agent 代码硬 bug，重试 10 次每次都真跑一轮。
- **`SEND_TIMEOUT`（重试发出后 run 没开跑的兜底）**：让它收口为正式错误，顺带消除「后端排队慢 → 兜底再发一条 → 双执行」的风险（koubou 当前无 `event_id` 去重）。兜底现在只负责收口，不自己发第二条。
- 所有协议/操作类错误、所有前端不认识的 code。

**为什么改**：后端 error 的取值空间前端管不住。后端新增一种业务错误（`quota exceeded` / `model unavailable`…），黑名单会在前端补码之前把它**白烧 10 次退避**；白名单只是不自动重试，用户仍有手动入口。失效方向安全得多 —— 这也一并消掉了本稿原「取舍 3：黑名单随后端文案漂移」那条风险。

## 取舍 4 作废（2026-08-25 晚）：插话纳入自愈

原取舍 4「steer 触发的失败一律不重试」的理由是「插话内容不进 `lastSend`，重发只会重跑更早那条已跑过的消息」。**浏览器实测推翻了这个前提**：无活动 run 时发 `user.steer`，后端并不报错，而是把它当一条新消息照常起了一轮 run（2026-08-25 验证，`runStatus` 转 running、消息增长，点 Stop 才停）。

既然后端就是把插话当新消息跑，那么把插话内容存进 `lastSend` 后，resend 它 = 重发用户那句话，语义完全正确。

旁证来自 Claude Code 自己的做法：它运行中按 Enter 只是把消息**排队在本地**，不参与 API 层重试——因为消息还没发出去，重试失败后内容仍在本地，用户直接回车即可。其实质保障是**用户输入不因一次上游抖动而丢失**。而我们这边 `send()` 发出 steer 后就 `resetComposer()`，内容只剩在已发出的用户气泡里；按原取舍，这轮一失败用户那句插话就得重打一遍。

**新口径**：`LastSend` 去掉 `kind` 判别（普通发送与插话同权，只存 `{content}`），`markSteerSent(content)` 记下插话原文。三件事一并解决——自动重试 resend 就是重发那句插话、手动重试按钮对插话也可用、内容不丢。`markSteerSent` 仍与 `markPendingSend` 分开：后者会置乐观计时与 45s 兜底，而插话不开新轮。

## 合并前评审记录（2026-08-25）

派了三个干净上下文的子代理（正确性 / 后端契约 / 仓库规范），但它们在本次会话下**全部只报空闲、不产出结论**（机制问题，非单个 agent 偶发），故由主上下文自行完成评审。以下是实际查证过的项与结论。

### Critical / Important — 发现 1 条，已修

**手动重试的 `mode` 判定钉错了轮次**（`src/store/index.ts` · commit `a70831c4`）。原判据取 `turns` 末条的 `lastMessageId`，但失败可能**根本没起 run**（`error` 事件先于 `run.started` 到达，`turns` 不新增条目），此时末条是上一轮**成功**的 turn —— 用户点「重试」实际发出 `continue` 而不是重发那句话。先写探针跑红（`expected 'continue' to be 'resend'`）再修，加 `status === 'error'` 校验，补三条边界测试。reducer 侧的 `failAgentTurn` 无此问题（按 `runId` 精确匹配，找不到即 `resend`）。

### 查过、无发现的层面

- **双发**（最严重的一类：后端无 `event_id` 去重，双发即双执行双扣费）：`connStatus` 反复抖动导致 effect 多次重跑、等待期用户手动发送两个时序都验过，`sendUserMessage` 只被调用一次。已转成常驻测试守护（`useAgentRetry.test.tsx`）。
- **后端 code 全集**：`grep` 后端 `actor.py` 的 code 字面量共 7 个（`upstream_unavailable` / `upstream_auth_failed` / `upstream_error` / `output_limit` / `budget_exceeded` / `execution_error` / `run_error`），前端 `ERROR_KEYS` 逐字对齐，无遗漏无拼写差异。
- **孤儿 run 的 payload 形状**：`run_lifecycle.py:104` 与 `service.py:170` 确认只有 `{type, message}`、**不带 `retryable`**，所以白名单里的 `RUN_ABANDONED` 能生效（若后端哪天给它带上 `retryable: false`，会正确地压过白名单）。
- **hook 顺序**：`AgentRetryBubble` 的所有 hook 都在 `if (!retry) return null` 之前。
- **瞬态**：`agentRetry` / `lastSend` 不在 `partializeAppState` 与 `sessionSnapshot` 里；浏览器实测落盘快照确无这两个键，刷新后无残留转圈气泡。
- **切项目**：`switchProjectSession` 展开 `createInitialKoubouState()` 即清；hook 的 effect 随 `phase` 变 null 重跑并清定时器。

### Minor（记录，不改）

1. `useAgentRetry` 的 `fire()` 在 `connStatus === 'open'` 但 `client.current` 恰为 `null` 时（切项目瞬间的窄窗口），会置 `phase: 'running'` 却没真发出去 —— 不是双发，是漏发，45s 兜底会把它收口为正式错误 + 手动重试。代价可接受，不为这个窄窗口加锁。
2. 重试自身发出时不调 `markPendingSend`，故不置乐观计时、不显示生成骨架 —— 进度气泡本身已是反馈。

## 第二轮评审（2026-08-25 晚，子代理独立评审成功）

第一次派的三个子代理只报空闲不产出；改为要求它们**边审边把结论写进文件**后成功，拿到两份实质结论（正确性、仓库规范；契约那份也在同一批）。以下按「我逐条验证过」的结果记录。

### 已修（Critical / Important）

根因是同一件事：**后端 live 的 `run.finished` payload 从不带 `error`** —— 两处发送点 `actor.py:1631` 与 `run_lifecycle.py:81` 都只有 `{run_id, status}`，孤儿的 `{type:"OrphanedRun"}` 只写 runs 表与 trace，不进事件流（我亲自核过）。由此暴露三处（commit `83957fae`）：

1. **自愈在生产主路径上大概率第一次就夭折**。`onError` 不关轮 → `error` 事件到达时 `runStatus` 仍是 `running`，而真正关轮要等随后那条 `run.finished`，间隔无上界（后端发完 error 还会继续 drain 流，`finally` 里另有数段 await）。首档退避只有 1s，重试撞上后端 `start_run` 的 `run already active` 门（`actor.py:783`），该文案不在白名单 → 直接 giveUp，**用户看到的报错还指错方向**。改：run 未关闭时挂起，关闭即补发（与断连挂起同构）。
2. **`agentRetry` 锁死在 `phase:'running'`**。打断、或无 `error` 的 `failed` 都不清重试态，而 45s 兜底只装一次、到点时 run 还在跑就直接 return。后果：进度气泡无限转圈，且手动重试判据含 `agentRetry == null`，**所有错误气泡的重试按钮一并消失**。改：终态帧统一收口。
3. **孤儿 run 完全静默**。属主 Pod 死掉时只有一条不带 error 的 `failed`，前端原本什么都不做。改：补失败气泡，靠新增的 `TurnMeta.errorReported` 与 error 事件去重。

规范侧两条（commit 见下）：

4. **`upstream_unavailable` 译文语义与显示时机相反**：写的是「正在重试…」，但这条译文**只在不再重试时**才会渲染（重试中界面上是 `chat.retry.progress` 的进度气泡）。11 语统一改成不预告行为的表述。
5. **`pt.ts` 串入欧洲葡语**：该文件基线是巴西葡语（`Excluir` / `arquivo` / `usuário` / `Contate o suporte` / `solicitação`），而新增块用了 `A tentar novamente` / `Contacte` / `o pedido`，且块内自己就不统一。已对齐 pt-BR。

### 已修（Minor 中值得顺手处理的）

- 白名单改造后遗留的两处「黑名单」注释（注释与判据相反会让读者理解反失效方向）。
- `run.finished` 分支靠比对 `classifyKoubouError` 的默认字面量 `'agent error'` 反推「上游没给 message」—— 跨模块隐式耦合，改那边不会有任何报错、这里只会静默失效。改为直接读原始字段。
- `retryAgentNow(from?)` 的可选参数只有测试在用（CLAUDE.md 反模式「留测试导向的生产代码」）→ 改必填，并在 action 层补一道 `agentRetry` 已存在即 no-op 的防线。
- `mode` 三元表达式的 `||` 与 `?:` 加括号。
- 计数/上限那组测试原先用 `run.finished{failed,error}` 驱动 —— 生产不会出现的形状，覆盖弱于表面。改用 `error` 事件驱动。

### 评审提出但**不采纳**（已验证不成立）

- 「插话失败会误发 `continue`」：评审推理是「插话发生在 running，该 run 必有输出 → mode=continue」，但失败的是插话**起的新 run**，它还没吐字。探针实测 `mode` 为 `resend`，spec「取舍 4 作废」的承诺是兑现的。

### 记录、不改

- `connStatus` 抖动会重置 45s 兜底窗口（断线重连循环中收口可能迟迟不到）。不是双发，评审自己也判「记录不改可接受」。
- `retryAgentNow` 从 `attempt: 1` 起算（与 spec ⑦ 字面「从 0 起」有出入，行为可接受）。
- `cancelAgentRetry` 在 `phase:'running'`（命令已发出）时仍推正式错误气泡，若这次重试随后成功，对话里会夹一条与结果矛盾的红气泡。
- danger 气泡外壳与文字小按钮的 className 在 `AgentRetryBubble` 与 `MessageItem` 各写一份（令牌本身合规，但属「迟早漂移」的同一模式，可择机抽共享常量）。
- 后端 `retryable` 的兜底是 `True`（`_RUN_ERROR` / `execution_error`），所以「后端新增业务错误会自动落到手动重试」并不绝对成立 —— 只要它没被 `_classify_status` / `_ERROR_MARKER_CODES` 收进非 retryable 那几档，仍会被重试。这是后端契约决定的，本稿「为什么改白名单」的论证需打个折。
- 项目 `CLAUDE.md` 里「后端按 `event_id` 去重」这句与后端现状不符（`client_event_id` 只用于回显去重，`actor.py:797`；`src/koubou/client.ts:56-60` 的注释反而是准确的）。建议择机订正该文档。
- `session.ready` 已不再携带 `visible_state.messages`（后端 `SessionReadyPayload` 无此字段），前端那条重建回退分支已是死码，前端 `CLAUDE.md` 相应描述也过期。与本轮无关，记录备查。

---

## 后续打磨轮（2026-08-27，分支 `fix/agent-error-bubble-polish`）

三件事：danger 气泡内部配色与行内动作样式、点手动重试即摘掉被点的那条错误气泡、自愈发出的消息带不可见哨兵前缀（历史不再留 `continue` / 重复原话）。

### 评审（干净上下文子代理，只给本稿与 commit 范围 diff）处置

**Critical（已修）** —— 摘掉气泡把一条既有 bug 的后果放大成「失败完全无痕」。根因不在本轮改动，而在 `run.finished{failed}` 的 `errorReported` 短路：它把 `error` 事件刚安排好的 `agentRetry` 一并清成 `null` 且不补气泡。而生产常态的到达顺序恰好是「`error` 事件 → 紧跟一条不带 error 的终态帧」，于是**自动重试第一次就被自己掐死**；本轮摘掉气泡后，这条路径上屏幕会全空（无进度、无气泡，连手动入口都没有——`canRetry` 判据要有气泡）。探针实测 `retry=null msgs=0`。改：`reported` 分支只收口 run 状态，不动 `agentRetry`。补了两个测试，其中一个是不变式（终态帧过后要么自愈还在、要么有可见错误气泡），不依赖逐条路径各自记得。

**Important（已修）**
- 行内动作与复制图标用透明度换层级，把可交互控件压到 3:1 以下（复制图标从 muted 的 3.62 掉到 2.38）。改：常态不压透明度，层级靠 hover 底色。
- 哨兵只覆盖了 `continue`，`resend` 模式重发的用户原话同样落日志、同样不推本地气泡 → 刷新后用户那句话在历史里出现两次（最多 10 次）。改：两种模式都打哨兵。

**Minor（已修）**：哨兵判据补 `trimStart`（与打断哨兵同口径）；哨兵改成**两个**连续 U+2063（前缀判据必须保留——resend 后半截是任意用户文本——两个不可见分隔符连着出现在粘贴文本里不可想象，以此收窄误伤面）；共用样式常量挪到 `components/chat/danger-bubble.ts`（不再寄居在 `ErrorDetail`）；复制按钮补 hover 面。

**技术性异议 / 记录不改**
- M-3 建议把布局类（`ml-auto` / `shrink-0`）留给调用方：当前两处调用方都要，抽出去反而两边各写一份，保留在常量里。
- 「手动重试后用户按停止 → 原错误消失」不算缺陷：用户自己终止的，且有本地化「已终止」回复顶上。
- 明主题 `--color-danger-fill` 与 `--color-danger-soft` 同值：该 token 语义只在「叠在 danger-soft 之上」成立，不可直接铺页面底。
- `<summary>` 的 `opacity-80` 是本轮之前就有的装饰性折叠头，不是动作按钮，不动。

### 本轮自己踩到的

`lastSend.content` 可以是 `ContentBlock[]`（带附件的发送），哨兵不能只会拼字符串——数组形态改为前插一个独立 text block，过滤侧的 `contentText` 只拼 text block 看前缀，两种形态同一判据。是 `tsc` 抓出来的，已补测试。

### 存量代价

已经落进事件日志的裸 `continue` / 重复原话没有哨兵，滤不掉。要连它们一起滤只能按文本匹配，那会误伤用户自己打的 `continue`——这是哨兵方案主动放弃的部分，老会话保持现状。

---

## 第二轮打磨（2026-08-27，分支 `fix/retry-bubble-polish`）

三件事，均为决策 5 / ⑧ 的修订，**以本节为准**：

1. **进度气泡不再展开上游原文**（推翻决策 5 的「+ 本次上游原文」与 ⑧ 的「同款可展开详情」）。它是「系统正在自愈」的进行态，不是报错；自愈期就摊开一坨异常栈，等于让用户为一件系统自己在处理的事排障。原文没丢——取消或次数耗尽时随 `agentRetry` 落成正式错误气泡再展示。`ErrorDetail` 自此只挂正式错误气泡。
2. **气泡的消失时机从「成功」提前到「后端受理」**（修订决策 5 的「成功即消失」）。`AgentRetry.phase` 增加取值 `'responded'`：`run.started` 到达且当前是 `'running'` 时转入，气泡就此退场——重试发出到 run 起来只是一瞬，之后隔着整轮生成，原先要让用户盯着「重试中 3/10」的红气泡看 agent 干完一整轮。
   - **状态不清空**：`attempt` 还得留着，否则「起跑后再失败」每次从 1 重数，10 次上限形同虚设。
   - **只从 `'running'` 转**：退避等待期收到的 `run.started` 不是本次自愈的回声。
   - 执行侧（`useAgentRetry`）对 `responded` 撒手，且**必须早于致命态收口**：此刻 agent 正在答，拿上一次的失败原因落气泡是陈年错误；也不能掉进 `fire` 分支，那里会 `scheduleAgentRetry` 把 phase 又拨回 `waiting`。
3. **气泡首行的前导标记与文字对齐**：改由字体度量派生——气泡外壳与首行都用 `items-baseline`（顺带让行内动作按钮的文字与正文基线齐），标记本体 `align-middle` 挂在文字基线上（位置 = 基线 − x-height/2，正好是字形的光学中心，换字号自动跟随）。共用类抽进 `danger-bubble.ts`（`DANGER_LEAD_CLS` / `DANGER_LEAD_DOT_CLS` / `DANGER_ROW_CLS`，顺带兑现上一轮「记录不改」里那条「可择机抽共享常量」）。
   - **走过的弯路**：先改成「等行高盒子里 flex 居中」，只对「首行就是文字」成立——首行里还有行内动作按钮（12px 字 + `py-[2px]` + 1px 边框 = 26px），比 20px 的文字行盒高，`items-center` 把文字往下推 3px 而标记仍贴行顶。是 Nick 看截图指出来的；我第一次「量过了」的说法不成立（取错了元素，把行盒中心与自己比，等于没量）。真机复测记录：改前圆点中心 88 / 文字光学中心 91.95，改后 91.45 / 91.95（0.5px 是 x-height 与字体 `sxHeight` 的固有出入）。

### 评审（干净上下文子代理，只给本稿与 commit 范围 diff）处置

**Important（已修）** —— `phase:'responded'` 有永久残留口，且是本轮新引入的回归。改动前同场景 phase 是 `'running'`，45s 兜底会收口；`responded` 直接 return 后这道网没了，而它的清空只挂在终态帧上。`session.ready` 不碰 `agentRetry` 却会把 `runStatus` 拨成 `idle`（我核过 `apply-koubou.ts` 的 ready 分支）——于是「自愈那轮起来了 → 断线 → 重连时后端已无 active run」会让终态帧永不到达：`agentRetry` 永久非 null，而手动重试判据含 `agentRetry == null`，**进度气泡不渲染、手动入口也一并消失，屏幕上一个出口都没有**。改：`responded` 撒手的只是「排期与发送」，不是不变式——回合一旦不在跑就清空（此刻计数已无消费者：唯一消费者是「这轮跑着的时候再失败」，而那条路径由 `failAgentTurn` 先把 phase 拨回 `waiting`）。补了出口不变式测试。

**Minor（已修）**
- 新测试用了上一轮明确废弃的 `run.finished{failed,error}` 形状驱动计数（后端两处发送点只发 `{run_id,status}`）。改用 `error` 事件驱动，并补上「紧跟的终态帧走 `errorReported` 短路、不动刚排好的自愈」这半截——那正是上一轮 Critical 的同一段代码。
- `AgentRetryBubble.test.tsx` 的夹具 `nextAt: null` 让「等待期」用例其实都走非等待分支（组件判据是 `phase==='waiting' && nextAt != null`）。夹具改带 `nextAt`。
- 圆点 / spinner 的等行高盒子两处同构 → 抽 `DANGER_LEAD_CLS`。

**评审确认无 Critical**：双发、计数归零、重复报错、持久化四类逐条核过——`fire()` 只从 `waiting` 出发；`failAgentTurn` 读 `attempt ?? 0` 故不归零；`responded` 期 `cancelAgentRetry` 已无调用方；`agentRetry` 既不在 `partializeAppState` 也不在 `sessionSnapshot`，无落盘风险。
