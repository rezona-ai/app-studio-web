# AI 游戏生成平台 v2 — 设计文档

- 日期：2026-06-04
- 状态：待 Nick 审阅
- 作者：Claude（与 Nick 协作 brainstorming）

## 1. 定位与目标

偏**创作向**的 AI 游戏平台原型。用户用自然语言驱动一个 agent，在**多模态资产画布**（图像 / 视频 / 音频 / 3D / 文档）上生成、派生、组织素材，并打包为可在右侧预览 / 切换的**游戏版本**。三大交互支柱 + 顶部工具栏，视觉严格对齐参考图（Taluna · 调酒师模拟器）。

核心约束（已与 Nick 确认）：

- **全新轻量前端原型**，不复用 v1 代码、不引入 WebContainer / Monaco。
- 前端**不直接调 LLM**，只通过 **websocket** 与一个**可 mock 的后端 agent 服务**通信。
- 事件协议对齐 **Claude Agent SDK 消息流**（采用其消息协议的**忠实子集**，非重写 SDK 引擎——见 §5 与 §15 决策记录）。
- 资产**按区域隔离**：空间分区 + 类型筛选**并存**。

核心交互闭环：

```
对话(左) ──> WS / Agent-SDK 消息 ──> 状态 store ──> 资产画布(中) + 预览/版本(右)
                                           ^                              |
                                           └──── 右键派生 / 保存版本 / 切换 ┘
```

## 2. 技术栈与关键选型（含取舍）

| 模块 | 选型 | 说明 / 取舍 |
|---|---|---|
| 框架 | Next.js 16.2 + React 19.2 + TypeScript + pnpm | 当前稳定线（与 v1 同代） |
| WS 服务 | **自定义 `server.ts`**：Next programmatic API + `ws`，`noServer:true` 处理 `upgrade`，路径 `/api/agent/ws` | 代价：`pnpm dev` 改为 `tsx watch server.ts`，失去 `next dev` CLI 糖，但仍有 HMR |
| 事件协议 | **Claude Agent SDK 消息协议的忠实子集**（手写：system / assistant / user / result + `stream_event` 包原始流式事件） | 同构（浏览器 + Node）、零依赖、不被上游版本漂移牵动；保留未来无缝替换为真 SDK 后端的口子 |
| 画布 | `@xyflow/react` 12 | 每种资产类型一种自定义节点 |
| 力导向 | `d3-force`（斥力 + 碰撞 + 向心力 + zone bounding 约束）驱动节点坐标 | React Flow 无内置力布局，d3-force 最轻 |
| 状态 | `zustand` 5（单 store + `persist`） | 单向数据流，reducer 唯一落库入口 |
| 三栏 | `react-resizable-panels` | 可拖拽、可折叠、有最小宽度 |
| 样式 | **Tailwind CSS v4 + CSS 变量设计 token** | 快速复刻参考图；实现期交 frontend-design skill 打磨 |
| 工具 | `nanoid`（id）、`vitest` + `@testing-library/react`（测试） | — |

> **内置 demo 游戏**：`public/games/nightcap/` 下的**自包含 HTML5 Canvas** 文件（NIGHTCAP 调酒师）。预览 iframe 加载之；版本切换通过 query / `postMessage` 切换标题 / 配色以体现差异。**不跑 WebContainer。**

## 3. 架构总览（单向数据流）

```
Composer(文本 + @引用 + 附件)
  → WS 上行 user_input envelope { sessionId, text, refs[], attachments[], baseVersionId }
  → server/agent(mock)：intent 匹配 → 选脚本 → 产出 SDKMessage 流
       system(init)
       → assistant(stream_event: 文本 / 思考 / tool_use 增量)
       → user(tool_result)
       → … → result(success, usage)
  → client/ws-client：解析帧 → 装配 stream_event → AsyncIterable<SDKMessage>
  → store/apply-message：(state, msg) => state'      ← 唯一落库入口
  → 反应式驱动 三栏 渲染
画布右键派生 / 版本「保存」/「切换」→ 本地动作或再发起一轮，同样汇入 store
```

**单向不可绕过**：所有外部输入（WS 事件、画布操作、版本切换、附件上传）最终都汇入单一 store；UI 各栏只是 store 的订阅者。

## 4. 目录结构与模块边界

```
game-create-platform/
├── server.ts                       # 自定义入口：Next + ws（开发用 tsx watch）
├── public/games/nightcap/          # 内置 demo 游戏（自包含 HTML5 Canvas）
├── docs/superpowers/{specs,plans}/
├── src/
│   ├── agent-protocol/             # ① 协议层（前后端共享，纯类型 / 编解码）
│   │   ├── messages.ts             #   SDKMessage 忠实子集 + 原始 stream 事件类型
│   │   ├── tools.ts                #   generate_assets / derive_variants / build_version schema
│   │   └── frame.ts                #   WS 帧编解码（逐行 JSON）
│   ├── server/                     # ② 后端 agent 运行时（不知道 UI）
│   │   ├── ws.ts                   #   WebSocketServer 接线（upgrade / 连接 / 中断）
│   │   ├── agent.ts                #   user_input → SDKMessage 流（异步生成器）
│   │   ├── scripts.ts              #   意图 → 脚本（对齐参考图剧情）+ 种子资产
│   │   └── intent.ts               #   关键词意图匹配
│   ├── client/
│   │   └── ws-client.ts            #   浏览器 WebSocket → 装配 → AsyncIterable<SDKMessage>
│   ├── store/
│   │   ├── types.ts                #   Asset / Edge / Version / Message / ...
│   │   ├── apply-message.ts        #   SDKMessage → store（纯函数 reducer）
│   │   ├── selectors.ts            #   画布 nodes/edges、active version 派生
│   │   └── index.ts                #   create + persist 中间件
│   ├── lib/{force-layout,ids,refs}.ts
│   ├── components/                 # ⑤ UI（'use client'）
│   │   ├── workspace/{Workspace,Toolbar,SearchPalette}.tsx
│   │   ├── chat/{ChatPanel,MessageItem,ThinkingBlock,ToolCard,Composer,MentionPopover,AttachmentBar}.tsx
│   │   ├── canvas/{AssetCanvas,ZoneLayer,nodeTypes,ContextMenu}.tsx
│   │   │   └── nodes/{ImageNode,VideoNode,AudioNode,ThreeDNode,DocNode}.tsx
│   │   └── preview/{PreviewPanel,GameFrame,DeviceToggle,VersionTimeline,CompareView}.tsx
│   └── app/{layout.tsx,page.tsx('use client' 直接渲染 Workspace;React Flow 的 SSR 由 AssetCanvas 内 mounted-guard 处理,未用 dynamic ssr:false),globals.css}
├── next.config.ts                  # 头部配置（如需）
├── tailwind 配置（v4：CSS-first，globals.css 内 @theme）
├── vitest.config.ts
└── package.json
```

每个单元职责单一、通过明确接口通信、可独立测试：协议层纯类型无业务；server 不知 UI；store reducer 是纯函数；UI 只订阅 / 写 store。

## 5. WebSocket + Claude Agent SDK 事件协议（忠实子集）

**上行**（client → server，`frame.ts` 编码为逐行 JSON）：

```ts
type ClientFrame =
  | { kind: 'user_input'; sessionId: string; text: string;
      refs: string[];                                   // @引用的 assetKey 列表
      attachments: { name: string; mime: string; dataUrl: string }[];
      baseVersionId: string | null }
  | { kind: 'abort'; sessionId: string };
```

**下行**（server → client）：`SDKMessage` 帧，忠实子集（字段对齐 Claude Agent SDK）：

```ts
type SDKMessage =
  | { type: 'system'; subtype: 'init'; session_id; model; tools: string[] }
  | { type: 'stream_event'; session_id; parent_tool_use_id: string | null; event: RawStreamEvent }
  | { type: 'assistant'; session_id; parent_tool_use_id: string | null; message: AssistantMessage }
  | { type: 'user'; session_id; parent_tool_use_id: string | null; message: UserToolResultMessage }
  | { type: 'result'; subtype: 'success' | 'error_max_turns' | 'error_during_execution';
      session_id; duration_ms; is_error; num_turns; result?: string; usage; total_cost_usd };

// 原始流式事件（镜像 Anthropic messages.stream）
type RawStreamEvent =
  | { type: 'message_start'; message }
  | { type: 'content_block_start'; index; content_block: { type:'text' } | { type:'thinking' } | { type:'tool_use'; id; name } }
  | { type: 'content_block_delta'; index; delta: { type:'text_delta'; text } | { type:'thinking_delta'; thinking } | { type:'input_json_delta'; partial_json } }
  | { type: 'content_block_stop'; index }
  | { type: 'message_delta'; delta } | { type: 'message_stop' };
```

- **流式渲染**：`stream_event` 逐 token 驱动对话栏（text/thinking 增量）与工具卡片（`input_json_delta` 累积拼接）。
- **落库**：客户端把 `stream_event` 装配成完整 `assistant` 消息（含 `tool_use` 块），reducer 据完整 `tool_use` 翻译为资产 / 版本变更。
- **中断**：client 发 `abort` → server 停脚本定时器 → 发 `result(error_during_execution)`。
- 一致性测试：`mockEmitter` 产出的帧 `satisfies SDKMessage`（§5 决策记录见 §15.1）。

**领域工具**（`tools.ts`，mock agent 通过 `tool_use` 调用，驱动画布 / 预览）：

```ts
generate_assets  : { items: { key; label; kind: AssetKind; prompt }[] }      // 独立资产
derive_variants  : { parentKey; count; instruction }                          // 派生变体（连血缘线）
build_version    : { label; summary; includeAssetKeys?: string[] }            // 打包版本快照
```

## 6. 状态模型（store）

```ts
type AssetKind   = 'image' | 'video' | 'audio' | '3d' | 'doc';
type AssetSource = 'generated' | 'derived' | 'uploaded' | 'reference';
type Status      = 'pending' | 'generating' | 'ready' | 'error';

interface Asset {
  id: string; key: string; label: string;
  kind: AssetKind; source: AssetSource;
  parentId?: string;                 // 派生血缘（→ 边）
  status: Status;
  position: { x: number; y: number };
  pinned: boolean;                   // 用户手动拖过 → 退出力模拟
  preview?: { color?: string; title?: string; src?: string; dataUrl?: string; duration?: string };
  prompt?: string;
}
interface Version {
  id: string; index: number; label: string; summary: string;
  createdAt: string; current: boolean;
  assetKeys: string[];               // 该版本引用的资产集
  game: { title: string; palette: string };  // 驱动 demo 预览差异
}
type Part =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; argsText: string; status: Status; result?: string };
interface Message {
  id: string; role: 'user' | 'assistant'; parts: Part[]; status: Status;
  refs?: string[]; attachments?: { name: string; mime: string }[];
}
```

**Slices**：

- `chat`：`messages: Message[]`；流式增量 append 到当前 assistant 消息。
- `connection`：`{ status:'connecting'|'open'|'closed'|'error', sessionId, runStatus:'idle'|'running'|'error' }`。
- `assets`：`assets: Asset[]`（派生 edges 由 `selectors` 从 `parentId` 派生）。
- `canvas`：UI 态——`selectedId`、`viewport`、`visibleKinds: Set<AssetKind>`（类型筛选）、`contextMenu`。
- `versions`：`{ list: Version[], activeVersionId, compare: { on: boolean, withId?: string } }`。
- `composer`：`{ draft: string, refs: string[], attachments: [...] }`。

**reducer（`apply-message.ts`，纯函数）**：

- `system(init)` → 置 sessionId / model；`runStatus='running'`。
- `stream_event` → 流式 append（文本 / 思考 / 工具参数增量）。
- `assistant`（完整）→ 解析 `tool_use`：
  - `generate_assets` → 新增独立资产（`source='generated'`，`status='generating'→'ready'`）；入 store 后由 `force-layout` 在其类型 zone 内分布。
  - `derive_variants` → 新增 N 个派生资产（`source='derived'`，`parentId=父`），锚定父节点旁、连虚线血缘。
  - `build_version` → 对当前资产集快照成新 `Version`，置 `current`、设 `activeVersionId`。
- `result` → `runStatus='idle'|'error'`。

**持久化**（persist）：只存 `chat.messages` + `assets` + `versions` + `composer` 草稿 + 画布布局（节点 position/pinned）；不存 `connection`（瞬态）。

## 7. 三栏 + 顶部工具栏

- **顶部工具栏**（≈56px，**预留可扩展**）：
  - 左：Logo「T」+「Taluna GAME AGENT」+ 面包屑「/ 当前游戏名称」+「● 已自动保存」徽章。
  - 中：搜索框「搜索资产、版本、对话…」（⌘K 唤起 `SearchPalette`，跨资产 / 版本 / 对话检索并跳转）。
  - 右：「↗ 分享」「▶ 试玩 V{n}」。
- **三栏**（`react-resizable-panels`，可拖拽 / 折叠 / 最小宽，各有列头）：左对话 ≈24% · 中画布 ≈46% · 右预览+版本 ≈30%。
- **视觉**：对齐参考图（浅色工作区 + 彩色资产卡 + 深色预览手机框）；设计 token 用 CSS 变量；实现期交 frontend-design 打磨。
- 响应式：窄屏画布列可折叠。

## 8. 资产画布（需求 #3 核心）

- **节点**：React Flow 自定义节点，每 `AssetKind` 一种卡片样式（对齐参考图缩略图：图像渐变缩略、视频带时长角标 + ▶、音频波形、文档纸张、3D 占位）。卡片底部显示 `label` + 类型徽章 + `status`（generating 转圈 / error 红边）。
- **分区（空间隔离）**：5 个类型 zone（图像 / 视频 / 音频 / 3D / 文档），每 zone 一块带浅色背景 + 标题的区域（`ZoneLayer` 画在 React Flow background 之上）；节点只在本类型 zone 内分布。
- **筛选**：顶部类型 chips（参考图那排「图像 / 视频 / 音频 / 3D / 文档」）既是图例又是显隐筛选——点击切换 `visibleKinds`，隐藏该类型 zone 与其节点。
- **布局**：
  - 独立生成资产 → 在本 zone 内 `d3-force`（`forceManyBody` 斥力 + `forceCollide` 碰撞 + `forceX/forceY` 向 zone 中心 + bounding 约束）均匀分布。
  - 派生资产 → 锚定在父节点附近，**虚线连父**（血缘）。
  - 用户拖动任意节点 → `pinned=true`（固定 `fx/fy`、退出力模拟）；仅未 pinned 的新节点参与下一轮 sim。
- **右键菜单**（`ContextMenu`，对齐参考图「重新生成 4 张」「在对话调整 / 画布重新生成」语义）：
  - **派生创作** → 弹输入 → 触发 `derive_variants`（生成 N 变体 + 自动连线，如 主角_v0 → v1..v4）。
  - **重新生成 N 张**（同派生的快捷）。
  - **作为 @ 引用** → 把该资产加入 Composer 的 refs chip。
  - **设为预览对象** / **重命名** / **删除**。
- 画布底部提示条：「⚡ 资产生成入口 · 选中资产『重新生成』即派生新变体」（对齐参考图）。

## 9. 对话栏（需求 #2）

- 列头「● AGENT · 对话」+ 折叠 chevron。
- **消息流**：YOU（用户）/ TALUNA AGENT（助手）。助手消息流式渲染：文本、可折叠**思考块**（`ThinkingBlock`）、**工具 / 资产进度卡片**（`ToolCard`，如「已派生 主角_v1/v2/v3/v4，血缘自动连线」）。用户消息内联显示 @ref chip 与附件名。
- **Composer**：
  - `@` 触发 `MentionPopover`：按类型分组列出画布资产，选中插入 ref chip（参考图「📦 asset · 调酒师_主角 ×」）；右键资产「作为 @ 引用」亦插入。
  - 「@ 提及」「📎 附件」按钮；附件上传 → chip（原型存 dataUrl，带大小校验）。
  - 「发送 ↵」→ 组装 `user_input` 经 WS 上行；运行中显「停止」（发 `abort`）。

## 10. 预览 + 版本时间线

- **预览头**：「▶ 预览 · V{n}　LIVE」+ 设备切换（移动 ▼ / 桌面）+「⊕ 保存为版本」+「↓ ZIP」（原型导出当前资产清单 JSON 占位）。
- **预览体**（`GameFrame`）：手机框 iframe 加载内置 NIGHTCAP 游戏。顶部 INSPECT MODE 横幅 +「在对话调整 / 画布重新生成」浮钮：点游戏内对象 →（在对话调整）该对象作为 @ 引用并聚焦 Composer /（画布重新生成）在画布选中对应资产。版本切换经 `postMessage` 把 `game.palette/title` 传入 iframe 体现差异。
- **版本时间线**（`VersionTimeline`）：版本卡（V1/V2/V3，标签 + 摘要 + 时间 + `CURRENT` 徽章 + 下载）；点卡切 `activeVersionId` → 预览重载（active 卡高亮）。
- **对比模式**（`CompareView`）：开启后选第二个版本，并排两预览。
- 「保存为版本」对当前资产集快照成新版本，append 到时间线并置 current。

## 11. Mock agent 脚本（对齐参考图剧情）

`intent.ts` 按关键词匹配意图，`scripts.ts` 选脚本逐步流式产出：

1. 「酒保模拟器 / 参考 / 角色场景」→ `generate_assets`：酒吧场景图、霓虹配色图、策划稿 doc、BGM audio、过场视频（伴随解说文本「已生成 3 张参考图、1 份策划稿、1 段 BGM、1 段过场动画…」）。
2. 「变体 / 派生」+ @主角 → `derive_variants`：4 张主角变体（v1..v4），血缘自动连线，解说「已派生 主角_v1/v2/v3/v4…是否打包？」。
3. 「打包 / 出一版」→ `build_version`：新版本，解说「V{n} 已生成，右侧时间线已更新」。
4. 兜底脚本：未命中关键词时给一段通用解说 + 视情况 `generate_assets`。

**初始种子**（`scripts.ts` 导出）：直接铺出参考图那套资产（酒吧场景 / 配色 / 策划稿 v1 / BGM / 主角_v0 + v1..v4 / 黄昏酒吧 / 过场动画）与 V1–V3 版本，使**打开即对齐截图**。

## 12. 错误处理与降级

- WS 断开 → `connection.status='closed'`，对话栏顶横幅「连接断开，重连中」+ 自动重连（指数退避）。
- `result(error_*)` → 当前 assistant 消息标错误气泡，`runStatus='error'`，可重发。
- 工具参数 JSON 解析失败（碎片坏）→ try/catch 守卫，转 run error，不崩溃。
- 附件 dataUrl 可能撑爆 localStorage 5MB → 单文件限额（≤ ~1MB）+ 超限不持久化（仅内存 + 提示），避免 quota 异常。
- 力布局：pinned 节点退出模拟；sim 收敛后冻结，避免持续抖动。

## 13. 测试策略（TDD，纯逻辑先行）

- **Vitest 单元**：
  - `frame` 编解码 roundtrip（分帧、逐行 JSON）。
  - `apply-message` reducer：各 SDKMessage → state（stream 装配、`tool_use` → 资产 / 版本、result）。
  - `force-layout`：zone bounding 约束、碰撞、pinned 退出、新节点入场。
  - `intent` 匹配、`refs` 解析（@ token → assetKey）。
  - `mockEmitter` 帧 `satisfies SDKMessage`（一致性）。
  - `selectors`：画布 nodes/edges、active version 派生。
- **组件（Testing Library）**：流式 / 思考折叠渲染、节点 status、Mention 选择、版本切换驱动预览。
- **集成**：Playwright（Chromium）冒烟为加分项（连接 → 生成资产 → 派生 → 保存版本 → 切换 → 对比）。

## 14. 里程碑（分阶段）

1. **脚手架 + 壳**：Next 工程 + 自定义 `server.ts`（Next + ws，WS 握手通）+ 三栏可拖拽布局 + 工具栏 + Tailwind v4 + 设计 token。
2. **协议层 + store**（TDD）：`messages/tools/frame`、`ws-client`、slices、`apply-message`、`persist`。
3. **server mock agent**：`ws/agent/scripts/intent` + 种子资产，跑通 Mock 全链路。
4. **对话栏**：Composer（@ 引用 + 附件）+ 流式消息 / 思考 / 工具卡渲染 + 连 store。
5. **资产画布**：自定义节点 + 分区 zone + 力导向 + 派生血缘 + 右键菜单 + 筛选 chips。
6. **预览 + 版本**：GameFrame（内置 demo）+ 设备切换 + 版本时间线 + 对比模式 + INSPECT 浮钮。
7. **打磨**：frontend-design 视觉对齐 + SearchPalette（⌘K）+ 错误 / 重连 / 中断 + 冒烟。

## 15. 关键决策记录

1. **不用官方 Agent SDK 运行时，只镜像其消息协议**：官方 `@anthropic-ai/claude-agent-sdk` 是真正驱动 agent 的 Node 引擎（会调模型 / 跑 agent loop），与本项目「mock 后端、不调 LLM」的约束相悖，且无脚本回放模式；我们只手写用到的 `SDKMessage` 忠实子集（system/assistant/user/result/stream_event），换取同构（浏览器 + Node）、零依赖、不被上游版本漂移牵动，并保留未来无缝替换为真 SDK 后端的线缆兼容。靠一致性测试（`satisfies`）防漂移。
2. **自定义 server 而非 in-browser mock**：需求 #2 强调「用 websocket」，故起真实 WS 服务以真实演示通信链路，后续接真 LLM 只改服务端。
3. **资产分区 + 筛选并存**：空间 zone 做类型隔离，顶部 chips 兼作图例与显隐筛选。
4. **预览用内置 demo + iframe，不跑 WebContainer**：契合「前端原型」定位，版本差异用 `postMessage` 传配色 / 标题体现。

## 16. 未来扩展（当前 YAGNI，不实现）

真实 LLM / 资产生成模型接入、多项目 / 历史侧栏、协作 / 服务端持久化、真实 ZIP 打包与游戏导出、可编辑流水线、3D 资产真实渲染、跨类型派生。
