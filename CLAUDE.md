# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Rezona Lab Game Agent（仓库 `rezonalab-game-web`，本地目录 `rezonalab-game-web`）——AI 游戏生成平台。工作台是「对话 | 预览」两栏：用户用自然语言驱动一个 agent 生成游戏，右侧预览 / 切换**游戏版本**；agent 产物与对话附件作为**资产**留在数据层，供对话里 `@` 提及。

> ⚠️ 本仓快照自 `rezonalab-game-web`，原中间栏的**多模态资产画布已于 2026-10-19 退役**（spec `docs/superpowers/specs/2026-10-19-remove-asset-canvas-design.md`）。旧 spec / plan 里涉及画布界面的内容一律作废，以本文件为准。

前端是 Next.js 16 + React 19，**不直接调 LLM**；agent 对话经 WebSocket 直连后端 **Koubou** 服务，资产 / 版本经 REST 走 **PGC** 服务。

> ⚠️ 最初设计稿 `docs/superpowers/specs/2026-06-04-ai-game-platform-v2-design.md` 描述的本地 mock agent 已不存在，以本文件与实际代码为准；后续单功能 plan/spec 多数仍准确。

## 常用命令

```bash
pnpm dev              # tsx watch server.ts —— 自定义服务器（端口 3000，含 HMR）
pnpm build            # next build
pnpm lint             # eslint
pnpm exec tsc --noEmit # 类型检查（CI 单独跑这一步）
pnpm test             # vitest run（一次性）
pnpm test:watch       # vitest 监听

# 跑单个测试文件 / 用例
pnpm exec vitest run src/koubou/apply-koubou.test.ts
pnpm exec vitest run -t "用例名片段"
```

- 运行环境：Node 22 + pnpm 11（`pnpm-workspace.yaml` 用了 `allowBuilds`，需 pnpm 10+）。
- 测试与源码**同目录**（`*.test.ts(x)`）；Vitest 用 jsdom + globals，`@` → `src` 别名，setup 见 `vitest.setup.ts`，排除 `.claude/worktrees/**`（worktree 内有独立 `node_modules`，不排会因 React 实例重复误报）。`eslint.config.mjs` 的 `ignores` 同样排它，改一处必须同步另一处。
- CI（`.github/workflows/ci.yml`，所有分支 + PR）：install → lint → tsc → test → build，纯检查不部署。
- 代码注释 / 计划 / commit message 一律用**中文**。

## 项目结构

分层原则：**协议层纯类型无业务 · `server/` 不知 UI · `store/` reducer 是纯函数 · UI 只订阅 / 写 store**。`@/*` 别名指向 `src/`。

- `server.ts`：Next 自定义入口（开发 tsx watch；生产 upgrade 仅给 HMR，本地开发额外分流 dev WS 代理）。
- `public/games/` 内置 demo 游戏；`public/figma/` 导出的设计 SVG/PNG；`deploy/` Docker / k8s / LB 接入；`docs/superpowers/{specs,plans}/` 各功能设计稿与实现计划（按日期命名）。
- `src/app/`：Next App Router（两个 catch-all 代理路由 + 媒体同源代理 + 防白闪 layout）。
- `src/koubou/`：① Koubou 协议层（前后端共享语义）——协议类型 / 纯函数 reducer / WS client。
- `src/server/`：② Next 服务端（代理 + cookie 鉴权透传，不知 UI）。
- `src/client/`：③ 浏览器副作用 hooks（连接 / 轮询 / 引导）。
- `src/store/`：④ 单一 zustand store（唯一落库入口，state + actions + selectors）。
- `src/lib/`：⑤ 纯逻辑 / 数据映射（无副作用，易测），含 `basePath.ts`（自身绝对路径必经）。
- `src/components/`：⑥ UI（'use client'：workspace / chat / canvas / preview / ui）。
- `src/types/`：全局类型声明。

测试与源码同目录(`*.test.ts(x)`),覆盖协议 reducer、store actions、lib 纯逻辑与关键组件。

## 架构：单向数据流

所有外部输入（Koubou WS 事件、PGC REST 结果、版本切换）最终都汇入**唯一的 zustand store**（`src/store/index.ts`）；UI 各栏只是 store 的订阅者，从不绕过 store 直接互通。

```
Composer ──user.message──▶ Koubou WS ──ServerEvent──▶ applyKoubou(reducer) ──▶ store(KoubouState)
                                                                                  │
PGC REST(loadCanvas/loadVersions) ──────────────────────────────────────────────┤
                                                                                  ▼
                                              ChatPanel(左) · PreviewPanel(右)
```

store 由四块合成（`AppStore = KoubouState & ServerState & UIState & Actions & ServerActions`）：

- **KoubouState**：对话切片。唯一写入口是 action `ingestKoubou` → 纯函数 reducer `applyKoubou`（`src/koubou/apply-koubou.ts`）。
- **ServerState**：项目 / 画布 / 版本 / 异步生成任务。由 **ServerActions**（`src/store/actions.ts`，闭包工厂 `createServerActions`）驱动 PGC REST。
- **UIState + Actions**：弹窗 / 选中 / 主题 / composer 等纯前端态。

`persist` 落 localStorage，key 是 **`rezonalab-v4`**（见下「易踩的坑」）。白名单见 `store/index.ts` 的 `partializeAppState`（会话快照、生成任务与在飞占位卡、导入去重 / 续跑队列、回放进度、模型记忆、composer 草稿、低余额锁等），瞬态（连接状态、live 流式增量）不落盘。persist `version` 现为 **3**：v3 迁移删掉画布退役后无读方的五个键（`visibleKinds` / `alignEnabled` / `listOpen` / `listWidth` / `viewportByProject`）；key 名刻意不换，理由见第二阶段计划 T3。

## 两套后端 + 代理链路

Koubou 与 PGC **同址**（`PGC_BASE_URL`），共用同一套 cookie 制鉴权（见下），但**信封格式不同**：

| | 浏览器 client | Next 代理路由 | 上游 | 成功信封 |
|---|---|---|---|---|
| PGC（项目/画布/版本） | `src/lib/pgc/client.ts` | `src/app/api/pgc/[...path]/route.ts` → `src/server/pgc/proxy.ts` | PGC REST | `{ success, code, message, data }` |
| Koubou（会话 HTTP） | `src/lib/koubou/client.ts` | `src/app/api/koubou/[...path]/route.ts` → `src/server/koubou/proxy.ts` | Koubou REST | `{ code, message, data }`，`code===0` 为成功 |
| Koubou（会话 WS） | `src/koubou/client.ts`（生产直连；本地开发经 dev WS 代理） | 仅本地开发：`server.ts` upgrade 分流 → `src/server/koubou/ws-proxy.ts` | Koubou WS | `ServerEvent` 帧 |

- **鉴权 = cookie 制（biz-api 统一鉴权）**：无服务账号、无服务自有 token。两个 `[...path]` catch-all 代理把浏览器的 `Cookie` 头**原样透传**给上游（pgc/koubou 据此转发 biz-api `/tln/biz/me` 自省当前用户）。透传逻辑见 `src/server/cookie.ts` 的 `resolveForwardCookie`：生产透传浏览器自带 cookie；**本地开发**浏览器在 `localhost` 拿不到 `.rezona.ai` cookie，故设 `DEV_COOKIE` env 注入 dev session cookie——**合并语义**：DEV_COOKIE 键优先，浏览器其余 cookie（含 LB 亲和 cookie）追加转发。配套 `src/server/dev-set-cookie.ts`：本地开发把上游 `Set-Cookie` 重写（去 Domain/Secure、None→Lax）回传浏览器，LB 会话亲和 cookie 落地 localhost 形成闭环（设计稿 `2026-07-24-dev-ws-proxy-affinity`）。浏览器侧 `/api/*` fetch 均带 `credentials:'include'`。
- `src/app/api/pgc/asset/route.ts`：媒体（如 GLB）的 SSR 安全代理，目标强制限定 `PGC_BASE_URL` 同源以防 SSRF。
- WebSocket **生产**不过 Next 代理：`createKoubouClient` 直连由 `NEXT_PUBLIC_PGC_BASE_URL` 派生的 `wss://`（`https→wss`，见 `src/koubou/wsBase.ts`）。**本地开发**（dev 构建且未设 `NEXT_PUBLIC_KOUBOU_BASE_URL`）改连本服务 `ws://localhost:3000/dev-ws/koubou/*`，由 `server.ts` upgrade 分流到 `src/server/koubou/ws-proxy.ts` 转发上游——同源 upgrade 自动携带亲和 cookie，服务端转发不受 SameSite 约束，打通 LB 会话亲和；关闭码/reason 双向透传保 `classifyClose` 语义。鉴权用 ws-ticket（`POST /api/koubou/auth/ws-ticket` 现签），断线指数退避重连，关闭码语义见 `protocol.ts` 的 `classifyClose`（4401 重签 / 4404 改新建 / 4000 被顶替不重连 / 4400·4403 致命）。每条客户端命令建帧时一次性分配 `event_id` 幂等键，socket open 前发出的命令按序积压、open 后冲刷（重连用原 ID 重发，后端按 `event_id` 去重）——为后端多副本（命令落非属主 Pod）提前铺垫。

`server.ts` 是 Next 自定义入口：生产把 `upgrade` 全量交给 Next（仅 HMR 用）；本地开发额外分流 `/dev-ws/koubou/*` 到 dev WS 代理，**对话 WS 逻辑仍在后端，本地只做转发**。

## Koubou 协议与历史重建（`src/koubou/protocol.ts` + `apply-koubou.ts`）

事件协议是 **Claude Agent SDK / Anthropic 消息流的忠实子集**。关键点：

- 服务端帧 `ServerEvent { type, session_id, payload, sequence, run_id }`。`type` 含 `session.ready` / `run.started|finished|interrupted` / `claude.message` / `tool.approval.requested` / `ask_user_question.requested` / `error`。
- `claude.message.payload.sdk_type` 区分 `AssistantMessage` / `UserMessage` / `SystemMessage` / `ResultMessage` / `StreamEvent`。流式渲染靠 `StreamEvent`（`message_start` → `content_block_start/delta/stop`）逐 token 追加到尾部 `generating` 草稿消息；完整 `AssistantMessage` 到达时落定。
- **消息身份用 `uuid` 优先**（并行 tool_use 时同一 API 消息按 block 拆成多条事件，`message_id` 相同而 `uuid` 各异，按 `message_id` 收编会互相覆盖丢 part）。
- **`sequence` 去重**：重连重放 + ready 可能重复下发，`seenSequences` 按 sequence 去重；只在 `sequence != null` 的可重放检查点持久化会话快照（保证 `lastSequence ↔ messages` 一致）。
- **冷启动历史**：`session.ready.payload.visible_state.messages` 是**与 live 同构的可重放事件日志**（不是已消化的视图）。本地无缓存时由 `rebuildHistory` 重建——用户文本只在 `user.message` 信封里，`UserMessage` 多为 `tool_result`（折叠进对应 `tool_use` part，见 `foldResults`）。
- 文件修改 diff 走文档约定的 **snake_case** 字段 `tool_use_result`，由 `parseFileDiff` 归一成 `FileDiff` 挂到 tool part（`DiffView` 渲染）。
- 多会话：按项目存 `koubouByProject`；切项目时 `useKoubouConnection` 据 `currentProjectId` 变化换连接，`switchProjectSession` 载入目标项目快照。本地无 sessionId 时 `resolveSession` 查后端最近一条，避免新建丢历史。

## 资产数据层（画布已退役）

画布界面、生成入口与 Engine Bridge 已于 2026-10-19 整体移除（spec `2026-10-19-remove-asset-canvas-design.md`；计划 `2026-10-19-remove-asset-canvas.md` 与第二阶段 `…-phase2.md`）。**保留的只有资产数据层**，因为对话在用：

- 消费方：`chat/MentionPopover` · `Composer` · `AttachmentBar`（`@` 提及）、`MessageItem` · `AssetChip`（引用回显）、`ToolCard`（3D 缩略图按同名资产 poster 反查）。
- 来源：agent 产物自动导入（`importFromLiveEvent` / `importMediaFromEvent`，`importedByProject` 去重，经 `/canvas/items/import` 服务端拉 `preview_url` 落库）、agent 异步生成任务（`registerAgentGenTask` 落占位卡 + `pollGenTasks` 推进，`restoreGenTasks` 刷新后按持久化任务 / item 前缀接回）、对话附件上传（`uploadChatAttachment` → `uploadCanvasItem`）、压缩包导入（`importProjectArchive` / `resumeImportQueue`）。`run.finished(succeeded)` 后 `loadCanvas` 刷新（以 PGC 为准）。
- **轮询 hook `client/useAssetPolling`**（挂在 `Workspace`）同时推进 agent 生成任务与构建中的版本（`status:'building'`）。它原名 `useCanvasPolling`，第一阶段被误当作画布专属删掉过——版本卡在 building、agent 产物的终态余额刷新 / 充值引导 / 失败提示全部丢失。**删它之前先想清楚这两条链路**。
- 落库时仍用 `src/lib/card-layout.ts` 给资产算坐标并随 `reference` 写回——与旧数据同一口径，**不得**让轮询 / 重连覆盖已有 `position`。
- 第二阶段清理已完成（2026-10-19，计划 `docs/superpowers/plans/2026-10-19-remove-asset-canvas-phase2.md`）：画布专属 UI 态与 action（生成 / 整理 / 分组 / 撤销 / 延迟删除 / 坐标批量回写 / 视口）、`store/bridge.ts`、`lib/engine-bridge/**`、`NEXT_PUBLIC_ENGINE_BRIDGE` 构建参数与两条 Bridge 部署契约测试、只服务画布 / Bridge / 素材库的 i18n 词条均已删除；`Toast` 不再有行内动作按钮（撤销 / 打开 Bridge）。i18n 的 `canvas` 命名空间只剩对话与 ui 仍在用的 `assetKind.*` / `play` / `pause` / `gizmo.viewFrom` / `inspector.copied`，新词条别再往这个命名空间加。
- 未做（另起任务）：`lib/card-layout.ts` 落位简化（需先确认后端是否依赖坐标）；`lib/pgc/client.ts` 里已无调用方的画布端点（生成 / 分组 / 改名 / 素材库等）；`globals.css` 里 `.react-flow*` / `.canvas-*` 等画布样式；`figAsset` 里十余个只服务画布工具条的图标。

## UI/UX 范式（新增 UI 必须遵守）

所有视觉 / 交互令牌集中在 **`src/app/globals.css`**，动效统一语汇见 `docs/superpowers/specs/2026-06-19-workspace-motion-design.md`。**新增任何 UI 元素都复用既有令牌 / 基础组件 / 动效类**——不引入硬编码色值、一次性 keyframes、新的按钮种类或独立 toast。下面每条都是约束，不是建议。

### 设计令牌（全在 `globals.css`，禁止硬编码）

- **颜色一律走 CSS 变量**（`@theme` 定义 + `[data-theme="dark"]` 覆盖），写 `bg-[var(--color-surface)]`，**禁止** `bg-gray-100` / `#fff` / 字面色值。语义层：文字 `--color-ink` / `--color-muted`；面 `--color-surface`（面板）· `--color-surface-2`（画布底 / Chat 浮面）· `--color-fill`（hover / 输入底）· `--color-canvas`（画布中心）· `--color-pop`（浮层，深色稿单独压暗）；描边 `--color-line`（主）/ `--color-line-2`（次）；强调色 = 品牌橙 `--color-primary`（#F97316，**恒定不随主题翻**，即设计稿 `primary/main`；选中/进度/高亮一律用它，柔光/底纹用 `--color-primary-soft`，其上文字用 `--color-on-primary`）；旧蓝 `--color-accent` 与旧青令牌名 `--color-teal` 均已全量迁移删除，勿再引入 —— ⚠️ 从 taluna 仓迁入的画布线原本整条用 `--color-teal`，已按 `teal→primary` / `teal-soft→primary-soft` / `on-teal→on-primary` 全量映射；**这类漏网不会报错**（CSS 未定义变量静默失色，tsc / 测试全绿），从旧仓搬代码时务必 `grep -rn -- "color-teal" src` 兜一道；`--color-live`；资产类型色 `--color-{image,video,audio,3d,doc}`。
- **主题靠变量自动适配**：仅 `[data-theme="dark"]` 覆盖语义变量，组件**不写主题分支**。唯一例外是 `.btn-raised` / `.btn-raised-active`（恒浅色 CTA，深色稿仍浅），其文字 / 图标用固定深色，**不可**用会翻转的 `--color-ink`。
- **圆角**：控件 `--radius-control`（8px）/ 卡片 `--radius-card`（12px）；实际分层用 `rounded-[16px]`（版本卡等大块面板）、`rounded-[24px]`（模态）、`rounded-[10px]`（按钮 / chip）——沿用对应层级的既有值，勿随意新增档位。
- **阴影**：复用 7 套预设 `--shadow-{toolbar,prompt,pill,btn,shortcut,popover,card}`（与 Figma effect 精确对齐），勿手写 `box-shadow`。
- **字体 / 字号**：正文 `--font-sans`（Inter）· 等宽数字 `--font-mono`（IBM Plex Mono）· 字标 / 大标题用 `.font-display`（Sekuya，仅 weight 400，不可合成加粗）。字号用精确 px（`text-[14px]`）对齐设计稿，不用 Tailwind 默认档（`text-base` 等）。

### 基础组件（先复用，勿造新种类）

- **图标一律 `FigIcon`**（`src/components/ui/figma.tsx`）：`src` 取自 `figAsset` 注册表（新图标先放 `public/figma/icons/` 再登记），`size` 默认 20，`tone` 默认按 `ICON_TONE` 解析——`primary`（随 currentColor 翻转）/ `secondary`（恒 `--color-muted` 灰）/ `original`（保留原配色，如 pencil / trash / logo）；`flipX` 用于镜像。primary/secondary 经 CSS mask 重着色以适配主题，**不直接 `<img>`**。
- **按钮**：主 CTA 用 `Button`（恒 `.btn-raised`）；图标 / 次级动作用 `IconButton`，variant `ghost`（默认）/ `bordered` / `raised` / `raised-active`，提交态用 `submitVariant(active, dark)` 选主题感知填充。**不新建按钮组件、不自写按钮样式。**
- **通知**：全局唯一 `Toast` 订阅 store 的 `lastError`，经 action `setError({ code, message, kind })` 触发、4s 自动消失。**不自造 toast。**
- **其他现成件优先复用**：`Segmented`（分段选择）· `Select`（0/1/多选自适应下拉）· `Badge`（状态胶囊）· `Tooltip` · `LoadingScreen`（骨架微光 + spinner）。
- **无障碍**：所有交互元素配 `aria-label` 或包 `Tooltip`。

### 交互动效（统一语汇，禁止一次性 keyframes）

- **复用 `globals.css` 末尾的动画类**：弹层 / 菜单 / Tooltip → `.anim-pop-in`（150ms，配 `origin-*` 从触发点缩放）；模态 → `.modal-pop` + 遮罩 `.modal-backdrop`（240ms 进 / 160ms 出，靠 `data-closing` 切退场）；Toast → `.toast-pop`；通用淡入淡出 → `.anim-media-in` / `.anim-fade-out`（200ms）；折叠展开 → `.anim-collapse-in`（180ms）。
- **缓动**：进场统一 `cubic-bezier(0.22, 1, 0.36, 1)`，退场用 `ease-in` 且更短。
- **退场不直接卸载**：用 `useExitTransition` / `useRequestClose` 先播退场再卸载（开 → `closing` → 延时卸载）。
- **反馈克制**：hover 仅轻微上浮（1–4px）或 `hover:bg-[var(--color-fill)]`；选中态走「描边转 accent + 外晕」；聚焦走 `.composer-card` / 搜索栏的「边框转 accent + 柔光环」。位移 / 缩放反馈加 `motion-safe:` 前缀（参考 `IconButton` 的 `motion-safe:active:scale-[0.92]`）。
- **降低动态必做**：任何新动画都要在 `@media (prefers-reduced-motion: reduce)` 内禁用或退化；新增 `.anim-*` 类记得补进 `globals.css` 该媒体查询的禁用列表。

### 浮层与布局

- **两栏壳**（`Workspace.tsx`）：Chat（可拖拽 360–800px，宽度持久化，可一键收起）| Preview（`flex-1 min-w-0`，吃满剩余宽度，下限 `PREVIEW_WIDTH_MIN` 330 保账户条）。几何在 `src/lib/sidebar-fit.ts`（`fitChatWidth` / `minPageWidth`）。固定桌面布局，无移动端断点。
- **游戏 16:9 上限在舞台内**：`GameFrame` 内层框 `max-w-[calc(100cqh*16/9)]`，超宽两侧露舞台底色。**不要**再靠限制预览列宽防拉伸（三栏时代的 `maxPreviewWidth` 已删）。
- **对话栏折叠把手**：`Workspace.tsx` 的 `EdgeHandle`（只剩 Chat 一侧在用），几何（24×132 圆角梯形 + 左右两版镜像 `clipPath`）在 `src/lib/edge-handle.ts`，镜像关系由单测守护。默认 hover 才浮现——**Chat 收起态与 Files / 对比时必须常显**（收起后没有 Chat 列可 hover；Files / 对比时那 24px 压在面板左缘，隐形会变误触）。
- **把手命中范围**：定位容器 `pointer-events-none` 只摆位，可命中的只有 `clipPath` 裁出的本体，且整块落在 Chat 边缘的**预览侧**——热区骑缝会吃掉 ChatPanel 消息区的滚动轨（已踩）。
- **把手的抬升走 `--elev-edge-handle`**（挂在定位容器上）：`clipPath` 元素的 `box-shadow` / `border` 会被裁剪一并裁掉（阴影落在裁剪区外、边框不沿曲边走），**只能用 `filter: drop-shadow()`**。挂容器而非按钮，静态轮廓与液体形变轮廓因此共用一份、投影自动跟着曲边走。底色 `--color-pop` 与面板底相近，不抬起来在「对话栏收起后贴视口左缘」时几乎看不见。
- **预览没有宽度状态**：两栏后预览恒吃满剩余宽度，三栏时代的「预览全宽」按钮、`previewFull` 状态与 `workspace.previewWidth` / `workspace.previewFull` 两个 key 都已删除（用户浏览器里的残值无害，不读）。Chat 的期望宽只读不改：碰撞消解只改实际宽，窗口放大后回到用户拖出的宽度。
- **对话栏收起**：Chat 列与其 1px 分隔条**始终渲染、宽度过渡到 0**（300ms ease-in-out；把手位置同步平移）——**不是不渲染**，不渲染就没有过渡；内层恒以 `chatW` 布局，ChatPanel 从不经历 0 宽，滚动位置与排版都不受收放影响，收起后整块 `inert`。凡横向几何（最小页宽 / 浮层 inset）都读收起态或 `chatSpanW`，别直接读 `chatW`。
- **浮层统一外观**：`bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]`；菜单 / Tooltip 从触发点定位并夹取进视口（留 8–12px 边距）。
- **菜单 / Tooltip 坑点**（提交记录已踩，勿重蹈）：遮罩用 `onWheel` 即关闭以放行底层滚动；`Tooltip` 包 absolute 触发元素必传 `transparent`（`display:contents`）避免幽灵 strut 撑高卡片。
- **z-index 阶梯**（沿用，勿插新值）：Tooltip / Toast `z-[100]` > 拖拽遮罩 / 全局 loading `z-50` > 浮动菜单 `z-[56]` / 其遮罩 `z-[55]` > Modal 遮罩 `z-40` > 分隔条 / 对话栏把手 `z-30`。
- **滚动**：重点滚动区用 `.scrollbar-auto`（hover 才显条），限高隐藏用 `.scrollbar-none`；flex 容器配 `min-h-0` / `min-w-0` 防内容撑破。

## 部署与 basePath（易踩的坑）

- **basePath**：构建期注入 `NEXT_PUBLIC_BASE_PATH=/game` 时整个应用跑在 `/game/*` 前缀下（部署在共享 HTTPS LB 后）。本地开发不设 → 根路径。
  - **浏览器端绝对路径不会被 Next 自动加前缀**（只有 `<Link>`/`next/image`/router 会）。凡 `fetch` / `WebSocket` / `<img src>` 指向本服务自己的 `/api/...` 或 `public/`，**必须**经 `src/lib/basePath.ts` 的 `apiPath()` / `assetPath()` 包一层，否则部署时会命中 LB 的 `/api/*` 规则被路由到别的后端。
- **localStorage key**：`persist` 用 `rezonalab-v4`（应用自有）；`src/app/layout.tsx` 防白闪内联脚本读的是**主站契约 key `rezonalab-config`**（JSON，含 `theme` / `lang`，水合前同步设 `data-theme`），同名字符串也是主站 postMessage 帧的 `type`。⚠️ 该 key 于 2026-07-31 品牌换名时由 `taluna-config` **硬改**（不留兼容读），**主站侧必须同步改成同一个 key**，否则刷新后主题回落默认 dark、主站切语言不再传递（见 `docs/superpowers/specs/2026-07-31-rezonalab-rebrand-design.md`）。另一个 key `rezonalab-agent-backend`（`?agent=cc|codex` 调试开关）**不是**跨应用契约——由本应用自己写自己读（`src/lib/agent-backend.ts` + `src/client/useAgentBackend.ts`），改名无需外部协调。
- **部署**：GKE Autopilot + Docker（运行层 `tsx server.ts`，保留完整 `node_modules`，**不能走 Next standalone** 因为带自定义服务器）。注意本服务 backend-service 上的 `timeoutSec=3600` **保护的不是 agent 对话 WS**——生产对话 WS 由浏览器直连 `wss://<host>/game/koubou`，按最长前缀落 **koubou 自己的 backend-service**，不经本服务（`server.ts` 生产分支只把 upgrade 交给 Next 作 HMR）；对话断连要查 koubou 的 backend。推 **dev** 触发叠合（`deploy_dev_pr.yml` 合成 `test` 后部署 develop；`deploy_dev.yml` 只剩手动旁路）；stage 手动 dispatch 默认 `main`；生产手动 dispatch，ref **无默认必填且只接受 `release/*`**（`_deploy.yml` 的 `Validate deploy source` 三环境各自钉死），**不**绑定 tag 自动触发。细节见 `deploy/README.md`。
- **Rezona Lab 栈（本仓库唯一部署目标）**：域名 `devlab/stalab/lab.rezona.ai`，namespace `rezonalab-game-{dev,stage,prod}`（与 pgc `rezonalab-game-server`、koubou **共用**同一 ns），镜像仓 `rezonalab-game-repo`。部署工作流的 `namespace` 是必填 input，**不得回退成 taluna 的 `develop`**（会顶掉老栈线上 Deployment）。dev 已上线实测记录、资源名清单与 LB 路由表见 `docs/deploy/rezonalab-dev-bringup.md`。
- **部署目标是运维变量，不是代码常量（2026-09-08 起）**：公司在把资源从官方渠道的计费账号迁到代理渠道的 GCP 项目 `gtxy-rzn-infra`，共存期（周维度）两个计算层都要部。目标由仓库变量 **`WEB_DEPLOY_TARGETS`**（逗号分隔）驱动：未配 / `rezonaai` = 迁移前的单目标行为（**缺省，零变化**）· `rezonaai,gtxy-rzn-infra` = 共存期两边都部 · `gtxy-rzn-infra` = 切换完成。**改变量即改目标，秒级、不动代码、不开 PR**，退回来就是把 `rezonaai` 加回去。拓扑（project / 集群 / 镜像仓）的唯一真相源是 `deploy/render_env.sh`，目标解析在 `deploy/deploy_targets.sh`，两者都被 `tests/deploy/gtxy-target-contract.test.ts` 钉住。🔴 **新项目那条腿的部署凭据在 GH Environment `<env>-gtxy` 作用域里**（`develop-gtxy` 等），不是仓库级——放仓库级会一把 key 喂三个环境。🔴 **`_deploy.yml` 顶层 env 块里绝不能再出现 `PROJECT_ID` / `CLUSTER_NAME` / `REPOSITORY_NAME`**：job 级 env 会静态固定它们，于是新项目那条腿静默部到老项目上且**全绿**——最坏的一类故障。🔴 控制面脚本经 `.control-plane` 二次 checkout 取自 **`github.sha`**（workflow 自己的版本），不是被部署的 ref：develop 部的是合成的 `test` 分支、prod 部 `release/*`、回滚部更老的 SHA，那些 ref 上可能没有这个脚本或者是旧版。
- **分支拓扑（四条线，2026-08-27 定）**：`dev` 自由演进（本地 `--no-ff` 合特性分支后直推）· `test` 机器分支（`dev` + 全部带 `deploy-for-testing` 标签的 PR 叠合，develop 环境唯一常态部署源，人不推）· `main` 只收 `pick/*` / `backport/*` / `docs/*` / `chore/*` 的 PR（stage 部署源）· `release/YYYY-MM-DD` 按需从 `main` 切（**prod 唯一部署源**，补丁走 `backport/*` 并成对 pick 回 main）。🔴 **`dev` 与 `main` 互不为祖先是刻意的**——两线独立才有选择性上线的余地，**不要**照搬 pgc 的 `main ⊆ dev` 血缘校验。设计稿 `docs/superpowers/specs/2026-08-27-merge-strategy-alignment-design.md`，操作序列 `docs/deploy/cicd-onboarding.md` §5.2/§5.3。
- **feature 身份是提交消息里的 `Feature:` trailer**（2026-08-28 起）：`.githooks/commit-msg` 在特性分支上自动追加当前分支名，主干（`dev`/`main`/`test`/`release/*`）与 `pick/*`/`backport/*` 不加；trailer 随消息被 cherry-pick 原样复制，所以三条线上是同一身份。`pnpm board` 双源识别（trailer + 旧的 merge subject 兜底存量），**因此上 `main` 的 pick PR 用 GitHub 默认 subject 也不会丢 feature**——写 `--subject "merge: feat/<原分支名> <标题>"` 仍推荐（看板标题更好看），但不再是命门。🔴 **该结论只覆盖钩子装上之后的 feature；挑拣 2026-08-28 之前的存量时 `--subject` 仍是命门**——那批提交没有 trailer，身份只在 dev 那条 merge 的 subject 里，而 `^1..^2` 恰好把 merge 排除在外，两源同时空。2026-09-03 已实发六次（PR #20 一条 PR 带 15 个 feature、默认 subject 合入，四行需求的 stage / prod 列至今显示 `n/m`）。pre-hook feature 一个一条 pick PR 并写 `--subject`，合并前用 `git log --format='%(trailers:key=Feature,valueonly)' <pick 分支> | grep -c '<分支名>'` 自查。案例见 spec §6.5。钩子靠 `package.json` 的 `prepare` 设 `core.hooksPath=.githooks`；**没生效就跑 `pnpm run prepare`**（`pnpm install` 在「已是最新」时会跳过生命周期脚本）。⚠️ 该配置只写**相对路径**——本仓踩过绝对路径指向旧仓、钩子全体静默失效的坑。自查两条：`git config --get core.hooksPath`（应为 `.githooks`）、提交后 `git log -1 --format='%(trailers:key=Feature,valueonly)'`（特性分支上应输出分支名）；要临时停用就 `git config --local --unset core.hooksPath`。⚠️ **pick 到 `main` 用逐条 `git cherry-pick <m>^1..<m>`，别用 `-m 1` 压扁**——压扁后消息是主干那条 merge 的消息，身份可能两源皆空（实测）。看板默认只统计**最近 3 个月**，`pnpm board --since=all` 看全量。设计稿 `docs/superpowers/specs/2026-08-28-board-trailer-identity-design.md`。**看板按需求聚合**（2026-09-02 起）：身份仍是分支名，`scripts/release-board/epics.json` 是人维护的「需求 → 精确分支名」映射（git 里没有这种信息，别指望自动推断；glob 只支持 `*` 且不鼓励，`*replay*` 会吞 UX 打磨分支）。聚合行**全部成员命中才 ✓，否则显示 `n/m`**；`docs/` / `chore/` 折叠到表尾「工程内部」组但判定不删；**新分支合入后以未归类单行出现，就是该补映射的提示**；一个分支写进两个需求脚本直接报错。🔴 **开发新需求时自主维护 `epics.json`，不等人提醒**：特性分支合入 dev 的同一回合里，把分支名写进所属需求（已有需求就追加，新需求就新开一组并起中文标题）；`docs/` / `chore/` 前缀分支不用登记。这属于回合收口的一部分，与 spec / plan 落盘同级。设计稿 `docs/superpowers/specs/2026-09-02-board-epics-design.md`。
- **分支保护**：`main` 与 `release/*` 必走 PR + required checks **`quality` + `branch-policy`**（批准数 0）；`dev` 不加 required check（GitHub 的 required check 对直推也生效，加了会封死本地 `--no-ff` 合完直推 dev 的节奏——**这条只约束 `dev`**，main/release 本就只走 PR，所以 `branch-policy` 在那两条上是 required）；`test` **刻意不配保护**（配错会让叠合链瘫痪，而它防的损失近乎为零）。🔴 **`dev` 的禁强推只能走 ruleset `dev-guardrails`**（classic protection 的 `allow_force_pushes` 在 dev 上写不进去，传 false/null 都返回 200 而值恒 true，实测），且**无 bypass、admin 也拦**；查它别看 `allow_force_pushes`，要看 `gh api repos/rezona-ai/rezonalab-game-web/rules/branches/dev --jq '[.[].type]'`。`main` 仍是 classic protection，`release/*` 因是通配且按需创建走 ruleset。改配置一律跑 `deploy/setup-branch-protection.sh`（默认 dry-run）。口径见 `docs/deploy/rezonalab-dev-bringup.md` §7。
- **路由巡检**：`pnpm lb:audit`（`scripts/lb-route-audit/`，只读）校验三个共享 url-map 里本前端的 `/game` + `/game/*` 仍指向 `rezonalab-game-web-${ENV}-backend`、更长前缀邻居未被吞、未占 `default`；`.github/workflows/lb_route_audit.yml` 每 4 小时跑。新环境接入后要把 `expected.ts` 的 `wired` 翻 `true`；该 workflow **必须在 main 上**才会被 schedule 触发。
- **共享 url-map 铁律**：`rezona-lab-*-urlmap` 由本前端 / pgc / koubou / Rezona Canvas / biz-api **共用**，`gcloud compute url-maps patch` 是**整体替换**而非合并——一律 `export → 改 → 逐条 diff → import`，只追加自己的 rule，不动别人的规则与 `default`（2026-07-29 已实发冲掉事故，见上文记录 §4）。
- **Dev 高可用（生产化）**：develop 跑 HPA `2-5`，Deployment 用 `RollingUpdate maxUnavailable=0 + maxSurge=1 + minReadySeconds + preStop sleep`，配 PDB(`minAvailable: 50%`)——滚动发布/节点维护期 standalone NEG 不掉到零端点。部署契约由 `tests/deploy/*.test.ts` 守护(渲染 manifest 后断言),改 HA 参数须同步更新。

## 开发范式（沿用这些约定）

- **先 docs 后码**：每个功能在 `docs/superpowers/{specs,plans}/` 先出设计稿、再出实现计划,然后写码;提交里 `docs:` 与 `feat:` 成对出现。纯逻辑 TDD(同目录 `*.test.ts(x)`)。
- **回合收口顺手登记看板归属**：特性分支合入 dev 时把分支名写进 `scripts/release-board/epics.json` 所属需求（详见「部署与 basePath」一节的看板段）。这一步由 agent 自主完成，不等 Nick 提醒。
- **纯函数 + 唯一落库入口**：状态变更走纯函数 reducer(`applyKoubou`)/ action,**返回新对象、不可变更新**;`store` 是唯一真相源,组件只 `subscribe`/调 action,跨组件协调也走 store 字段(`creditModalOpen`/`modelMenuRequest`/`composerFocusRequest` 等打开态 / 请求号都进 store),不互相直连。
- **副作用与纯逻辑分层**:解析 / 归一 / 映射 / 落位(`parseFileDiff`、`pgc/map.ts`、`card-layout.ts`…)是无副作用纯函数下沉到 `lib/` 并单测;连接 / 轮询 / IO 隔离在 `client/` hooks 与 `server/`。
- **`await` 后必校验上下文**:action 内每个 `await` 之后 `if (get().currentProjectId !== pid) return;`(代码中 10+ 处),丢弃过期响应;切项目在**同一次 `set`** 内清空会话态,维持不变式「`messages` 恒属于 `currentProjectId`」。
- **乐观 UI:占位卡 → 原位替换**:生成立即落 `pending_` 占位卡(转圈),真实资产返回原位替换,失败移除占位卡 + Toast。
- **多道幂等去重**:`sequence`(`seenSequences`)/ `importedByProject`(持久)+ `attemptedRef`(本会话)/ 串行 promise chain 保顺序依赖。注意 **StrictMode / 热刷新的重复挂载 ≠ 项目切换**,用 ref 判定真正切换再重置(`useCanvasAutoImport`)。
- **错误分层兜底**:`guard()` 只把已知 `PgcError` 转 `lastError`(→Toast),其余照抛;**koubou** 代理层把上游不可达收敛为 **502 + JSON 信封**(`UPSTREAM_UNAVAILABLE`),但 **pgc** 代理层只记日志后原样抛出、路由层 `handle()` 无 try/catch,实际对外是**裸 500**——两侧口径不一致属已知差异,排障以实际状态码为准;非法 WS 帧 `try/catch` 跳过。
- **客户端层同样两套口径(易踩)**:`src/lib/pgc/client.ts` 的 `pgc()` 把超时 / 中止 / 断网**归一**成 `PgcError`(`TIMEOUT`/`ABORTED`/`NETWORK`),而 `src/lib/koubou/client.ts` 的 `koubou()` **只归一信封**——超时原样抛 `DOMException(TimeoutError)`、断网抛 `TypeError`。故 `catch (e) { if (e instanceof KoubouError) … else throw e }` 这个写法会把传输失败当成程序 bug 漏出去;而在调用点**无法**反过来把「非 KoubouError」判成传输失败(断网抛 TypeError,空指针也抛 TypeError,`try` 里还常包着自己的解引用)。区分只能在 fetch 调用点做。当前对策:分不清来源的路径一律弹**不归因**的 `UNKNOWN`(「出现错误,请重试」)并照抛,不冒充业务失败(见 bug #13870465 的处置)。
- **超时分档两侧都要配**:两个 client 各有默认档与 `SLOW_TIMEOUT_MS`(300s)。provisioning / 同步生成类端点必须显式放宽,否则把「服务端其实会成功」的操作误杀成前端失败。跨服务编排尤其容易漏——分享 / 回放两条链上 pgc 半截(`workbenchShare.open` / `startReplay`)与 koubou 半截(`cloneFromShare` / `cloneFromTemplate`)要成对放宽,只配一侧等于没配。
- **依赖注入便于测试**:`createKoubouClient` 接受 `factory`(测试注入 `FakeWS`)与 `mintTicket`;测试用假实现 + `flush()` 微任务,不依赖真实计时器 / 网络。
- **`eslint-disable` 必带 `-- 理由`**;注释解释**「为什么」**(竞态 / 不变式 / 后端契约)而非「做什么」,中文。

## 反模式（提交记录里被刻意清除的，勿重新引入）

- **臆测后端字段做兜底**:只取文档约定字段。曾移除推测性 camelCase 兜底,只留 snake_case(`79c5175`);`canvas_x/y` 取整再传以匹配后端 int(`76f18a0`)——尊重契约类型,不自作主张加别名 / 浮点。
- **吞掉未知错误**:`guard` 之外不 `catch` 非预期错误(留给它暴露 bug)。
- **覆盖前端拥有的坐标**:轮询 / 重连 / 服务端旧坐标**不得**冲掉已落位的 `position`(`actions.ts` 多处显式保留 `position: a.position`)。
- **持久化瞬态**:连接状态、`sequence=null` 的 live 流式增量不落盘;只在可重放检查点持久化,保证 `lastSequence ↔ messages` 一致。
- **流式草稿期解析半截 tool input**:`input_json_delta` 增量不解析,等完整 `AssistantMessage` 落定再读 `input`。
- **堆叠废弃机制 / 留测试导向的生产代码**:历史上整块删除——泳道 + d3-force(`bf61f24`)、`pinned` 字段(`647bdf3`)、nightcap mock 兜底(`5c1c2a7`)、为测试而加的 Promise 包装(`d37c896`)。新增能力优先替换旧机制,不留 dead code。
- **绕过 `basePath` 写自身绝对路径**:`fetch`/`WebSocket`/`<img>` 指向本服务的绝对路径不经 `apiPath()`/`assetPath()` —— 部署在 `/game/*` 下会被路由到别的后端。
- **孤儿任务兜底删服务端 item**:轮询判不出任务时**不得**删 item —— 后端可能仍在跑,删掉等于丢掉已付费的产物。改标孤儿态,给不花钱的「重新检查」。
- **额度展示用 `balance`**:后端文档明写「展示一律用 `spendable`,勿本地推导」(见 `lib/pgc/types.ts` 的 `BalanceData` 注释)。`balance` 含被在飞生成预留的 `held`,显示它会让用户被 402 拦下时看到自相矛盾的数字;也不要本地算 `balance - held`。

## 环境变量

| 变量 | 用途 |
|---|---|
| `PGC_BASE_URL` | 服务端：PGC + Koubou 同址基址（代理转发 / 签 ticket） |
| `DEV_COOKIE` | 仅本地开发：注入 dev session cookie（与浏览器 cookie 合并、DEV 键优先；兼作 Set-Cookie 回传门控。生产不设） |
| `NEXT_PUBLIC_PGC_BASE_URL` | 前端：媒体直连 + 由其派生 Koubou WS 地址 |
| `KOUBOU_BASE_URL` | 仅本地调试：Koubou HTTP 代理直连本地服务（如 `http://127.0.0.1:8000`，挂根路径不拼 `/game/koubou` 前缀）；不设走 `PGC_BASE_URL` 派生 |
| `NEXT_PUBLIC_KOUBOU_BASE_URL` | 仅本地调试：浏览器 Koubou WS 直连本地服务（同上，`http→ws`）；与 `KOUBOU_BASE_URL` 成对设置 |
| `LOCAL_GAME_ROOT` | 仅本地调试：本地 koubou 版本快照根目录（`{data_root}/{user}/workspaces`）；设了 `NEXT_PUBLIC_KOUBOU_BASE_URL` 后游戏预览走 `/api/local-preview` 直读该目录 |
| `NEXT_PUBLIC_BASE_PATH` | 仅部署：`/game`，本地不设 |
| `PORT` | 默认 3000 |
