# WS 断线提醒与重连加固 — 设计稿

- 日期：2026-07-01
- 范围：Koubou 对话 WebSocket 的断线可见性与重连可靠性
- 非范围：跨标签页共享连接（SharedWorker）、把 WS 迁入 Web Worker、PGC REST 链路

## 背景与问题

Koubou 对话走 WS 直连（`src/koubou/client.ts`）。传输层**已有**重连能力：指数退避（`scheduleReconnect`，`min(1000·2^retry, 8000)`）、关闭码分类（`classifyClose`：4401 重签 / 4404 新建 / 4000 顶替不重连 / 4400·4403 致命）、应用层心跳回应（收 `server.heartbeat` 即回 `client.ping`）、ticket 连续失败兜底（`MAX_TICKET_FAILS=5`）、命令积压冲刷。

但实测暴露两个明确缺口：

1. **半开 / 僵尸连接不自愈**：休眠唤醒、切 WiFi、切后台回来后，连接进入半开态（TCP 假活）。浏览器 `onclose` 迟迟不触发，客户端**永远停在 `open` 态、不重连**，页面看似连着但发消息无响应、也不再收推送。根因：客户端只**回应**心跳，从不**检测心跳是否还在来**。

2. **放弃后无出路**：`mintTicket` 连续失败达上限后停在 `error` 态——**无定时器、彻底停摆**，之后网络恢复也不重连，只能刷页。且 `error` 与瞬时抖动的 `error` 无法区分，UI 无从给"手动重连"入口。

3. **断开全程无可见反馈**：`connStatus` 有 6 态，但 UI 仅在 `fatal`/`superseded` 弹一次性 toast；`connecting`/`closed`/`error` 等过渡态**零提示**（`connErrorToast` 返回 null）。`connStatus` 唯一的其他用途是 `Composer` 门控自动发送。用户在断开/重连中全程无感。

## 目标 / 非目标

**目标**
- 半开连接能被客户端主动发现并触发重连
- 自动重连放弃后有出路：网络/前台恢复时自动重置重连，且提供手动重连入口
- 断开与重连中对用户可见（持续态提示，非一次性 toast）

**非目标**
- 多标签页共享单连接（SharedWorker）——经确认非当前目标
- 把 WS 迁入 Web Worker——不解决半开（休眠时 worker 同样挂起），且引入 postMessage 边界、cookie/basePath 搬迁、丧失单测便利，收益不抵成本
- 改动后端心跳协议或关闭码语义

## 方案

分三部分：传输层加固（`client.ts`，纯逻辑）、恢复触发（`useKoubouConnection` hook，DOM 副作用）、断开提醒 UI（Chat 栏内联条）。

### 一、传输层加固（`src/koubou/client.ts`）

#### 1. 心跳看门狗（治半开）

服务端每 ~20s 发 `server.heartbeat`。客户端新增看门狗定时器：

- `onopen` 时启动；**每收到任意入站帧**（`onmessage` 首行）就重置计时
- 阈值 `HEARTBEAT_TIMEOUT_MS = 45_000`（>2× 心跳间隔）内无任何帧 → 判定连接已死 → 主动 `ws.close()`
- 主动 close 落入既有 `onclose`：无自定义关闭码 → `classifyClose` 默认 `retry` → `scheduleReconnect` 退避重连
- `onclose` / 重连开始 / 用户 `close()` 时清除看门狗，避免野定时器污染新连接

活跃 run 有大量帧、空闲有 20s 心跳，两种情况都持续续命；仅真半开（既无业务帧也无心跳）才触发。纯 `setTimeout`，无 DOM 依赖，可单测。

#### 2. `reconnect()` 方法 + 新增 `'stalled'` 状态（治放弃后无出路）

- `ConnStatus` 增加 `'stalled'`（放弃态，区别于瞬时 `error`）。定义更新两处：`src/koubou/client.ts` 与 `src/store/types.ts`
- `mintTicket` 连续失败达 `MAX_TICKET_FAILS` 时，由 `onStatus('error')` 改为 `onStatus('stalled')`，明确表达"已停摆"，供 UI 显示手动重连按钮
- `KoubouClient` 接口新增 `reconnect(): void`：重置 `retry = 0`、`ticketFails = 0`、`closedByUser = false`，清除 pending 定时器后立即 `connect()`。幂等——重复调用只重连一次（先 clearTimeout）

#### 3. 关闭码 → 状态的既有语义保持

`superseded`（4000）/ `fatal`（4400·4403）仍为终态、不自动重连（协议/权限/被顶替不会自愈）。

### 二、恢复触发（`src/client/useKoubouConnection.ts`）

在 hook 内注册 DOM 监听（副作用归 client 层，符合分层约定）：

- 监听 `window` 的 `online` 与 `document` 的 `visibilitychange`
- 触发时读 `useStore.getState().connStatus`，若 ∈ `{stalled, error, closed}` 则调用当前 `client.reconnect()`
- **不**在 `fatal` / `superseded` / `open` / `connecting` 上自动重连
- 监听在 effect 内注册、cleanup 内解绑；用与 client 同一份 ref 访问 `reconnect`

`visibilitychange` 只在 `document.visibilityState === 'visible'` 时判定。`online` 事件直接判定。

### 三、断开提醒 UI（Chat 栏内联条）

断开是**持续态**，与 4s 自动消失的全局 `Toast` 语义不符——**不复用 Toast**，改用输入框上方的持续内联条，连接恢复即自动收起。

**新组件** `src/components/chat/ReconnectBanner.tsx`：
- 渲染在 Chat 栏 `Composer` 上方（`ChatPanel` 布局内）
- 读 `connStatus`（store）；手动重连经已有的 `client` ref（`useKoubouConnection` 已把 `clientRef` 透传至 `Composer`，`ReconnectBanner` 作为同级接收同一 ref）调 `client.current?.reconnect()`

**状态机映射**：

| `connStatus` | 内联条表现 |
|---|---|
| `open` | 隐藏（`.anim-collapse-in` 反向收起） |
| `connecting` / `closed` / `error` | spinner + "重连中，消息将在恢复后发送"，notice 色调，无按钮（自动重试中） |
| `stalled` / `fatal` | warning 色调 + "连接已断开" + 「重连」按钮 → `reconnect()` |
| `superseded` | 维持现状（柔和 notice toast，`connErrorToast` 不变），**不入内联条** |

**复用约束（遵 CLAUDE.md UI 范式）**：
- 色值走 `--color-*` CSS 变量（notice / warning 语义），禁硬编码
- 动效复用 `.anim-collapse-in`（180ms），退场反向；`prefers-reduced-motion` 下退化
- 「重连」按钮用现成 `Button` / `IconButton`，不自造
- 配 `aria-live="polite"` 供读屏播报
- **不禁用输入框**：断开期间发的命令本就入队、重连后冲刷，内联条顺带告知"消息将在恢复后发送"

**i18n**：新增文案 key（en 为单一真相源，补齐六语 en/zh/fr/ru/ja/vi）：
- `chat.conn.reconnecting`（重连中，消息将在恢复后发送）
- `chat.conn.disconnected`（连接已断开）
- `chat.conn.reconnect`（重连，按钮）

## 状态与数据流

```
server.heartbeat / 任意帧 ──▶ 重置看门狗
                              │ 45s 无帧
                              ▼
                          ws.close() ──▶ onclose(default) ──▶ scheduleReconnect
mintTicket ×5 失败 ──▶ onStatus('stalled') ──▶ setConn ──▶ ReconnectBanner「重连」按钮
online / visibilitychange(visible) ──▶ connStatus∈{stalled,error,closed} ? ──▶ client.reconnect()
「重连」按钮点击 ──▶ client.reconnect() ──▶ retry/ticketFails/closedByUser 归零 → connect()
connStatus ──▶ setConn(store) ──▶ ReconnectBanner 状态机渲染
```

## 错误处理与边界

- 看门狗仅在 socket `open` 后运行；`connect` 重入时先清旧看门狗，避免与旧 socket 的定时器叠加
- `reconnect()` 先 `clearTimeout(timer)` 再连，避免与在途退避定时器竞态双连
- 主动 close 触发的 `onclose`：`closedByUser` 为 false（看门狗触发不是用户关闭），故正常走重连
- `stalled` 后调 `reconnect()` 若 ticket 仍失败，会再次积累到上限、再回 `stalled`——可再次手动/自动重连，不进入紧循环（退避仍在）
- `fatal` 的「重连」按钮会重新 `mintTicket` 尝试（可能救回瞬时鉴权抖动）；若确属终态则再次落 `fatal`，可接受

## 测试计划（同目录 `*.test.ts`）

沿用现有 `FakeWS` + `flush()` 微任务 + `vi.useFakeTimers()/advanceTimersByTimeAsync()` 范式。

`src/koubou/client.test.ts` 新增：
- **看门狗触发**：open 后 45s 无帧 → 断言调用了 `ws.close()` → 推进退避 → 新 socket 建立
- **看门狗重置**：open 后每 <45s 收一帧（含 `server.heartbeat`）→ 不触发 close
- **`reconnect()`**：处于 `stalled`/退避态时调用 → 立即重连、`retry`/`ticketFails` 归零
- **`stalled` 状态**：`mintTicket` 连续失败达上限 → 断言 `onStatus` 最终收到 `'stalled'`（而非静默 `error`）
- 既有 `server.heartbeat` 回 `client.ping` 测试保持通过

`src/i18n/errors.test.ts`（若存在）/ 纯函数：
- `connErrorToast('stalled')` → null（走内联条不走 toast）；`fatal`/`superseded` 映射不变

组件测试 `ReconnectBanner.test.tsx`：
- 各 `connStatus` → 正确文案 / 是否显示「重连」按钮
- 点击「重连」→ 调用注入的 `reconnect`

## 涉及文件

- `src/koubou/client.ts`：看门狗、`reconnect()`、`stalled`、`ConnStatus`
- `src/store/types.ts`：`ConnStatus` 增加 `'stalled'`
- `src/client/useKoubouConnection.ts`：`online`/`visibilitychange` 恢复触发
- `src/components/chat/ReconnectBanner.tsx`（新）+ 在 `ChatPanel` 内挂载
- `src/i18n/errors.ts`：确认 `stalled` 不 toast（大概率无需改，`connErrorToast` 默认返回 null）
- `src/i18n/locales/*`：新增 `chat.conn.*` 六语文案
- 对应 `*.test.ts(x)`
```
