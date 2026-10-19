# Koubou WebSocket 完整对话能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Koubou WebSocket 协议实现完整对话能力(连接/发消息/流式渲染/run 生命周期/工具审批/AskUserQuestion/权限模式/增量重连/steering/多模态/media 预览),替换现有 `/api/agent/ws` 的 mock 脚本链路。

**Architecture:** 浏览器直连 `ws://8.232.44.61`;Next.js 新增 Koubou HTTP 代理用服务端 PGC token 签发短时 ws-ticket(凭证不进前端)。WS 事件经纯函数 reducer `applyKoubou` 映射进 zustand。画布/版本保持 PGC REST 驱动,`run.finished` 后刷新。

**Tech Stack:** Next.js 16 / React 19 / zustand 5 / ws 8 / vitest 4 / @testing-library/react。设计文档:`docs/superpowers/specs/2026-06-09-koubou-websocket-conversation-design.md`。

**约定:** 注释/commit 用中文;TDD;每步一个动作;频繁提交。所有路径相对仓库根 `game-create-platform/`。

---

## 文件结构

```
新增:
  src/app/api/koubou/[...path]/route.ts     Koubou HTTP 代理(透传,注入 PGC Bearer)
  src/server/koubou/proxy.ts                 proxyFetch(base=KOUBOU_BASE_URL,复用 getToken)
  src/koubou/protocol.ts                     协议类型 + 纯 helper(isFullMessage/parseMediaGenerated/classifyClose/buildWsUrl/toolResultText)
  src/koubou/client.ts                       WS 客户端(连接/发送/重连)
  src/koubou/apply-koubou.ts                 事件→KoubouState reducer
  src/client/useKoubouConnection.ts          连接 hook
  src/components/chat/ToolApprovalCard.tsx   工具审批卡
  src/components/chat/QuestionCard.tsx       AskUserQuestion 卡
  src/components/chat/PermissionModeMenu.tsx 权限模式切换
  + 对应 *.test.ts(x)

改造:
  src/store/types.ts                          KoubouState 切片 + Part 模型 + PendingInteraction
  src/store/index.ts                          ingestKoubou/会话 action + 按项目持久化
  src/components/chat/{Composer,MessageItem,ToolCard,ThinkingBlock,ChatPanel}.tsx
  src/components/workspace/Workspace.tsx       换 useKoubouConnection
  server.ts                                    移除 /api/agent/ws upgrade
  .env / .env.example                          KOUBOU_BASE_URL / NEXT_PUBLIC_KOUBOU_WS_URL

删除(退役 mock,Task 5):
  src/server/{agent,intent,scripts,ws}.ts (+ tests)
  src/agent-protocol/{frame,messages,tools}.ts (+ frame.test.ts)
  src/client/{ws-client,useAgentConnection}.ts (+ ws-client.test.ts)
  src/store/apply-message.ts (+ apply-message.test.ts)
```

---

## Task 1: 配置 + Koubou HTTP 代理

**Files:**
- Modify: `.env`, `.env.example`
- Create: `src/server/koubou/proxy.ts`
- Create: `src/app/api/koubou/[...path]/route.ts`

- [ ] **Step 1: 加环境变量**

在 `.env.example` 末尾追加:

```
# Koubou agent WebSocket 对接
KOUBOU_BASE_URL=http://8.232.44.61          # 服务端:签 ws-ticket / sessions REST
NEXT_PUBLIC_KOUBOU_WS_URL=ws://8.232.44.61  # 浏览器:拼 WS URL
```

在 `.env` 末尾追加同样两行(值相同)。

- [ ] **Step 2: 写 Koubou proxyFetch(复用 PGC token,base 换 Koubou)**

Create `src/server/koubou/proxy.ts`:

```ts
// Koubou HTTP 代理:沿用服务端 PGC token,base 指向 KOUBOU_BASE_URL
import { getToken, invalidateToken } from '@/server/pgc/auth';

function base(): string {
  const b = process.env.KOUBOU_BASE_URL;
  if (!b) throw new Error('KOUBOU_BASE_URL 未配置');
  return b.replace(/\/$/, '');
}

export interface ProxyInit {
  body?: BodyInit | null;
  headers?: Record<string, string>;
  search?: string; // 含前导 ?
}

// 转发到 koubou,注入 Bearer(PGC access_token);401 → 失效重登并重试一次
export async function proxyFetch(method: string, path: string, init: ProxyInit = {}): Promise<Response> {
  const url = `${base()}${path}${init.search ?? ''}`;
  const doFetch = (token: string) =>
    fetch(url, {
      method,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      body: init.body ?? undefined,
    });

  let res = await doFetch(await getToken());
  if (res.status === 401) {
    invalidateToken();
    res = await doFetch(await getToken());
  }
  return res;
}
```

- [ ] **Step 3: 写 catch-all 路由**

Create `src/app/api/koubou/[...path]/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { proxyFetch } from '@/server/koubou/proxy';

export const dynamic = 'force-dynamic';

const PASS_THROUGH = ['content-type', 'content-disposition', 'content-length'];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = '/' + path.join('/');
  const method = req.method;
  const hasBody = method === 'POST' || method === 'PATCH' || method === 'PUT';

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;

  const body = hasBody ? Buffer.from(await req.arrayBuffer()) : undefined;
  const res = await proxyFetch(method, target, { headers, body, search: req.nextUrl.search });

  const out = new Headers();
  for (const h of PASS_THROUGH) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
```

- [ ] **Step 4: 手动验证代理签 ticket**

确保 dev server 在跑(`pnpm dev`),另开终端:

Run: `curl -sS -X POST http://localhost:3000/api/koubou/auth/ws-ticket -H 'Content-Type: application/json' -d '{}' -w '\n[HTTP %{http_code}]\n'`
Expected: `{"code":0,"message":"ok","data":{"ticket":"...","expires_in_seconds":60}}` 且 `[HTTP 200]`

- [ ] **Step 5: Commit**

```bash
git add .env.example src/server/koubou/proxy.ts src/app/api/koubou/
git commit -m "Koubou 对话:HTTP 代理 + 环境变量(签发 ws-ticket)"
```

---

## Task 2: 协议层 protocol.ts

**Files:**
- Create: `src/koubou/protocol.ts`
- Test: `src/koubou/protocol.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/koubou/protocol.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { isFullMessage, parseMediaGenerated, classifyClose, buildWsUrl, toolResultText } from './protocol';

describe('isFullMessage', () => {
  test('完整消息类型为 true,StreamEvent/未知为 false', () => {
    expect(isFullMessage('AssistantMessage')).toBe(true);
    expect(isFullMessage('ResultMessage')).toBe(true);
    expect(isFullMessage('StreamEvent')).toBe(false);
    expect(isFullMessage('HookEventMessage')).toBe(false);
  });
});

describe('parseMediaGenerated', () => {
  test('解析 media.generated JSON', () => {
    const j = JSON.stringify({ type: 'media.generated', kind: 'image', path: 'a.png', preview_url: 'http://x/a.png' });
    expect(parseMediaGenerated(j)).toMatchObject({ kind: 'image', preview_url: 'http://x/a.png' });
  });
  test('非 media JSON 或非法文本返回 null', () => {
    expect(parseMediaGenerated('{"status":"ok"}')).toBeNull();
    expect(parseMediaGenerated('plain text')).toBeNull();
  });
});

describe('toolResultText', () => {
  test('字符串原样;block 数组拼 text', () => {
    expect(toolResultText('hi')).toBe('hi');
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab');
  });
});

describe('classifyClose', () => {
  test('关闭码分类', () => {
    expect(classifyClose(4401)).toBe('reauth');
    expect(classifyClose(4404)).toBe('recreate');
    expect(classifyClose(4000)).toBe('superseded');
    expect(classifyClose(4400)).toBe('fatal');
    expect(classifyClose(4403)).toBe('fatal');
    expect(classifyClose(1006)).toBe('retry');
  });
});

describe('buildWsUrl', () => {
  test('新建会话 URL', () => {
    expect(buildWsUrl('ws://h', '2', { ticket: 'tk' })).toBe('ws://h/projects/2/ws?ws_ticket=tk');
  });
  test('恢复会话 URL', () => {
    expect(buildWsUrl('ws://h/', '2', { sessionId: 's1', ticket: 'tk' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk');
  });
  test('续传带 after_sequence(仅恢复时)', () => {
    expect(buildWsUrl('ws://h', '2', { sessionId: 's1', afterSequence: 7, ticket: 'tk' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk&after_sequence=7');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/koubou/protocol.test.ts`
Expected: FAIL（`Cannot find module './protocol'`）

- [ ] **Step 3: 写 protocol.ts**

Create `src/koubou/protocol.ts`:

```ts
// Koubou WebSocket 协议类型 + 纯 helper(前后端共享语义,以 Claude Agent SDK 消息为主)

// ---- 权限模式 ----
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions' | 'auto';

// ---- 关闭码 ----
export type CloseAction = 'reauth' | 'recreate' | 'superseded' | 'fatal' | 'retry';
export function classifyClose(code: number): CloseAction {
  switch (code) {
    case 4401: return 'reauth';      // 重新签 ticket
    case 4404: return 'recreate';    // 会话不存在 → 改新建
    case 4000: return 'superseded';  // 被新连接顶替 → 不重连
    case 4400:
    case 4403: return 'fatal';       // 协议/权限错误 → 不重连
    default: return 'retry';         // 网络断开 → 退避重连
  }
}

// ---- Claude content block(raw Anthropic 形状) ----
export interface TextBlock { type: 'text'; text: string }
export interface ThinkingBlock { type: 'thinking'; thinking: string }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };

// ---- 原始 stream event(Anthropic streaming 子集) ----
export type RawStreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: string; [k: string]: unknown };

// ---- sdk 消息类型 ----
export function isFullMessage(sdkType: string): boolean {
  return sdkType === 'AssistantMessage' || sdkType === 'UserMessage'
    || sdkType === 'SystemMessage' || sdkType === 'ResultMessage';
}

export interface ClaudeMessagePayload {
  sdk_type: string;
  payload: {
    content?: ContentBlock[] | string;
    model?: string;
    message_id?: string;
    id?: string;
    event?: RawStreamEvent;
    [k: string]: unknown;
  };
}

// ---- 服务端 envelope ----
export interface ServerEvent {
  type: string;
  project_id: string;
  session_id: string;
  payload: Record<string, unknown>;
  event_id?: string;
  run_id?: string | null;
  sequence?: number | null;
  created_at?: string;
}

// ---- 客户端 envelope ----
export interface ClientEvent { type: string; payload?: unknown; event_id?: string }
export type UserMessageContent = { role: 'user'; content: string | ContentBlock[] };

// ---- AskUserQuestion 题目 ----
export interface QuestionOption { label: string; description?: string }
export interface QuestionDef { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean }

// ---- media.generated ----
export interface MediaGenerated {
  type: 'media.generated';
  kind: string;            // 'image' | 'video' | ...
  path: string;
  preview_url: string | null;
  human_size?: string;
  [k: string]: unknown;
}

// 进程内 MCP 工具结果以 text block 下发,文本是 JSON;解析 media.generated
export function parseMediaGenerated(text: string): MediaGenerated | null {
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && j.type === 'media.generated') return j as MediaGenerated;
  } catch { /* 非 JSON */ }
  return null;
}

// tool_result.content 可能是字符串或 block 数组,拍平成文本
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('');
  }
  return '';
}

// 拼 WS URL:有 sessionId→恢复(可带 after_sequence);否则新建
export function buildWsUrl(
  base: string,
  projectId: string,
  opts: { sessionId?: string | null; afterSequence?: number | null; ticket: string },
): string {
  const root = base.replace(/\/$/, '');
  const path = opts.sessionId ? `/projects/${projectId}/sessions/${opts.sessionId}/ws` : `/projects/${projectId}/ws`;
  const params = new URLSearchParams({ ws_ticket: opts.ticket });
  if (opts.sessionId && opts.afterSequence != null) params.set('after_sequence', String(opts.afterSequence));
  return `${root}${path}?${params.toString()}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/koubou/protocol.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/koubou/protocol.ts src/koubou/protocol.test.ts
git commit -m "Koubou 对话:协议类型 + 纯 helper"
```

---

## Task 3: WS 客户端 client.ts

**Files:**
- Create: `src/koubou/client.ts`
- Test: `src/koubou/client.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/koubou/client.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import { createKoubouClient } from './client';
import type { ServerEvent } from './protocol';

class FakeWS {
  static OPEN = 1; readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.({ code: 1000 }); }
  emit(ev: ServerEvent) { this.onmessage?.({ data: JSON.stringify(ev) }); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<Parameters<typeof createKoubouClient>[0]> = {}) {
  const created: FakeWS[] = [];
  const statuses: string[] = [];
  const events: ServerEvent[] = [];
  const client = createKoubouClient({
    wsBaseUrl: 'ws://h',
    projectId: '2',
    mintTicket: () => Promise.resolve('tk'),
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    factory: (url: string) => { const w = new FakeWS(url); created.push(w); return w as never; },
    ...over,
  });
  return { client, created, statuses, events };
}

describe('createKoubouClient', () => {
  test('新建会话:mint ticket 后用新建 URL 连接,事件透传', async () => {
    const { created, events } = setup();
    await flush();
    expect(created[0].url).toBe('ws://h/projects/2/ws?ws_ticket=tk');
    created[0].onopen?.();
    created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's9', payload: {} });
    expect(events[0]).toMatchObject({ type: 'session.ready', session_id: 's9' });
  });

  test('sendUserMessage 组装 user.message envelope', async () => {
    const { client, created } = setup();
    await flush();
    created[0].onopen?.();
    client.sendUserMessage({ role: 'user', content: 'hi' });
    expect(JSON.parse(created[0].sent[0])).toEqual({ type: 'user.message', payload: { message: { role: 'user', content: 'hi' }, parent_tool_use_id: null } });
  });

  test('approveTool / answerQuestion / interrupt / setPermissionMode 各自 envelope', async () => {
    const { client, created } = setup();
    await flush();
    created[0].onopen?.();
    client.approveTool('toolu_1', false);
    client.answerQuestion('toolu_2', { 'Q?': '像素风' });
    client.interrupt();
    client.setPermissionMode('acceptEdits');
    const sent = created[0].sent.map((s) => JSON.parse(s));
    expect(sent[0]).toEqual({ type: 'tool.approval', payload: { interaction_id: 'toolu_1', approved: false } });
    expect(sent[1]).toEqual({ type: 'ask_user_question.answer', payload: { interaction_id: 'toolu_2', answers: { 'Q?': '像素风' } } });
    expect(sent[2]).toEqual({ type: 'run.interrupt', payload: {} });
    expect(sent[3]).toEqual({ type: 'session.set_permission_mode', payload: { mode: 'acceptEdits' } });
  });

  test('收到 session.ready 后记住 session_id,4401 关闭重连用恢复 URL', async () => {
    const { created } = setup();
    await flush();
    created[0].onopen?.();
    created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's9', payload: {}, sequence: null });
    created[0].onclose?.({ code: 4401 });
    await flush();
    expect(created[1].url).toBe('ws://h/projects/2/sessions/s9/ws?ws_ticket=tk');
  });

  test('4000 superseded 不重连', async () => {
    const { created, statuses } = setup();
    await flush();
    created[0].onopen?.();
    created[0].onclose?.({ code: 4000 });
    await flush();
    expect(created.length).toBe(1);
    expect(statuses).toContain('superseded');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/koubou/client.test.ts`
Expected: FAIL（`Cannot find module './client'`）

- [ ] **Step 3: 写 client.ts**

Create `src/koubou/client.ts`:

```ts
import {
  buildWsUrl, classifyClose,
  type ServerEvent, type PermissionMode, type UserMessageContent, type ClientEvent,
} from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded';

export interface KoubouClientOpts {
  wsBaseUrl: string;
  projectId: string;
  sessionId?: string | null;
  afterSequence?: number | null;
  mintTicket: () => Promise<string>;
  onEvent: (e: ServerEvent) => void;
  onStatus: (s: ConnStatus) => void;
  factory?: (url: string) => WebSocket;   // 测试注入
}

export interface KoubouClient {
  sendUserMessage: (message: UserMessageContent, parentToolUseId?: string | null) => void;
  steer: (content: string) => void;
  interrupt: () => void;
  approveTool: (interactionId: string, approved: boolean) => void;
  answerQuestion: (interactionId: string, answers: Record<string, string | string[]>) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  close: () => void;
}

const WS_OPEN = 1;

export function createKoubouClient(opts: KoubouClientOpts): KoubouClient {
  let ws: WebSocket | null = null;
  let sessionId: string | null = opts.sessionId ?? null;
  let afterSequence: number | null = opts.afterSequence ?? null;
  let retry = 0;
  let closedByUser = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const make = opts.factory ?? ((u: string) => new WebSocket(u));

  const connect = async () => {
    if (closedByUser) return;
    opts.onStatus('connecting');
    let ticket: string;
    try { ticket = await opts.mintTicket(); }
    catch { opts.onStatus('error'); scheduleReconnect(); return; }
    if (closedByUser) return;
    const url = buildWsUrl(opts.wsBaseUrl, opts.projectId, { sessionId, afterSequence, ticket });
    ws = make(url);
    ws.onopen = () => { retry = 0; opts.onStatus('open'); };
    ws.onmessage = (e: MessageEvent | { data: string }) => {
      const raw = (e as { data: string }).data;
      let ev: ServerEvent | null = null;
      try { ev = JSON.parse(raw) as ServerEvent; } catch { return; } // 容错:跳过非法帧
      // 记住 session_id,供重连用恢复 URL;跟踪 lastSequence 供续传
      if (ev.session_id && !sessionId) sessionId = ev.session_id;
      if (typeof ev.sequence === 'number') afterSequence = ev.sequence;
      opts.onEvent(ev);
    };
    ws.onerror = () => opts.onStatus('error');
    ws.onclose = (e: CloseEvent | { code: number }) => {
      const code = (e as { code: number }).code ?? 1006;
      if (closedByUser) { opts.onStatus('closed'); return; }
      const action = classifyClose(code);
      if (action === 'superseded') { opts.onStatus('superseded'); return; }
      if (action === 'fatal') { opts.onStatus('error'); return; }
      if (action === 'recreate') { sessionId = null; afterSequence = null; }
      // reauth / retry / recreate 均重连(reauth 会重新 mintTicket)
      opts.onStatus('closed');
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closedByUser) return;
    clearTimeout(timer);
    timer = setTimeout(() => void connect(), Math.min(1000 * 2 ** retry++, 8000));
  };

  const send = (frame: ClientEvent) => {
    if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify(frame));
  };

  void connect();

  return {
    sendUserMessage: (message, parentToolUseId = null) =>
      send({ type: 'user.message', payload: { message, parent_tool_use_id: parentToolUseId } }),
    steer: (content) => send({ type: 'user.steer', payload: { content } }),
    interrupt: () => send({ type: 'run.interrupt', payload: {} }),
    approveTool: (interaction_id, approved) => send({ type: 'tool.approval', payload: { interaction_id, approved } }),
    answerQuestion: (interaction_id, answers) => send({ type: 'ask_user_question.answer', payload: { interaction_id, answers } }),
    setPermissionMode: (mode) => send({ type: 'session.set_permission_mode', payload: { mode } }),
    close: () => { closedByUser = true; clearTimeout(timer); ws?.close(); },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/koubou/client.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/koubou/client.ts src/koubou/client.test.ts
git commit -m "Koubou 对话:WS 客户端(连接/发送/关闭码重连)"
```

---

## Task 4a: store 类型 — KoubouState / Part / PendingInteraction

**Files:**
- Modify: `src/store/types.ts`

- [ ] **Step 1: 改 Part 模型 + 新增会话类型**

打开 `src/store/types.ts`。把**从 `export type Part =` 到 `createInitialReducerState()` 函数结束的整段**(含中间的 `ConnStatus` / `RunStatus` / `Message` / `ReducerState` / `createInitialReducerState`,即原第 26-54 行)整体替换为下面内容(`AssetKind` import 行第 1 行此刻先保留,Task 5 Step 1a 再迁移;`AssetSource`/`Status`/`Asset`/`Version`/`AssetPreviewData` 段与 `GenTask` 不动):

```ts
import type { PermissionMode, MediaGenerated, QuestionDef } from '@/koubou/protocol';

export type Part =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; status: Status; result?: string; isError?: boolean; media?: MediaGenerated };

export interface Message {
  id: string; role: 'user' | 'assistant'; parts: Part[]; status: Status;
}

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded';
export type RunStatus = 'idle' | 'running' | 'error';

// 未决交互(工具审批 / AskUserQuestion),按 interaction_id 去重
export interface ApprovalInteraction { kind: 'approval'; interactionId: string; toolName: string; input: unknown }
export interface QuestionInteraction { kind: 'question'; interactionId: string; questions: QuestionDef[] }
export type PendingInteraction = ApprovalInteraction | QuestionInteraction;

// 对话切片(由 applyKoubou 维护)
export interface KoubouState {
  messages: Message[];
  runStatus: RunStatus;
  activeRunId: string | null;
  permissionMode: PermissionMode;
  sessionId: string | null;
  lastSequence: number;
  model: string | null;
  pendingInteractions: Record<string, PendingInteraction>;
  seenSequences: number[];   // 重放去重,不持久化
}

export function createInitialKoubouState(): KoubouState {
  return {
    messages: [], runStatus: 'idle', activeRunId: null, permissionMode: 'default',
    sessionId: null, lastSequence: 0, model: null, pendingInteractions: {}, seenSequences: [],
  };
}

// 每项目会话持久化(单会话自动恢复)
export interface PersistedSession { sessionId: string; lastSequence: number; messages: Message[] }
```

> 删掉旧的 `ReducerState`/`createInitialReducerState`(已被 `KoubouState` 取代)。`AssetKind` import 行(第 1 行)保留。第 4-5 行 `AssetSource`/`Status` 及 `Asset`/`Version`/`AssetPreviewData` 段(第 4-24 行)保持不变。

- [ ] **Step 2: 给 ServerState 加 koubouByProject**

把 `ServerState`(原第 60-71 行)的接口与初始化改为:

```ts
export interface ServerState {
  projects: ProjectData[];
  currentProjectId: number | null;
  genTasks: GenTask[];
  pendingVersionId: string | null;
  buildingVersion: Version | null;
  lastError: { code: string; message: string } | null;
  koubouByProject: Record<string, PersistedSession>;   // 按项目持久化会话
}

export function createInitialServerState(): ServerState {
  return { projects: [], currentProjectId: null, genTasks: [], pendingVersionId: null, buildingVersion: null, lastError: null, koubouByProject: {} };
}
```

- [ ] **Step 3: 校验类型编译**

Run: `pnpm exec tsc --noEmit`
Expected: 报错集中在 `src/store/index.ts` / `apply-message.ts` / 旧 chat 组件(引用了已删的 `ReducerState`、`asset-ref`/`action` part)——这些将在 Task 4b/5/6 修复。`types.ts` 本身不应报错。

- [ ] **Step 4: Commit**

```bash
git add src/store/types.ts
git commit -m "Koubou 对话:store 类型(KoubouState/Part/PendingInteraction/按项目持久化)"
```

---

## Task 4b: apply-koubou reducer

**Files:**
- Create: `src/koubou/apply-koubou.ts`
- Test: `src/koubou/apply-koubou.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/koubou/apply-koubou.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { applyKoubou } from './apply-koubou';
import { createInitialKoubouState } from '@/store/types';
import type { ServerEvent } from './protocol';

const S = () => createInitialKoubouState();
const ev = (e: Partial<ServerEvent> & { type: string }): ServerEvent =>
  ({ project_id: '2', session_id: 's1', payload: {}, ...e }) as ServerEvent;

describe('session.ready', () => {
  test('空消息时用 visible_state 重建历史 + 恢复 run/权限/pending', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: {
        session_id: 's1', permission_mode: 'acceptEdits',
        visible_state: { messages: [
          { uuid: 'u1', role: 'user', content: { role: 'user', content: '做个跳跃游戏' } },
          { uuid: 'a1', role: 'assistant', content: { role: 'assistant', content: [
            { type: 'thinking', thinking: '先看目录' }, { type: 'text', text: '好的' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ] } },
          { uuid: 'u2', role: 'user', content: { role: 'user', content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'a.png\nb.png' },
          ] } },
        ] },
        active_run: { run_id: 'r1', status: 'running' },
        pending_interactions: [
          { interaction_id: 'i1', interaction_type: 'approval', tool_name: 'Bash', request: { interaction_id: 'i1', tool_name: 'Bash', input: { command: 'rm' } } },
        ],
      },
    }));
    expect(next.sessionId).toBe('s1');
    expect(next.permissionMode).toBe('acceptEdits');
    expect(next.runStatus).toBe('running');
    expect(next.activeRunId).toBe('r1');
    // 历史:user 气泡 + assistant 气泡(tool_result 折叠进 tool part,不单独成泡)
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0].role).toBe('user');
    const tool = next.messages[1].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ id: 't1', name: 'Bash', result: 'a.png\nb.png', status: 'ready' });
    expect(next.pendingInteractions['i1']).toMatchObject({ kind: 'approval', toolName: 'Bash' });
  });

  test('已有本地消息时不覆盖历史,仅校正 run/pending', () => {
    const base = { ...S(), messages: [{ id: 'local', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }], status: 'ready' as const }] };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, pending_interactions: [], permission_mode: 'default', visible_state: { messages: [] } } }));
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].id).toBe('local');
    expect(next.runStatus).toBe('idle');
  });
});

describe('run 生命周期', () => {
  test('run.started → running;run.finished succeeded → idle', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    expect(s.runStatus).toBe('running');
    expect(s.activeRunId).toBe('r1');
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 4, payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.runStatus).toBe('idle');
    expect(s.activeRunId).toBeNull();
    expect(s.lastSequence).toBe(4);
  });
  test('run.finished failed → error', () => {
    const s = applyKoubou(S(), ev({ type: 'run.finished', sequence: 2, payload: { status: 'failed' } }));
    expect(s.runStatus).toBe('error');
  });
});

describe('claude.message 流式 + 完整消息', () => {
  test('StreamEvent 增量累积文本,AssistantMessage 落定权威内容', () => {
    let s = S();
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } } } } }));
    expect(s.messages[0].parts[0]).toEqual({ type: 'text', text: '你好' });
    // 完整 AssistantMessage(同 message_id)落定,覆盖草稿
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'text', text: '你好,我们开始吧' }] } } }));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].parts[0]).toEqual({ type: 'text', text: '你好,我们开始吧' });
    expect(s.messages[0].status).toBe('ready');
  });

  test('UserMessage 的 tool_result 回填到 tool part,media.generated 解析', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: 3, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm2', content: [{ type: 'tool_use', id: 'tg', name: 'generate_image', input: {} }] } } }));
    const mediaJson = JSON.stringify({ type: 'media.generated', kind: 'image', path: 'x.png', preview_url: 'http://x/x.png' });
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 4, payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 'tg', content: mediaJson }] } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool')!;
    expect(tool).toMatchObject({ status: 'ready' });
    expect((tool as { media?: { preview_url: string } }).media?.preview_url).toBe('http://x/x.png');
  });
});

describe('交互 + 去重 + 错误', () => {
  test('approval.requested / question.requested 写入 pending', () => {
    let s = applyKoubou(S(), ev({ type: 'tool.approval.requested', sequence: 5, payload: { interaction_id: 'i1', tool_name: 'Bash', input: { command: 'ls' } } }));
    expect(s.pendingInteractions['i1']).toMatchObject({ kind: 'approval', toolName: 'Bash' });
    s = applyKoubou(s, ev({ type: 'ask_user_question.requested', sequence: 6, payload: { interaction_id: 'i2', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }] } } }));
    expect(s.pendingInteractions['i2']).toMatchObject({ kind: 'question' });
  });

  test('同 sequence 重复事件被忽略(幂等)', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'tool.approval.requested', sequence: 5, payload: { interaction_id: 'i1', tool_name: 'Bash', input: {} } }));
    const before = s.pendingInteractions;
    s = applyKoubou(s, ev({ type: 'tool.approval.requested', sequence: 5, payload: { interaction_id: 'iX', tool_name: 'Other', input: {} } }));
    expect(s.pendingInteractions).toBe(before); // sequence=5 已见,整事件忽略
  });

  test('permission_mode.changed 更新模式;error stale 清对应弹窗', () => {
    let s = applyKoubou(S(), ev({ type: 'tool.approval.requested', sequence: 7, payload: { interaction_id: 'i1', tool_name: 'Bash', input: {} } }));
    s = applyKoubou(s, ev({ type: 'permission_mode.changed', sequence: null, payload: { mode: 'plan' } }));
    expect(s.permissionMode).toBe('plan');
    s = applyKoubou(s, ev({ type: 'error', sequence: 8, payload: { message: 'stale tool approval', interaction_id: 'i1' } }));
    expect(s.pendingInteractions['i1']).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/koubou/apply-koubou.test.ts`
Expected: FAIL（`Cannot find module './apply-koubou'`）

- [ ] **Step 3: 写 apply-koubou.ts**

Create `src/koubou/apply-koubou.ts`:

```ts
import type {
  ServerEvent, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
  RawStreamEvent, ClaudeMessagePayload, PermissionMode, QuestionDef,
} from './protocol';
import { isFullMessage, parseMediaGenerated, toolResultText } from './protocol';
import type { KoubouState, Message, Part, PendingInteraction } from '@/store/types';
import { newId } from '@/lib/ids';

export function applyKoubou(state: KoubouState, e: ServerEvent): KoubouState {
  // 可重放事件按 sequence 去重(重连重放 + ready 可能重复下发)
  if (typeof e.sequence === 'number') {
    if (state.seenSequences.includes(e.sequence)) return state;
    state = { ...state, seenSequences: [...state.seenSequences, e.sequence], lastSequence: Math.max(state.lastSequence, e.sequence) };
  }
  switch (e.type) {
    case 'session.ready': return onReady(state, e);
    case 'run.started': return { ...state, runStatus: 'running', activeRunId: (e.payload.run_id as string) ?? e.run_id ?? null };
    case 'run.interrupted': return finishRun(state, 'idle');
    case 'run.finished': return finishRun(state, e.payload.status === 'succeeded' ? 'idle' : 'error');
    case 'claude.message': return onClaudeMessage(state, e.payload as unknown as ClaudeMessagePayload);
    case 'tool.approval.requested': return upsertPending(state, {
      kind: 'approval', interactionId: e.payload.interaction_id as string,
      toolName: e.payload.tool_name as string, input: e.payload.input,
    });
    case 'ask_user_question.requested': return upsertPending(state, {
      kind: 'question', interactionId: e.payload.interaction_id as string,
      questions: ((e.payload.input as { questions?: QuestionDef[] })?.questions) ?? [],
    });
    case 'permission_mode.changed': return { ...state, permissionMode: e.payload.mode as PermissionMode };
    case 'error': return onError(state, e);
    default: return state; // 未知事件容错
  }
}

// ---- session.ready ----
function onReady(state: KoubouState, e: ServerEvent): KoubouState {
  const p = e.payload as {
    session_id?: string; permission_mode?: PermissionMode;
    visible_state?: { messages?: HistoryView[] };
    active_run?: { run_id: string; status: string } | null;
    pending_interactions?: PendingRaw[];
  };
  const activeRun = p.active_run ?? null;
  let next: KoubouState = {
    ...state,
    sessionId: p.session_id ?? state.sessionId,
    permissionMode: p.permission_mode ?? state.permissionMode,
    runStatus: activeRun ? 'running' : 'idle',
    activeRunId: activeRun?.run_id ?? null,
  };
  // 无本地缓存 → 用 visible_state 重建历史;有本地缓存 → 保留本地消息
  if (state.messages.length === 0 && p.visible_state?.messages?.length) {
    next = { ...next, messages: rebuildHistory(p.visible_state.messages) };
  }
  // 合并 pending(去重 by interaction_id)
  for (const it of p.pending_interactions ?? []) {
    next = upsertPending(next, toPending(it));
  }
  return next;
}

interface HistoryView { uuid: string; role: string; content?: { role?: string; content?: ContentBlock[] | string } }
interface PendingRaw { interaction_id: string; interaction_type: string; tool_name: string; request: { input?: unknown; questions?: QuestionDef[] } }

function toPending(it: PendingRaw): PendingInteraction {
  if (it.interaction_type === 'question') {
    return { kind: 'question', interactionId: it.interaction_id, questions: (it.request as { questions?: QuestionDef[]; input?: { questions?: QuestionDef[] } }).questions ?? (it.request.input as { questions?: QuestionDef[] })?.questions ?? [] };
  }
  return { kind: 'approval', interactionId: it.interaction_id, toolName: it.tool_name, input: it.request.input };
}

function rebuildHistory(views: HistoryView[]): Message[] {
  const messages: Message[] = [];
  for (const v of views) {
    const content = v.content?.content ?? [];
    if (v.role === 'assistant') {
      messages.push({ id: v.uuid, role: 'assistant', parts: blocksToParts(content), status: 'ready' });
    } else {
      // user:若全是 tool_result → 折叠进既有 tool part,不成泡;否则成 user 气泡
      const blocks = Array.isArray(content) ? content : [];
      const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
      if (results.length && results.length === blocks.length) {
        foldResults(messages, results);
      } else {
        messages.push({ id: v.uuid, role: 'user', parts: blocksToParts(content), status: 'ready' });
      }
    }
  }
  return messages;
}

function blocksToParts(content: ContentBlock[] | string): Part[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const parts: Part[] = [];
  for (const b of content) {
    if (b.type === 'text') parts.push({ type: 'text', text: (b as TextBlock).text ?? '' });
    else if (b.type === 'thinking') parts.push({ type: 'thinking', text: (b as ThinkingBlock).thinking ?? '' });
    else if (b.type === 'tool_use') { const t = b as ToolUseBlock; parts.push({ type: 'tool', id: t.id, name: t.name, input: t.input, status: 'ready' }); }
    // tool_result 由 foldResults 处理
  }
  return parts;
}

// 把 tool_result 回填到对应 tool_use part(跨消息按 tool_use_id 匹配)
function foldResults(messages: Message[], results: ToolResultBlock[]): void {
  for (const r of results) {
    const text = toolResultText(r.content);
    const media = parseMediaGenerated(text) ?? undefined;
    for (const m of messages) {
      for (let i = 0; i < m.parts.length; i++) {
        const p = m.parts[i];
        if (p.type === 'tool' && p.id === r.tool_use_id) {
          m.parts[i] = { ...p, status: 'ready', result: text, isError: r.is_error, media };
        }
      }
    }
  }
}

// ---- run 结束:清 loading + 落定最后一条 assistant ----
function finishRun(state: KoubouState, status: 'idle' | 'error'): KoubouState {
  const messages = state.messages.map((m) =>
    m.role === 'assistant' && m.status === 'generating' ? { ...m, status: status === 'error' ? 'error' as const : 'ready' as const } : m);
  return { ...state, messages, runStatus: status, activeRunId: null };
}

// ---- claude.message ----
function onClaudeMessage(state: KoubouState, p: ClaudeMessagePayload): KoubouState {
  if (p.sdk_type === 'StreamEvent') return applyStreamEvent(state, p.payload.event as RawStreamEvent);
  if (!isFullMessage(p.sdk_type)) return state; // HookEvent/TaskProgress 等忽略
  if (p.sdk_type === 'SystemMessage') return p.payload.model ? { ...state, model: p.payload.model } : state;
  if (p.sdk_type === 'ResultMessage') return state; // run.finished 已驱动状态
  const content = (p.payload.content ?? []) as ContentBlock[] | string;
  const messageId = p.payload.message_id ?? p.payload.id;
  if (p.sdk_type === 'AssistantMessage') return reconcileAssistant(state, messageId, content);
  // UserMessage:仅折叠 tool_result(用户文本已乐观渲染,不重复成泡)
  const blocks = Array.isArray(content) ? content : [];
  const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  if (!results.length) return state;
  const messages = state.messages.map((m) => ({ ...m, parts: m.parts.slice() }));
  foldResults(messages, results);
  return { ...state, messages };
}

function reconcileAssistant(state: KoubouState, messageId: string | undefined, content: ContentBlock[] | string): KoubouState {
  const parts = blocksToParts(content);
  const messages = state.messages.slice();
  // 优先按 message_id 匹配;否则收编尾部 generating 草稿;再否则新增
  let idx = messageId ? messages.findIndex((m) => m.id === messageId) : -1;
  if (idx === -1) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].status === 'generating') { idx = i; break; }
    }
  }
  const msg: Message = { id: messageId ?? newId('msg'), role: 'assistant', parts, status: 'ready' };
  if (idx === -1) messages.push(msg); else messages[idx] = msg;
  return { ...state, messages };
}

function applyStreamEvent(state: KoubouState, ev: RawStreamEvent): KoubouState {
  switch (ev.type) {
    case 'message_start': {
      const id = (ev as { message: { id: string } }).message.id;
      if (state.messages.some((m) => m.id === id)) return state;
      return { ...state, messages: [...state.messages, { id, role: 'assistant', parts: [], status: 'generating' }] };
    }
    case 'content_block_start': {
      const cur = lastDraft(state); if (!cur) return state;
      const cb = (ev as { index: number; content_block: { type: string; id?: string; name?: string } });
      const part: Part = cb.content_block.type === 'text' ? { type: 'text', text: '' }
        : cb.content_block.type === 'thinking' ? { type: 'thinking', text: '' }
        : { type: 'tool', id: cb.content_block.id ?? '', name: cb.content_block.name ?? '', input: undefined, status: 'generating' };
      return patchDraft(state, cur.id, (parts) => setAt(parts, cb.index, part));
    }
    case 'content_block_delta': {
      const cur = lastDraft(state); if (!cur) return state;
      const d = (ev as { index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } });
      return patchDraft(state, cur.id, (parts) => {
        const arr = parts.slice(); const p = arr[d.index]; if (!p) return arr;
        if (d.delta.type === 'text_delta' && p.type === 'text') arr[d.index] = { ...p, text: p.text + (d.delta.text ?? '') };
        else if (d.delta.type === 'thinking_delta' && p.type === 'thinking') arr[d.index] = { ...p, text: p.text + (d.delta.thinking ?? '') };
        // tool input 增量在草稿期不解析,等完整 AssistantMessage 落定
        return arr;
      });
    }
    default: return state; // content_block_stop / message_stop 不改草稿
  }
}

function lastDraft(state: KoubouState): Message | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'assistant' && state.messages[i].status === 'generating') return state.messages[i];
  }
  return undefined;
}
function patchDraft(state: KoubouState, id: string, fn: (parts: Part[]) => Part[]): KoubouState {
  return { ...state, messages: state.messages.map((m) => (m.id === id ? { ...m, parts: fn(m.parts) } : m)) };
}
function setAt(arr: Part[], i: number, v: Part): Part[] { const a = arr.slice(); a[i] = v; return a; }

// ---- pending / error ----
function upsertPending(state: KoubouState, it: PendingInteraction): KoubouState {
  return { ...state, pendingInteractions: { ...state.pendingInteractions, [it.interactionId]: it } };
}
function onError(state: KoubouState, e: ServerEvent): KoubouState {
  // lastError 写入在 store 层(见 Task 5);reducer 仅按 interaction_id 清理过期弹窗
  const id = e.payload.interaction_id as string | undefined;
  if (!id || !state.pendingInteractions[id]) return state;
  const pending = { ...state.pendingInteractions };
  delete pending[id];
  return { ...state, pendingInteractions: pending };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/koubou/apply-koubou.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "Koubou 对话:事件→状态 reducer(流式/历史/工具结果/交互/去重)"
```

---

## Task 5: store 接线 + 连接 hook + Workspace 装配 + 退役 mock

**Files:**
- Modify: `src/store/index.ts`
- Create: `src/client/useKoubouConnection.ts`
- Modify: `src/components/workspace/Workspace.tsx`
- Modify: `server.ts`
- Delete: `src/server/{agent,intent,scripts,ws}.ts` (+ `agent.test.ts` `intent.test.ts` `scripts.test.ts`)、`src/agent-protocol/{frame,messages,tools}.ts` (+ `frame.test.ts`)、`src/client/{ws-client,useAgentConnection}.ts` (+ `ws-client.test.ts`)、`src/store/apply-message.ts` (+ `apply-message.test.ts`)

- [ ] **Step 1a: 迁移 AssetKind 到 `src/lib/asset-kind.ts`(删除 agent-protocol 前置)**

`AssetKind` 当前定义在 `src/agent-protocol/messages.ts`(本任务将删除),有 11 处导入它。先把定义迁到 `src/lib/asset-kind.ts`。

在 `src/lib/asset-kind.ts` 顶部、`import { figAsset }` 之前,把第 1 行 `import type { AssetKind } from '@/agent-protocol/messages';` 替换为本地定义:

```ts
// 资产类型(原 agent-protocol/messages,迁来此处作为唯一来源)
export type AssetKind = 'image' | 'video' | 'audio' | '3d' | 'doc';
```

再把以下 10 个文件里 `from '@/agent-protocol/messages'` 的 `AssetKind` 导入改为 `from '@/lib/asset-kind'`(注意:这些文件可能同时还在用 `messages` 的其它导出吗?经核查没有,只导入 `AssetKind`,整行替换模块路径即可):

`src/components/chat/MentionPopover.tsx`、`src/components/canvas/GenerateForm.tsx`、`src/components/canvas/AddAssetMenu.tsx`、`src/components/canvas/nodes/NodeCard.tsx`、`src/lib/assets.ts`、`src/lib/zones.ts`、`src/lib/force-layout.ts`、`src/lib/pgc/map.ts`、`src/store/types.ts`、`src/store/index.ts`。

验证无残留:Run `grep -rln "agent-protocol" src` —— 此时应只剩 mock 文件(`server/*`、`store/apply-message*`、`client/ws-client*`),它们将在 Step 6 删除。

- [ ] **Step 1b: 改 store index.ts —— 用 KoubouState + ingestKoubou + 按项目持久化**

打开 `src/store/index.ts`。做如下改动:

(a) import 段:把 `import { applyMessage } from './apply-message';` 删除,把第 4-6 行替换为:

```ts
import { applyKoubou } from '@/koubou/apply-koubou';
import { createInitialKoubouState, createInitialServerState, type KoubouState, type ServerState, type Version, type Message, type PersistedSession } from './types';
import type { ServerEvent, PermissionMode } from '@/koubou/protocol';
import type { AssetKind } from '@/lib/asset-kind';
```

(b) `UIState.connStatus` 类型加 `'superseded'`,并新增 `sessionEpoch`(用于「新对话」触发 hook 重连):

```ts
  connStatus: 'connecting' | 'open' | 'closed' | 'error' | 'superseded';
  sessionEpoch: number;
```

在初始 state(原第 58-63 行,`connStatus: 'connecting',` 那块)加 `sessionEpoch: 0,`。

(c) `Actions` 接口:删 `ingest`,加:

```ts
  ingestKoubou: (e: ServerEvent) => void;
  startNewSession: () => void;
  switchProjectSession: (nextPid: number | null) => void;   // 仅载入目标项目会话快照
  setPermissionMode: (mode: PermissionMode) => void;
```

(d) `AppStore` 组合类型把 `ReducerState` 换成 `KoubouState`:

```ts
export type AppStore = KoubouState & ServerState & UIState & Actions & ServerActions;
```

(e) 初始 state:`...createInitialReducerState()` → `...createInitialKoubouState()`。

(f) 实现 `ingest` 行(原第 65 行)替换为:

```ts
      ingestKoubou: (e) =>
        set((s) => {
          const koubou = applyKoubou(s, e);
          // error 事件的 message 写入 lastError(ServerState)
          if (e.type === 'error') {
            const msg = (e.payload as { message?: string }).message ?? 'agent error';
            return { ...koubou, lastError: { code: 'AGENT', message: msg } };
          }
          return koubou;
        }),
      // 载入目标项目会话快照;上一项目快照已在 onEvent 检查点持久化,无需在此回存
      switchProjectSession: (nextPid) =>
        set((s) => {
          const saved: PersistedSession | undefined = nextPid != null ? s.koubouByProject[String(nextPid)] : undefined;
          return {
            ...createInitialKoubouState(),
            sessionId: saved?.sessionId || null,
            lastSequence: saved?.lastSequence ?? 0,
            messages: saved?.messages ?? [],
          };
        }),
      // 新对话:清当前项目持久化会话 + 重置 + 自增 epoch(hook effect 依赖 epoch,触发重连为新建)
      startNewSession: () =>
        set((s) => {
          const map = { ...s.koubouByProject };
          if (s.currentProjectId != null) delete map[String(s.currentProjectId)];
          return { ...createInitialKoubouState(), koubouByProject: map, sessionEpoch: s.sessionEpoch + 1 };
        }),
      setPermissionMode: (permissionMode) => set({ permissionMode }),
```

(g) `pushUserMessage` 保留(Composer 乐观渲染用)。`composer`/`addRef` 等保留。

(h) persist `partialize`(原第 120-125 行)改为:

```ts
      partialize: (s) => ({
        visibleKinds: s.visibleKinds,
        currentProjectId: s.currentProjectId,
        koubouByProject: s.koubouByProject,
        composer: { draft: s.composer.draft, refs: s.composer.refs, attachments: [] },
      }),
```

> 不再单独持久化 `messages`(改由 `koubouByProject` 按项目存)。`seenSequences` 不持久化。

- [ ] **Step 2: selectProject 切换时换会话**

打开 `src/store/actions.ts`。`selectProject`(第 46-49 行)在重置前调换会话。把函数体改为:

```ts
  const selectProject = async (id: number) => guard(set, async () => {
    // 注:switchProjectSession 是 store action,这里通过 get() 拿不到(actions 闭包);改由 useKoubouConnection 在 currentProjectId 变化时换会话。
    set({ currentProjectId: id, assets: [], versions: [], activeVersionId: null, buildingVersion: null, pendingVersionId: null, genTasks: [] });
    await Promise.all([loadCanvas(), loadVersions()]);
  });
```

> 会话换入/换出统一在 hook 里基于 `currentProjectId` 副作用触发(见 Step 4),避免 server actions 与 UI actions 类型环。

- [ ] **Step 3: 写连接 hook**

Create `src/client/useKoubouConnection.ts`:

```ts
'use client';
import { useEffect, useRef } from 'react';
import { createKoubouClient, type KoubouClient } from '@/koubou/client';
import { useStore } from '@/store';

async function mintTicket(): Promise<string> {
  const res = await fetch('/api/koubou/auth/ws-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const env = (await res.json()) as { data?: { ticket?: string } };
  const ticket = env.data?.ticket;
  if (!ticket) throw new Error('ws-ticket 签发失败');
  return ticket;
}

export function useKoubouConnection() {
  const clientRef = useRef<KoubouClient | null>(null);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const sessionEpoch = useStore((s) => s.sessionEpoch);   // 新对话自增 → 触发重连

  useEffect(() => {
    if (currentProjectId == null) { clientRef.current?.close(); clientRef.current = null; return; }
    const pid = currentProjectId;
    // 载入该项目会话快照(供恢复/续传)
    useStore.getState().switchProjectSession(pid);
    const { sessionId, lastSequence } = useStore.getState();

    const wsBaseUrl = process.env.NEXT_PUBLIC_KOUBOU_WS_URL!;
    const client = createKoubouClient({
      wsBaseUrl,
      projectId: String(pid),
      sessionId,
      afterSequence: sessionId ? lastSequence : null,
      mintTicket,
      onEvent: (e) => {
        useStore.getState().ingestKoubou(e);
        const st = useStore.getState();
        // 仅在可重放检查点(非空 sequence)持久化:保证 lastSequence ↔ messages 一致,流式增量(sequence=null)不落盘
        if (typeof e.sequence === 'number' && st.sessionId) {
          useStore.setState({
            koubouByProject: { ...st.koubouByProject, [String(pid)]: { sessionId: st.sessionId, lastSequence: st.lastSequence, messages: st.messages } },
          });
        }
        // run 成功结束 → 以 PGC 为准刷新画布/版本
        if (e.type === 'run.finished' && (e.payload as { status?: string }).status === 'succeeded') {
          void useStore.getState().loadCanvas().catch(() => {});
          void useStore.getState().loadVersions().catch(() => {});
        }
      },
      onStatus: (s) => useStore.getState().setConn(s),
    });
    clientRef.current = client;
    return () => { client.close(); clientRef.current = null; };
  }, [currentProjectId, sessionEpoch]);

  return clientRef;
}
```

- [ ] **Step 4: Workspace 换 hook**

打开 `src/components/workspace/Workspace.tsx`。把 `import { useAgentConnection } from ...` 改为 `import { useKoubouConnection } from '@/client/useKoubouConnection';`,把 `const client = useAgentConnection();` 改为 `const client = useKoubouConnection();`。其余(`useProjectBootstrap`/`useCanvasPolling`、三列布局、`<ChatPanel client={client} />`)不变。

- [ ] **Step 5: server.ts 移除 mock WS**

把 `server.ts` 改为(移除 `ws`/`attachAgent`/`/api/agent/ws` upgrade):

```ts
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT) || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();
const upgrade = app.getUpgradeHandler();

const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));
// 对话已直连 Koubou WS;本地不再托管 agent WS。HMR 等 upgrade 仍交给 Next。
server.on('upgrade', (req, socket, head) => upgrade(req, socket, head));

server.listen(port, () => console.log(`> Ready on http://localhost:${port}`));
```

- [ ] **Step 6: 删除 mock 文件**

```bash
git rm src/server/agent.ts src/server/agent.test.ts src/server/intent.ts src/server/intent.test.ts \
       src/server/scripts.ts src/server/scripts.test.ts src/server/ws.ts \
       src/agent-protocol/frame.ts src/agent-protocol/frame.test.ts src/agent-protocol/messages.ts src/agent-protocol/tools.ts \
       src/client/ws-client.ts src/client/ws-client.test.ts src/client/useAgentConnection.ts \
       src/store/apply-message.ts src/store/apply-message.test.ts
```

> 若 `messages.ts` 还被别处 import(`AssetKind` 已迁到 `lib/asset-kind`、`tools.ts` 仅被旧 apply-message 用),`grep -rn "agent-protocol" src` 应无残留;有则改 import。

- [ ] **Step 7: 编译 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 编译通过;`src/koubou/*` 测试 PASS。chat 组件相关测试(`MessageItem.test.tsx`)此时可能因 Part 模型变化报错——Task 6 修复。若阻塞,可暂时 `it.skip`,Task 6 复原。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Koubou 对话:store 接线 + 连接 hook + Workspace 装配,退役 mock agent"
```

---

## Task 6: 对话 UI —— Composer 发送/steer/interrupt + 消息块渲染 + media 预览

**Files:**
- Modify: `src/components/chat/Composer.tsx`
- Modify: `src/components/chat/MessageItem.tsx`
- Modify: `src/components/chat/ToolCard.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`
- Test: `src/components/chat/MessageItem.test.tsx`

- [ ] **Step 1: Composer 改发 Koubou 消息(运行中=steer)**

打开 `src/components/chat/Composer.tsx`:

(a) import 改:`import type { KoubouClient } from '@/koubou/client';` 和 `import type { ContentBlock } from '@/koubou/protocol';`,组件 prop 类型 `client: React.RefObject<KoubouClient | null>`。

(b) 把 `send()`(第 62-79 行)替换为(refs 折进文本;空内容且非运行中才拦截;运行中=steer;有图片附件=多模态 blocks):

```ts
  const send = () => {
    // @mention 的 refs 折进文本
    const text = [draft.trim(), ...refs.map((r) => '@' + r)].filter(Boolean).join(' ');
    if (!text && attachments.length === 0) return;          // 空内容拦截
    if (runStatus !== 'running' && !text && attachments.length === 0) return;
    // 乐观渲染用户气泡
    pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [{ type: 'text', text }] });
    if (runStatus === 'running') {
      // 运行中发送 = steering(中断当前 run 并作为下一条消息)
      client.current?.steer(text);
    } else {
      // 多模态:有图片附件 → content blocks;否则纯文本
      const imgs = attachments.filter((a) => a.mime.startsWith('image/'));
      const content: string | ContentBlock[] = imgs.length
        ? ([
            { type: 'text', text },
            ...imgs.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.dataUrl.split(',')[1] ?? '' } })),
          ] as ContentBlock[])
        : text;
      client.current?.sendUserMessage({ role: 'user', content });
    }
    resetComposer();
  };
```

(c) 停止按钮:`onClick={() => client.current?.abort()}` 改为 `onClick={() => client.current?.interrupt()}`。

- [ ] **Step 2: ToolCard 渲染 input + result + media 预览**

打开 `src/components/chat/ToolCard.tsx`,替换为(适配新 `tool` part 字段):

```tsx
import type { Part } from '@/store/types';

export default function ToolCard({ part }: { part: Extract<Part, { type: 'tool' }> }) {
  const argText = part.input !== undefined ? JSON.stringify(part.input) : '';
  return (
    <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="font-medium">{part.name}</span>
        <span className="text-[11px] text-[#7b7b7b]">{part.status}</span>
      </div>
      {argText && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[#555]">{argText.slice(0, 400)}</pre>}
      {part.media?.preview_url && (
        part.media.kind === 'video'
          ? <video src={part.media.preview_url} controls className="mt-2 max-h-48 rounded-[8px]" />
          : <img src={part.media.preview_url} alt={part.media.path} className="mt-2 max-h-48 rounded-[8px]" />
      )}
      {!part.media && part.result && (
        <pre className={`mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] ${part.isError ? 'text-red-600' : 'text-[#555]'}`}>{part.result.slice(0, 600)}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 3: MessageItem 去掉已删的 part 类型**

打开 `src/components/chat/MessageItem.tsx`。删除对 `asset-ref` / `action` part 的渲染分支(以及对 `AssetChip`/`ActionPill` 的 import 若仅此处用)。tool 分支改为 `<ToolCard part={p} />`(传整个 part)。用户消息的 `refs`/`attachments` 渲染:`Message` 不再有 `refs`/`attachments` 字段,删除相关渲染(refs 已折进文本)。保留 text→`RichText`、thinking→`ThinkingBlock`。

- [ ] **Step 4: 修 MessageItem 测试**

打开 `src/components/chat/MessageItem.test.tsx`,把构造的 `Message`/`Part` 改为新模型(去掉 `refs`/`asset-ref`/`action`;tool part 用 `{ type:'tool', id, name, input, status }`)。一个代表性断言:

```tsx
import { render, screen } from '@testing-library/react';
import MessageItem from './MessageItem';
import type { Message } from '@/store/types';

test('渲染 assistant 文本 + 工具卡', () => {
  const m: Message = { id: 'a1', role: 'assistant', status: 'ready', parts: [
    { type: 'text', text: '开始啦' },
    { type: 'tool', id: 't1', name: 'Bash', input: { command: 'ls' }, status: 'ready', result: 'a.png' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('开始啦')).toBeInTheDocument();
  expect(screen.getByText('Bash')).toBeInTheDocument();
});
```

- [ ] **Step 5: 编译 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test src/components/chat`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/chat
git commit -m "Koubou 对话:Composer 发送/steer/interrupt + 消息块渲染 + media 预览"
```

---

## Task 7: 交互组件 —— 工具审批 / AskUserQuestion / 权限模式

**Files:**
- Create: `src/components/chat/ToolApprovalCard.tsx`
- Create: `src/components/chat/QuestionCard.tsx`
- Create: `src/components/chat/PermissionModeMenu.tsx`
- Test: `src/components/chat/ToolApprovalCard.test.tsx`, `src/components/chat/QuestionCard.test.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`(渲染 pending + 权限模式入口)

- [ ] **Step 1: 写审批卡失败测试**

Create `src/components/chat/ToolApprovalCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ToolApprovalCard from './ToolApprovalCard';

test('展示工具名 + input,点批准/拒绝回调', () => {
  const onResolve = vi.fn();
  render(<ToolApprovalCard interactionId="i1" toolName="Bash" input={{ command: 'rm -rf' }} onResolve={onResolve} />);
  expect(screen.getByText('Bash')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
  expect(onResolve).toHaveBeenCalledWith('i1', false);
  fireEvent.click(screen.getByRole('button', { name: '批准' }));
  expect(onResolve).toHaveBeenCalledWith('i1', true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/components/chat/ToolApprovalCard.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 ToolApprovalCard**

Create `src/components/chat/ToolApprovalCard.tsx`:

```tsx
export default function ToolApprovalCard({ interactionId, toolName, input, onResolve }: {
  interactionId: string; toolName: string; input: unknown;
  onResolve: (interactionId: string, approved: boolean) => void;
}) {
  return (
    <div className="rounded-[12px] border border-amber-300 bg-amber-50 p-3 text-[13px]">
      <div className="mb-1 font-medium">需要审批工具:{toolName}</div>
      <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[#555]">{JSON.stringify(input, null, 2).slice(0, 600)}</pre>
      <div className="flex gap-2">
        <button className="rounded-[8px] bg-black px-3 py-1 text-white" onClick={() => onResolve(interactionId, true)}>批准</button>
        <button className="rounded-[8px] border border-[var(--color-line)] px-3 py-1" onClick={() => onResolve(interactionId, false)}>拒绝</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 写 QuestionCard 失败测试**

Create `src/components/chat/QuestionCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import QuestionCard from './QuestionCard';
import type { QuestionDef } from '@/koubou/protocol';

const questions: QuestionDef[] = [
  { question: '美术风格?', header: '美术', options: [{ label: '像素风' }, { label: '手绘' }], multiSelect: false },
];

test('单选回答提交 answers 以问题文本为 key', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i2" questions={questions} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: '像素风' }));
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  expect(onSubmit).toHaveBeenCalledWith('i2', { '美术风格?': '像素风' });
});
```

- [ ] **Step 5: 写 QuestionCard**

Create `src/components/chat/QuestionCard.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { QuestionDef } from '@/koubou/protocol';

export default function QuestionCard({ interactionId, questions, onSubmit }: {
  interactionId: string; questions: QuestionDef[];
  onSubmit: (interactionId: string, answers: Record<string, string | string[]>) => void;
}) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const toggle = (q: QuestionDef, label: string) => {
    setSel((prev) => {
      const cur = prev[q.question] ?? [];
      if (q.multiSelect) {
        return { ...prev, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      }
      return { ...prev, [q.question]: [label] };
    });
  };
  const submit = () => {
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const cur = sel[q.question] ?? [];
      answers[q.question] = q.multiSelect ? cur : (cur[0] ?? '');
    }
    onSubmit(interactionId, answers);
  };
  return (
    <div className="rounded-[12px] border border-blue-300 bg-blue-50 p-3 text-[13px]">
      {questions.map((q) => (
        <div key={q.question} className="mb-3">
          <div className="mb-1 font-medium">{q.question}</div>
          <div className="flex flex-wrap gap-2">
            {q.options.map((o) => {
              const active = (sel[q.question] ?? []).includes(o.label);
              return (
                <button key={o.label} onClick={() => toggle(q, o.label)}
                  className={`rounded-[8px] border px-3 py-1 ${active ? 'border-black bg-black text-white' : 'border-[var(--color-line)]'}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button className="rounded-[8px] bg-black px-3 py-1 text-white" onClick={submit}>提交</button>
    </div>
  );
}
```

- [ ] **Step 6: 写 PermissionModeMenu**

Create `src/components/chat/PermissionModeMenu.tsx`:

```tsx
'use client';
import type { PermissionMode } from '@/koubou/protocol';

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions', 'auto'];

export default function PermissionModeMenu({ mode, onChange }: { mode: PermissionMode; onChange: (m: PermissionMode) => void }) {
  return (
    <select value={mode} onChange={(e) => onChange(e.target.value as PermissionMode)}
      className="rounded-[8px] border border-[var(--color-line)] bg-transparent px-2 py-1 text-[12px]">
      {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}
```

- [ ] **Step 7: ChatPanel 渲染 pending + 权限模式入口 + 新对话**

打开 `src/components/chat/ChatPanel.tsx`。引入:

```tsx
import ToolApprovalCard from './ToolApprovalCard';
import QuestionCard from './QuestionCard';
import PermissionModeMenu from './PermissionModeMenu';
import type { KoubouClient } from '@/koubou/client';
```

prop 类型 `client: React.RefObject<KoubouClient | null>`。在消息列表下方、Composer 上方插入 pending 渲染:

发送后乐观清弹窗用 `resolvePending`(Step 8 在 store 新增的干净 action):

```tsx
{Object.values(pendingInteractions).map((it) =>
  it.kind === 'approval'
    ? <ToolApprovalCard key={it.interactionId} interactionId={it.interactionId} toolName={it.toolName} input={it.input}
        onResolve={(id, ok) => { client.current?.approveTool(id, ok); useStore.getState().resolvePending(id); }} />
    : <QuestionCard key={it.interactionId} interactionId={it.interactionId} questions={it.questions}
        onSubmit={(id, ans) => { client.current?.answerQuestion(id, ans); useStore.getState().resolvePending(id); }} />
)}
```

从 store 取 `pendingInteractions`、`permissionMode`,头部加:

```tsx
<PermissionModeMenu mode={permissionMode} onChange={(m) => { client.current?.setPermissionMode(m); useStore.getState().setPermissionMode(m); }} />
<button onClick={() => useStore.getState().startNewSession()} className="text-[12px] underline">新对话</button>
```

- [ ] **Step 8: 在 store 加 resolvePending(按 Step 7 注释)**

`src/store/index.ts` 的 `Actions` 加 `resolvePending: (id: string) => void;`,实现处加:

```ts
      resolvePending: (id) => set((s) => { const p = { ...s.pendingInteractions }; delete p[id]; return { pendingInteractions: p }; }),
```

- [ ] **Step 9: 编译 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test src/components/chat`
Expected: PASS（审批卡 / 问答卡用例）

- [ ] **Step 10: Commit**

```bash
git add src/components/chat src/store/index.ts
git commit -m "Koubou 对话:工具审批 / AskUserQuestion / 权限模式交互组件"
```

---

## Task 8: 端到端冒烟 + 刷新恢复核对

**Files:** 无新增;手动验证 + 修复。

- [ ] **Step 1: 全量测试 + 编译 + lint**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm lint`
Expected: 全绿。

- [ ] **Step 2: 起服务,手动冒烟**

Run: `pnpm dev`,浏览器开 `http://localhost:3000`:
- [ ] 选中一个项目 → DevTools Network/WS 看到连到 `ws://8.232.44.61/projects/{id}/ws?ws_ticket=...`,收到 `session.ready`,`connStatus` 变 open。
- [ ] 输入「做一个 2D 跳跃游戏原型」发送 → 看到 `run.started`(loading)、流式文本/thinking、tool 卡;`run.finished` 后 loading 消失,画布/版本刷新。
- [ ] 若 agent 触发工具审批 → 出现审批卡,点批准/拒绝后弹窗消失、对话继续。
- [ ] 若 agent 触发 AskUserQuestion → 出现问答卡,选择提交后继续。
- [ ] 运行中再输入一句发送 → 触发 steer(中断并接续)。
- [ ] 点停止 → `run.interrupted`,loading 消失。

- [ ] **Step 3: 刷新恢复核对**

- [ ] run 进行中或刚结束时刷新页面 → 重连用 `/sessions/{sid}/ws?after_sequence={lastSequence}`,历史消息保留(来自 `koubouByProject`),`session.ready` 校正 run/pending;无重复气泡、无重复审批弹窗。
- [ ] 切换到另一个项目再切回 → 各自会话独立恢复。
- [ ] 点「新对话」→ 新建 session(URL 无 `/sessions/`),历史清空。

- [ ] **Step 4: 修复发现的问题并提交**

如有偏差,定位到对应模块(client URL / reducer 去重 / hook 持久化)修复并补测试。

```bash
git add -A
git commit -m "Koubou 对话:端到端冒烟修复 + 刷新恢复核对"
```

---

## 完成标准

- 选项目即连 Koubou WS,发消息可流式看到 Claude 回复(text/thinking/tool/tool_result),run 生命周期正确。
- 工具审批、AskUserQuestion、权限模式切换、steering、中断均可用。
- 刷新/切项目用 `after_sequence` 增量续传,无重复;`media.generated` 预览可见。
- 画布/版本仍由 PGC 驱动,run 成功后自动刷新。
- `pnpm exec tsc --noEmit && pnpm test && pnpm lint` 全绿。
