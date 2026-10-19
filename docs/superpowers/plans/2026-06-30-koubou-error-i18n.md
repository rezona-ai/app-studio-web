# Koubou WS 错误本地化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Koubou WS 的应用层 error 事件、非 error 失败信号、传输层关闭码统一本地化（四语），识别到错误信号时输出人类可读的本地化文案。

**Architecture:** reducer（`applyKoubou`）保持纯函数、locale 中立——只做纯匹配、存「稳定 code + 后端原文 fallback」，渲染期（`MessageItem` / `Toast`）才翻译。本地维护「已知 message → 本地 code」映射（应用层错误无机器码），复用现有 `errors.ts` 的 `ERROR_KEYS` + `resolveErrorMessage`。传输层 fatal/superseded 经新增终态收敛为通用 Toast。

**Tech Stack:** TypeScript · react-i18next（四语静态打包，en 单一真相源）· zustand store · Vitest（jsdom + globals，`@`→`src`）。

## Global Constraints

- **reducer 纯函数、locale 中立**：禁止在 `src/koubou/apply-koubou.ts`、`src/i18n/errors.ts` 的归一函数里调用 `t()`；持久化态只存 `{code, text}`，渲染期翻译。
- **四语词条必须对齐**：en（`src/i18n/locales/en.ts`）为单一真相源，新增 key 必须同步补 zh/vi/es；缺 key 会被 `Messages` 类型编译期 + `src/i18n/i18n.test.ts` 运行时双重拦截。
- **传输层不暴露实际错误**：fatal 类一律收敛为一条通用文案，不向用户展示真实关闭码 / reason。
- **尊重契约、不臆造**：未知 message 且无异常 type 时不给 code，回退后端原文（保留现行行为）。
- **md 文档禁止字面 Tailwind arbitrary class**（如 `bg-[var(...)]`）：Tailwind 会扫描 docs 下的 .md 生成非法 CSS 致页面 500。本计划改 UI 时只给内层表达式，不复制带方括号的 className 字符串。
- **`ConnStatus` 联合类型新增值须同步三处**：`src/koubou/client.ts`、`src/store/types.ts`、`src/store/index.ts`，否则 `tsc` 报错。
- 代码注释 / commit message 一律中文；commit 一句话总结。
- 工作分支：`feat/koubou-error-i18n`（worktree）。

## Prerequisite（执行前一次性）

- [ ] **P0：worktree 装依赖**

worktree 是独立检出，无 `node_modules`（vitest 排除 `.claude/worktrees/**` 即因其有独立依赖）。执行任何测试前先安装：

Run: `pnpm install`
Expected: 安装完成，无 ERR。

- [ ] **P1：基线测试通过**

Run: `pnpm test`
Expected: 全绿（确认起点干净，新增失败可归因于本次改动）。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/i18n/locales/{en,zh,vi,es}.ts` | 新增 `errors.koubou.*` 词条（en 真相源 + 三语译文） | T1 |
| `src/i18n/errors.ts` | `KOUBOU_MESSAGE_CODES` + `classifyKoubouError` + `connErrorToast`，扩展 `ERROR_KEYS` | T1 |
| `src/i18n/errors.test.ts` | 纯逻辑测试 | T1 |
| `src/store/types.ts` | `Part` error 加 `code?`；`ConnStatus` 加 `'fatal'` | T2 / T5 |
| `src/koubou/apply-koubou.ts` | `onError` 本地化；`pushErrorBubble`；credit/build/orphaned 三分支 | T2 / T3 |
| `src/koubou/apply-koubou.test.ts` | reducer 测试 | T2 / T3 |
| `src/components/chat/MessageItem.tsx` | error 气泡渲染走 `resolveErrorMessage` | T4 |
| `src/components/chat/MessageItem.test.tsx` | 渲染测试 | T4 |
| `src/koubou/client.ts` | fatal 关闭 → `onStatus('fatal')`；`ConnStatus` 加 `'fatal'` | T5 |
| `src/koubou/client.test.ts` | 关闭码 → 状态测试 | T5 |
| `src/store/index.ts` | `connStatus` union 加 `'fatal'` | T5 |
| `src/client/useKoubouConnection.ts` | `onStatus` 经 `connErrorToast` 触发 `setError` | T5 |

---

### Task 1: i18n 词条 + 错误归一纯逻辑

**Files:**
- Modify: `src/i18n/locales/en.ts`（`errors` 对象内，`upload` 块之后追加 `koubou`）
- Modify: `src/i18n/locales/zh.ts` / `vi.ts` / `es.ts`（同位置追加 `koubou` 译文）
- Modify: `src/i18n/errors.ts`
- Test: `src/i18n/errors.test.ts`

**Interfaces:**
- Produces:
  - `classifyKoubouError(p: { message?: unknown; type?: unknown }): { code?: string; fallback: string }`
  - `connErrorToast(status: string): { code: string; message: string; kind: 'error' | 'notice' } | null`
  - `ERROR_KEYS` 新增 12 个 koubou code → `errors.koubou.*` key 条目
  - `resolveErrorMessage(code, fallback, t)`（已存在，不改签名）

- [ ] **Step 1: 写失败测试**

在 `src/i18n/errors.test.ts` 顶部 import 改为：

```ts
import { resolveErrorMessage, classifyKoubouError, connErrorToast } from './errors';
```

追加用例：

```ts
test('classifyKoubouError: 固定 message 命中 → 对应 code', () => {
  expect(classifyKoubouError({ message: 'run already active' })).toEqual({ code: 'RUN_ALREADY_ACTIVE', fallback: 'run already active' });
});
test('classifyKoubouError: 有 type(动态异常) → 通用 AGENT_RUN_ERROR', () => {
  expect(classifyKoubouError({ type: 'ValueError', message: 'boom' })).toEqual({ code: 'AGENT_RUN_ERROR', fallback: 'boom' });
});
test('classifyKoubouError: 未知 message 且无 type → 无 code,回退原文', () => {
  expect(classifyKoubouError({ message: 'weird thing' })).toEqual({ code: undefined, fallback: 'weird thing' });
});
test('classifyKoubouError: 空 payload → 默认 fallback', () => {
  expect(classifyKoubouError({})).toEqual({ code: undefined, fallback: 'agent error' });
});
test('新 koubou code 经 resolveErrorMessage 出译文', () => {
  expect(resolveErrorMessage('RUN_ALREADY_ACTIVE', 'fb', i18n.t.bind(i18n))).toBe('A run is already in progress. Wait for it to finish.');
});
test('connErrorToast: fatal/superseded/其他', () => {
  expect(connErrorToast('fatal')).toEqual({ code: 'CONNECTION', message: '', kind: 'error' });
  expect(connErrorToast('superseded')).toEqual({ code: 'SESSION_SUPERSEDED', message: '', kind: 'notice' });
  expect(connErrorToast('open')).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/i18n/errors.test.ts`
Expected: FAIL（`classifyKoubouError` / `connErrorToast` 未导出）。

- [ ] **Step 3: en.ts 追加词条**

在 `src/i18n/locales/en.ts` 的 `errors:` 对象内、`upload: { ... }` 之后追加：

```ts
    koubou: {
      invalidUserMessage: "Couldn't send that message. Please try again.",
      runAlreadyActive: 'A run is already in progress. Wait for it to finish.',
      invalidPermissionMode: 'Invalid permission mode.',
      invalidModel: "That model isn't available.",
      staleToolApproval: 'This request has expired.',
      staleQuestionAnswer: 'This question has expired.',
      runError: 'Something went wrong during the run. Please try again.',
      creditInsufficient: "You're out of credits. The run was interrupted.",
      buildFailed: 'The game build failed. Please try again.',
      runAbandoned: 'The run was interrupted by a service restart. Please try again.',
      connection: 'Connection error. Please refresh and try again.',
      superseded: 'This session was opened in another window.',
    },
```

- [ ] **Step 4: zh.ts 追加译文**

在 `src/i18n/locales/zh.ts` 的 `errors.upload` 块之后追加：

```ts
    koubou: {
      invalidUserMessage: '消息发送失败，请重试。',
      runAlreadyActive: '已有任务正在进行，请等待其完成。',
      invalidPermissionMode: '权限模式无效。',
      invalidModel: '该模型不可用。',
      staleToolApproval: '该请求已失效。',
      staleQuestionAnswer: '该问题已失效。',
      runError: '运行出错，请重试。',
      creditInsufficient: '积分不足，本轮已中断。',
      buildFailed: '游戏构建失败，请重试。',
      runAbandoned: '服务重启导致本轮中断，请重试。',
      connection: '连接出错，请刷新后重试。',
      superseded: '会话已在其他位置打开。',
    },
```

- [ ] **Step 5: vi.ts 追加译文**

在 `src/i18n/locales/vi.ts` 的 `errors.upload` 块之后追加：

```ts
    koubou: {
      invalidUserMessage: 'Không gửi được tin nhắn đó. Vui lòng thử lại.',
      runAlreadyActive: 'Đã có một tác vụ đang chạy. Vui lòng đợi nó hoàn tất.',
      invalidPermissionMode: 'Chế độ quyền không hợp lệ.',
      invalidModel: 'Mô hình đó không khả dụng.',
      staleToolApproval: 'Yêu cầu này đã hết hạn.',
      staleQuestionAnswer: 'Câu hỏi này đã hết hạn.',
      runError: 'Đã xảy ra lỗi trong quá trình chạy. Vui lòng thử lại.',
      creditInsufficient: 'Bạn đã hết tín dụng. Tác vụ đã bị gián đoạn.',
      buildFailed: 'Xây dựng trò chơi thất bại. Vui lòng thử lại.',
      runAbandoned: 'Tác vụ bị gián đoạn do khởi động lại dịch vụ. Vui lòng thử lại.',
      connection: 'Lỗi kết nối. Vui lòng tải lại và thử lại.',
      superseded: 'Phiên này đã được mở ở cửa sổ khác.',
    },
```

- [ ] **Step 6: es.ts 追加译文**

在 `src/i18n/locales/es.ts` 的 `errors.upload` 块之后追加：

```ts
    koubou: {
      invalidUserMessage: 'No se pudo enviar ese mensaje. Inténtalo de nuevo.',
      runAlreadyActive: 'Ya hay una ejecución en curso. Espera a que termine.',
      invalidPermissionMode: 'Modo de permiso no válido.',
      invalidModel: 'Ese modelo no está disponible.',
      staleToolApproval: 'Esta solicitud ha caducado.',
      staleQuestionAnswer: 'Esta pregunta ha caducado.',
      runError: 'Algo salió mal durante la ejecución. Inténtalo de nuevo.',
      creditInsufficient: 'Te has quedado sin créditos. La ejecución se interrumpió.',
      buildFailed: 'La compilación del juego falló. Inténtalo de nuevo.',
      runAbandoned: 'La ejecución se interrumpió por un reinicio del servicio. Inténtalo de nuevo.',
      connection: 'Error de conexión. Actualiza e inténtalo de nuevo.',
      superseded: 'Esta sesión se abrió en otra ventana.',
    },
```

- [ ] **Step 7: errors.ts 扩展映射与纯函数**

把 `src/i18n/errors.ts` 整体替换为：

```ts
import type { TFunction } from 'i18next';

// 后端 error code → i18n key。收录 PGC 已知 code + Koubou WS 本地维护 code。
export const ERROR_KEYS: Record<string, string> = {
  GEN_FAILED: 'errors.GEN_FAILED',
  CLIPBOARD: 'errors.CLIPBOARD',
  AUTH: 'errors.AUTH',
  UPSTREAM_UNAVAILABLE: 'errors.UPSTREAM_UNAVAILABLE',
  // Koubou WS 错误(本地维护;后端应用层错误无机器码,故前端落地 code 枚举)
  INVALID_USER_MESSAGE: 'errors.koubou.invalidUserMessage',
  RUN_ALREADY_ACTIVE: 'errors.koubou.runAlreadyActive',
  INVALID_PERMISSION_MODE: 'errors.koubou.invalidPermissionMode',
  INVALID_MODEL: 'errors.koubou.invalidModel',
  STALE_TOOL_APPROVAL: 'errors.koubou.staleToolApproval',
  STALE_QUESTION_ANSWER: 'errors.koubou.staleQuestionAnswer',
  AGENT_RUN_ERROR: 'errors.koubou.runError',
  CREDIT_INSUFFICIENT: 'errors.koubou.creditInsufficient',
  BUILD_FAILED: 'errors.koubou.buildFailed',
  RUN_ABANDONED: 'errors.koubou.runAbandoned',
  CONNECTION: 'errors.koubou.connection',
  SESSION_SUPERSEDED: 'errors.koubou.superseded',
};

// 应用层 error 事件无机器码,只能按已知 message 文案归一到本地 code(纯函数,不触 i18n)
const KOUBOU_MESSAGE_CODES: Record<string, string> = {
  'invalid user message': 'INVALID_USER_MESSAGE',
  'run already active': 'RUN_ALREADY_ACTIVE',
  'invalid permission mode': 'INVALID_PERMISSION_MODE',
  'invalid model': 'INVALID_MODEL',
  'stale tool approval': 'STALE_TOOL_APPROVAL',
  'stale question answer': 'STALE_QUESTION_ANSWER',
};

// 把 error 事件 payload 归一成 {code, fallback}。
// 固定 message 命中 → 对应 code;否则有 type(动态异常) → 通用 run 错误码;
// 再否则不臆造 → 无 code,回退后端原文。
export function classifyKoubouError(p: { message?: unknown; type?: unknown }): { code?: string; fallback: string } {
  const msg = (typeof p.message === 'string' ? p.message : '').trim();
  const code = KOUBOU_MESSAGE_CODES[msg] ?? (p.type ? 'AGENT_RUN_ERROR' : undefined);
  return { code, fallback: msg || 'agent error' };
}

// 传输层终态 → 通用提示(纯函数)。fatal 不暴露真实关闭码/reason;superseded 为多标签顶替,柔和 notice。
// 非终态(connecting/open/closed/error 瞬时态)返回 null,不打扰用户。
export function connErrorToast(status: string): { code: string; message: string; kind: 'error' | 'notice' } | null {
  if (status === 'fatal') return { code: 'CONNECTION', message: '', kind: 'error' };
  if (status === 'superseded') return { code: 'SESSION_SUPERSEDED', message: '', kind: 'notice' };
  return null;
}

// 命中映射且词条存在 → 译文;否则回退后端原 message(尊重契约不臆造)。
export function resolveErrorMessage(code: string, fallbackMessage: string, t: TFunction): string {
  const key = ERROR_KEYS[code];
  if (key && t(key) !== key) return t(key);
  return fallbackMessage;
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `pnpm exec vitest run src/i18n/errors.test.ts src/i18n/i18n.test.ts`
Expected: PASS（errors 新用例 + i18n parity 四语对齐均绿）。

- [ ] **Step 9: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（`Messages` 类型确认四语 key 对齐）。

- [ ] **Step 10: 提交**

```bash
git add src/i18n/
git commit -m "feat: 新增 Koubou WS 错误四语词条与 classifyKoubouError/connErrorToast 归一纯函数"
```

---

### Task 2: Part.code 类型 + 应用层 error 本地化

**Files:**
- Modify: `src/store/types.ts:32`（`Part` 的 error 分支）
- Modify: `src/koubou/apply-koubou.ts`（import + `onError` + 新增 `pushErrorBubble`）
- Test: `src/koubou/apply-koubou.test.ts`

**Interfaces:**
- Consumes: `classifyKoubouError`（T1）
- Produces:
  - `Part` error 分支：`{ type: 'error'; text: string; code?: string }`
  - `pushErrorBubble(state: KoubouState, code: string | undefined, fallback: string): KoubouState`（apply-koubou.ts 内部 helper，供 T3 复用）

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 中、现有 error 用例附近追加：

```ts
test('error 命中已知 message → 气泡带本地 code + 回退原文', () => {
  const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { message: 'run already active' } }));
  expect(s.messages[0]).toMatchObject({ role: 'assistant', status: 'error', parts: [{ type: 'error', code: 'RUN_ALREADY_ACTIVE', text: 'run already active' }] });
});
test('error 动态异常(带 type) → 通用 AGENT_RUN_ERROR 码', () => {
  const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { type: 'ValueError', message: 'boom' } }));
  expect(s.messages[0].parts[0]).toMatchObject({ type: 'error', code: 'AGENT_RUN_ERROR', text: 'boom' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: FAIL（气泡 part 当前无 `code` 字段）。

- [ ] **Step 3: 扩展 Part 类型**

`src/store/types.ts:32` 改为：

```ts
  | { type: 'error'; text: string; code?: string }   // agent/run 级错误气泡;text=后端原文 fallback,code=本地错误码(命中时,渲染期翻译)
```

- [ ] **Step 4: apply-koubou 引入归一 + 改造 onError**

`src/koubou/apply-koubou.ts` 顶部 import 区追加：

```ts
import { classifyKoubouError } from '@/i18n/errors';
```

把文件末尾的 `onError` 函数替换为（并在其下方新增 `pushErrorBubble`）：

```ts
function onError(state: KoubouState, e: ServerEvent): KoubouState {
  const id = e.payload.interaction_id as string | undefined;
  // 命中某个未决交互 = 该弹窗已失效(stale),仅清弹窗;housekeeping,不冒泡进对话
  if (id && state.pendingInteractions[id]) {
    const pending = { ...state.pendingInteractions };
    delete pending[id];
    return { ...state, pendingInteractions: pending };
  }
  // 其余 = agent/run 级错误:归一为本地 code(渲染期翻译),原文作 fallback
  const { code, fallback } = classifyKoubouError(e.payload);
  return pushErrorBubble(state, code, fallback);
}

// 追加一条本地化 error 气泡:code 命中时附带(MessageItem 渲染期翻译),fallback 为后端原文/默认。
function pushErrorBubble(state: KoubouState, code: string | undefined, fallback: string): KoubouState {
  const part: Part = code ? { type: 'error', text: fallback, code } : { type: 'error', text: fallback };
  const msg: Message = { id: newId('msg'), role: 'assistant', status: 'error', parts: [part] };
  return { ...state, messages: [...state.messages, msg] };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS（新用例绿；既有 `'agent crashed'` 用例因未命中无 code 仍绿，`'agent error'` 空 payload 用例 `toEqual` 无 code 字段仍绿）。

- [ ] **Step 6: 类型检查 + 提交**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/store/types.ts src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: 应用层 error 事件归一本地 code,气泡 part 携 code 供渲染期翻译"
```

---

### Task 3: 非 error 失败信号（credit / build / 孤儿 run）

**Files:**
- Modify: `src/koubou/apply-koubou.ts`（`applyKoubou` switch 内 `run.finished` 分支 + 新增 `credit.insufficient` / `build.failed` 分支）
- Test: `src/koubou/apply-koubou.test.ts`

**Interfaces:**
- Consumes: `pushErrorBubble`（T2）、`finishRun`（已存在）

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 追加：

```ts
test('credit.insufficient → 本地化中断气泡', () => {
  const s = applyKoubou(S(), ev({ type: 'credit.insufficient', sequence: 8, payload: { reason: 'mid_run' } }));
  expect(s.messages[0].parts[0]).toMatchObject({ type: 'error', code: 'CREDIT_INSUFFICIENT' });
});
test('build.failed → 本地化构建失败气泡', () => {
  const s = applyKoubou(S(), ev({ type: 'build.failed', sequence: 8, payload: { stage: 'validate' } }));
  expect(s.messages[0].parts[0]).toMatchObject({ type: 'error', code: 'BUILD_FAILED' });
});
test('run.finished 携带 OrphanedRun → 闭轮 + RUN_ABANDONED 气泡', () => {
  let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 7, payload: { run_id: 'r1' } }));
  s = applyKoubou(s, ev({ type: 'run.finished', sequence: 8, run_id: 'r1', payload: { status: 'failed', error: { type: 'OrphanedRun', message: 'run abandoned by service restart' } } }));
  expect(s.runStatus).toBe('error');
  expect(s.messages.some((m) => m.parts.some((p) => p.type === 'error' && p.code === 'RUN_ABANDONED'))).toBe(true);
});
test('run.finished 普通失败(无 error 对象) → 不追加额外气泡', () => {
  let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 7, payload: { run_id: 'r1' } }));
  s = applyKoubou(s, ev({ type: 'run.finished', sequence: 8, run_id: 'r1', payload: { status: 'failed' } }));
  expect(s.messages.some((m) => m.parts.some((p) => p.type === 'error'))).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: FAIL（credit/build 走 default 被忽略;orphaned 无气泡）。

- [ ] **Step 3: 改造 run.finished 分支 + 新增两分支**

`src/koubou/apply-koubou.ts` 的 `applyKoubou` switch 中，把现有：

```ts
    case 'run.finished': return finishRun(state, e, e.payload.status === 'succeeded' ? 'succeeded' : 'error');
```

替换为：

```ts
    case 'run.finished': {
      const next = finishRun(state, e, e.payload.status === 'succeeded' ? 'succeeded' : 'error');
      // 孤儿 run(服务重启回收)等会内嵌 error 对象 → 追加本地化气泡;普通失败不内嵌,不重复冒泡
      const err = e.payload.error as { type?: string; message?: string } | undefined;
      if (err) {
        const code = err.type === 'OrphanedRun' ? 'RUN_ABANDONED' : 'AGENT_RUN_ERROR';
        return pushErrorBubble(next, code, err.message?.trim() || 'run error');
      }
      return next;
    }
```

并在 `case 'error': return onError(state, e);` 之前追加两分支：

```ts
    case 'credit.insufficient': return pushErrorBubble(state, 'CREDIT_INSUFFICIENT', 'Insufficient credits');
    case 'build.failed': return pushErrorBubble(state, 'BUILD_FAILED', 'Build failed');
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS（含既有 run.finished 用例不回归——它们 payload 无 `error` 对象，走 `return next`）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: credit.insufficient/build.failed/孤儿 run 追加本地化失败气泡"
```

---

### Task 4: MessageItem 渲染本地化

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`（import + `case 'error':` 内层文本表达式）
- Test: `src/components/chat/MessageItem.test.tsx`

**Interfaces:**
- Consumes: `resolveErrorMessage`（T1）、`Part.code`（T2）

- [ ] **Step 1: 写失败测试**

在 `src/components/chat/MessageItem.test.tsx` 追加（默认语言为 en，词条出英文译文）：

```ts
test('error part 带本地 code → 渲染本地化译文', () => {
  const m: Message = { id: 'e2', role: 'assistant', status: 'error', parts: [
    { type: 'error', code: 'RUN_ALREADY_ACTIVE', text: 'run already active' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.getByRole('alert')).toHaveTextContent('A run is already in progress. Wait for it to finish.');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/MessageItem.test.tsx`
Expected: FAIL（当前直接渲染 `p.text`，显示 'run already active' 而非译文）。

- [ ] **Step 3: 引入解析并改内层表达式**

`src/components/chat/MessageItem.tsx` import 区追加：

```ts
import { resolveErrorMessage } from '@/i18n/errors';
```

在 `case 'error':` 分支中，**只改最内层那一行文本表达式**（保持外层 `div` / `span` 的 className 完全不动）：把

```tsx
<span className="min-w-0 break-words">{p.text}</span>
```

改为

```tsx
<span className="min-w-0 break-words">{resolveErrorMessage(p.code ?? '', p.text, t)}</span>
```

（`t` 已由组件顶部 `const { t } = useTranslation();` 提供；`resolveErrorMessage` 对空 / 未知 code 自动回退 `p.text`，故未命中码的气泡行为不变。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/chat/MessageItem.test.tsx`
Expected: PASS（新用例出译文；既有 `'agent crashed'`（无 code）用例回退原文仍绿）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

```bash
git add src/components/chat/MessageItem.tsx src/components/chat/MessageItem.test.tsx
git commit -m "feat: 对话 error 气泡渲染期经 resolveErrorMessage 本地化"
```

---

### Task 5: 传输层 fatal 终态 + 通用提示

**Files:**
- Modify: `src/koubou/client.ts:7`（`ConnStatus` 加 `'fatal'`）+ onclose 的 fatal 分支
- Modify: `src/store/types.ts:61`（`ConnStatus` 加 `'fatal'`）
- Modify: `src/store/index.ts:32`（`connStatus` union 加 `'fatal'`）
- Modify: `src/client/useKoubouConnection.ts`（`onStatus` 回调）
- Test: `src/koubou/client.test.ts`

**Interfaces:**
- Consumes: `connErrorToast`（T1）、`classifyClose`（已存在）

- [ ] **Step 1: 写失败测试**

在 `src/koubou/client.test.ts` 的 `describe('createKoubouClient', ...)` 内追加：

```ts
test('4400 关闭 → fatal 终态(区别于瞬时 error)', async () => {
  const { created, statuses } = setup();
  await flush();
  created[0].open();
  created[0].onclose?.({ code: 4400 });
  expect(statuses).toContain('fatal');
  expect(statuses).not.toContain('error');
});
test('4000 关闭 → superseded(被顶替)', async () => {
  const { created, statuses } = setup();
  await flush();
  created[0].open();
  created[0].onclose?.({ code: 4000 });
  expect(statuses).toContain('superseded');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/client.test.ts`
Expected: FAIL（4400 当前发 `'error'` 而非 `'fatal'`）。

- [ ] **Step 3: client.ts 改 fatal 分支 + 扩 ConnStatus**

`src/koubou/client.ts:7` 改为：

```ts
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal';
```

onclose 内把：

```ts
      if (action === 'fatal') { opts.onStatus('error'); return; }
```

改为：

```ts
      if (action === 'fatal') { opts.onStatus('fatal'); return; }   // 终态:与 ws.onerror 的瞬时 'error' 区分,避免抖动误报
```

- [ ] **Step 4: 同步 store 两处 ConnStatus union**

`src/store/types.ts:61` 改为：

```ts
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal';
```

`src/store/index.ts:32` 改为：

```ts
  connStatus: 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal';
```

- [ ] **Step 5: useKoubouConnection 接通用提示**

`src/client/useKoubouConnection.ts` import 区追加：

```ts
import { connErrorToast } from '@/i18n/errors';
```

把 `onStatus: (s) => useStore.getState().setConn(s),` 替换为：

```ts
        onStatus: (s) => {
          useStore.getState().setConn(s);
          // 传输层 fatal/superseded 给一条通用提示(不暴露真实关闭码/reason)
          const toast = connErrorToast(s);
          if (toast) useStore.getState().setError(toast);
        },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/client.test.ts`
Expected: PASS。

- [ ] **Step 7: 类型检查 + 提交**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（三处 union 已对齐）。

```bash
git add src/koubou/client.ts src/koubou/client.test.ts src/store/types.ts src/store/index.ts src/client/useKoubouConnection.ts
git commit -m "feat: 传输层 fatal 新增终态,fatal/superseded 经 setError 出通用本地化提示"
```

---

### Task 6: 全量验证

**Files:** 无（仅校验）

- [ ] **Step 1: lint**

Run: `pnpm lint`
Expected: 无 error。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 全量测试**

Run: `pnpm test`
Expected: 全绿。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: 成功（验证 i18n 词条 + 无 md arbitrary-class 致 CSS 故障）。

---

## Self-Review 记录

- **Spec 覆盖**：① 应用层 error → T1（归一）+ T2（reducer）+ T4（渲染）；③ 非 error 信号 → T1（词条）+ T3；② 传输层 → T1（`connErrorToast` + 词条）+ T5。四语词条 → T1。✓
- **Placeholder**：无 TBD/TODO；每个改 code 的 step 均给完整代码。✓
- **类型一致**：`classifyKoubouError` / `connErrorToast` / `pushErrorBubble` / `Part.code` / `ConnStatus 'fatal'` 跨任务签名一致；code 字符串（如 `RUN_ALREADY_ACTIVE`）在 `ERROR_KEYS`、`KOUBOU_MESSAGE_CODES`、reducer、测试中拼写统一。✓
- **既有测试不回归**：`'agent crashed'`（无 code，`toMatchObject` 兼容）、`'agent error'`（空 payload，`toEqual` 无 code 字段）、stale 弹窗清理、普通 run.finished 失败——均在对应任务 step 注明保持绿。✓
