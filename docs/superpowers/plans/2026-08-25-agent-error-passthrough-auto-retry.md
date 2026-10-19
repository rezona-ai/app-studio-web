# Agent 错误透传 + 自动重试 + steer 入口 — 实现计划

> 设计稿：`docs/superpowers/specs/2026-08-25-agent-error-passthrough-auto-retry.md`
> 分支：`feat/agent-error-passthrough-retry`（worktree，基点 dev @ `edec2977`）

## 任务总览

按「能独立跑测试、能独立评审」拆。A1–A2 是纯函数底座；A3–A4 交付**需求前半段（原文透传）**，到此可独立合并；A5–A8 交付**后半段（自动重试）**；B1–B2 是 steer 入口，与 A 无依赖，放最后。

| # | 任务 | 落点 | 依赖 |
|---|---|---|---|
| A1 | 重试判据纯函数 | `src/lib/agent-retry.ts` | — |
| A2 | 上游原文归一 | `src/i18n/errors.ts` | — |
| A3 | 协议层 `detail` + reducer 失败入口收敛 | `protocol.ts` · `apply-koubou.ts` | A2 |
| A4 | 错误气泡展示原文 + 词条 | `MessageItem.tsx` · 11 语 | A3 |
| A5 | 重试状态 + reducer 判定 | `store/types.ts` · `apply-koubou.ts` | A1 A3 |
| A6 | store actions | `store/index.ts` | A5 |
| A7 | 重试执行 hook | `src/client/useAgentRetry.ts` | A6 |
| A8 | 重试进度气泡 + 词条 | `AgentRetryBubble.tsx` · `ChatPanel.tsx` · 11 语 | A6 |
| B1 | running 态并排按钮 + 词条 | `Composer.tsx` · 11 语 | — |
| B2 | steer 图片折 token 修复 | `Composer.tsx` | — |

**i18n 注意**：语言包是 11 个（`src/i18n/locales/{de,en,es,fr,ja,ko,pt,ru,vi,zh-TW,zh}.ts`），`i18n.test.ts` 递归断言各语言叶子 key 与 en 完全一致、TS 类型再兜一道。凡新增词条必须 11 个文件同步加，漏一个测试就红。

## 相对 spec 的一处补充

spec 没写「重试发出后 run 永不开跑」的兜底。现有 `markPendingSend` 的 45s `SEND_TIMEOUT` 兜底只服务用户手动发送，且它会清 `agentRetry`（用户手动发送 = 放弃重试），重试路径不能复用它 —— 否则重试一发出就把自己的状态清了。

**处置**：`useAgentRetry` 发出后自行设 45s 定时器，到点若仍 `phase === 'running'` 且 `runStatus !== 'running'`，调 `failAgentRetry({ code: 'SEND_TIMEOUT' })` 当作本次失败推进（复用同一套 attempt / 上限 / mode 判定）。不这么做，气泡会永久停在「重试中 n/10」。

## A1 · 重试判据纯函数

**先写失败测试** `src/lib/agent-retry.test.ts`：

- `isRetryableAgentError`：6 条业务码 + `BUILD_FAILED` → `false`；`AGENT_RUN_ERROR` / `RUN_ABANDONED` / `undefined` → `true`
- `retryDelayMs`：`0→1000`、`1→2000`、`2→4000`、`3→8000`、`4→8000`（封顶不越界）
- `MAX_AGENT_RETRIES === 10`

**实现** `src/lib/agent-retry.ts`：

```ts
export const MAX_AGENT_RETRIES = 10;
export type RetryMode = 'resend' | 'continue';

// 必然再失败的业务错误不重试。口径与 i18n/errors.ts 的 KOUBOU_MESSAGE_CODES 对齐 ——
// 那 6 条是后端固定文案(参数非法 / 状态冲突 / 已失效交互),重发只会被原样再拒一次;
// BUILD_FAILED 同理(产物本身有问题,重跑不变)。
// 刻意**不**列 RUN_ABANDONED:孤儿 run 恰恰是瞬时故障(属主 Pod 没了),正是该重试的那类。
const NON_RETRYABLE: ReadonlySet<string> = new Set([
  'INVALID_USER_MESSAGE', 'RUN_ALREADY_ACTIVE', 'INVALID_PERMISSION_MODE',
  'INVALID_MODEL', 'STALE_TOOL_APPROVAL', 'STALE_QUESTION_ANSWER', 'BUILD_FAILED',
]);

export function isRetryableAgentError(code: string | undefined): boolean {
  return !(code && NON_RETRYABLE.has(code));
}

// 与传输层 scheduleReconnect 同一套语汇(min(1000·2ⁿ, 8000)),attempt 从 0 起
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}
```

**验证**：`pnpm exec vitest run src/lib/agent-retry.test.ts`

## A2 · 上游原文归一

**先写失败测试**（追加进 `src/i18n/errors.test.ts`）：

- `{ type: 'AnthropicOverloadedError', message: 'Overloaded' }` → `'AnthropicOverloadedError: Overloaded'`
- 无 `type` → 原样 message
- 无 message 有 type → 只 type
- 两者皆空 → `undefined`
- 超长 message → 截断到上限并带省略号

**实现**（`src/i18n/errors.ts`，紧邻 `classifyKoubouError`）：

```ts
// detail 随 error part 落进持久化的 messages,故截断防超长堆栈把 localStorage 快照撑爆
const DETAIL_MAX = 2000;

// 上游原文详情:有异常类名时拼成 `Type: message`,否则原样 message。
// 与 classifyKoubouError 分工:那个出「稳定 code + 主行 fallback」,这个出「给人看的完整原文」。
export function koubouErrorDetail(p: { message?: unknown; type?: unknown }): string | undefined {
  const msg = (typeof p.message === 'string' ? p.message : '').trim();
  const type = (typeof p.type === 'string' ? p.type : '').trim();
  const full = type && msg ? `${type}: ${msg}` : type || msg;
  if (!full) return undefined;
  return full.length > DETAIL_MAX ? `${full.slice(0, DETAIL_MAX)}…` : full;
}
```

**验证**：`pnpm exec vitest run src/i18n/errors.test.ts`

**commit（A1+A2 合并一提）**：`feat(koubou): 补重试判据与上游原文归一两个纯函数`

## A3 · 协议层 `detail` + reducer 失败入口收敛

**先写失败测试**（追加进 `src/koubou/apply-koubou.test.ts`）：

- `error` 事件带 `type` + `message` → 气泡 part 带 `detail: 'Type: message'`，主行 `text`/`code` 与今天一致
- `run.finished{failed}` 内嵌 error → 同样带 `detail`
- 固定文案命中 code（如 `invalid model`）时 **detail 仍在**（决策 6：统一口径，不分两支）
- 无 message 无 type → `detail` 为 `undefined`（不写空字段）

**实现**：

1. `protocol.ts` 的 error part 加 `detail?: string`。
2. `apply-koubou.ts` 抽出并 export（A5 要在 store 侧复用）：

```ts
// agent/run 级失败的唯一收口。两个入口(error 事件 / run.finished{failed})此前各推各的气泡,
// 收敛成一处是为了 A5 的重试判定只写一份 —— 判据各写一份是本仓明列的反模式。
export function failAgentTurn(state: KoubouState, f: AgentFailure): KoubouState {
  return pushErrorBubble(state, f.code, f.fallback, f.detail);
}
```

3. `pushErrorBubble` 扩 `detail` 参数，仅在有值时写进 part（不写 `detail: undefined` 字段，保持快照形状干净）。
4. 两个入口改调 `failAgentTurn`；`onError` 保留其 `pendingSendAt/pendingModel` 清位，`run.finished` 保留 `sealed()`。

本任务**只做透传**，重试判定留给 A5 —— 这样这一步的 diff 可以单独评审「行为等价 + 多一个字段」。

**验证**：`pnpm exec vitest run src/koubou/apply-koubou.test.ts`

**commit**：`feat(koubou): error 气泡带上游原文 detail,两处失败入口收敛到 failAgentTurn`

## A4 · 错误气泡展示原文

**先写失败测试**（追加进 `src/components/chat/MessageItem.test.tsx`）：

- part 带 `detail` → 渲染「详情」折叠触发器；展开后原文可见
- part 无 `detail` → 不渲染折叠区（不留空壳）
- 主行仍走 `resolveErrorMessage`（命中 code 用译文）

**实现**：

- `MessageItem.tsx` 的 `case 'error'` 分支：主行不变，其下加 `<details>`（`<summary>` 用 `chat.error.detail`），内容 `font-mono text-[12px]` + `overflow-x-auto` + 复制按钮（复用既有复制实现与 `COPIED` 反馈 code）。
- 词条 11 语同步加：`chat.error.detail`、`chat.error.copy`。
- 令牌全部复用（danger 软底、`--font-mono`、`IconButton`），不新增色值 / keyframes。

**验证**：`pnpm exec vitest run src/components/chat/MessageItem.test.tsx src/i18n/i18n.test.ts`

**commit**：`feat(chat): 错误气泡可展开上游原文并支持复制`

> 到此需求前半段完整可用。A5 起进入自动重试。

## A5 · 重试状态 + reducer 判定

**先写失败测试** `src/koubou/apply-koubou.retry.test.ts`（新文件）：

| 用例 | 断言 |
|---|---|
| 可重试错误 + `lastSend` 有值 | **不推气泡**，`agentRetry.attempt === 1`、`phase === 'waiting'` |
| 该 run 的 `turn.lastMessageId == null` | `mode === 'resend'` |
| 该 run 的 `turn.lastMessageId != null` | `mode === 'continue'` |
| `error` 事件无匹配 run | `mode === 'resend'` |
| 先 resend 失败、再有输出后失败 | 第二次 `mode` 变 `continue`（每次重判，不沿用） |
| 业务错误码 | 推气泡、`agentRetry` 为 null |
| `lastSend == null` / `kind === 'steer'` | 推气泡、不重试 |
| 第 11 次失败 | 推气泡（含最后一次 detail）、清 `agentRetry` |
| `run.finished{succeeded}` | `agentRetry` 清空 |

**实现**：

1. `store/types.ts`：`KoubouState` 加 `lastSend` / `agentRetry`（形状见 spec ④），初值 `null`；**确认不进** `partializeAppState` 与 `sessionSnapshot`（这两处不动即为瞬态，但要在 A5 的 diff 里显式核一遍）。
2. `apply-koubou.ts` 的 `failAgentTurn` 升级为完整判定：

```ts
export function failAgentTurn(state: KoubouState, f: AgentFailure): KoubouState {
  const bubble = (): KoubouState => ({ ...pushErrorBubble(state, f.code, f.fallback, f.detail), agentRetry: null });
  // steer 内容不进 lastSend:重发只会重跑更早那条已跑过的消息,并丢掉用户真正想说的话
  if (!state.lastSend || state.lastSend.kind === 'steer') return bubble();
  if (!isRetryableAgentError(f.code)) return bubble();
  const attempt = (state.agentRetry?.attempt ?? 0) + 1;
  if (attempt > MAX_AGENT_RETRIES) return bubble();
  // 本轮是否已有助手输出 —— lastMessageId 在助手消息落定/流式开篇时被 patch,
  // tool_use 作为助手消息的 part 天然包含在内,无需另造判据
  const turn = f.runId ? state.turns.find((t) => t.runId === f.runId) : undefined;
  const mode: RetryMode = turn?.lastMessageId ? 'continue' : 'resend';
  return { ...state, agentRetry: { attempt, mode, phase: 'waiting', nextAt: null, text: f.fallback, code: f.code, detail: f.detail } };
}
```

3. `run.finished{succeeded}` 分支清 `agentRetry`。
4. 切项目清空：核 `switchProjectSession` 的会话态重置是否覆盖新字段（同一次 `set` 内清，维持既有不变式）。

**验证**：`pnpm exec vitest run src/koubou/apply-koubou.retry.test.ts src/koubou/apply-koubou.test.ts`

**commit**：`feat(koubou): 失败按阶段判定重试动作(重发/continue)与次数上限`

## A6 · store actions

**先写失败测试**（追加进 `src/store/pending-send.test.ts` 或新建 `src/store/agent-retry.test.ts`）：

- `markPendingSend(payload)` → `lastSend` 记下 payload 且清 `agentRetry`
- steer 路径 → `lastSend.kind === 'steer'`
- `scheduleAgentRetry(t)` → 写 `nextAt`；`startAgentRetry()` → `phase='running'`、`nextAt=null`
- `cancelAgentRetry()` → 落正式错误气泡（带最后一次 detail）且清态
- `failAgentRetry({code:'SEND_TIMEOUT'})` → 走同一套判定推进 attempt
- `retryAgentNow()` → attempt 从 0 重新计

**实现**（`src/store/index.ts`）：`markPendingSend` 扩参记 `lastSend`；新增上述四个 action，内部一律复用 `failAgentTurn`，不另写判定。

**验证**：`pnpm exec vitest run src/store/`

**commit**：`feat(store): 重试上下文落库与取消/手动重试入口`

## A7 · 重试执行 hook

**先写失败测试** `src/client/useAgentRetry.test.ts`（假计时器 + FakeWS，仿 `client.test.ts` 既有做法）：

- `phase='waiting'` → 到 `retryDelayMs(attempt-1)` 才发，早一毫秒不发
- `mode='resend'` → 发出的是原 payload；`mode='continue'` → 发 `{ role:'user', content:'continue' }` 且**不**新增用户气泡
- `connStatus !== 'open'` → 到点不发；转 open 后立即补发
- `connStatus` 进 `fatal`/`superseded` → 落正式错误、清态
- 发出后 45s 无 `run.started` → 按 `SEND_TIMEOUT` 推进下一次
- 卸载 / 切项目 → 清定时器，不再发

**实现**（`src/client/useAgentRetry.ts`，挂在 `Workspace` 或 `ChatPanel` 与 `useKoubouConnection` 同层，拿到同一个 `clientRef`）：订阅 `agentRetry` + `connStatus`，按 spec ⑥ 执行。所有定时器在 effect 清理里 `clearTimeout`。

**验证**：`pnpm exec vitest run src/client/useAgentRetry.test.ts`

**commit**：`feat(client): 按退避执行自动重试,断连挂起、fatal 终止`

## A8 · 重试进度气泡

**先写失败测试** `src/components/chat/AgentRetryBubble.test.tsx`：

- `agentRetry == null` → 不渲染
- `phase='waiting'` → 显示 `n/10` 与倒计时秒数、显示本次原文（同款可展开）、有取消按钮
- `phase='running'` → 显示 `n/10` + spinner，不显示倒计时
- 点取消 → 调 `cancelAgentRetry`

**实现**：新组件按 spec ⑧；挂进 `ChatPanel` 消息列表尾部（`MessageSkeleton` 同位置）；倒计时用组件内 `setInterval`（只重渲自身）；11 语补 `chat.retry.progress` / `chat.retry.waiting` / `chat.retry.cancel`；`role="status"` + `aria-live="polite"`。

**验证**：`pnpm exec vitest run src/components/chat/ src/i18n/i18n.test.ts`

**commit**：`feat(chat): 对话尾部展示自动重试进度并可取消`

## B1 · running 态并排按钮

**先写失败测试**（追加进 `src/components/chat/Composer.test.tsx`）：

- `runStatus='running'` + 草稿非空 → 停止与发送**同时**存在且都可点；点发送触发 `steer`
- `runStatus='running'` + 草稿空 → 只有停止
- `replayActive` → 与今天一致（都不出现）

**实现**：`Composer.tsx` 按钮区改为 running 时渲染 `[停止, canSend && 发送]`；发送按钮 `aria-label` 用新词条 `chat.composer.steer`（语义是打断并接续，与「发送」区分），11 语同步。复用 `IconButton` + `submitVariant`，不新增按钮种类。

**验证**：`pnpm exec vitest run src/components/chat/Composer.test.tsx src/i18n/i18n.test.ts`

**commit**：`feat(chat): 回合进行中补出插话发送按钮`

## B2 · steer 图片折 token

**先写失败测试**（追加进 `Composer.test.tsx`）：

- `runStatus='running'` + 一张 ready image 附件 + 文本 → `steer` 收到的文本含 `@[image]<url>`
- 非 running 路径不变（image 仍走原生 image 内容块，不折 token）

**实现**：`send()` 里 steer 分支单独组装文本 —— image 附件也折 `@[image]<${a.url}>`（`MENTION_TYPE.image` 是既有契约，`refs.ts:26`）。非 steer 分支一字不动。

**验证**：`pnpm exec vitest run src/components/chat/Composer.test.tsx`

**commit**：`fix(chat): 插话带图不再静默丢弃图片附件`

## 收口

1. 全量验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build`
2. 派干净上下文子代理按 commit 范围独立评审（只给 spec + diff，不给会话历史）；Critical / Important 修完再合，Minor 记回 spec。
3. `--no-ff` 合回 dev，合并结果上重跑完整验证。
4. worktree / 分支清理**问过 Nick 再动**。
