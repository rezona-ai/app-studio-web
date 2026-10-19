# Koubou WS 错误本地化 — 设计稿

> 日期：2026-06-30 · 分支：`feat/koubou-error-i18n`

## 背景与目标

后端 Koubou WS 交互会下发一批错误信号（见 `docs` 的「WebSocket 错误码参考」）。这些信号目前在前端的处理参差不齐，且**面向用户的文案全是后端英文原文 / 完全没展示**：

- **应用层 `error` 事件**：`apply-koubou.ts` 的 `onError` 把 `payload.message` 原样塞进对话的 error 气泡，全英文、未本地化。
- **传输层关闭码**（4400/4401/4404/4000）：`client.ts` 的 `classifyClose` 只驱动重连 / `connStatus`，没有任何面向用户的文案。
- **非 error 失败信号**（`credit.insufficient` / `build.failed` / 孤儿 run）：`applyKoubou` 的 switch 走 default 分支被直接忽略，用户完全看不到。

目标：当前端识别到这些错误信号时，输出**本地化**的人类可读文案；本地维护这套错误文案的国际化（四语：en / zh / vi / es）。

一个来自后端文档的关键事实：应用层错误**没有稳定的机器可读 code，只能匹配 message 文案**。因此这条链路不能复用「后端 code → key」，需要本地维护「**已知 message 文案 → 本地 code**」映射，相当于把后端文档结尾建议的「error_code 枚举」在前端落地。

## 范围

| 类别 | 是否覆盖 | 处理方式 |
|---|---|---|
| ① 应用层 `error` 事件（6 条固定 message + 动态异常） | ✅ | 本地化后展示在对话 error 气泡 |
| ② 传输层关闭码 | ✅（仅通用提示） | fatal 类一律收敛为**一条通用文案**，不暴露真实关闭码 / reason；superseded（4000，多标签顶替、非真错）单独给一条柔和 notice |
| ③ 非 error 失败信号（credit / build / 孤儿 run） | ✅ | 新增事件处理 + 本地化气泡 |

明确**不做**：展示 `build.failed` 的 logs / stage 细节；展示动态异常的原始堆栈 / 异常类名；为积分不足提供「充值」等产品级交互。这些超出「错误本地化」的范畴。

## 核心原则（与现有架构对齐）

1. **reducer 保持纯函数、locale 中立**：`applyKoubou` 绝不调 `t()`。它只做纯匹配，往 state 里存「稳定 code + 后端原文 fallback」；**渲染期**才翻译。这与 `Toast` 的现行模式完全一致——避免把某语言译文烤进持久化态，且切语言时能正确重渲。
2. **复用现有 i18n 基建**：扩展 `src/i18n/errors.ts` 的 `ERROR_KEYS`（code → key 表）+ `resolveErrorMessage(code, fallback, t)`，不新造解析器。词条挂在 `errors.koubou.*` 命名空间下。
3. **尊重契约、不臆造**：未知 message 且无异常 type 时，不给 code、原样回退后端文案（保留现行行为）。

## 详细设计

### ① 应用层 `error` 事件

在 `src/i18n/errors.ts` 新增纯函数与映射：

```ts
// 应用层错误无机器码,只能按已知 message 归一到本地 code(纯函数,不触 i18n)
const KOUBOU_MESSAGE_CODES: Record<string, string> = {
  'invalid user message': 'INVALID_USER_MESSAGE',
  'run already active': 'RUN_ALREADY_ACTIVE',
  'invalid permission mode': 'INVALID_PERMISSION_MODE',
  'invalid model': 'INVALID_MODEL',
  'stale tool approval': 'STALE_TOOL_APPROVAL',
  'stale question answer': 'STALE_QUESTION_ANSWER',
};

// 把 error 事件 payload 归一成 {code, fallback}。
// 固定 message 命中 → 对应 code;否则有 type(动态异常)→ 通用 run 错误码;
// 再否则不臆造 → 无 code,回退后端原文。
export function classifyKoubouError(p: { message?: unknown; type?: unknown }): { code?: string; fallback: string } {
  const msg = (typeof p.message === 'string' ? p.message : '').trim();
  const code = KOUBOU_MESSAGE_CODES[msg] ?? (p.type ? 'AGENT_RUN_ERROR' : undefined);
  return { code, fallback: msg || 'agent error' };
}
```

`apply-koubou.ts` 的 `onError` 改造：

- **stale 弹窗命中分支不变**：`error` 事件携带 `interaction_id` 且命中未决交互时，仍只清弹窗（housekeeping），不冒泡气泡。
- 其余分支用 `classifyKoubouError(e.payload)` 算出 `{code, fallback}`，气泡 part 存 `{ type: 'error', text: fallback, ...(code ? { code } : {}) }`。**未命中 + 无 type 时不带 code**，渲染回退后端原文（保留现行行为）。

`Part` 类型扩展（`src/store/types.ts`）：

```ts
| { type: 'error'; text: string; code?: string }   // text=后端原文 fallback；code=本地错误码(命中时)
```

`MessageItem.tsx` 的 `error` 分支：把 `{p.text}` 改为 `resolveErrorMessage(p.code ?? '', p.text, t)`——命中本地词条则译，否则回退 `p.text`。`resolveErrorMessage` 对空 code / 未知 code 已天然回退 fallback，无需额外分支。

> **动态异常**（`{ type: "XxxError", message }`）：按「不暴露实际错误」的取向，统一归到 `AGENT_RUN_ERROR` 通用码、显示「运行出错」译文，**不把原始异常文本抛给用户**。

### ③ 非 error 失败信号

`applyKoubou` 的 switch 新增分支，复用一个小工具 `pushErrorBubble(state, code, fallback)` 追加本地化 error 气泡（与 `onError` 同构：一条 `role:'assistant'`、`status:'error'`、`parts:[{type:'error', code, text:fallback}]` 的消息）：

| 事件 | 本地 code | 处理 |
|---|---|---|
| `credit.insufficient` | `CREDIT_INSUFFICIENT` | 追加气泡（积分不足，本轮已中断） |
| `build.failed` | `BUILD_FAILED` | 追加气泡（构建失败；不展示 logs / stage 细节） |
| `run.finished` 内嵌 `payload.error.type === 'OrphanedRun'` | `RUN_ABANDONED` | 先照常 `finishRun`，再追加气泡（服务重启，本轮被回收） |

注意：

- 这些事件若带 `sequence`，由 `applyKoubou` 顶部既有的 `seenSequences` 去重逻辑兜底，无需额外处理。
- `credit.insufficient` 等只负责「追加本地化气泡」；run 的状态流转仍由独立的 `run.*` 事件驱动，二者不耦合。
- 孤儿 run 仅在 `run.finished` 携带 `error.type === 'OrphanedRun'` 时追加气泡；其他 `payload.error` 存在但 type 未知时，回退通用 `AGENT_RUN_ERROR`；普通失败（无 `payload.error`）不追加气泡（已由轮次 footer 的 error 态 + `error` 事件呈现）。

### ② 传输层 —— 一条通用信息，不暴露真实关闭码

- `src/koubou/client.ts`：把 fatal 关闭从 `onStatus('error')` 改为 **`onStatus('fatal')`**。新增一个**终态** `'fatal'`，与 `ws.onerror` 的瞬时 `'error'` 区分开——否则网络抖动触发的瞬时 `'error'`（随后自动重连）也会误报 toast。`ConnStatus` 联合类型三处同步加 `'fatal'`：`client.ts`、`src/store/types.ts`、`src/store/index.ts`。
- `src/client/useKoubouConnection.ts` 的 `onStatus` 回调（现仅 `setConn(s)`）增补副作用：
  - `'fatal'` → `setError({ code: 'CONNECTION', message: '', kind: 'error' })`：Toast 展示**通用**「连接出错，请刷新重试」，不含 4400/4401/reason。
  - `'superseded'`（4000，多标签顶替，非真错）→ `setError({ code: 'SESSION_SUPERSEDED', message: '', kind: 'notice' })`：柔和 notice 提示「会话已在其他位置打开」。
- `superseded` / `fatal` 的现有重连语义（不重连）保持不变；本次只是补面向用户的提示。

> `setError` 的 `message` 传空串：`Toast` 经 `resolveErrorMessage(code, message, t)` 解析，命中 `CONNECTION` / `SESSION_SUPERSEDED` 的词条直接出译文，不依赖 fallback。

### i18n 词条（`errors.koubou.*`，四语同步）

en 为单一真相源（`src/i18n/locales/en.ts`），结构如下；zh / vi / es 同步补齐对应译文（`Messages` 类型会在缺 key 时编译期报错，强制对齐）：

```
errors.koubou = {
  invalidUserMessage,        // INVALID_USER_MESSAGE
  runAlreadyActive,          // RUN_ALREADY_ACTIVE
  invalidPermissionMode,     // INVALID_PERMISSION_MODE
  invalidModel,              // INVALID_MODEL
  staleToolApproval,         // STALE_TOOL_APPROVAL
  staleQuestionAnswer,       // STALE_QUESTION_ANSWER
  runError,                  // AGENT_RUN_ERROR(动态异常 / run 执行错误,通用)
  creditInsufficient,        // CREDIT_INSUFFICIENT
  buildFailed,               // BUILD_FAILED
  runAbandoned,              // RUN_ABANDONED
  connection,                // CONNECTION(传输层通用)
  superseded,                // SESSION_SUPERSEDED(会话被顶替)
}
```

`ERROR_KEYS`（code → key 表）同步新增上述 code 到 `errors.koubou.*` key 的映射条目。

文案基调（en，其余语言对译）：

- `invalidUserMessage`: "Couldn't send that message. Please try again."
- `runAlreadyActive`: "A run is already in progress. Wait for it to finish."
- `invalidPermissionMode`: "Invalid permission mode."
- `invalidModel`: "That model isn't available."
- `staleToolApproval`: "This request has expired."
- `staleQuestionAnswer`: "This question has expired."
- `runError`: "Something went wrong during the run. Please try again."
- `creditInsufficient`: "You're out of credits. The run was interrupted."
- `buildFailed`: "The game build failed. Please try again."
- `runAbandoned`: "The run was interrupted by a service restart. Please try again."
- `connection`: "Connection error. Please refresh and try again."
- `superseded`: "This session was opened in another window."

## UI/UX 一致性

- 对话 error 气泡：复用 `MessageItem` 既有 `error` 分支的样式与 `role="alert"`，不新增样式 / keyframes。
- 传输层提示：复用全局唯一的 `Toast`（订阅 `lastError`）+ `setError` action，`kind` 取 `error` / `notice`。不自造 toast。
- 文案为面向用户的人话，不出现技术术语 / 错误码 / 后端 reason（传输层尤其遵守「不暴露实际错误」）。

## 测试

- `src/i18n/errors.test.ts`（扩展）：
  - `classifyKoubouError`：固定 message 命中各 code；有 `type` → `AGENT_RUN_ERROR`；未知 message 且无 type → `{ code: undefined, fallback }`；空 payload → `fallback: 'agent error'`。
  - 新增 koubou code 经 `resolveErrorMessage` 返回对应译文。
- `src/koubou/apply-koubou.test.ts`：
  - 既有 3 个 error 用例保持绿（新增可选 `code` 字段对 `toMatchObject` / `toEqual` 兼容——仅命中时附带 code，未命中不附带）。
  - 新增：`error` 携带 `message:'run already active'` → 气泡带 `code:'RUN_ALREADY_ACTIVE'` + fallback text。
  - 新增：`error` 携带 `type:'ValueError', message:'boom'` → 气泡带 `code:'AGENT_RUN_ERROR'`。
  - 新增：`credit.insufficient` → 追加 `CREDIT_INSUFFICIENT` 气泡。
  - 新增：`build.failed` → 追加 `BUILD_FAILED` 气泡。
  - 新增：`run.finished` 携带 `error.type:'OrphanedRun'` → 闭轮 + 追加 `RUN_ABANDONED` 气泡。
- `src/koubou/client.test.ts`（已有 FakeWS + `onStatus` 用例，扩展）：4400 关闭 → `onStatus('fatal')`；4000 → `onStatus('superseded')`。
- 四语词条对齐双重保障：`Messages` 类型编译期强制（`pnpm exec tsc --noEmit`）+ `src/i18n/i18n.test.ts` 既有运行时 parity 测试（递归比对 en 与 zh/vi/es 的 key 集合），新增 `errors.koubou.*` key 自动纳入校验。

## 不变式 / 风险

- reducer 纯函数、locale 中立不可破：禁止在 `apply-koubou.ts` / `errors.ts` 的归一函数里调用 `t()`。
- 持久化的 `messages` 仍只存 `{code, text}`，切语言后由 `MessageItem` 重新解析，无需迁移历史。
- `ConnStatus` 新增 `'fatal'` 需同步三处 union，否则 `tsc` 报错（编译期可发现）。
- 文案匹配依赖后端固定 message 字符串；后端若改文案，前端回退后端原文（不崩，仅不本地化）——可接受，符合「尊重契约、未知不臆造」。
