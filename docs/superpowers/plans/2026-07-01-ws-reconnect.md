# WS 断线提醒与重连加固 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Koubou 对话 WS 的断线对用户可见，并补上半开检测、放弃后出路，使任何停摆都能自愈或手动恢复。

**Architecture:** 传输层在 `createKoubouClient` 内加心跳看门狗（治半开）、`reconnect()` 方法与 `stalled` 状态（治放弃后无出路）；`useKoubouConnection` hook 监听 `online`/`visibilitychange` 触发恢复；新增 `ReconnectBanner` 内联条读 `connStatus` 呈现重连中/已断开并提供手动重连。所有既有重连能力（退避、关闭码分类、会话续传、命令积压冲刷）保持不变。

**Tech Stack:** TypeScript · React 19 · zustand · react-i18next · Vitest（jsdom + FakeWS 注入 + `vi.useFakeTimers`）

## Global Constraints

- 代码注释 / commit message 一律用**中文**（CLAUDE.md）
- 色值只走 `--color-*` CSS 变量，禁硬编码；本方案复用既有 `--color-danger` / `--color-danger-soft` / `--color-fill` / `--color-muted` / `--color-line-2`，**不新增 token**
- 动效复用 `.anim-collapse-in`（已在 `prefers-reduced-motion` 禁用列表内），禁一次性 keyframes
- 按钮用现成 `Button`，spinner 复用全站惯例 `size-4 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]`
- 交互元素配 `aria-label` / `aria-live`
- **react-hooks lint 约束**：禁 effect 内 setState、禁渲染期改 ref；需要"是否曾连上"这类派生态时用**渲染期 guarded setState**（`if (cond && !flag) setFlag(true)`）
- i18n 六语（en/zh/fr/ru/ja/vi），**en 为单一真相源**；`src/i18n/i18n.test.ts` 强制五语与 en 键集一致，新增 key 必须六套齐全（否则该测试失败）
- `ConnStatus` 类型**重复定义在两处**（`src/koubou/client.ts` 与 `src/store/types.ts`），改动须同步

---

## 文件结构

- `src/koubou/client.ts`（改）：`ConnStatus` 加 `'stalled'`；`KoubouClient` 加 `reconnect()`；ticket 耗尽发 `stalled`；心跳看门狗；导出纯函数 `shouldReconnectOnWake`
- `src/store/types.ts`（改）：`ConnStatus` 加 `'stalled'`
- `src/client/useKoubouConnection.ts`（改）：`online` / `visibilitychange` 恢复触发
- `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（改）：`chat.conn.*` 六语文案
- `src/components/chat/ReconnectBanner.tsx`（新）+ `ReconnectBanner.test.tsx`（新）
- `src/components/chat/ChatPanel.tsx`（改）：挂载 `<ReconnectBanner client={client} />`
- 测试：`src/koubou/client.test.ts`（增用例）、`src/i18n/errors.test.ts`（增断言）

---

## Task 1: `stalled` 状态 + `reconnect()` 方法

**Files:**
- Modify: `src/koubou/client.ts`
- Modify: `src/store/types.ts:61`
- Test: `src/koubou/client.test.ts`、`src/i18n/errors.test.ts`

**Interfaces:**
- Produces: `ConnStatus` 新增 `'stalled'`；`KoubouClient.reconnect(): void`（重置 `retry`/`ticketFails`/`closedByUser` 后立即 `connect()`）

- [ ] **Step 1: 写失败测试（client.test.ts 末尾 describe 内追加）**

```ts
  test('mintTicket 连续失败达上限 → stalled 状态(而非静默 error)', async () => {
    vi.useFakeTimers();
    try {
      const { statuses } = setup({ mintTicket: () => Promise.reject(new Error('down')) });
      await vi.advanceTimersByTimeAsync(60_000);   // 覆盖全部退避窗口
      expect(statuses).toContain('stalled');
    } finally { vi.useRealTimers(); }
  });

  test('reconnect():停滞后立即重连,重置退避与 ticket 失败计数', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      // 前 5 次失败 → stalled;reconnect() 清零后第 6 次成功建连
      const { client, created, statuses } = setup({
        mintTicket: () => { calls++; return calls <= 5 ? Promise.reject(new Error('x')) : Promise.resolve('tk'); },
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(statuses).toContain('stalled');
      expect(created).toHaveLength(0);
      client.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(created).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/client.test.ts -t "stalled"`
Expected: FAIL（`statuses` 不含 `'stalled'`；`client.reconnect` 不是函数）

- [ ] **Step 3: 实现——`ConnStatus` 加 `'stalled'`（两处）**

`src/koubou/client.ts:7`：
```ts
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal' | 'stalled';
```
`src/store/types.ts:61`：
```ts
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal' | 'stalled';
```

- [ ] **Step 4: 实现——ticket 耗尽发 `stalled`**

`src/koubou/client.ts` 的 `connect()` 中，把 mintTicket 的 catch 块改为：
```ts
    try { ticket = await opts.mintTicket(); }
    catch {
      // 连续失败累加;未达上限 → error + 退避重连;达上限 → 放弃自动重连,发 stalled 供 UI 手动重连(旧为静默停在 error)
      if (++ticketFails < MAX_TICKET_FAILS) { opts.onStatus('error'); scheduleReconnect(); }
      else opts.onStatus('stalled');
      return;
    }
```

- [ ] **Step 5: 实现——`reconnect()` 方法**

`KoubouClient` 接口（`src/koubou/client.ts:22-30`）在 `close` 前加一行：
```ts
  reconnect: () => void;
```
返回对象（`src/koubou/client.ts:124-133`）在 `close` 前加：
```ts
    // 手动/唤醒重连:清零退避与 ticket 失败计数、解除用户关闭标记,立即重连(先 clearTimeout 防与在途退避竞态双连)
    reconnect: () => { closedByUser = false; retry = 0; ticketFails = 0; clearTimeout(timer); void connect(); },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/client.test.ts`
Expected: PASS（含既有全部用例——旧的"连续失败达上限停止重连"用例只断言 `calls`/`created`，不受影响）

- [ ] **Step 7: 加断言——`stalled` 不弹 toast（errors.test.ts）**

在 `src/i18n/errors.test.ts` 里 `connErrorToast` 相关 describe 内追加：
```ts
  test('stalled 不弹 toast(走内联条)', () => {
    expect(connErrorToast('stalled')).toBeNull();
  });
```
（`connErrorToast` 默认对非 fatal/superseded 返回 null，无需改实现——此断言仅锁定契约。若 `errors.test.ts` 未导入 `connErrorToast`，在顶部 import 补上。）

Run: `pnpm exec vitest run src/i18n/errors.test.ts`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add src/koubou/client.ts src/store/types.ts src/koubou/client.test.ts src/i18n/errors.test.ts
git commit -m "feat: WS 客户端新增 stalled 状态与 reconnect() 手动重连"
```

---

## Task 2: 心跳看门狗（治半开连接）

**Files:**
- Modify: `src/koubou/client.ts`
- Test: `src/koubou/client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createKoubouClient`
- Produces: 无新导出；行为——`open` 后 `HEARTBEAT_TIMEOUT_MS`（45000ms）内无任何入站帧则主动 `ws.close()`，落入既有 `onclose`（默认关闭码 → `retry`）走退避重连

- [ ] **Step 1: 写失败测试（client.test.ts 追加）**

```ts
  test('心跳看门狗:open 后 45s 无帧 → 主动关闭并重连', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      created[0].open();
      expect(created[0].closed).toBe(false);
      await vi.advanceTimersByTimeAsync(45_000);   // 无帧 → 看门狗判死
      expect(created[0].closed).toBe(true);         // 主动关闭
      await vi.advanceTimersByTimeAsync(1100);      // 退避重连
      expect(created).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  test('心跳看门狗:期间持续收帧则不触发关闭', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      created[0].open();
      // 每 30s(< 45s 阈值)来一帧,持续 90s 都不应判死
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
        created[0].emit({ type: 'server.heartbeat', project_id: '2', session_id: 's9', payload: {} });
      }
      expect(created[0].closed).toBe(false);
      expect(created).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/client.test.ts -t "看门狗"`
Expected: FAIL（45s 后 `created[0].closed` 仍为 false，无 `created[1]`）

- [ ] **Step 3: 实现——常量与状态**

`src/koubou/client.ts:33` 的 `MAX_TICKET_FAILS` 下加：
```ts
const HEARTBEAT_TIMEOUT_MS = 45_000;   // >2× 服务端 ~20s 心跳:此间无任何入站帧判定连接已死(治半开/僵尸连接)
```
`createKoubouClient` 内 `let timer:` 一行下加：
```ts
  let watchdog: ReturnType<typeof setTimeout> | undefined;
```

- [ ] **Step 4: 实现——看门狗启停函数**

在 `const make = ...` / `const genId = ...` 之后、`const connect = ...` 之前加：
```ts
  const clearWatchdog = () => { clearTimeout(watchdog); watchdog = undefined; };
  // 每收到任意入站帧即重置;超时无帧 → 判半开,主动关闭当前 socket,落入 onclose(默认码)走退避重连
  const kickWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (ws && ws.readyState === WS_OPEN) { try { ws.close(); } catch { /* 已关闭 */ } }
    }, HEARTBEAT_TIMEOUT_MS);
  };
```

- [ ] **Step 5: 实现——接线（4 处）**

① 重连前的旧 socket 解绑块（`src/koubou/client.ts:68`）加 `clearWatchdog()`（旧 handler 已置 null,不会经 onclose 清理,须显式清）：
```ts
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; clearWatchdog(); try { ws.close(); } catch { /* 已关闭 */ } }
```
② `onopen`（`src/koubou/client.ts:70`）末尾启动看门狗：
```ts
    ws.onopen = () => { retry = 0; opts.onStatus('open'); flush(); kickWatchdog(); };
```
③ `onmessage`（`src/koubou/client.ts:71`）首行重置看门狗：
```ts
    ws.onmessage = (e: MessageEvent | { data: string }) => {
      kickWatchdog();   // 任意入站帧证明连接存活,重置看门狗
      const raw = (e as { data: string }).data;
```
④ `onclose`（`src/koubou/client.ts:88`）首行清看门狗：
```ts
    ws.onclose = (e: CloseEvent | { code: number }) => {
      clearWatchdog();
      const code = (e as { code: number }).code ?? 1006;
```

- [ ] **Step 6: 实现——`close()` 清看门狗**

返回对象的 `close`（`src/koubou/client.ts:132`）加 `clearWatchdog()`：
```ts
    close: () => { closedByUser = true; clearTimeout(timer); clearWatchdog(); ws?.close(); },
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/client.test.ts`
Expected: PASS（含既有 heartbeat 相关用例）

- [ ] **Step 8: 提交**

```bash
git add src/koubou/client.ts src/koubou/client.test.ts
git commit -m "feat: WS 客户端加心跳看门狗,主动发现并重连半开连接"
```

---

## Task 3: 恢复触发（online / visibilitychange）

**Files:**
- Modify: `src/koubou/client.ts`（导出纯函数 `shouldReconnectOnWake`）
- Modify: `src/client/useKoubouConnection.ts`
- Test: `src/koubou/client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `KoubouClient.reconnect()`
- Produces: `shouldReconnectOnWake(status: string): boolean` —— 仅 `stalled` / `error` / `closed` 返回 true

- [ ] **Step 1: 写失败测试（client.test.ts 追加，import 处补 `shouldReconnectOnWake`）**

顶部 import 改为：
```ts
import { createKoubouClient, shouldReconnectOnWake } from './client';
```
用例：
```ts
  test('shouldReconnectOnWake:仅停滞态触发唤醒重连', () => {
    expect(shouldReconnectOnWake('stalled')).toBe(true);
    expect(shouldReconnectOnWake('error')).toBe(true);
    expect(shouldReconnectOnWake('closed')).toBe(true);
    expect(shouldReconnectOnWake('open')).toBe(false);
    expect(shouldReconnectOnWake('connecting')).toBe(false);
    expect(shouldReconnectOnWake('fatal')).toBe(false);       // 终态不自愈
    expect(shouldReconnectOnWake('superseded')).toBe(false);  // 被顶替,重连会再被顶
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/client.test.ts -t "shouldReconnectOnWake"`
Expected: FAIL（`shouldReconnectOnWake` 未导出）

- [ ] **Step 3: 实现——导出纯函数（client.ts）**

`src/koubou/client.ts` 的 `classifyClose` import 之后、`ConnStatus` 定义附近加：
```ts
// 唤醒/网络恢复时是否应重连:仅停滞态(放弃 stalled / 瞬时错 error / 退避等待 closed)才重连;
// open/connecting 已在连,fatal/superseded 为终态不自愈
export function shouldReconnectOnWake(status: string): boolean {
  return status === 'stalled' || status === 'error' || status === 'closed';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/client.test.ts -t "shouldReconnectOnWake"`
Expected: PASS

- [ ] **Step 5: 实现——hook 接线（useKoubouConnection.ts）**

顶部 import（`src/client/useKoubouConnection.ts:3`）改为：
```ts
import { createKoubouClient, shouldReconnectOnWake, type KoubouClient } from '@/koubou/client';
```
在 `const wsBaseUrl = ...`（`src/client/useKoubouConnection.ts:34`）之后、`let aborted = false;` 之前加监听：
```ts
    // 唤醒/网络恢复时:若连接停滞则重连(治断网久了、ticket 耗尽后不自愈;半开由 client 内看门狗兜底)。
    // 读实时 connStatus 决策,fatal/superseded 不重连(见 shouldReconnectOnWake)。
    const onWake = () => { if (shouldReconnectOnWake(useStore.getState().connStatus)) clientRef.current?.reconnect(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onWake(); };
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onVisible);
```
把 effect 的 cleanup（`src/client/useKoubouConnection.ts:91`）改为:
```ts
    return () => {
      aborted = true;
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onVisible);
      clientRef.current?.close();
      clientRef.current = null;
    };
```

- [ ] **Step 6: 类型检查（hook 接线由 tsc 守护,无独立单测)**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/koubou/client.ts src/koubou/client.test.ts src/client/useKoubouConnection.ts
git commit -m "feat: 网络/前台恢复时自动重连停滞的 WS 连接"
```

---

## Task 4: i18n 文案（chat.conn.* 六语）

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`
- Test: `src/i18n/i18n.test.ts`（既有 key 平价测试守护）

**Interfaces:**
- Produces: i18n key `chat.conn.reconnecting` / `chat.conn.disconnected` / `chat.conn.reconnect`

- [ ] **Step 1: en.ts —— 在 `chat:` 对象内(如 `loadingEarlier` 行之后)加 `conn` 子块**

`src/i18n/locales/en.ts`：
```ts
    conn: {
      reconnecting: 'Reconnecting… messages will send once reconnected',
      disconnected: 'Connection lost',
      reconnect: 'Reconnect',
    },
```

- [ ] **Step 2: zh.ts —— 同位置加**

`src/i18n/locales/zh.ts`：
```ts
    conn: {
      reconnecting: '重连中，消息将在恢复后发送',
      disconnected: '连接已断开',
      reconnect: '重连',
    },
```

- [ ] **Step 3: fr.ts —— 同位置加**

`src/i18n/locales/fr.ts`：
```ts
    conn: {
      reconnecting: 'Reconnexion… les messages seront envoyés une fois reconnecté',
      disconnected: 'Connexion perdue',
      reconnect: 'Reconnecter',
    },
```

- [ ] **Step 4: ru.ts —— 同位置加**

`src/i18n/locales/ru.ts`：
```ts
    conn: {
      reconnecting: 'Переподключение… сообщения будут отправлены после восстановления связи',
      disconnected: 'Соединение потеряно',
      reconnect: 'Переподключить',
    },
```

- [ ] **Step 5: ja.ts —— 同位置加**

`src/i18n/locales/ja.ts`：
```ts
    conn: {
      reconnecting: '再接続中… 復旧後にメッセージを送信します',
      disconnected: '接続が切断されました',
      reconnect: '再接続',
    },
```

- [ ] **Step 6: vi.ts —— 同位置加**

`src/i18n/locales/vi.ts`：
```ts
    conn: {
      reconnecting: 'Đang kết nối lại… tin nhắn sẽ được gửi sau khi kết nối lại',
      disconnected: 'Mất kết nối',
      reconnect: 'Kết nối lại',
    },
```

- [ ] **Step 7: 运行 key 平价测试确认六语一致**

Run: `pnpm exec vitest run src/i18n/i18n.test.ts`
Expected: PASS（五语与 en 键集一致；若漏补某语言此测试会 FAIL，据错补齐）

- [ ] **Step 8: 提交**

```bash
git add src/i18n/locales/
git commit -m "feat: i18n 新增 chat.conn 断线重连文案(六语)"
```

---

## Task 5: ReconnectBanner 内联条 + 挂载

**Files:**
- Create: `src/components/chat/ReconnectBanner.tsx`
- Create: `src/components/chat/ReconnectBanner.test.tsx`
- Modify: `src/components/chat/ChatPanel.tsx:200`

**Interfaces:**
- Consumes: `useStore().connStatus`（含 Task 1 的 `'stalled'`）、`KoubouClient.reconnect()`（Task 1）、`chat.conn.*`（Task 4）
- Produces: 默认导出组件 `ReconnectBanner({ client }: { client: React.RefObject<KoubouClient | null> })`

- [ ] **Step 1: 写失败测试（新建 ReconnectBanner.test.tsx）**

```tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import ReconnectBanner from './ReconnectBanner';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';

afterEach(cleanup);

// 造一个只含 reconnect 的假 client ref
function fakeClient() {
  const reconnect = vi.fn();
  return { ref: { current: { reconnect } as unknown as KoubouClient }, reconnect };
}

test('open → 不渲染', () => {
  useStore.setState({ connStatus: 'open' });
  const { container } = render(<ReconnectBanner client={fakeClient().ref} />);
  expect(container.firstChild).toBeNull();
});

test('superseded → 不渲染(走 toast)', () => {
  useStore.setState({ connStatus: 'superseded' });
  const { container } = render(<ReconnectBanner client={fakeClient().ref} />);
  expect(container.firstChild).toBeNull();
});

test('初次 connecting(从未 open 过) → 不渲染,避免首屏误报', () => {
  useStore.setState({ connStatus: 'connecting' });
  const { container } = render(<ReconnectBanner client={fakeClient().ref} />);
  expect(container.firstChild).toBeNull();
});

test('曾 open 后断开(closed) → 显示重连中,无重连按钮', () => {
  useStore.setState({ connStatus: 'open' });
  const { rerender } = render(<ReconnectBanner client={fakeClient().ref} />);
  act(() => { useStore.setState({ connStatus: 'closed' }); });
  rerender(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.getByText('Reconnecting… messages will send once reconnected')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
});

test('stalled → 显示已断开 + 重连按钮,点击调 reconnect', () => {
  useStore.setState({ connStatus: 'stalled' });
  const c = fakeClient();
  render(<ReconnectBanner client={c.ref} />);
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Reconnect' }).click();
  expect(c.reconnect).toHaveBeenCalledTimes(1);
});

test('fatal → 显示重连按钮', () => {
  useStore.setState({ connStatus: 'fatal' });
  render(<ReconnectBanner client={fakeClient().ref} />);
  expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ReconnectBanner.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件（新建 ReconnectBanner.tsx）**

```tsx
'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import Button from '@/components/ui/Button';
import type { KoubouClient } from '@/koubou/client';

// WS 断线内联条:重连中(spinner) / 已断开(重连按钮)。状态机见 docs/superpowers/specs/2026-07-01-ws-reconnect-design.md
export default function ReconnectBanner({ client }: { client: React.RefObject<KoubouClient | null> }) {
  const connStatus = useStore((s) => s.connStatus);
  const { t } = useTranslation();
  // 记录是否曾连上:初次 connecting(从未 open)不显示"重连中",避免首屏误报。
  // 渲染期 guarded setState(遵仓库禁 effect-setState / 禁渲染期改 ref 的约束)。
  const [everOpen, setEverOpen] = useState(false);
  if (connStatus === 'open' && !everOpen) setEverOpen(true);

  // open 已连、superseded 走 toast:均不入内联条
  if (connStatus === 'open' || connStatus === 'superseded') return null;

  const stalled = connStatus === 'stalled' || connStatus === 'fatal';
  // 非停滞态(重连中)且从未连上过 → 首屏初次连接,不打扰
  if (!stalled && !everOpen) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`anim-collapse-in mx-3 mb-2 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] ${
        stalled
          ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
          : 'bg-[var(--color-fill)] text-[var(--color-muted)]'
      }`}
    >
      {stalled ? (
        <>
          <span className="flex-1">{t('chat.conn.disconnected')}</span>
          <Button className="px-2 py-1 text-[13px]" onClick={() => client.current?.reconnect()}>
            {t('chat.conn.reconnect')}
          </Button>
        </>
      ) : (
        <>
          <span
            aria-hidden
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]"
          />
          <span className="flex-1">{t('chat.conn.reconnecting')}</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ReconnectBanner.test.tsx`
Expected: PASS

- [ ] **Step 5: 挂载到 ChatPanel（Composer 上方）**

`src/components/chat/ChatPanel.tsx:18` import 区加：
```ts
import ReconnectBanner from './ReconnectBanner';
```
`src/components/chat/ChatPanel.tsx:200` 的 `<Composer client={client} />` 上一行插入：
```tsx
      <ReconnectBanner client={client} />
      <Composer client={client} />
```

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: 均 PASS

- [ ] **Step 7: 提交**

```bash
git add src/components/chat/ReconnectBanner.tsx src/components/chat/ReconnectBanner.test.tsx src/components/chat/ChatPanel.tsx
git commit -m "feat: 新增 WS 断线重连内联条并挂载到 Chat 栏"
```

---

## 收尾验证

- [ ] `pnpm lint`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm test`
- [ ] `pnpm build`

四步全绿后，本功能完成，走 finishing-a-development-branch 决定合并方式。

## 备注（评审可关注）

- **退场动画**：内联条在连接恢复(`open`)时直接卸载(仅入场 `.anim-collapse-in`,无退场过渡)。理由:恢复是"问题消失"的正向事件,瞬时移除读感自然,且避免引入 `useExitTransition` 的额外复杂度(YAGNI)。若需退场动画可作后续小改。
- **`connecting` 也显示重连中**:`mintTicket` 挂起(后端慢)时 `connecting` 可能持续,此时仍显示内联条(靠 `everOpen` 只抑制首屏初次连接),保证"后端慢"场景也有反馈。
- **看门狗阈值 45s**:>2× 服务端 ~20s 心跳。若后端心跳周期调整,同步改 `HEARTBEAT_TIMEOUT_MS`。
