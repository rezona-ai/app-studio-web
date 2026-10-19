# 移除资产画布：工作台改为「对话 | 预览」两栏（设计稿）

- 日期：2026-10-19
- 仓库：`app-studio-web`（快照自 `rezonalab-game-web` main `d082072a`）
- 分支（建议）：`feat/remove-asset-canvas`
- 方案：**方案一 —— 拆掉画布界面与生成入口，保留资产数据层**（2026-10-19 拍板）

## 1. 目的

本应用不再需要中间的多模态资产画布。工作台从「Chat | Canvas | Preview（overlay）」三栏改为「Chat | Preview」两栏：
游戏预览吃掉原画布的横向空间，对话驱动 agent 生成游戏的主链路不变。

**不做**：不动 store 里画布相关的 state / action（布局、撤销、分组、生成任务等），不动 PGC 后端契约，不动 i18n 词条——这些留给第二阶段（§8）。

## 2. 现状盘点

### 2.1 画布界面（整块移除）

- `src/components/canvas/**`：39 个源文件 + 37 个测试，约 6.9k 行源码 / 7.7k 行测试。含画布本体 `AssetCanvas`、节点、右键菜单、
  分组框、生成表单（`GenerateForm` / `GenerateFormHost` / `Derived3DForm`）、加卡菜单（`AddAssetMenu` / `EmptyStateChips`）、
  创意素材库（`CreativeLibraryModal` / `AssetLibraryButton`）、列表抽屉、搜索、灯箱、改名 / 文本编辑弹窗。
- 挂点只有一个：`src/components/workspace/Workspace.tsx`（`AssetCanvas` / `ContextMenu` / `GroupContextMenu` / `GenerateFormHost`
  及四个 dynamic 弹窗）。分享页、全屏页、`/share` 路由都不引用画布。

### 2.2 删画布后变成孤儿的模块（按 import 图传递闭包计算）

| 类别 | 文件 |
|---|---|
| client hooks | `useCanvasPaste` · `useAltBypass` · `useCanvasPolling` · `usePendingDeleteFlush` · `useFirstAppearance` · `useGenEstimate` |
| lib 纯逻辑 | `asset-actions` · `asset-time` · `bulk-actions` · `canvas-drop` · `canvas-keys` · `context-target` · `derive-band` · `derive-policy` · `derived-3d` · `gen-estimate` · `gen-prefill` · `gen-progress` · `loaded-media` · `nudge` · `offscreen` · `popover-anchor` · `rf-nodes` · `rig-animation` · `rig-viewer` · `zoom` · `pgc/voices` |
| Engine Bridge UI | `EngineBridgeButton` · `EngineBridgePanel` · `SendToMenu` · `TransferCapsule`（见 §5.3） |

合计（含 canvas 目录）约 8.9k 行源码，连同各自的同目录测试一并删除。

### 2.3 必须保留的资产数据层（对话在用）

画布之外仍读 `s.assets` 的地方：

| 消费方 | 用途 |
|---|---|
| `chat/MentionPopover` · `Composer` · `AttachmentBar` | `@` 提及资产、发送前把提及换成 token |
| `chat/MessageItem` · `AssetChip` | 消息里资产引用的回显 |
| `chat/ToolCard` | 3D 产物缩略图按同名资产 poster 反查 |

支撑它们的链路全部保留、行为不变：

- `loadCanvas`（启动 / `run.finished(succeeded)` 后刷新资产列表）；
- `importFromLiveEvent` / `importMediaFromEvent` 自动导入 agent 产物（`importedByProject` 去重，`card-layout` 给新卡落坐标——坐标虽已无人展示，但写回后端的契约不变，保留）；
- `uploadChatAttachment`（对话附件经 `uploadCanvasItem` 落为资产）；
- `ApkExportModal` 的 `uploadCanvasItem`（导出图标上传，与画布界面无关）。

## 3. 目标布局

```
┌────────────┬─┬──────────────────────────────────────────┐
│  ChatPanel │ │  PreviewPanel（flex-1，吃满剩余宽度）       │
│ 360–800 可拖│█│  账户条 / tab 行 / 舞台(7) / Versions(3)   │
│ 可一键收起  │ │                                          │
└────────────┴─┴──────────────────────────────────────────┘
          ↑ 唯一一条可拖分隔条 + 左侧 EdgeHandle（收起态常显）
```

- **Chat 列**：宽度拖拽、持久化（`workspace.chatWidth`）、一键收起（`workspace.chatCollapsed`）、收放 300ms 过渡、收起后 `inert`——**全部沿用**。
- **Preview 列**：从 absolute overlay 改为普通 flex 项 `min-w-0 flex-1`，不再有自己的宽度状态。
  - 预览侧分隔条、`spacer`、overlay 容器删除；`compare` / Files 不再需要「扩展覆盖画布」特判（它们本来就在预览列里）。
  - **全宽态退役**：`previewFull` 的语义是「把画布挤掉」，画布没了它就恒为真。删除 tab 行的全宽 / 恢复按钮、`workspace.previewFull` 与
    `workspace.previewWidth` 两个 localStorage key 的读写、「出现新版本自动全宽」effect、store 的 `previewFull` / `togglePreviewFull` / `setPreviewFull`
    （这三项虽在 store，但只服务布局，随本次一并删，不算 §1 的「不动 store」范围）。
- **页面最小宽** = `CHAT_WIDTH_MIN + PREVIEW_WIDTH_MIN + 1px`（收起态 = `PREVIEW_WIDTH_MIN`），更窄由外层横向滚动兜住（机制不变）。
- Chat 拖拽上限 = `min(CHAT_WIDTH_MAX, 视口 − PREVIEW_WIDTH_MIN − 1px)`。

### 3.1 16:9 失真（必须处理）

原先预览列宽被 `maxPreviewWidth` 按「舞台高 × 16/9」封顶，理由是 iframe 满幅铺舞台、超宽会横向拉伸游戏。两栏后预览列宽不再受控，
**改在舞台内信箱化**：`GameFrame` 内层框加 `max-width: calc(100cqh * 16 / 9)`（舞台已是 `container-type:size`），超出部分露舞台底色
`--color-canvas`，居中。竖向下限（原 `GAME_MIN_RATIO` 手机竖屏比例）不再需要——宽度下限由 `PREVIEW_WIDTH_MIN` 与 Chat 上限共同保证。
`CompareView` 已自带 `cqh` 约束，不改。

### 3.2 几何模块收敛

- `lib/preview-width.ts`：整个删除，唯一留用的 `PREVIEW_WIDTH_MIN`（账户条硬底）并入 `lib/sidebar-fit.ts`（实现时调整：只剩一个常量不值得单独成模块）；
  `CANVAS_WIDTH_MIN`、`maxPreviewWidth` / `minPreviewWidth` / `clampPreviewW` 及舞台高常量随之消失。
- `lib/sidebar-fit.ts`：`fitSidebars` 简化为只消解 Chat 宽（期望宽只读不改的不变式保留）；`minPageWidth` 按上式重写。两者单测同步改写。

### 3.3 跟随画布列定位的浮层

- `Toast`：原「横向居中于画布列」，改为居中于**预览列**（`leftInset = chatSpanW`，`rightInset = 0`）。
- `GenerateFormHost` 随画布删除，其 inset 透传一并消失。

## 4. 交互与文案

- `MentionPopover` 空态文案「No assets yet — generate some on the canvas to @mention them」改为不指向画布的表述：
  「No assets yet — files the agent generates or you attach will show up here」。（该处为硬编码英文，不涉及 i18n。）
- 用户失去的入口（**有意为之**，验收时逐条确认不存在）：双击画布生成、加卡菜单五类生成、上传资源、创意素材库、资产列表抽屉、
  画布搜索 / 筛选 / 对齐 / 整理、灯箱、改名、文本笔记、派生 3D、批量重试 / 删除、⌘Z 撤销画布操作。
- 资产来源只剩两条：agent 产物自动导入、对话附件上传。

## 5. 连带影响与决定

### 5.1 撤销 / 延迟删除

撤销条目与延迟删除只由画布操作产生。删掉画布后 `undo` 栈恒空、`pendingDeletes` 恒空：
`usePendingDeleteFlush` 删除；`Toast` 的「撤销」按钮代码保留（它订阅的是通用 `undoToken`），第二阶段随撤销栈一起清。

### 5.2 异步生成轮询

`useCanvasPolling` 只推进画布发起的视频 / 3D `GenTask`。生成入口没了就不会再产生任务，hook 删除。
**风险**：`genTasksByProject` / `inflightCardsByProject` 在 persist 白名单里。本应用与老应用若同源部署，用户浏览器里可能残留老应用的在飞任务，
删掉轮询后这些任务不会再推进（不会扣费、不会丢已完成产物——产物仍在后端，`loadCanvas` 能拉到）。新应用独立域名 / 新 persist key 时不存在此问题；
若同源，第二阶段改 persist key 时一并处理。

### 5.3 Engine Bridge（2026-10-19 拍板：随画布下线）

Engine Bridge 的全部界面——顶栏按钮、面板、卡片右键「发送至」、传输胶囊——**都长在画布里**，唯一例外是 Workspace 里的 `LnaExplainer`。
它的价值就是把画布资产送进本地引擎；画布没了，它没有入口也没有可发送的对象。

**决定：随画布一并下线**——删除上表四个组件与 Workspace 的 `LnaExplainer` 挂载；`store/bridge.ts`、`lib/engine-bridge/**`、
`NEXT_PUBLIC_ENGINE_BRIDGE` 构建参数与 `tests/deploy/engine-bridge-flag-contract.test.ts` 本阶段不动（flag 关闭即零影响，第二阶段清）。
若要保留 Bridge，需要另设计「从对话 / 资产引用发送」的入口，不在本稿范围。

### 5.4 夏令时守护（CI 连带）

`lib/asset-time.ts` 只服务画布的时间分段，随之删除；它的 `asset-time.dst.test.ts` 是 `pnpm test:tz` 的唯一对象，因此同步删除：
`package.json` 的 `test:tz` 脚本、`.github/workflows/ci.yml` 的 test:tz 步骤、`tests/ci-tz-contract.test.ts`。
不保留空壳脚本——CLAUDE.md 明确反对留 dead code。

## 6. 改动清单

| 动作 | 范围 |
|---|---|
| 删除 | `src/components/canvas/**`；§2.2 全部文件；`EngineBridge.test.tsx`、`PreviewPanel.bridge.test.tsx`（防「Bridge 入口回搬到预览栏」的守卫，Bridge 下线后无意义）、`store/preview-full.test.ts` 及上述各文件的同目录测试 |
| 改写 | `Workspace.tsx`（两栏布局，§3）；`PreviewPanel.tsx`（去全宽按钮）；`GameFrame.tsx`（16:9 信箱化，§3.1）；`lib/preview-width.ts` / `lib/sidebar-fit.ts`（§3.2）；`store/index.ts`（去 `previewFull` 三项）；`Toast` 调用点 inset；`MentionPopover` 文案 |
| 测试 | `Workspace.test.tsx`、`PreviewPanel.test.tsx`、`preview-width.test.ts`、`sidebar-fit.test.ts` 按新几何改写；新增 GameFrame 信箱化断言 |
| CI / 脚本 | 删 `test:tz` 脚本与 CI 步骤、`tests/ci-tz-contract.test.ts` |
| 文档 | `CLAUDE.md`：「画布与生成」整节标为已退役并指向本稿；「三栏壳」「两侧折叠把手」「预览全宽」「z-index」「test:tz」相关条目改为两栏口径 |

## 7. 验收

1. `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿；`grep -rn "components/canvas" src` 无结果。
2. 本地 `pnpm dev`：工作台只有对话与预览两栏；拖分隔条只改 Chat 宽；收起对话栏后预览吃满全宽、把手常显、再展开回到原宽。
3. 宽屏下游戏不被横向拉伸（两侧露舞台底色）；窄视口出现横向滚动而不是两栏互相覆盖。
4. 对话里 `@` 能列出 agent 产物与附件并正常发送；agent 新产物在 `run.finished` 后可被提及。
5. Files tab、对比模式、版本切换、分享 / 导出菜单行为不变。
6. 刷新后 Chat 宽度与收起态保持；旧的 `workspace.previewWidth` / `workspace.previewFull` 残值不影响布局。

## 8. 第二阶段（另起任务，本稿不做）

- store 清理：`selectedIds` / `contextMenu` / `groupMenu` / `addMenu` / `lightbox` / `genForm` / `derived3dForm` / `libraryOpen` / `canvasTool` /
  `align*` / `canvasQuery` / `list*` / `hoverAssetId` / `visibleKinds` 等 UI 态；生成、整理、分组、撤销、延迟删除等 action（`store/actions.ts` 3.1k 行中的相当部分）；
  persist 白名单与 key 版本。
- `store/bridge.ts`、`lib/engine-bridge/**` 与 Bridge 构建参数 / 契约测试（若 §5.3 维持下线）。
- i18n：只服务画布的 `canvas.*` 词条（`canvas.assetKind.*`、`canvas.play` 等仍被对话 / ui 引用，需逐条甄别），11 个语言同步。
- `lib/card-layout.ts`：若确认坐标不再有任何展示端，可简化自动导入的落位计算（需同时确认后端是否依赖坐标）。
