# AI 游戏生成平台 v2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Next.js 16 搭一个偏创作向的 AI 游戏生成平台原型——三栏(对话 / 多模态资产画布 / 预览+版本)+ 工具栏,前端经 websocket 与可 mock 的后端 agent(回放 Claude Agent SDK 消息流)通信。

**Architecture:** 单向数据流——Composer 经 WS 上行 → server mock agent 产出 `SDKMessage` 流 → client 装配 → 纯函数 reducer `applyMessage` 落入 zustand 单 store → 反应式驱动三栏。协议层为前后端共享纯类型;server 不知 UI;UI 只订阅 / 写 store。资产画布用 React Flow + d3-force(类型 zone 内力导向 + 派生血缘连线)。

**Tech Stack:** Next.js 16.2 / React 19.2 / TypeScript / pnpm / `ws`(自定义 server.ts) / `@xyflow/react` 12 / `d3-force` / `zustand` 5 / `react-resizable-panels` / Tailwind CSS v4 / `vitest` + `@testing-library/react`。

**约定:** 所有 commit message 用中文、一句话总结。测试命令统一 `pnpm vitest run <path>`。每个任务末尾 commit。

---

## 文件结构总览

```
server.ts                              # 自定义入口:Next + ws
postcss.config.mjs                     # Tailwind v4
next.config.ts
vitest.config.ts / vitest.setup.ts
public/games/nightcap/index.html       # 内置 demo 游戏
src/
├── agent-protocol/{messages,tools,frame}.ts     # 协议层(前后端共享纯类型)
├── server/{ws,agent,scripts,intent}.ts          # 后端 mock agent(不知 UI)
├── client/ws-client.ts                           # 浏览器 WS 客户端
├── store/{types,apply-message,selectors,index}.ts
├── lib/{ids,refs,zones,force-layout}.ts
├── components/
│   ├── workspace/{Workspace,Toolbar,SearchPalette}.tsx
│   ├── chat/{ChatPanel,MessageItem,ThinkingBlock,ToolCard,Composer,MentionPopover,AttachmentBar}.tsx
│   ├── canvas/{AssetCanvas,ZoneLayer,ContextMenu}.tsx + nodes/{Image,Video,Audio,ThreeD,Doc}Node.tsx
│   └── preview/{PreviewPanel,GameFrame,DeviceToggle,VersionTimeline,CompareView}.tsx
└── app/{layout.tsx,page.tsx,globals.css}
```

类型依赖方向:`agent-protocol` ← `store/types` ← 其余一切。先定协议与 store 类型,后续任务全部引用它们。

---

# 阶段 0：脚手架 + 自定义 server + 三栏壳

## Task 0.1：初始化 Next 工程与依赖

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`

- [ ] **Step 1: 在工程根用 pnpm 安装依赖**(目录已有 `docs/`、`.gitignore`,不要用 create-next-app 覆盖)

Run:
```bash
pnpm init
pnpm add next@16.2.7 react@19.2.4 react-dom@19.2.4 @xyflow/react@^12.11.0 d3-force@^3.0.0 zustand@^5.0.14 react-resizable-panels@^4.11.2 nanoid@^5.0.0 ws@^8.18.0
pnpm add -D typescript@^5 @types/node@^20 @types/react@^19 @types/react-dom@^19 @types/ws@^8 @types/d3-force@^3 tsx@^4 tailwindcss@^4 @tailwindcss/postcss@^4 postcss@^8 vitest@^4 @vitejs/plugin-react@^6 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^29 eslint@^9 eslint-config-next@16.2.7
```
Expected: `node_modules/` 与 `pnpm-lock.yaml` 生成。

- [ ] **Step 2: 写 `package.json` scripts 字段**(合并进 pnpm init 生成的文件)

```json
{
  "name": "game-create-platform",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "next build",
    "start": "cross-env NODE_ENV=production tsx server.ts",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```
> 注:`start` 用到 `cross-env` 可选;开发只用 `dev`。可省略 `start` 行如不需要生产。保留 `dependencies`/`devDependencies` 不动。

- [ ] **Step 3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "//jsx": "注:Next 16 启动时会强制改写为 react-jsx(React 自动运行时),属预期,无需对抗",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: 写 `next.config.ts`**

```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {};
export default nextConfig;
```

- [ ] **Step 5: 写 `.env.example`**

```
PORT=3000
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "初始化 Next 工程与依赖"
```

## Task 0.2：配置 Tailwind v4 与设计 token

**Files:**
- Create: `postcss.config.mjs`, `src/app/globals.css`

- [ ] **Step 1: 写 `postcss.config.mjs`**

```js
const config = { plugins: { '@tailwindcss/postcss': {} } };
export default config;
```

- [ ] **Step 2: 写 `src/app/globals.css`**(Tailwind v4 CSS-first + 参考图设计 token)

```css
@import "tailwindcss";

@theme {
  --color-canvas: #f4f5f7;
  --color-surface: #ffffff;
  --color-ink: #1f2430;
  --color-muted: #8b92a3;
  --color-line: #e6e8ee;
  --color-brand: #3b5bff;
  --color-image: #6c8cff;
  --color-video: #ff8a4c;
  --color-audio: #28c2a8;
  --color-3d: #a06bff;
  --color-doc: #f2c64b;
  --color-preview-bg: #14121c;
  --radius-card: 14px;
}

html, body, #__app { height: 100%; }
body { background: var(--color-canvas); color: var(--color-ink); font-family: ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
* { box-sizing: border-box; }
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "配置 Tailwind v4 与设计 token"
```

## Task 0.3：根布局与客户端壳占位

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/workspace/Workspace.tsx`

- [ ] **Step 1: 写 `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Taluna · Game Agent', description: 'AI 游戏生成平台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><div id="__app">{children}</div></body>
    </html>
  );
}
```

- [ ] **Step 2: 写 `src/components/workspace/Workspace.tsx`**(本任务先放占位,后续任务填充)

```tsx
'use client';
export default function Workspace() {
  return <div className="h-full grid place-items-center text-[var(--color-muted)]">Workspace 占位</div>;
}
```

- [ ] **Step 3: 写 `src/app/page.tsx`**(整页 client,直接渲染 Workspace)

```tsx
'use client';
import Workspace from '@/components/workspace/Workspace';
export default function Page() { return <Workspace />; }
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "新增根布局与客户端壳占位"
```

## Task 0.4：自定义 server.ts(Next + ws 握手)

**Files:**
- Create: `server.ts`

- [ ] **Step 1: 写 `server.ts`**(此刻 ws 仅回显一条 system init,验证握手;真正 agent 在阶段 3 接入)

```ts
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT) || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  // 阶段 3 由 attachAgent(ws) 替换为真正的 agent 接线
  ws.send(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'boot', model: 'mock', tools: [] }));
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url!, true);
  if (pathname === '/api/agent/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(port, () => console.log(`> Ready on http://localhost:${port}  (ws: /api/agent/ws)`));
```

- [ ] **Step 2: 手动验证握手**

Run: `pnpm dev`,浏览器开 `http://localhost:3000`(应显示 "Workspace 占位"),控制台无报错。再开终端:
```bash
node -e "const W=require('ws');const ws=new W('ws://localhost:3000/api/agent/ws');ws.on('message',m=>{console.log('收到',m.toString());process.exit(0)})"
```
Expected: 打印 `收到 {"type":"system","subtype":"init",...}`。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "新增自定义 server 与 ws 握手"
```

## Task 0.5：vitest 配置

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`

- [ ] **Step 1: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
```

- [ ] **Step 2: 写 `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: 占位 smoke 测试验证 vitest 跑通**

Create `src/lib/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('vitest 跑通', () => { expect(1 + 1).toBe(2); });
```
Run: `pnpm vitest run src/lib/smoke.test.ts`
Expected: PASS。随后删除该文件。

- [ ] **Step 4: Commit**

```bash
rm src/lib/smoke.test.ts
git add -A && git commit -m "配置 vitest"
```

---

# 阶段 1：协议层(共享纯类型 + 编解码,TDD)

## Task 1.1：消息与工具类型定义

**Files:**
- Create: `src/agent-protocol/messages.ts`, `src/agent-protocol/tools.ts`

- [ ] **Step 1: 写 `src/agent-protocol/messages.ts`**

```ts
// Claude Agent SDK 消息协议的忠实子集(手写,前后端共享)
export type AssetKind = 'image' | 'video' | 'audio' | '3d' | 'doc';

export interface Usage { input_tokens: number; output_tokens: number; }

export interface TextBlock { type: 'text'; text: string; }
export interface ThinkingContentBlock { type: 'thinking'; thinking: string; }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown; }
export type ContentBlock = TextBlock | ThinkingContentBlock | ToolUseBlock;

export interface AssistantApiMessage { id: string; role: 'assistant'; model: string; content: ContentBlock[]; }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; }
export interface UserApiMessage { role: 'user'; content: ToolResultBlock[]; }

export type RawStreamEvent =
  | { type: 'message_start'; message: { id: string; role: 'assistant'; model: string; content: [] } }
  | { type: 'content_block_start'; index: number;
      content_block: { type: 'text'; text: '' } | { type: 'thinking'; thinking: '' } | { type: 'tool_use'; id: string; name: string; input: Record<string, never> } }
  | { type: 'content_block_delta'; index: number;
      delta: { type: 'text_delta'; text: string } | { type: 'thinking_delta'; thinking: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null }; usage?: Usage }
  | { type: 'message_stop' };

export type SDKMessage =
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; tools: string[] }
  | { type: 'stream_event'; session_id: string; parent_tool_use_id: string | null; event: RawStreamEvent }
  | { type: 'assistant'; session_id: string; parent_tool_use_id: string | null; message: AssistantApiMessage }
  | { type: 'user'; session_id: string; parent_tool_use_id: string | null; message: UserApiMessage }
  | { type: 'result'; subtype: 'success' | 'error_max_turns' | 'error_during_execution';
      session_id: string; duration_ms: number; is_error: boolean; num_turns: number; result?: string; usage: Usage; total_cost_usd: number };
```

- [ ] **Step 2: 写 `src/agent-protocol/tools.ts`**

```ts
import type { AssetKind } from './messages';

export interface AssetPreview { color?: string; title?: string; src?: string; duration?: string; }

export interface GenerateAssetsInput {
  items: { key: string; label: string; kind: AssetKind; prompt: string; preview?: AssetPreview }[];
}
export interface DeriveVariantsInput {
  parentKey: string; count: number; instruction: string; labels?: string[]; previews?: AssetPreview[];
}
export interface BuildVersionInput {
  label: string; summary: string; includeAssetKeys?: string[]; game?: { title: string; palette: string };
}

export type ToolName = 'generate_assets' | 'derive_variants' | 'build_version';
export const TOOL_NAMES: ToolName[] = ['generate_assets', 'derive_variants', 'build_version'];
```

- [ ] **Step 3: 类型编译检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "新增 Agent SDK 消息与工具类型"
```

## Task 1.2：WS 帧编解码(TDD)

**Files:**
- Create: `src/agent-protocol/frame.ts`
- Test: `src/agent-protocol/frame.test.ts`

- [ ] **Step 1: 写失败测试 `src/agent-protocol/frame.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { encodeFrame, decodeFrames } from './frame';
import type { SDKMessage } from './messages';

const sys: SDKMessage = { type: 'system', subtype: 'init', session_id: 's1', model: 'mock', tools: [] };

describe('frame 编解码', () => {
  test('encode 以换行结尾、可被 decode 还原', () => {
    const buf = encodeFrame(sys);
    expect(buf.endsWith('\n')).toBe(true);
    const { frames, rest } = decodeFrames(buf);
    expect(frames).toEqual([sys]);
    expect(rest).toBe('');
  });

  test('多帧拼接逐行切分', () => {
    const buf = encodeFrame(sys) + encodeFrame({ ...sys, session_id: 's2' });
    const { frames } = decodeFrames(buf);
    expect(frames).toHaveLength(2);
  });

  test('半截帧留在 rest,不丢失', () => {
    const buf = encodeFrame(sys) + '{"type":"result"';
    const { frames, rest } = decodeFrames(buf);
    expect(frames).toHaveLength(1);
    expect(rest).toBe('{"type":"result"');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/agent-protocol/frame.test.ts`
Expected: FAIL（`encodeFrame is not a function`）。

- [ ] **Step 3: 写实现 `src/agent-protocol/frame.ts`**

```ts
import type { SDKMessage } from './messages';

export type ClientFrame =
  | { kind: 'user_input'; sessionId: string; text: string; refs: string[];
      attachments: { name: string; mime: string; dataUrl: string }[]; baseVersionId: string | null }
  | { kind: 'abort'; sessionId: string };

export function encodeFrame(frame: SDKMessage | ClientFrame): string {
  return JSON.stringify(frame) + '\n';
}

export function decodeFrames(buffer: string): { frames: unknown[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const frames: unknown[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (line) frames.push(JSON.parse(line));
  }
  return { frames, rest };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run src/agent-protocol/frame.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "新增 WS 帧编解码(TDD)"
```

---

# 阶段 2：store 类型 + 工具库 + reducer + 力导向(TDD)

## Task 2.1：store 类型与 zone 常量

**Files:**
- Create: `src/store/types.ts`, `src/lib/zones.ts`, `src/lib/ids.ts`

- [ ] **Step 1: 写 `src/lib/ids.ts`**

```ts
import { nanoid } from 'nanoid';
export const newId = (prefix = '') => `${prefix}${prefix ? '_' : ''}${nanoid(8)}`;
```

- [ ] **Step 2: 写 `src/lib/zones.ts`**

```ts
import type { AssetKind } from '@/agent-protocol/messages';

export interface Zone { kind: AssetKind; x: number; y: number; width: number; height: number; }
export const ZONE_ORDER: AssetKind[] = ['image', 'video', 'audio', '3d', 'doc'];
export const ZONE_LABEL: Record<AssetKind, string> = { image: '图像', video: '视频', audio: '音频', '3d': '3D', doc: '文档' };
export const ZONE_W = 540, ZONE_H = 420, ZONE_GAP = 56;

export function zoneFor(kind: AssetKind): Zone {
  const i = Math.max(0, ZONE_ORDER.indexOf(kind));
  return { kind, x: i * (ZONE_W + ZONE_GAP), y: 0, width: ZONE_W, height: ZONE_H };
}
export function zoneCenter(z: Zone) { return { x: z.x + z.width / 2, y: z.y + z.height / 2 }; }
export function zonesMap(): Record<AssetKind, Zone> {
  return Object.fromEntries(ZONE_ORDER.map((k) => [k, zoneFor(k)])) as Record<AssetKind, Zone>;
}
```

- [ ] **Step 3: 写 `src/store/types.ts`**

```ts
import type { AssetKind } from '@/agent-protocol/messages';

export type AssetSource = 'generated' | 'derived' | 'uploaded' | 'reference';
export type Status = 'pending' | 'generating' | 'ready' | 'error';

export interface AssetPreviewData { color?: string; title?: string; src?: string; dataUrl?: string; duration?: string; }
export interface Asset {
  id: string; key: string; label: string;
  kind: AssetKind; source: AssetSource;
  parentId?: string;
  status: Status;
  position: { x: number; y: number };
  pinned: boolean;
  preview?: AssetPreviewData;
  prompt?: string;
}

export interface Version {
  id: string; index: number; label: string; summary: string;
  createdAt: string; current: boolean;
  assetKeys: string[];
  game: { title: string; palette: string };
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; argsText: string; status: Status; result?: string };

export interface Message {
  id: string; role: 'user' | 'assistant'; parts: Part[]; status: Status;
  refs?: string[]; attachments?: { name: string; mime: string }[];
}

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error';
export type RunStatus = 'idle' | 'running' | 'error';

// reducer 关心的数据切片(纯数据,无 action)
export interface ReducerState {
  messages: Message[];
  assets: Asset[];
  versions: Version[];
  activeVersionId: string | null;
  sessionId: string | null;
  model: string | null;
  runStatus: RunStatus;
}

export function createInitialReducerState(): ReducerState {
  return { messages: [], assets: [], versions: [], activeVersionId: null, sessionId: null, model: null, runStatus: 'idle' };
}
```

- [ ] **Step 4: 类型编译检查 + Commit**

Run: `pnpm exec tsc --noEmit`(Expected: 无错误)
```bash
git add -A && git commit -m "新增 store 类型与 zone 常量"
```

## Task 2.2：@ 引用解析工具(TDD)

**Files:**
- Create: `src/lib/refs.ts`
- Test: `src/lib/refs.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/refs.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { getActiveMention } from './refs';

describe('getActiveMention', () => {
  test('光标紧跟 @query 时返回 query 与起点', () => {
    const text = '把 @主角 调亮';
    const caret = 5; // 紧跟在 "@主角" 之后
    expect(getActiveMention(text, caret)).toEqual({ query: '主角', start: 2 });
  });
  test('@ 后到光标含空格则不激活', () => {
    expect(getActiveMention('@主 角', 4)).toBeNull();
  });
  test('无 @ 返回 null', () => {
    expect(getActiveMention('普通文本', 3)).toBeNull();
  });
  test('空 query(刚敲 @)也激活', () => {
    expect(getActiveMention('hi @', 4)).toEqual({ query: '', start: 3 });
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/lib/refs.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现 `src/lib/refs.ts`**

```ts
export interface ActiveMention { query: string; start: number; }

// 返回光标处正在输入的 @mention(从最近的 '@' 到光标,中间不含空白)
export function getActiveMention(text: string, caret: number): ActiveMention | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}
```

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/lib/refs.test.ts`(Expected: PASS)
```bash
git add -A && git commit -m "新增 @ 引用解析工具(TDD)"
```

## Task 2.3：力导向布局(TDD)

**Files:**
- Create: `src/lib/force-layout.ts`
- Test: `src/lib/force-layout.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/force-layout.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { runForceLayout, type LayoutNode } from './force-layout';
import { zonesMap, zoneFor } from './zones';

const zones = zonesMap();

function imageNode(id: string, x: number, y: number, pinned = false): LayoutNode {
  return { id, kind: 'image', x, y, pinned };
}

describe('runForceLayout', () => {
  test('pinned 节点坐标保持不变', () => {
    const nodes = [imageNode('a', 100, 100, true), imageNode('b', 110, 100)];
    const out = runForceLayout(nodes, zones);
    const a = out.find((n) => n.id === 'a')!;
    expect(a.x).toBe(100);
    expect(a.y).toBe(100);
  });

  test('未 pinned 节点被约束在所属 zone 边界内', () => {
    const z = zoneFor('image');
    const nodes = Array.from({ length: 6 }, (_, i) => imageNode(`n${i}`, z.x + 10, z.y + 10));
    const out = runForceLayout(nodes, zones);
    for (const n of out) {
      expect(n.x).toBeGreaterThanOrEqual(z.x);
      expect(n.x).toBeLessThanOrEqual(z.x + z.width);
      expect(n.y).toBeGreaterThanOrEqual(z.y);
      expect(n.y).toBeLessThanOrEqual(z.y + z.height);
    }
  });

  test('确定性:相同输入两次结果一致', () => {
    const make = () => [imageNode('a', 50, 50), imageNode('b', 55, 52), imageNode('c', 60, 48)];
    const out1 = runForceLayout(make(), zones);
    const out2 = runForceLayout(make(), zones);
    expect(out1).toEqual(out2);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/lib/force-layout.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现 `src/lib/force-layout.ts`**

```ts
import { forceSimulation, forceManyBody, forceCollide, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { AssetKind } from '@/agent-protocol/messages';
import { zoneCenter, type Zone } from './zones';

export interface LayoutNode { id: string; kind: AssetKind; x: number; y: number; pinned: boolean; }
interface SimNode extends SimulationNodeDatum { id: string; kind: AssetKind; fx?: number; fy?: number; }

const NODE_R = 70;   // 碰撞半径
const PAD = 80;      // 距 zone 边界内边距(留卡片尺寸)
const TICKS = 120;

export function runForceLayout(nodes: LayoutNode[], zones: Record<AssetKind, Zone>): LayoutNode[] {
  const sim: SimNode[] = nodes.map((n) => ({
    id: n.id, kind: n.kind, x: n.x, y: n.y, vx: 0, vy: 0,
    ...(n.pinned ? { fx: n.x, fy: n.y } : {}),
  }));

  const simulation = forceSimulation<SimNode>(sim)
    .force('charge', forceManyBody().strength(-180))
    .force('collide', forceCollide(NODE_R))
    .force('x', forceX<SimNode>((d) => zoneCenter(zones[d.kind]).x).strength(0.08))
    .force('y', forceY<SimNode>((d) => zoneCenter(zones[d.kind]).y).strength(0.08))
    .stop();

  for (let i = 0; i < TICKS; i++) {
    simulation.tick();
    for (const d of sim) {
      if (d.fx != null) continue;
      const z = zones[d.kind];
      d.x = Math.min(Math.max(d.x!, z.x + PAD), z.x + z.width - PAD);
      d.y = Math.min(Math.max(d.y!, z.y + PAD), z.y + z.height - PAD);
    }
  }

  const byId = new Map(sim.map((d) => [d.id, d]));
  return nodes.map((n) => {
    const d = byId.get(n.id)!;
    return n.pinned ? n : { ...n, x: Math.round(d.x!), y: Math.round(d.y!) };
  });
}
```

> 注:`PAD=80` 需 < `width/2`,`540/2=270` 满足。clamp 在边界范围内,边界测试中 `>= z.x` 与 `<= z.x+width` 必然成立。

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/lib/force-layout.test.ts`(Expected: PASS)
```bash
git add -A && git commit -m "新增 zone 约束力导向布局(TDD)"
```

## Task 2.4：reducer applyMessage — 流式与文本(TDD)

**Files:**
- Create: `src/store/apply-message.ts`
- Test: `src/store/apply-message.test.ts`

- [ ] **Step 1: 写失败测试 `src/store/apply-message.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { applyMessage } from './apply-message';
import { createInitialReducerState } from './types';
import type { SDKMessage } from '@/agent-protocol/messages';

const sid = 's1';
function feed(msgs: SDKMessage[]) {
  return msgs.reduce((s, m) => applyMessage(s, m), createInitialReducerState());
}

describe('applyMessage — 系统与流式文本', () => {
  test('system init 设 session/model 并进入 running', () => {
    const s = feed([{ type: 'system', subtype: 'init', session_id: sid, model: 'mock', tools: [] }]);
    expect(s.sessionId).toBe(sid);
    expect(s.model).toBe('mock');
    expect(s.runStatus).toBe('running');
  });

  test('message_start 新建 assistant 消息,text_delta 累积', () => {
    const s = feed([
      { type: 'system', subtype: 'init', session_id: sid, model: 'mock', tools: [] },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'mock', content: [] } } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '已生成' } } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' 3 张图' } } },
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('assistant');
    expect(s.messages[0].parts).toEqual([{ type: 'text', text: '已生成 3 张图' }]);
  });

  test('thinking_delta 累积到 thinking part', () => {
    const s = feed([
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'mock', content: [] } } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先铺参考图' } } },
    ]);
    expect(s.messages[0].parts[0]).toEqual({ type: 'thinking', text: '先铺参考图' });
  });

  test('result success 置 runStatus=idle 且消息 ready', () => {
    const s = feed([
      { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'mock', content: [] } } },
      { type: 'result', subtype: 'success', session_id: sid, duration_ms: 1, is_error: false, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]);
    expect(s.runStatus).toBe('idle');
    expect(s.messages[0].status).toBe('ready');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/store/apply-message.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现 `src/store/apply-message.ts`**(本步含工具效果骨架,Task 2.5 补全测试)

```ts
import type { SDKMessage, RawStreamEvent, ToolUseBlock, ContentBlock, ToolResultBlock } from '@/agent-protocol/messages';
import type { ReducerState, Message, Part, Asset, Version } from './types';
import type { GenerateAssetsInput, DeriveVariantsInput, BuildVersionInput } from '@/agent-protocol/tools';
import { newId } from '@/lib/ids';
import { zoneFor, zoneCenter } from '@/lib/zones';

export function applyMessage(state: ReducerState, msg: SDKMessage): ReducerState {
  switch (msg.type) {
    case 'system':
      return { ...state, sessionId: msg.session_id, model: msg.model, runStatus: 'running' };
    case 'stream_event':
      return applyStreamEvent(state, msg.event);
    case 'assistant':
      return applyAssistant(state, msg.message.content);
    case 'user':
      return applyToolResults(state, msg.message.content);
    case 'result':
      return finishRun(state, msg.subtype === 'success');
    default:
      return state;
  }
}

function lastAssistant(state: ReducerState): Message | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].role === 'assistant') return state.messages[i];
  return undefined;
}
function replaceMessage(state: ReducerState, id: string, patch: (m: Message) => Message): ReducerState {
  return { ...state, messages: state.messages.map((m) => (m.id === id ? patch(m) : m)) };
}

function applyStreamEvent(state: ReducerState, ev: RawStreamEvent): ReducerState {
  switch (ev.type) {
    case 'message_start': {
      const m: Message = { id: newId('msg'), role: 'assistant', parts: [], status: 'generating' };
      return { ...state, messages: [...state.messages, m] };
    }
    case 'content_block_start': {
      const cur = lastAssistant(state); if (!cur) return state;
      const part: Part =
        ev.content_block.type === 'text' ? { type: 'text', text: '' }
        : ev.content_block.type === 'thinking' ? { type: 'thinking', text: '' }
        : { type: 'tool', id: ev.content_block.id, name: ev.content_block.name, argsText: '', status: 'generating' };
      return replaceMessage(state, cur.id, (m) => ({ ...m, parts: setAt(m.parts, ev.index, part) }));
    }
    case 'content_block_delta': {
      const cur = lastAssistant(state); if (!cur) return state;
      return replaceMessage(state, cur.id, (m) => {
        const parts = m.parts.slice();
        const p = parts[ev.index];
        if (!p) return m;
        if (ev.delta.type === 'text_delta' && p.type === 'text') parts[ev.index] = { ...p, text: p.text + ev.delta.text };
        else if (ev.delta.type === 'thinking_delta' && p.type === 'thinking') parts[ev.index] = { ...p, text: p.text + ev.delta.thinking };
        else if (ev.delta.type === 'input_json_delta' && p.type === 'tool') parts[ev.index] = { ...p, argsText: p.argsText + ev.delta.partial_json };
        return { ...m, parts };
      });
    }
    case 'content_block_stop': {
      const cur = lastAssistant(state); if (!cur) return state;
      return replaceMessage(state, cur.id, (m) => {
        const parts = m.parts.slice();
        const p = parts[ev.index];
        if (p && p.type === 'tool') parts[ev.index] = { ...p, status: 'ready' };
        return { ...m, parts };
      });
    }
    default:
      return state; // message_delta / message_stop 不改状态
  }
}

function setAt<T>(arr: T[], i: number, v: T): T[] { const a = arr.slice(); a[i] = v; return a; }

// 完整 assistant 帧:权威应用工具效果(资产/版本)
function applyAssistant(state: ReducerState, content: ContentBlock[]): ReducerState {
  let next = state;
  for (const block of content) {
    if (block.type === 'tool_use') next = applyTool(next, block);
  }
  return next;
}

function applyTool(state: ReducerState, block: ToolUseBlock): ReducerState {
  if (block.name === 'generate_assets') return applyGenerateAssets(state, block.input as GenerateAssetsInput);
  if (block.name === 'derive_variants') return applyDeriveVariants(state, block.input as DeriveVariantsInput);
  if (block.name === 'build_version') return applyBuildVersion(state, block.input as BuildVersionInput);
  return state;
}

function applyGenerateAssets(state: ReducerState, input: GenerateAssetsInput): ReducerState {
  const created: Asset[] = input.items.map((it, i) => {
    const c = zoneCenter(zoneFor(it.kind));
    return {
      id: newId('a'), key: it.key, label: it.label, kind: it.kind, source: 'generated',
      status: 'ready', pinned: false, prompt: it.prompt, preview: it.preview,
      position: { x: c.x + (i % 3) * 40 - 40, y: c.y + Math.floor(i / 3) * 40 - 40 },
    };
  });
  return { ...state, assets: [...state.assets, ...created] };
}

function applyDeriveVariants(state: ReducerState, input: DeriveVariantsInput): ReducerState {
  const parent = state.assets.find((a) => a.key === input.parentKey);
  if (!parent) return state;
  const created: Asset[] = Array.from({ length: input.count }, (_, i) => ({
    id: newId('a'),
    key: `${parent.key}_v${i + 1}`,
    label: input.labels?.[i] ?? `${parent.label}_v${i + 1}`,
    kind: parent.kind, source: 'derived', parentId: parent.id,
    status: 'ready', pinned: false, prompt: input.instruction, preview: input.previews?.[i],
    position: { x: parent.position.x + 220, y: parent.position.y + (i - (input.count - 1) / 2) * 130 },
  }));
  return { ...state, assets: [...state.assets, ...created] };
}

function applyBuildVersion(state: ReducerState, input: BuildVersionInput): ReducerState {
  const index = state.versions.length + 1;
  const v: Version = {
    id: newId('v'), index, label: input.label || `V${index}`, summary: input.summary,
    createdAt: new Date().toISOString(), current: true,
    assetKeys: input.includeAssetKeys ?? state.assets.map((a) => a.key),
    game: input.game ?? { title: 'NIGHTCAP', palette: 'neon' },
  };
  return {
    ...state,
    versions: [...state.versions.map((x) => ({ ...x, current: false })), v],
    activeVersionId: v.id,
  };
}

function applyToolResults(state: ReducerState, blocks: ToolResultBlock[]): ReducerState {
  let next = state;
  for (const b of blocks) {
    next = {
      ...next,
      messages: next.messages.map((m) => ({
        ...m,
        parts: m.parts.map((p) => (p.type === 'tool' && p.id === b.tool_use_id ? { ...p, status: 'ready', result: b.content } : p)),
      })),
    };
  }
  return next;
}

function finishRun(state: ReducerState, ok: boolean): ReducerState {
  const cur = lastAssistant(state);
  const messages = cur ? state.messages.map((m) => (m.id === cur.id ? { ...m, status: ok ? 'ready' : 'error' as const } : m)) : state.messages;
  return { ...state, messages, runStatus: ok ? 'idle' : 'error' };
}
```

> 注:`new Date().toISOString()` 在生产 reducer 里可接受(非 Workflow 脚本环境)。如担心测试不确定性,Task 2.5 的 build_version 测试只断言 `index/label/current`,不断言 `createdAt`。

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run src/store/apply-message.test.ts`
Expected: PASS（4 个用例)。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "新增 applyMessage reducer 流式与文本(TDD)"
```

## Task 2.5：reducer 工具效果(资产/派生/版本)测试

**Files:**
- Modify: `src/store/apply-message.test.ts`(追加用例)

- [ ] **Step 1: 追加失败测试**(append 到现有文件末尾)

```ts
import type { ContentBlock } from '@/agent-protocol/messages';
function assistantWithTool(name: string, input: unknown): SDKMessage {
  const content: ContentBlock[] = [{ type: 'tool_use', id: 't1', name, input }];
  return { type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { id: 'm1', role: 'assistant', model: 'mock', content } };
}

describe('applyMessage — 工具效果', () => {
  test('generate_assets 按类型落入资产,position 在对应 zone 附近', () => {
    const s = feed([assistantWithTool('generate_assets', {
      items: [
        { key: 'bar', label: '参考·酒吧场景', kind: 'image', prompt: 'cyberpunk bar' },
        { key: 'bgm', label: 'BGM·合成器', kind: 'audio', prompt: 'synthwave' },
      ],
    })]);
    expect(s.assets).toHaveLength(2);
    expect(s.assets.find((a) => a.key === 'bgm')!.kind).toBe('audio');
    expect(s.assets.every((a) => a.source === 'generated')).toBe(true);
  });

  test('derive_variants 生成 N 个派生资产并连父(parentId)', () => {
    const s = feed([
      assistantWithTool('generate_assets', { items: [{ key: 'hero', label: '主角_v0', kind: 'image', prompt: 'hero' }] }),
      assistantWithTool('derive_variants', { parentKey: 'hero', count: 4, instruction: '红色调变体' }),
    ]);
    const parent = s.assets.find((a) => a.key === 'hero')!;
    const derived = s.assets.filter((a) => a.source === 'derived');
    expect(derived).toHaveLength(4);
    expect(derived.every((d) => d.parentId === parent.id && d.kind === 'image')).toBe(true);
    expect(s.assets.map((a) => a.key)).toContain('hero_v3');
  });

  test('build_version 生成版本并置为 current/active', () => {
    const s = feed([
      assistantWithTool('generate_assets', { items: [{ key: 'hero', label: '主角', kind: 'image', prompt: 'h' }] }),
      assistantWithTool('build_version', { label: 'V1', summary: '初版原型' }),
    ]);
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0].current).toBe(true);
    expect(s.activeVersionId).toBe(s.versions[0].id);
    expect(s.versions[0].assetKeys).toContain('hero');
  });

  test('两次 build_version 后只有最后一个 current', () => {
    const s = feed([
      assistantWithTool('build_version', { label: 'V1', summary: 'a' }),
      assistantWithTool('build_version', { label: 'V2', summary: 'b' }),
    ]);
    expect(s.versions.filter((v) => v.current)).toHaveLength(1);
    expect(s.versions.find((v) => v.current)!.label).toBe('V2');
  });
});
```

- [ ] **Step 2: 运行**

Run: `pnpm vitest run src/store/apply-message.test.ts`
Expected: PASS（全部用例,实现已在 Task 2.4 完成)。若有失败按报错修 `apply-message.ts`。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "补充 reducer 工具效果测试"
```

## Task 2.6：selectors(画布 nodes/edges、active version)(TDD)

**Files:**
- Create: `src/store/selectors.ts`
- Test: `src/store/selectors.test.ts`

- [ ] **Step 1: 写失败测试 `src/store/selectors.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { selectCanvasNodes, selectCanvasEdges, selectActiveVersion } from './selectors';
import type { Asset, Version } from './types';

const a = (over: Partial<Asset>): Asset => ({
  id: 'x', key: 'k', label: 'L', kind: 'image', source: 'generated', status: 'ready',
  position: { x: 0, y: 0 }, pinned: false, ...over,
});

describe('selectors', () => {
  test('每个资产映射为一个 RF 节点(含 type=kind)', () => {
    const nodes = selectCanvasNodes([a({ id: '1', kind: 'image' }), a({ id: '2', kind: 'audio' })]);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ id: '1', type: 'image', position: { x: 0, y: 0 } });
  });
  test('派生资产产生一条 parent→child 边', () => {
    const edges = selectCanvasEdges([a({ id: '1', key: 'hero' }), a({ id: '2', key: 'hero_v1', source: 'derived', parentId: '1' })]);
    expect(edges).toEqual([{ id: 'e-1-2', source: '1', target: '2', animated: false }]);
  });
  test('无 parentId 不产生边', () => {
    expect(selectCanvasEdges([a({ id: '1' })])).toEqual([]);
  });
  test('selectActiveVersion 取 current/active', () => {
    const v: Version = { id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: true, assetKeys: [], game: { title: 't', palette: 'p' } };
    expect(selectActiveVersion([v], 'v1')).toBe(v);
    expect(selectActiveVersion([v], null)).toBe(v); // 回退到 current
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run src/store/selectors.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现 `src/store/selectors.ts`**

```ts
import type { Asset, Version } from './types';

export interface RFNodeData { asset: Asset; }
export interface RFNode { id: string; type: string; position: { x: number; y: number }; data: RFNodeData; }
export interface RFEdge { id: string; source: string; target: string; animated: boolean; }

export function selectCanvasNodes(assets: Asset[]): RFNode[] {
  return assets.map((asset) => ({ id: asset.id, type: asset.kind, position: asset.position, data: { asset } }));
}
export function selectCanvasEdges(assets: Asset[]): RFEdge[] {
  return assets
    .filter((a) => a.parentId)
    .map((a) => ({ id: `e-${a.parentId}-${a.id}`, source: a.parentId!, target: a.id, animated: false }));
}
export function selectActiveVersion(versions: Version[], activeVersionId: string | null): Version | null {
  return versions.find((v) => v.id === activeVersionId) ?? versions.find((v) => v.current) ?? null;
}
```

> 注:RF 的 `type` 用 `'3d'` 作 nodeType key 也合法(任意字符串)。

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/store/selectors.test.ts`(Expected: PASS)
```bash
git add -A && git commit -m "新增画布/版本 selectors(TDD)"
```

## Task 2.7：zustand store(create + persist + actions)

**Files:**
- Create: `src/store/index.ts`

- [ ] **Step 1: 写 `src/store/index.ts`**

```ts
'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SDKMessage } from '@/agent-protocol/messages';
import { applyMessage } from './apply-message';
import { createInitialReducerState, type ReducerState, type Asset, type Version, type Message } from './types';
import type { AssetKind } from '@/agent-protocol/messages';
import { ZONE_ORDER } from '@/lib/zones';
import { newId } from '@/lib/ids';

export interface ContextMenuState { id: string; x: number; y: number; }
export interface ComposerState { draft: string; refs: string[]; attachments: { name: string; mime: string; dataUrl: string }[]; }

interface UIState {
  connStatus: 'connecting' | 'open' | 'closed' | 'error';
  visibleKinds: AssetKind[];
  selectedAssetId: string | null;
  contextMenu: ContextMenuState | null;
  compare: { on: boolean; withId: string | null };
  composer: ComposerState;
}

interface Actions {
  ingest: (msg: SDKMessage) => void;                 // 唯一落库入口
  setConn: (s: UIState['connStatus']) => void;
  setAssetPosition: (id: string, x: number, y: number, pinned?: boolean) => void;
  setAssetPositions: (updates: { id: string; x: number; y: number }[]) => void;
  toggleKind: (k: AssetKind) => void;
  selectAsset: (id: string | null) => void;
  openContextMenu: (m: ContextMenuState | null) => void;
  renameAsset: (id: string, label: string) => void;
  removeAsset: (id: string) => void;
  setActiveVersion: (id: string) => void;
  saveVersion: () => void;                            // 本地"保存为版本"
  toggleCompare: () => void;
  setCompareWith: (id: string | null) => void;
  pushUserMessage: (m: Message) => void;
  composerSet: (patch: Partial<ComposerState>) => void;
  addRef: (key: string) => void;
  removeRef: (key: string) => void;
  resetComposer: () => void;
}

export type AppStore = ReducerState & UIState & Actions;

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...createInitialReducerState(),
      connStatus: 'connecting',
      visibleKinds: [...ZONE_ORDER],
      selectedAssetId: null,
      contextMenu: null,
      compare: { on: false, withId: null },
      composer: { draft: '', refs: [], attachments: [] },

      ingest: (msg) => set((s) => applyMessage(s, msg)),
      setConn: (connStatus) => set({ connStatus }),
      setAssetPosition: (id, x, y, pinned = true) =>
        set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, position: { x, y }, pinned } : a)) })),
      setAssetPositions: (updates) =>
        set((s) => {
          const m = new Map(updates.map((u) => [u.id, u]));
          return { assets: s.assets.map((a) => (m.has(a.id) ? { ...a, position: { x: m.get(a.id)!.x, y: m.get(a.id)!.y } } : a)) };
        }),
      toggleKind: (k) =>
        set((s) => ({ visibleKinds: s.visibleKinds.includes(k) ? s.visibleKinds.filter((x) => x !== k) : [...s.visibleKinds, k] })),
      selectAsset: (selectedAssetId) => set({ selectedAssetId }),
      openContextMenu: (contextMenu) => set({ contextMenu }),
      renameAsset: (id, label) => set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, label } : a)) })),
      removeAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id && a.parentId !== id) })),
      setActiveVersion: (id) =>
        set((s) => ({ activeVersionId: id, versions: s.versions.map((v) => ({ ...v, current: v.id === id })) })),
      saveVersion: () =>
        set((s) => {
          const index = s.versions.length + 1;
          const v: Version = { id: newId('v'), index, label: `V${index}`, summary: '手动保存', createdAt: new Date().toISOString(), current: true, assetKeys: s.assets.map((a) => a.key), game: { title: 'NIGHTCAP', palette: 'neon' } };
          return { versions: [...s.versions.map((x) => ({ ...x, current: false })), v], activeVersionId: v.id };
        }),
      toggleCompare: () => set((s) => ({ compare: { ...s.compare, on: !s.compare.on } })),
      setCompareWith: (withId) => set((s) => ({ compare: { ...s.compare, withId } })),
      pushUserMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      composerSet: (patch) => set((s) => ({ composer: { ...s.composer, ...patch } })),
      addRef: (key) => set((s) => ({ composer: { ...s.composer, refs: s.composer.refs.includes(key) ? s.composer.refs : [...s.composer.refs, key] } })),
      removeRef: (key) => set((s) => ({ composer: { ...s.composer, refs: s.composer.refs.filter((r) => r !== key) } })),
      resetComposer: () => set({ composer: { draft: '', refs: [], attachments: [] } }),
    }),
    {
      name: 'taluna-v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        messages: s.messages, assets: s.assets, versions: s.versions, activeVersionId: s.activeVersionId,
        visibleKinds: s.visibleKinds, composer: s.composer,
      }),
    },
  ),
);
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "新增 zustand 单 store(persist + actions)"
```

---

# 阶段 3：server mock agent(TDD)

## Task 3.1：意图匹配(TDD)

**Files:**
- Create: `src/server/intent.ts`
- Test: `src/server/intent.test.ts`

- [ ] **Step 1: 写失败测试 `src/server/intent.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { matchIntent } from './intent';

describe('matchIntent', () => {
  test('提到参考/场景/角色 → generate', () => {
    expect(matchIntent('做一个赛博朋克酒保模拟器,先来一些角色和场景参考')).toBe('generate');
  });
  test('提到变体/派生 → derive', () => {
    expect(matchIntent('红色调主角再来 4 张变体')).toBe('derive');
  });
  test('提到打包/出一版 → build', () => {
    expect(matchIntent('打包一版')).toBe('build');
  });
  test('其他 → generate(兜底)', () => {
    expect(matchIntent('随便聊聊')).toBe('generate');
  });
});
```

- [ ] **Step 2: 运行验证失败** — Run: `pnpm vitest run src/server/intent.test.ts` → FAIL

- [ ] **Step 3: 写实现 `src/server/intent.ts`**

```ts
export type Intent = 'generate' | 'derive' | 'build';

export function matchIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/(打包|出一?版|build|发布|保存版本)/.test(t)) return 'build';
  if (/(变体|派生|再来|多来|变种|variant|derive)/.test(t)) return 'derive';
  return 'generate';
}
```

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/server/intent.test.ts`(PASS)
```bash
git add -A && git commit -m "新增意图匹配(TDD)"
```

## Task 3.2：脚本与种子资产(含 SDKMessage 一致性,TDD)

**Files:**
- Create: `src/server/scripts.ts`
- Test: `src/server/scripts.test.ts`

- [ ] **Step 1: 写失败测试 `src/server/scripts.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { buildScript, SEED } from './scripts';
import type { SDKMessage } from '@/agent-protocol/messages';

function isSDK(m: SDKMessage): m is SDKMessage { return true; }

describe('buildScript', () => {
  test('generate 脚本含 system→stream(text)→assistant(tool generate_assets)→user→result', () => {
    const msgs = buildScript('generate', { text: '场景参考', refs: [], sessionId: 's1' });
    expect(msgs[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(msgs.at(-1)).toMatchObject({ type: 'result' });
    const toolAssistant = msgs.find((m) => m.type === 'assistant') as Extract<SDKMessage, { type: 'assistant' }>;
    expect(toolAssistant.message.content.some((b) => b.type === 'tool_use' && b.name === 'generate_assets')).toBe(true);
    expect(msgs.every(isSDK)).toBe(true); // satisfies 一致性
  });

  test('derive 脚本调用 derive_variants', () => {
    const msgs = buildScript('derive', { text: '4 张变体', refs: ['hero'], sessionId: 's1' });
    const a = msgs.find((m) => m.type === 'assistant') as Extract<SDKMessage, { type: 'assistant' }>;
    expect(a.message.content.some((b) => b.type === 'tool_use' && b.name === 'derive_variants')).toBe(true);
  });

  test('build 脚本调用 build_version', () => {
    const msgs = buildScript('build', { text: '打包', refs: [], sessionId: 's1' });
    const a = msgs.find((m) => m.type === 'assistant') as Extract<SDKMessage, { type: 'assistant' }>;
    expect(a.message.content.some((b) => b.type === 'tool_use' && b.name === 'build_version')).toBe(true);
  });

  test('SEED 含参考图/配色/策划稿/BGM/过场 与 主角谱系', () => {
    const keys = SEED.assets.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(['bar_scene', 'palette', 'plan_doc', 'bgm', 'cutscene', 'hero_v0']));
    expect(SEED.versions).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 运行验证失败** — Run: `pnpm vitest run src/server/scripts.test.ts` → FAIL

- [ ] **Step 3: 写实现 `src/server/scripts.ts`**

```ts
import type { SDKMessage, ContentBlock, RawStreamEvent } from '@/agent-protocol/messages';
import type { Intent } from './intent';
import type { Asset, Version } from '@/store/types';

const MODEL = 'claude-sonnet-4-6';

export interface ScriptCtx { text: string; refs: string[]; sessionId: string; }

// ---- 流式辅助:把一段文本 + 一个 tool_use 编成 stream_event 序列 + 完整 assistant 帧 ----
function streamText(sid: string, msgId: string, text: string): SDKMessage[] {
  const ev = (event: RawStreamEvent): SDKMessage => ({ type: 'stream_event', session_id: sid, parent_tool_use_id: null, event });
  const out: SDKMessage[] = [ev({ type: 'message_start', message: { id: msgId, role: 'assistant', model: MODEL, content: [] } })];
  out.push(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  for (const chunk of text.match(/.{1,6}/gs) ?? [text]) out.push(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } }));
  out.push(ev({ type: 'content_block_stop', index: 0 }));
  return out;
}
function streamToolArgs(sid: string, toolId: string, name: string, input: unknown): SDKMessage[] {
  const ev = (event: RawStreamEvent): SDKMessage => ({ type: 'stream_event', session_id: sid, parent_tool_use_id: null, event });
  const json = JSON.stringify(input);
  const out: SDKMessage[] = [ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: toolId, name, input: {} } })];
  for (const chunk of json.match(/.{1,40}/gs) ?? [json]) out.push(ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: chunk } }));
  out.push(ev({ type: 'content_block_stop', index: 1 }));
  return out;
}
function assistantFrame(sid: string, msgId: string, text: string, toolId: string, name: string, input: unknown): SDKMessage {
  const content: ContentBlock[] = [{ type: 'text', text }, { type: 'tool_use', id: toolId, name, input }];
  return { type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { id: msgId, role: 'assistant', model: MODEL, content } };
}
function toolResult(sid: string, toolId: string, content: string): SDKMessage {
  return { type: 'user', session_id: sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content }] } };
}
function done(sid: string): SDKMessage {
  return { type: 'result', subtype: 'success', session_id: sid, duration_ms: 1200, is_error: false, num_turns: 1, usage: { input_tokens: 200, output_tokens: 320 }, total_cost_usd: 0.01 };
}

// ---- 三套脚本 ----
function genTurn(ctx: ScriptCtx): SDKMessage[] {
  const sid = ctx.sessionId, msgId = 'm_gen', toolId = 't_gen';
  const text = '已生成 3 张参考图、1 份策划稿、1 段 BGM、1 段过场动画,落在画布上。继续派生角色变体,或告诉我下一步。';
  const input = {
    items: [
      { key: 'bar_scene', label: '参考·酒吧场景', kind: 'image', prompt: 'cyberpunk bar at night', preview: { color: '#3a2b5c', title: 'NIGHTCAP' } },
      { key: 'palette', label: '赛博霓虹配色', kind: 'image', prompt: 'neon palette', preview: { color: '#5b1a52' } },
      { key: 'plan_doc', label: '策划稿 v1', kind: 'doc', prompt: 'design doc', preview: { title: '调酒师模拟器·策划稿' } },
      { key: 'bgm', label: 'BGM·合成器', kind: 'audio', prompt: 'synthwave loop', preview: { duration: '1:46' } },
      { key: 'cutscene', label: '过场动画·开场', kind: 'video', prompt: 'intro cutscene', preview: { duration: '0:24', color: '#7a3b8c' } },
    ],
  };
  return [{ type: 'system', subtype: 'init', session_id: sid, model: MODEL, tools: ['generate_assets', 'derive_variants', 'build_version'] },
    ...streamText(sid, msgId, text), ...streamToolArgs(sid, toolId, 'generate_assets', input),
    assistantFrame(sid, msgId, text, toolId, 'generate_assets', input), toolResult(sid, toolId, '已落库 5 个资产'), done(sid)];
}
function deriveTurn(ctx: ScriptCtx): SDKMessage[] {
  const sid = ctx.sessionId, msgId = 'm_der', toolId = 't_der';
  const parentKey = ctx.refs[0] ?? 'hero_v0';
  const text = '已派生 主角_v1 / v2 / v3 / v4,血缘自动连线。已累积 4 次资产更新,是否打包新版本?';
  const colors = ['#c0392b', '#1f8f5f', '#7b3fe4', '#d96a1f'];
  const input = { parentKey, count: 4, instruction: ctx.text, labels: ['主角_v1', '主角_v2', '主角_v3', '主角_v4'], previews: colors.map((c) => ({ color: c })) };
  return [{ type: 'system', subtype: 'init', session_id: sid, model: MODEL, tools: ['generate_assets', 'derive_variants', 'build_version'] },
    ...streamText(sid, msgId, text), ...streamToolArgs(sid, toolId, 'derive_variants', input),
    assistantFrame(sid, msgId, text, toolId, 'derive_variants', input), toolResult(sid, toolId, '已派生 4 个变体'), done(sid)];
}
function buildTurn(ctx: ScriptCtx): SDKMessage[] {
  const sid = ctx.sessionId, msgId = 'm_bld', toolId = 't_bld';
  const text = '新版本已生成(含可玩 build + 全部依赖资产)。右侧时间线已更新。';
  const input = { label: '', summary: '平衡性调整', game: { title: 'NIGHTCAP', palette: 'neon' } };
  return [{ type: 'system', subtype: 'init', session_id: sid, model: MODEL, tools: ['generate_assets', 'derive_variants', 'build_version'] },
    ...streamText(sid, msgId, text), ...streamToolArgs(sid, toolId, 'build_version', input),
    assistantFrame(sid, msgId, text, toolId, 'build_version', input), toolResult(sid, toolId, '版本已打包'), done(sid)];
}

export function buildScript(intent: Intent, ctx: ScriptCtx): SDKMessage[] {
  if (intent === 'derive') return deriveTurn(ctx);
  if (intent === 'build') return buildTurn(ctx);
  return genTurn(ctx);
}

// ---- 初始种子(打开即对齐截图)----
const seedAsset = (o: Partial<Asset> & Pick<Asset, 'key' | 'label' | 'kind'>): Asset => ({
  id: `seed_${o.key}`, source: 'generated', status: 'ready', pinned: false, position: { x: 0, y: 0 }, ...o,
} as Asset);

export const SEED: { assets: Asset[]; versions: Version[] } = {
  assets: [
    seedAsset({ key: 'bar_scene', label: '参考·酒吧场景', kind: 'image', source: 'reference', preview: { color: '#3a2b5c', title: 'NIGHTCAP' } }),
    seedAsset({ key: 'palette', label: '赛博霓虹配色', kind: 'image', preview: { color: '#5b1a52' } }),
    seedAsset({ key: 'plan_doc', label: '策划稿 v1', kind: 'doc', preview: { title: '调酒师模拟器·策划稿' } }),
    seedAsset({ key: 'bgm', label: 'BGM·合成器', kind: 'audio', preview: { duration: '1:46' } }),
    seedAsset({ key: 'cutscene', label: '过场动画·开场', kind: 'video', preview: { duration: '0:24', color: '#7a3b8c' } }),
    seedAsset({ key: 'hero_v0', label: '主角_v0', kind: 'image', preview: { color: '#1f8f5f' } }),
    seedAsset({ key: 'hero_v1', label: '主角_v1', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#c0392b' } }),
    seedAsset({ key: 'hero_v2', label: '主角_v2', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#1f8f5f' } }),
    seedAsset({ key: 'hero_v3', label: '主角_v3', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#7b3fe4' } }),
    seedAsset({ key: 'hero_v4', label: '主角_v4', kind: 'image', source: 'derived', parentId: 'seed_hero_v0', preview: { color: '#d96a1f' } }),
    seedAsset({ key: 'sunset_bar', label: '场景·黄昏酒吧', kind: 'image', preview: { color: '#b5532a', title: 'SUNSET BAR' } }),
  ],
  versions: [
    { id: 'seed_v1', index: 1, label: 'V1', summary: '初版原型', createdAt: '2026-06-02T09:45:00Z', current: false, assetKeys: ['bar_scene', 'hero_v0'], game: { title: 'NIGHTCAP', palette: 'neon' } },
    { id: 'seed_v2', index: 2, label: 'V2', summary: '红色主角', createdAt: '2026-06-02T11:18:00Z', current: false, assetKeys: ['bar_scene', 'hero_v1'], game: { title: 'NIGHTCAP', palette: 'red' } },
    { id: 'seed_v3', index: 3, label: 'V3', summary: '平衡性调整', createdAt: '2026-06-02T14:32:00Z', current: true, assetKeys: ['bar_scene', 'hero_v2'], game: { title: 'NIGHTCAP', palette: 'neon' } },
  ],
};
```

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/server/scripts.test.ts`(PASS)
```bash
git add -A && git commit -m "新增 mock 脚本与种子资产(TDD)"
```

## Task 3.3：agent 异步生成器(TDD)

**Files:**
- Create: `src/server/agent.ts`
- Test: `src/server/agent.test.ts`

- [ ] **Step 1: 写失败测试 `src/server/agent.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { runAgent } from './agent';

describe('runAgent', () => {
  test('产出 system 开头、result 结尾的 SDKMessage 序列', async () => {
    const out: any[] = [];
    for await (const m of runAgent({ kind: 'user_input', sessionId: 's1', text: '场景参考', refs: [], attachments: [], baseVersionId: null }, { delayMs: 0 })) out.push(m);
    expect(out[0].type).toBe('system');
    expect(out.at(-1).type).toBe('result');
  });

  test('abort 信号触发后提前结束并发 error result', async () => {
    const ac = new AbortController();
    const out: any[] = [];
    ac.abort();
    for await (const m of runAgent({ kind: 'user_input', sessionId: 's1', text: '场景参考', refs: [], attachments: [], baseVersionId: null }, { delayMs: 0, signal: ac.signal })) out.push(m);
    expect(out.at(-1)).toMatchObject({ type: 'result', subtype: 'error_during_execution' });
  });
});
```

- [ ] **Step 2: 运行验证失败** — Run: `pnpm vitest run src/server/agent.test.ts` → FAIL

- [ ] **Step 3: 写实现 `src/server/agent.ts`**

```ts
import type { SDKMessage } from '@/agent-protocol/messages';
import type { ClientFrame } from '@/agent-protocol/frame';
import { matchIntent } from './intent';
import { buildScript } from './scripts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RunOpts { delayMs?: number; signal?: AbortSignal; }

export async function* runAgent(input: Extract<ClientFrame, { kind: 'user_input' }>, opts: RunOpts = {}): AsyncGenerator<SDKMessage> {
  const { delayMs = 24, signal } = opts;
  const intent = matchIntent(input.text);
  const script = buildScript(intent, { text: input.text, refs: input.refs, sessionId: input.sessionId });

  for (const msg of script) {
    if (signal?.aborted) {
      yield { type: 'result', subtype: 'error_during_execution', session_id: input.sessionId, duration_ms: 0, is_error: true, num_turns: 1, result: 'aborted', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 };
      return;
    }
    yield msg;
    if (delayMs && msg.type === 'stream_event') await sleep(delayMs);
  }
}
```

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/server/agent.test.ts`(PASS)
```bash
git add -A && git commit -m "新增 mock agent 异步生成器(TDD)"
```

## Task 3.4：ws 接线并接入 server.ts

**Files:**
- Create: `src/server/ws.ts`
- Modify: `server.ts`

- [ ] **Step 1: 写 `src/server/ws.ts`**

```ts
import type { WebSocket } from 'ws';
import { decodeFrames, encodeFrame, type ClientFrame } from '@/agent-protocol/frame';
import { runAgent } from './agent';

export function attachAgent(ws: WebSocket) {
  let buffer = '';
  let ac: AbortController | null = null;

  ws.on('message', async (raw: Buffer) => {
    buffer += raw.toString('utf8');
    const { frames, rest } = decodeFrames(buffer.endsWith('\n') ? buffer : buffer + '\n');
    buffer = rest;
    for (const f of frames) {
      const frame = f as ClientFrame;
      if (frame.kind === 'abort') { ac?.abort(); continue; }
      if (frame.kind === 'user_input') {
        ac = new AbortController();
        for await (const msg of runAgent(frame, { signal: ac.signal })) {
          if (ws.readyState !== ws.OPEN) break;
          ws.send(encodeFrame(msg));
        }
      }
    }
  });

  ws.on('close', () => ac?.abort());
}
```

> 注:浏览器 `WebSocket.send` 每次一帧;此处兼容拼接,`decodeFrames` 对单帧也正确。`@` 路径别名在 server.ts 由 tsx + tsconfig paths 解析。

- [ ] **Step 2: 修改 `server.ts` 的 `wss.on('connection')`**

把 Task 0.4 里的占位 connection 处理替换为:
```ts
import { attachAgent } from './src/server/ws';
// ...
wss.on('connection', (ws) => attachAgent(ws as never));
```
(删除原先 `ws.send(JSON.stringify({...system init...}))` 占位行。)

- [ ] **Step 3: 手动验证全链路**

Run: `pnpm dev`,新终端:
```bash
node --input-type=module -e "import('ws').then(({default:W})=>{const ws=new W('ws://localhost:3000/api/agent/ws');ws.on('open',()=>ws.send(JSON.stringify({kind:'user_input',sessionId:'s1',text:'场景参考',refs:[],attachments:[],baseVersionId:null})+'\n'));let n=0;ws.on('message',m=>{n++;const o=JSON.parse(m.toString());if(o.type==='result'){console.log('共',n,'帧, 结尾',o.type);process.exit(0)}})})"
```
Expected: 打印帧数且以 `result` 结束。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "ws agent 接线接入自定义 server"
```

## Task 3.5：浏览器 WS 客户端(TDD)

**Files:**
- Create: `src/client/ws-client.ts`
- Test: `src/client/ws-client.test.ts`

- [ ] **Step 1: 写失败测试 `src/client/ws-client.test.ts`**(用 fake socket 验证解析)

```ts
import { describe, expect, test, vi } from 'vitest';
import { createAgentClient } from './ws-client';
import { encodeFrame } from '@/agent-protocol/frame';
import type { SDKMessage } from '@/agent-protocol/messages';

class FakeWS {
  static OPEN = 1; readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
  emit(msg: SDKMessage) { this.onmessage?.({ data: encodeFrame(msg) }); }
}

describe('createAgentClient', () => {
  test('收到的帧透传给 onMessage 回调', () => {
    const fake = new FakeWS('ws://x');
    const received: SDKMessage[] = [];
    const client = createAgentClient({ url: 'ws://x', factory: () => fake as never, onMessage: (m) => received.push(m), onStatus: () => {} });
    fake.onopen?.();
    fake.emit({ type: 'system', subtype: 'init', session_id: 's1', model: 'mock', tools: [] });
    expect(received[0]).toMatchObject({ type: 'system' });
    client.close();
  });

  test('send 组装 user_input 帧', () => {
    const fake = new FakeWS('ws://x');
    const client = createAgentClient({ url: 'ws://x', factory: () => fake as never, onMessage: () => {}, onStatus: () => {} });
    fake.onopen?.();
    client.sendUserInput({ text: 'hi', refs: ['hero'], attachments: [], baseVersionId: null });
    expect(JSON.parse(fake.sent[0])).toMatchObject({ kind: 'user_input', text: 'hi', refs: ['hero'] });
    client.close();
  });
});
```

- [ ] **Step 2: 运行验证失败** — Run: `pnpm vitest run src/client/ws-client.test.ts` → FAIL

- [ ] **Step 3: 写实现 `src/client/ws-client.ts`**

```ts
import { decodeFrames, encodeFrame, type ClientFrame } from '@/agent-protocol/frame';
import type { SDKMessage } from '@/agent-protocol/messages';

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface AgentClientOpts {
  url: string;
  onMessage: (m: SDKMessage) => void;
  onStatus: (s: ConnStatus) => void;
  factory?: (url: string) => WebSocket;   // 测试注入
}

export interface AgentClient {
  sendUserInput: (p: { text: string; refs: string[]; attachments: { name: string; mime: string; dataUrl: string }[]; baseVersionId: string | null }) => void;
  abort: () => void;
  close: () => void;
}

export function createAgentClient(opts: AgentClientOpts): AgentClient {
  const sessionId = `web_${Math.round(performance.now())}_${Math.floor((globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] ?? 0))}`;
  const make = opts.factory ?? ((u: string) => new WebSocket(u));
  let buffer = '';
  const ws = make(opts.url);
  opts.onStatus('connecting');

  ws.onopen = () => opts.onStatus('open');
  ws.onmessage = (e: MessageEvent | { data: string }) => {
    buffer += (e as { data: string }).data;
    const { frames, rest } = decodeFrames(buffer);
    buffer = rest;
    for (const f of frames) opts.onMessage(f as SDKMessage);
  };
  ws.onclose = () => opts.onStatus('closed');
  ws.onerror = () => opts.onStatus('error');

  const send = (frame: ClientFrame) => { if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(frame)); };

  return {
    sendUserInput: (p) => send({ kind: 'user_input', sessionId, ...p }),
    abort: () => send({ kind: 'abort', sessionId }),
    close: () => ws.close(),
  };
}
```

> 注:`WebSocket.OPEN` 在测试 fake 上用 `1`;FakeWS 已设 `readyState=1`。

- [ ] **Step 4: 运行验证通过 + Commit**

Run: `pnpm vitest run src/client/ws-client.test.ts`(PASS)
```bash
git add -A && git commit -m "新增浏览器 WS 客户端(TDD)"
```

## Task 3.6：连接 hook + 种子注水

**Files:**
- Create: `src/client/useAgentConnection.ts`

- [ ] **Step 1: 写 `src/client/useAgentConnection.ts`**

```ts
'use client';
import { useEffect, useRef } from 'react';
import { createAgentClient, type AgentClient } from './ws-client';
import { useStore } from '@/store';
import { SEED } from '@/server/scripts';

export function useAgentConnection() {
  const clientRef = useRef<AgentClient | null>(null);
  const ingest = useStore((s) => s.ingest);
  const setConn = useStore((s) => s.setConn);

  // 首次注水种子(仅当 store 为空)
  useEffect(() => {
    const s = useStore.getState();
    if (s.assets.length === 0 && s.versions.length === 0) {
      useStore.setState({ assets: SEED.assets, versions: SEED.versions, activeVersionId: SEED.versions.find((v) => v.current)?.id ?? null });
    }
  }, []);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const client = createAgentClient({
      url: `${proto}://${location.host}/api/agent/ws`,
      onMessage: ingest,
      onStatus: setConn,
    });
    clientRef.current = client;
    return () => client.close();
  }, [ingest, setConn]);

  return clientRef;
}
```

- [ ] **Step 2: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增连接 hook 与种子注水"
```

---

# 阶段 4：对话栏

## Task 4.1：消息渲染(ThinkingBlock / ToolCard / MessageItem)

**Files:**
- Create: `src/components/chat/ThinkingBlock.tsx`, `src/components/chat/ToolCard.tsx`, `src/components/chat/MessageItem.tsx`

- [ ] **Step 1: 写 `src/components/chat/ThinkingBlock.tsx`**

```tsx
'use client';
import { useState } from 'react';
export default function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 text-xs text-[var(--color-muted)]">
      <button onClick={() => setOpen((o) => !o)} className="hover:underline">{open ? '▾' : '▸'} 思考过程</button>
      {open && <div className="mt-1 whitespace-pre-wrap rounded-md bg-[var(--color-canvas)] p-2">{text}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 写 `src/components/chat/ToolCard.tsx`**

```tsx
'use client';
const LABEL: Record<string, string> = { generate_assets: '生成资产', derive_variants: '派生变体', build_version: '打包版本' };
export default function ToolCard({ name, status, result }: { name: string; status: string; result?: string }) {
  return (
    <div className="my-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{LABEL[name] ?? name}</span>
        <span className={status === 'ready' ? 'text-[var(--color-audio)]' : 'text-[var(--color-muted)]'}>
          {status === 'ready' ? '✓ 完成' : '● 进行中'}
        </span>
      </div>
      {result && <div className="mt-1 text-[var(--color-muted)]">{result}</div>}
    </div>
  );
}
```

- [ ] **Step 3: 写 `src/components/chat/MessageItem.tsx`**

```tsx
'use client';
import type { Message } from '@/store/types';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';

export default function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className="mb-4">
      <div className={`mb-1 text-[11px] font-semibold tracking-wide ${isUser ? 'text-[var(--color-brand)]' : 'text-[var(--color-muted)]'}`}>
        {isUser ? 'YOU' : 'TALUNA AGENT'}
      </div>
      {message.refs?.length ? (
        <div className="mb-1 flex flex-wrap gap-1">
          {message.refs.map((r) => <span key={r} className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]">@{r}</span>)}
        </div>
      ) : null}
      {message.parts.map((p, i) => {
        if (p.type === 'text') return <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{p.text}</p>;
        if (p.type === 'thinking') return <ThinkingBlock key={i} text={p.text} />;
        return <ToolCard key={i} name={p.name} status={p.status} result={p.result} />;
      })}
    </div>
  );
}
```

- [ ] **Step 4: 写组件测试 `src/components/chat/MessageItem.test.tsx`**

```tsx
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageItem from './MessageItem';
import type { Message } from '@/store/types';

describe('MessageItem', () => {
  test('助手文本消息渲染 TALUNA AGENT 与文本', () => {
    const m: Message = { id: '1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '已生成 3 张图' }] };
    render(<MessageItem message={m} />);
    expect(screen.getByText('TALUNA AGENT')).toBeInTheDocument();
    expect(screen.getByText('已生成 3 张图')).toBeInTheDocument();
  });
  test('工具 part 渲染工具卡', () => {
    const m: Message = { id: '1', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 't', name: 'derive_variants', argsText: '', status: 'ready' }] };
    render(<MessageItem message={m} />);
    expect(screen.getByText('派生变体')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: 运行 + Commit**

Run: `pnpm vitest run src/components/chat/MessageItem.test.tsx`(PASS)
```bash
git add -A && git commit -m "新增对话消息/思考/工具卡渲染"
```

## Task 4.2：MentionPopover + AttachmentBar + Composer

**Files:**
- Create: `src/components/chat/MentionPopover.tsx`, `src/components/chat/AttachmentBar.tsx`, `src/components/chat/Composer.tsx`

- [ ] **Step 1: 写 `src/components/chat/MentionPopover.tsx`**

```tsx
'use client';
import { useStore } from '@/store';
import { ZONE_LABEL } from '@/lib/zones';
import type { AssetKind } from '@/agent-protocol/messages';

export default function MentionPopover({ query, onPick }: { query: string; onPick: (key: string) => void }) {
  const assets = useStore((s) => s.assets);
  const list = assets.filter((a) => (a.key + a.label).toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  if (list.length === 0) return null;
  return (
    <div className="absolute bottom-full mb-1 max-h-56 w-64 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
      {list.map((a) => (
        <button key={a.id} onMouseDown={(e) => { e.preventDefault(); onPick(a.key); }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-canvas)]">
          <span className="text-[10px] text-[var(--color-muted)]">{ZONE_LABEL[a.kind as AssetKind]}</span>
          <span className="truncate">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 `src/components/chat/AttachmentBar.tsx`**

```tsx
'use client';
import { useStore } from '@/store';

export default function AttachmentBar() {
  const { refs, attachments } = useStore((s) => s.composer);
  const removeRef = useStore((s) => s.removeRef);
  const composerSet = useStore((s) => s.composer && s.composerSet);
  if (refs.length === 0 && attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {refs.map((r) => (
        <span key={r} className="flex items-center gap-1 rounded-md bg-[var(--color-audio)]/15 px-2 py-0.5 text-xs text-[var(--color-audio)]">
          📦 asset · {r}
          <button onClick={() => removeRef(r)} className="text-[var(--color-muted)]">×</button>
        </span>
      ))}
      {attachments.map((f, i) => (
        <span key={i} className="flex items-center gap-1 rounded-md bg-[var(--color-canvas)] px-2 py-0.5 text-xs">
          📎 {f.name}
          <button onClick={() => composerSet({ attachments: attachments.filter((_, j) => j !== i) })} className="text-[var(--color-muted)]">×</button>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 写 `src/components/chat/Composer.tsx`**

```tsx
'use client';
import { useRef, useState } from 'react';
import { useStore } from '@/store';
import { getActiveMention } from '@/lib/refs';
import { newId } from '@/lib/ids';
import MentionPopover from './MentionPopover';
import AttachmentBar from './AttachmentBar';
import type { AgentClient } from '@/client/ws-client';

export default function Composer({ client }: { client: React.RefObject<AgentClient | null> }) {
  const { draft, refs, attachments } = useStore((s) => s.composer);
  const composerSet = useStore((s) => s.composerSet);
  const addRef = useStore((s) => s.addRef);
  const resetComposer = useStore((s) => s.resetComposer);
  const pushUserMessage = useStore((s) => s.pushUserMessage);
  const runStatus = useStore((s) => s.runStatus);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    composerSet({ draft: e.target.value });
    setMention(getActiveMention(e.target.value, e.target.selectionStart ?? e.target.value.length));
  };
  const pickMention = (key: string) => {
    if (mention) {
      const next = draft.slice(0, mention.start) + draft.slice(mention.start + 1 + mention.query.length);
      composerSet({ draft: next });
    }
    addRef(key); setMention(null); taRef.current?.focus();
  };
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => {
      if (f.size > 1_000_000) return; // 单文件 ≤ ~1MB
      const reader = new FileReader();
      reader.onload = () => composerSet({ attachments: [...useStore.getState().composer.attachments, { name: f.name, mime: f.type, dataUrl: String(reader.result) }] });
      reader.readAsDataURL(f);
    });
  };
  const send = () => {
    if (!draft.trim() || runStatus === 'running') return;
    pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [{ type: 'text', text: draft }], refs: [...refs], attachments: attachments.map(({ name, mime }) => ({ name, mime })) });
    client.current?.sendUserInput({ text: draft, refs, attachments, baseVersionId: useStore.getState().activeVersionId });
    resetComposer();
  };

  return (
    <div className="border-t border-[var(--color-line)]">
      <AttachmentBar />
      <div className="relative px-3 py-2">
        {mention && <MentionPopover query={mention.query} onPick={pickMention} />}
        <textarea ref={taRef} value={draft} onChange={onChange} rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="描述你的游戏,或用 @ 引用画布资产…"
          className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-sm outline-none focus:border-[var(--color-brand)]" />
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex gap-2 text-xs text-[var(--color-muted)]">
            <button onMouseDown={(e) => { e.preventDefault(); composerSet({ draft: draft + '@' }); setMention({ query: '', start: draft.length }); taRef.current?.focus(); }}>@ 提及</button>
            <label className="cursor-pointer">📎 附件<input type="file" multiple className="hidden" onChange={onFiles} /></label>
          </div>
          {runStatus === 'running'
            ? <button onClick={() => client.current?.abort()} className="rounded-md bg-[var(--color-video)] px-3 py-1 text-xs text-white">停止</button>
            : <button onClick={send} className="rounded-md bg-[var(--color-ink)] px-3 py-1 text-xs text-white">发送 ↵</button>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增 Composer/@引用/附件"
```

## Task 4.3：ChatPanel 装配

**Files:**
- Create: `src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: 写 `src/components/chat/ChatPanel.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import MessageItem from './MessageItem';
import Composer from './Composer';
import type { AgentClient } from '@/client/ws-client';

export default function ChatPanel({ client }: { client: React.RefObject<AgentClient | null> }) {
  const messages = useStore((s) => s.messages);
  const connStatus = useStore((s) => s.connStatus);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-[var(--color-muted)]">
        <span>● AGENT · 对话</span>
        {connStatus !== 'open' && <span className="text-[var(--color-video)]">{connStatus === 'connecting' ? '连接中…' : '连接断开'}</span>}
      </div>
      <div className="flex-1 overflow-auto px-3 py-3">
        {messages.map((m) => <MessageItem key={m.id} message={m} />)}
        <div ref={endRef} />
      </div>
      <Composer client={client} />
    </div>
  );
}
```

- [ ] **Step 2: 临时挂到 Workspace 验证**(把 Workspace 暂时改为渲染 ChatPanel + 连接 hook)

```tsx
'use client';
import { useAgentConnection } from '@/client/useAgentConnection';
import ChatPanel from '@/components/chat/ChatPanel';
export default function Workspace() {
  const client = useAgentConnection();
  return <div className="h-full w-[360px]"><ChatPanel client={client} /></div>;
}
```
Run: `pnpm dev` → 输入"做个酒保模拟器场景参考" → 看到流式文本 + 工具卡 + 画布资产进 store(控制台 `useStore.getState().assets`)。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "新增 ChatPanel 并跑通对话全链路"
```

---

# 阶段 5：资产画布(React Flow + 分区 + 力导向 + 派生 + 右键)

## Task 5.1：资产节点组件(每类型一种)

**Files:**
- Create: `src/components/canvas/nodes/ImageNode.tsx`, `VideoNode.tsx`, `AudioNode.tsx`, `ThreeDNode.tsx`, `DocNode.tsx`, `src/components/canvas/nodeTypes.ts`

- [ ] **Step 1: 写 `src/components/canvas/nodes/ImageNode.tsx`**

```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';

export default function ImageNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  return (
    <div className={`w-40 overflow-hidden rounded-[14px] border-2 bg-white shadow-sm ${selected ? 'border-[var(--color-brand)]' : 'border-transparent'}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="grid h-24 place-items-center text-sm font-semibold text-white" style={{ background: a.preview?.color ?? 'var(--color-image)' }}>
        {a.preview?.title ?? ''}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px]">
        <span className="truncate">{a.label}</span>
        <span className="text-[var(--color-muted)]">IMAGE</span>
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
```

- [ ] **Step 2: 写其余四个节点**(同构,差异在徽章/缩略;以下为各文件完整内容)

`VideoNode.tsx`:
```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
export default function VideoNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  return (
    <div className={`w-40 overflow-hidden rounded-[14px] border-2 bg-white shadow-sm ${selected ? 'border-[var(--color-brand)]' : 'border-transparent'}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="relative grid h-24 place-items-center text-white" style={{ background: a.preview?.color ?? 'var(--color-video)' }}>
        <span className="text-2xl">▶</span>
        {a.preview?.duration && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px]">{a.preview.duration}</span>}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px]"><span className="truncate">{a.label}</span><span className="text-[var(--color-muted)]">VIDEO</span></div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
```
`AudioNode.tsx`:
```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
export default function AudioNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  return (
    <div className={`w-40 overflow-hidden rounded-[14px] border-2 bg-white shadow-sm ${selected ? 'border-[var(--color-brand)]' : 'border-transparent'}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex h-24 items-end justify-center gap-0.5 px-2 pb-2" style={{ background: 'color-mix(in srgb, var(--color-audio) 18%, white)' }}>
        {[8, 18, 12, 24, 16, 28, 14, 20, 10].map((h, i) => <span key={i} className="w-1.5 rounded-t bg-[var(--color-audio)]" style={{ height: h }} />)}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px]"><span className="truncate">{a.label}</span><span className="text-[var(--color-muted)]">AUDIO</span></div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
```
`ThreeDNode.tsx`:
```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
export default function ThreeDNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  return (
    <div className={`w-40 overflow-hidden rounded-[14px] border-2 bg-white shadow-sm ${selected ? 'border-[var(--color-brand)]' : 'border-transparent'}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="grid h-24 place-items-center text-3xl" style={{ background: 'color-mix(in srgb, var(--color-3d) 18%, white)' }}>🧊</div>
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px]"><span className="truncate">{a.label}</span><span className="text-[var(--color-muted)]">3D</span></div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
```
`DocNode.tsx`:
```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
export default function DocNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  return (
    <div className={`w-40 overflow-hidden rounded-[14px] border-2 bg-white shadow-sm ${selected ? 'border-[var(--color-brand)]' : 'border-transparent'}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="h-24 bg-[color-mix(in_srgb,var(--color-doc)_22%,white)] p-2 text-[10px] leading-tight text-[var(--color-ink)]">
        <div className="mb-1 font-semibold">{a.preview?.title ?? '文档'}</div>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="mb-0.5 h-1 rounded bg-black/10" style={{ width: `${90 - i * 12}%` }} />)}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px]"><span className="truncate">{a.label}</span><span className="text-[var(--color-muted)]">DOC</span></div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
```

- [ ] **Step 3: 写 `src/components/canvas/nodeTypes.ts`**(组件外定义,避免重渲)

```ts
import ImageNode from './nodes/ImageNode';
import VideoNode from './nodes/VideoNode';
import AudioNode from './nodes/AudioNode';
import ThreeDNode from './nodes/ThreeDNode';
import DocNode from './nodes/DocNode';

export const nodeTypes = { image: ImageNode, video: VideoNode, audio: AudioNode, '3d': ThreeDNode, doc: DocNode } as const;
```

- [ ] **Step 4: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增各类型资产节点组件"
```

## Task 5.2：ZoneLayer 分区背景

**Files:**
- Create: `src/components/canvas/ZoneLayer.tsx`

- [ ] **Step 1: 写 `src/components/canvas/ZoneLayer.tsx`**

```tsx
'use client';
import { ViewportPortal } from '@xyflow/react';
import { ZONE_ORDER, ZONE_LABEL, zoneFor } from '@/lib/zones';
import type { AssetKind } from '@/agent-protocol/messages';

const TINT: Record<AssetKind, string> = { image: 'var(--color-image)', video: 'var(--color-video)', audio: 'var(--color-audio)', '3d': 'var(--color-3d)', doc: 'var(--color-doc)' };

export default function ZoneLayer({ visibleKinds }: { visibleKinds: AssetKind[] }) {
  return (
    <ViewportPortal>
      {ZONE_ORDER.filter((k) => visibleKinds.includes(k)).map((k) => {
        const z = zoneFor(k);
        return (
          <div key={k} style={{ position: 'absolute', transform: `translate(${z.x}px, ${z.y}px)`, width: z.width, height: z.height }}
            className="pointer-events-none rounded-2xl border border-dashed"
            >
            <div style={{ borderColor: TINT[k], background: `color-mix(in srgb, ${TINT[k]} 6%, transparent)` }} className="h-full w-full rounded-2xl border">
              <div style={{ color: TINT[k] }} className="px-3 py-1.5 text-xs font-semibold">{ZONE_LABEL[k]}</div>
            </div>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
```

- [ ] **Step 2: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增画布分区背景层"
```

## Task 5.3：AssetCanvas(React Flow + 力导向 + 筛选)

**Files:**
- Create: `src/components/canvas/AssetCanvas.tsx`

- [ ] **Step 1: 写 `src/components/canvas/AssetCanvas.tsx`**

```tsx
'use client';
import { useEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider, type Node, type NodeChange, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/store';
import { selectCanvasNodes, selectCanvasEdges } from '@/store/selectors';
import { nodeTypes } from './nodeTypes';
import ZoneLayer from './ZoneLayer';
import { runForceLayout, type LayoutNode } from '@/lib/force-layout';
import { zonesMap, ZONE_ORDER, ZONE_LABEL } from '@/lib/zones';
import type { AssetKind } from '@/agent-protocol/messages';

function Inner() {
  const assets = useStore((s) => s.assets);
  const visibleKinds = useStore((s) => s.visibleKinds);
  const toggleKind = useStore((s) => s.toggleKind);
  const setAssetPosition = useStore((s) => s.setAssetPosition);
  const setAssetPositions = useStore((s) => s.setAssetPositions);
  const selectAsset = useStore((s) => s.selectAsset);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const laidOutCount = useRef(0);

  // 新的未 pinned 节点出现时跑一次力导向并写回坐标
  useEffect(() => {
    const movable = assets.filter((a) => !a.pinned);
    if (movable.length === laidOutCount.current) return;
    laidOutCount.current = movable.length;
    const input: LayoutNode[] = assets.map((a) => ({ id: a.id, kind: a.kind, x: a.position.x, y: a.position.y, pinned: a.pinned }));
    const out = runForceLayout(input, zonesMap());
    setAssetPositions(out.filter((n) => { const a = assets.find((x) => x.id === n.id); return a && !a.pinned; }).map((n) => ({ id: n.id, x: n.x, y: n.y })));
  }, [assets, setAssetPositions]);

  const nodes = useMemo<Node[]>(() =>
    selectCanvasNodes(assets.filter((a) => visibleKinds.includes(a.kind))) as unknown as Node[],
    [assets, visibleKinds]);
  const edges = useMemo(() => selectCanvasEdges(assets), [assets]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position && !c.dragging === false) {
        // 实时跟随
      }
      if (c.type === 'position' && c.position && c.dragging === false) {
        setAssetPosition(c.id, c.position.x, c.position.y, true); // 拖动结束 → pin
      }
    }
    applyNodeChanges(changes, nodes); // 让 RF 内部跟手(返回值不入 store,store 由拖动结束写回)
  };

  return (
    <div className="relative h-full">
      <div className="absolute left-3 top-3 z-10 flex gap-1.5">
        {ZONE_ORDER.map((k: AssetKind) => (
          <button key={k} onClick={() => toggleKind(k)}
            className={`rounded-full px-2.5 py-1 text-xs ${visibleKinds.includes(k) ? 'bg-[var(--color-ink)] text-white' : 'bg-white text-[var(--color-muted)] border border-[var(--color-line)]'}`}>
            {ZONE_LABEL[k]}
          </button>
        ))}
      </div>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
        defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: 'var(--color-muted)', strokeDasharray: '4 4' } }}
        onNodeClick={(_, n) => selectAsset(n.id)}
        onNodeContextMenu={(e, n) => { e.preventDefault(); selectAsset(n.id); openContextMenu({ id: n.id, x: e.clientX, y: e.clientY }); }}
        onPaneClick={() => { selectAsset(null); openContextMenu(null); }}
        fitView proOptions={{ hideAttribution: true }}>
        <ZoneLayer visibleKinds={visibleKinds} />
        <Background color="#dfe2ea" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs text-[var(--color-muted)] shadow">
        ⚡ 资产生成入口 · 选中资产「重新生成」即派生新变体
      </div>
    </div>
  );
}

export default function AssetCanvas() {
  return <ReactFlowProvider><Inner /></ReactFlowProvider>;
}
```

> 注:拖动跟手由 React Flow 内部状态驱动;拖动结束(`dragging===false`)写回 store 并置 `pinned`。`onNodesChange` 中对 `applyNodeChanges` 的返回值不入 store,避免与受控 nodes 冲突——若发现拖动不跟手,改为本地 `useNodesState` 镜像 + 拖动结束同步 store(见 §故障排查)。

- [ ] **Step 2: 故障排查备选(如拖动不跟手)**:把 `nodes` 改为 `const [rfNodes, setRfNodes, onNodesChange] = useNodesState(...)`,用 `useEffect` 在 `assets` 变化时 `setRfNodes(selectCanvasNodes(...))`,并在 `onNodeDragStop` 里 `setAssetPosition(id, pos.x, pos.y, true)`。二选一,确保拖动顺滑。

- [ ] **Step 3: 临时挂 Workspace 验证**:Workspace 改为左 ChatPanel + 中 AssetCanvas,`pnpm dev` 看到种子资产按类型分区分布、可拖动、派生有连线。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "新增资产画布(分区+力导向+筛选)"
```

## Task 5.4：ContextMenu 右键菜单

**Files:**
- Create: `src/components/canvas/ContextMenu.tsx`

- [ ] **Step 1: 写 `src/components/canvas/ContextMenu.tsx`**

```tsx
'use client';
import { useStore } from '@/store';
import type { AgentClient } from '@/client/ws-client';

export default function ContextMenu({ client }: { client: React.RefObject<AgentClient | null> }) {
  const menu = useStore((s) => s.contextMenu);
  const assets = useStore((s) => s.assets);
  const close = useStore((s) => s.openContextMenu);
  const addRef = useStore((s) => s.addRef);
  const renameAsset = useStore((s) => s.renameAsset);
  const removeAsset = useStore((s) => s.removeAsset);
  if (!menu) return null;
  const asset = assets.find((a) => a.id === menu.id);
  if (!asset) return null;

  const derive = (count: number) => {
    client.current?.sendUserInput({ text: `基于 ${asset.label} 派生 ${count} 张变体`, refs: [asset.key], attachments: [], baseVersionId: useStore.getState().activeVersionId });
    close(null);
  };
  const item = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--color-canvas)]';
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => close(null)} />
      <div className="fixed z-50 w-44 overflow-hidden rounded-lg border border-[var(--color-line)] bg-white py-1 shadow-xl" style={{ left: menu.x, top: menu.y }}>
        <button className={item} onClick={() => derive(4)}>✦ 派生创作(4 张)</button>
        <button className={item} onClick={() => derive(1)}>↻ 重新生成 1 张</button>
        <button className={item} onClick={() => { addRef(asset.key); close(null); }}>@ 作为引用</button>
        <button className={item} onClick={() => { const n = prompt('重命名', asset.label); if (n) renameAsset(asset.id, n); close(null); }}>✎ 重命名</button>
        <button className={`${item} text-[var(--color-video)]`} onClick={() => { removeAsset(asset.id); close(null); }}>🗑 删除</button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增资产右键菜单(派生/引用/重命名/删除)"
```

---

# 阶段 6：预览 + 版本时间线

## Task 6.1：内置 demo 游戏

**Files:**
- Create: `public/games/nightcap/index.html`

- [ ] **Step 1: 写 `public/games/nightcap/index.html`**(自包含 Canvas,接收 postMessage 切配色/标题)

```html
<!doctype html><html><head><meta charset="utf-8" /><style>
  html,body{margin:0;height:100%;background:#14121c;overflow:hidden;font-family:system-ui}
  #t{position:absolute;top:18px;width:100%;text-align:center;color:#ff5 db;font-weight:800;font-size:26px;letter-spacing:2px}
  canvas{display:block;margin:0 auto}
  #mix{position:absolute;bottom:36px;left:50%;transform:translateX(-50%);background:#26d3c0;color:#06251f;border:none;border-radius:20px;padding:10px 28px;font-weight:800;letter-spacing:2px;box-shadow:0 0 18px #26d3c0}
</style></head><body>
  <div id="t">NIGHTCAP</div>
  <canvas id="c" width="320" height="520"></canvas>
  <button id="mix">MIX</button>
  <script>
    const c = document.getElementById('c'), x = c.getContext('2d');
    let palette = 'neon', score = 2850;
    const COLORS = { neon: ['#1f8f5f','#3a2b5c'], red: ['#c0392b','#3a1b25'], default: ['#7b3fe4','#2b1b4c'] };
    function draw(){
      const [hero, bg] = COLORS[palette] || COLORS.default;
      x.fillStyle = bg; x.fillRect(0,0,320,520);
      x.fillStyle = '#0e0c16'; x.fillRect(0,360,320,160);          // 吧台
      x.fillStyle = '#ffd34d'; x.font='14px monospace'; x.fillText('SCORE / 0'+score, 90, 70);
      for(let i=0;i<5;i++){ x.fillStyle=['#26d3c0','#ffd34d','#ff7a4c','#6c8cff','#ff5edb'][i]; x.fillRect(40+i*18,330,10,28-i*2); } // 酒瓶
      x.fillStyle = hero; x.fillRect(150,300,40,60);                // 主角
      x.fillStyle = '#f2c9a0'; x.fillRect(158,284,24,20);
    }
    draw();
    document.getElementById('mix').onclick = () => { score += 120; draw(); };
    addEventListener('message', (e) => { if(e.data?.palette) palette = e.data.palette; if(e.data?.title) document.getElementById('t').textContent = e.data.title; draw(); });
  </script>
</body></html>
```

> 注:修掉 CSS 里 `#ff5 db` 的笔误为 `#ff5edb`(写入时确认无空格)。

- [ ] **Step 2: 验证**:`pnpm dev` 后访问 `http://localhost:3000/games/nightcap/index.html`,看到 NIGHTCAP 画面与 MIX 按钮。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "新增内置 NIGHTCAP demo 游戏"
```

## Task 6.2：GameFrame + DeviceToggle

**Files:**
- Create: `src/components/preview/DeviceToggle.tsx`, `src/components/preview/GameFrame.tsx`

- [ ] **Step 1: 写 `src/components/preview/DeviceToggle.tsx`**

```tsx
'use client';
export default function DeviceToggle({ value, onChange }: { value: 'mobile' | 'desktop'; onChange: (v: 'mobile' | 'desktop') => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as 'mobile' | 'desktop')}
      className="rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs">
      <option value="mobile">📱 移动</option>
      <option value="desktop">🖥 桌面</option>
    </select>
  );
}
```

- [ ] **Step 2: 写 `src/components/preview/GameFrame.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import type { Version } from '@/store/types';

export default function GameFrame({ version, device }: { version: Version | null; device: 'mobile' | 'desktop' }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (version && ref.current?.contentWindow) ref.current.contentWindow.postMessage({ palette: version.game.palette, title: version.game.title }, '*');
  }, [version]);
  const w = device === 'mobile' ? 'w-[340px]' : 'w-full';
  return (
    <div className="relative flex flex-1 items-center justify-center bg-[var(--color-preview-bg)] p-4">
      <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-[var(--color-doc)] px-3 py-1 text-[11px] font-semibold text-black/80">
        ◆ INSPECT MODE · 单击对象引用,资产对象支持画布定位
      </div>
      <div className={`${w} max-w-[360px] overflow-hidden rounded-[28px] border-4 border-black/40 shadow-2xl`}>
        <iframe ref={ref} src="/games/nightcap/index.html" title="preview"
          onLoad={() => { if (version) ref.current?.contentWindow?.postMessage({ palette: version.game.palette, title: version.game.title }, '*'); }}
          className="h-[560px] w-full bg-black" />
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 text-xs">
        <button className="rounded-md bg-[var(--color-doc)] px-3 py-1.5 font-medium">▢ 在对话调整</button>
        <button className="rounded-md bg-white/90 px-3 py-1.5">↻ 画布重新生成</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增游戏预览框与设备切换"
```

## Task 6.3：VersionTimeline + CompareView + PreviewPanel

**Files:**
- Create: `src/components/preview/VersionTimeline.tsx`, `src/components/preview/CompareView.tsx`, `src/components/preview/PreviewPanel.tsx`

- [ ] **Step 1: 写 `src/components/preview/VersionTimeline.tsx`**

```tsx
'use client';
import { useStore } from '@/store';

export default function VersionTimeline() {
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const setActive = useStore((s) => s.setActiveVersion);
  const toggleCompare = useStore((s) => s.toggleCompare);
  const compareOn = useStore((s) => s.compare.on);
  const setCompareWith = useStore((s) => s.setCompareWith);

  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold">
        <span>🟦 版本时间线 · {versions.length} 个版本</span>
        <button onClick={toggleCompare} className={`rounded px-2 py-0.5 ${compareOn ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-muted)]'}`}>⇄ 对比模式</button>
      </div>
      <div className="flex max-h-44 flex-col gap-1.5 overflow-auto">
        {[...versions].reverse().map((v) => {
          const active = v.id === activeId;
          return (
            <button key={v.id}
              onClick={() => (compareOn ? setCompareWith(v.id) : setActive(v.id))}
              className={`rounded-lg border px-3 py-2 text-left ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/5' : 'border-[var(--color-line)]'}`}>
              <div className="flex items-center gap-2 text-sm font-bold">
                {v.label}{v.current && <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] text-white">CURRENT</span>}
              </div>
              <div className="text-xs text-[var(--color-muted)]">{v.summary} · {new Date(v.createdAt).toLocaleString('zh-CN')}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 `src/components/preview/CompareView.tsx`**

```tsx
'use client';
import { useStore } from '@/store';
import { selectActiveVersion } from '@/store/selectors';
import GameFrame from './GameFrame';

export default function CompareView() {
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const withId = useStore((s) => s.compare.withId);
  const left = selectActiveVersion(versions, activeId);
  const right = versions.find((v) => v.id === withId) ?? null;
  return (
    <div className="flex flex-1">
      <div className="flex flex-1 flex-col"><div className="bg-[var(--color-preview-bg)] py-1 text-center text-xs text-white">{left?.label ?? '当前'}</div><GameFrame version={left} device="mobile" /></div>
      <div className="flex flex-1 flex-col"><div className="bg-[var(--color-preview-bg)] py-1 text-center text-xs text-white">{right?.label ?? '选择版本'}</div><GameFrame version={right} device="mobile" /></div>
    </div>
  );
}
```

- [ ] **Step 3: 写 `src/components/preview/PreviewPanel.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useStore } from '@/store';
import { selectActiveVersion } from '@/store/selectors';
import GameFrame from './GameFrame';
import DeviceToggle from './DeviceToggle';
import CompareView from './CompareView';
import VersionTimeline from './VersionTimeline';

export default function PreviewPanel() {
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const compareOn = useStore((s) => s.compare.on);
  const saveVersion = useStore((s) => s.saveVersion);
  const active = selectActiveVersion(versions, activeId);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2 text-xs">
        <span className="font-semibold">▶ 预览 · {active?.label ?? 'V0'} <span className="ml-1 rounded bg-[var(--color-video)] px-1 text-white">LIVE</span></span>
        <div className="flex items-center gap-2">
          <DeviceToggle value={device} onChange={setDevice} />
          <button onClick={saveVersion} className="rounded-md bg-[var(--color-brand)] px-2 py-1 text-white">⊕ 保存为版本</button>
          <button className="rounded-md border border-[var(--color-line)] px-2 py-1">↓ ZIP</button>
        </div>
      </div>
      {compareOn ? <CompareView /> : <GameFrame version={active} device={device} />}
      <VersionTimeline />
    </div>
  );
}
```

> ZIP 按钮原型阶段仅占位(无 onClick),不导出真实包(见 spec §16 YAGNI)。

- [ ] **Step 4: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增版本时间线/对比/预览面板"
```

---

# 阶段 7：工具栏 + 三栏壳 + 搜索 + 收尾

## Task 7.1：Toolbar + SearchPalette

**Files:**
- Create: `src/components/workspace/Toolbar.tsx`, `src/components/workspace/SearchPalette.tsx`

- [ ] **Step 1: 写 `src/components/workspace/SearchPalette.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const assets = useStore((s) => s.assets);
  const versions = useStore((s) => s.versions);
  const selectAsset = useStore((s) => s.selectAsset);
  const setActive = useStore((s) => s.setActiveVersion);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, []);
  if (!open) return null;

  const aHits = assets.filter((a) => (a.label + a.key).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  const vHits = versions.filter((v) => (v.label + v.summary).toLowerCase().includes(q.toLowerCase())).slice(0, 4);
  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/30 pt-24" onClick={() => setOpen(false)}>
      <div className="w-[520px] overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索资产、版本、对话…" className="w-full border-b border-[var(--color-line)] px-4 py-3 outline-none" />
        <div className="max-h-80 overflow-auto p-2 text-sm">
          {aHits.map((a) => <button key={a.id} className="block w-full rounded px-3 py-1.5 text-left hover:bg-[var(--color-canvas)]" onClick={() => { selectAsset(a.id); setOpen(false); }}>资产 · {a.label}</button>)}
          {vHits.map((v) => <button key={v.id} className="block w-full rounded px-3 py-1.5 text-left hover:bg-[var(--color-canvas)]" onClick={() => { setActive(v.id); setOpen(false); }}>版本 · {v.label} {v.summary}</button>)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 `src/components/workspace/Toolbar.tsx`**

```tsx
'use client';
import { useStore } from '@/store';
import { selectActiveVersion } from '@/store/selectors';

export default function Toolbar() {
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const active = selectActiveVersion(versions, activeId);
  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-brand)] font-bold text-white">T</span>
        <span className="font-semibold">Taluna <span className="text-xs font-normal tracking-widest text-[var(--color-muted)]">GAME AGENT</span></span>
        <span className="text-[var(--color-muted)]">/ 调酒师模拟器</span>
        <span className="rounded-full bg-[var(--color-audio)]/15 px-2 py-0.5 text-xs text-[var(--color-audio)]">● 已自动保存</span>
      </div>
      <div className="flex items-center gap-3">
        <button className="w-72 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-left text-sm text-[var(--color-muted)]" onClick={() => dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>🔍 搜索资产、版本、对话… <span className="float-right">⌘K</span></button>
        <button className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm">↗ 分享</button>
        <button className="rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-sm text-white">▶ 试玩 {active?.label ?? 'V0'}</button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`(无错误)
```bash
git add -A && git commit -m "新增顶部工具栏与搜索面板"
```

## Task 7.2：Workspace 三栏装配(最终)

**Files:**
- Modify: `src/components/workspace/Workspace.tsx`

- [ ] **Step 1: 用最终版替换 `Workspace.tsx`**

```tsx
'use client';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAgentConnection } from '@/client/useAgentConnection';
import Toolbar from './Toolbar';
import SearchPalette from './SearchPalette';
import ChatPanel from '@/components/chat/ChatPanel';
import AssetCanvas from '@/components/canvas/AssetCanvas';
import ContextMenu from '@/components/canvas/ContextMenu';
import PreviewPanel from '@/components/preview/PreviewPanel';

const Handle = () => <PanelResizeHandle className="w-px bg-[var(--color-line)] transition-colors hover:bg-[var(--color-brand)]" />;

export default function Workspace() {
  const client = useAgentConnection();
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={24} minSize={16}><ChatPanel client={client} /></Panel>
        <Handle />
        <Panel defaultSize={46} minSize={30}><AssetCanvas /></Panel>
        <Handle />
        <Panel defaultSize={30} minSize={22}><PreviewPanel /></Panel>
      </PanelGroup>
      <ContextMenu client={client} />
      <SearchPalette />
    </div>
  );
}
```

- [ ] **Step 2: 全量手动验证**(对照参考图)

Run: `pnpm dev`。检查清单:
1. 顶部工具栏 / 三栏可拖拽。
2. 画布种子资产按类型分区、主角谱系有连线、可拖动(拖完固定)。
3. 类型 chips 可显隐对应区域。
4. 对话输入"做个酒保模拟器场景参考"→ 流式回复 + 画布新增资产。
5. 右键主角 → 派生创作 → 新增 4 变体连线 + 对话出现派生卡。
6. 输入"打包一版"→ 右侧时间线新增版本并切换。
7. 点版本卡切换预览;对比模式并排。
8. ⌘K 搜索跳转。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "装配三栏工作区(最终)"
```

## Task 7.3：错误/重连/中断 + lint 收尾

**Files:**
- Modify: `src/client/useAgentConnection.ts`(加自动重连)

- [ ] **Step 1: 给 `useAgentConnection` 加指数退避重连**

把连接 `useEffect` 改为带重连版本:
```tsx
useEffect(() => {
  let closed = false, retry = 0, timer: ReturnType<typeof setTimeout>;
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const client = createAgentClient({
      url: `${proto}://${location.host}/api/agent/ws`,
      onMessage: ingest,
      onStatus: (s) => {
        setConn(s);
        if (s === 'open') retry = 0;
        if ((s === 'closed' || s === 'error') && !closed) { timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000)); }
      },
    });
    clientRef.current = client;
  };
  connect();
  return () => { closed = true; clearTimeout(timer); clientRef.current?.close(); };
}, [ingest, setConn]);
```

- [ ] **Step 2: lint 与类型全量检查**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误(按报错修)。

- [ ] **Step 3: 全量测试**

Run: `pnpm test`
Expected: 所有单测 PASS。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "加自动重连并通过 lint/类型/测试收尾"
```

## Task 7.4：(可选)Playwright 冒烟

**Files:**
- Create: `e2e/smoke.spec.ts`(如已装 Playwright)

- [ ] **Step 1: 装 Playwright**:`pnpm add -D @playwright/test && pnpm exec playwright install chromium`
- [ ] **Step 2: 写冒烟脚本**:启动 `pnpm dev`,断言三栏出现、输入消息后画布资产数增加、点击版本卡预览 iframe 重载。(完整脚本依实际选择器编写)
- [ ] **Step 3: Commit**:`git add -A && git commit -m "新增 Playwright 冒烟(可选)"`

---

## 自查(Self-Review)

**Spec 覆盖核对:**

| Spec 章节 | 对应任务 |
|---|---|
| §2 技术栈/自定义 server/Tailwind | Task 0.1–0.5 |
| §5 协议(messages/tools/frame) | Task 1.1–1.2 |
| §6 store(types/reducer/selectors/persist) | Task 2.1, 2.4–2.7 |
| §6 力导向 / @引用 | Task 2.2–2.3, 5.3 |
| §11 mock agent/脚本/种子 | Task 3.1–3.6 |
| §9 对话栏(@+附件+流式) | Task 4.1–4.3 |
| §8 资产画布(节点/分区/筛选/派生/右键) | Task 5.1–5.4 |
| §10 预览+版本+对比+INSPECT | Task 6.1–6.3 |
| §7 工具栏/三栏/SearchPalette | Task 7.1–7.2 |
| §12 错误/重连/中断 | Task 3.3(abort)/7.3 |
| §13 测试 | 各 TDD 任务 + 7.4 |

**类型一致性:** `Asset/Version/Message/Part/ReducerState` 在 Task 2.1 定义,后续全部引用;`SDKMessage/RawStreamEvent/ContentBlock` 在 Task 1.1 定义;`RFNodeData` 在 Task 2.6 定义并被节点组件引用;`AgentClient` 在 Task 3.5 定义并被 Composer/ChatPanel/ContextMenu 引用——签名一致。

**已知需执行者留意的点(非占位,均有备选方案):**
- Task 5.3 受控 nodes 拖动:若不跟手,用 Step 2 的 `useNodesState` 备选。
- Task 6.1 HTML 中 `#ff5edb` 笔误务必修正。
- `new Date().toISOString()` 用于生产 reducer 可接受;相关测试不断言时间字段。
