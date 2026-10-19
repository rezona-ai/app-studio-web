# 移除资产画布（两栏工作台）—— 实现计划

spec：`docs/superpowers/specs/2026-10-19-remove-asset-canvas-design.md`（方案一；Engine Bridge 随画布下线，2026-10-19 拍板）

顺序原则：**先改布局再删文件**——T1–T3 让 Workspace 不再引用画布且全绿，T4 起的删除才是纯减法，每步结束 `tsc` 能立刻暴露漏网引用。
每个任务跑通 `pnpm exec tsc --noEmit` + 相关测试后单独提交（`feat:` / `test:` / `chore:` / `docs:` 按性质分，中文 message）。

## T0 前置（需用户确认）

- 当前 `app-studio-web` 的快照导入**尚未提交**。实现前先由用户确认提交这条初始导入（建议 message：`chore: 导入 rezonalab-game-web main 快照(d082072a)`），
  否则本特性的 diff 会与 1258 个导入文件混在一起，无法评审。
- 从该提交切 `feat/remove-asset-canvas`。新仓目前只有 `main`，**收口的合入目标（直接 PR 进 main / 先建 dev）待用户定**，见 T9。
- 本 spec / plan 两个文件随 T0 之后的第一条 `docs:` 提交入库。

## T1 几何模块收敛（纯逻辑，先改测试）

- `src/lib/preview-width.ts`：（实现时调整为整文件删除，`PREVIEW_WIDTH_MIN = 330` 并入 `sidebar-fit.ts`）删 `PREVIEW_WIDTH_DEFAULT`、`CANVAS_WIDTH_MIN`、
  `PREVIEW_ACCOUNT_BAR_H` / `PREVIEW_TAB_ROW_H` / `PREVIEW_STAGE_SHARE` / `GAME_MAX_RATIO` / `GAME_MIN_RATIO`、`maxPreviewWidth` / `minPreviewWidth` / `clampPreviewW`。
- `src/lib/sidebar-fit.ts`：
  - `minPageWidth(chatCollapsed)` = 收起 ? `PREVIEW_WIDTH_MIN` : `CHAT_WIDTH_MIN + SEPARATOR_W + PREVIEW_WIDTH_MIN`（去掉 `viewportH` 参数，只剩一条分隔条）。
  - `fitChatWidth(desiredChatW, viewportW, chatCollapsed)` 取代 `fitSidebars`：返回 `max(CHAT_WIDTH_MIN, min(clampChatWidth(desired), viewportW − SEPARATOR_W − PREVIEW_WIDTH_MIN))`；
    收起态原样返回 `clampChatWidth(desired)`（不消解，展开后回到期望宽——不变式保留）。
  - 删 `SEPARATOR_TOTAL_W`、`SidebarWidths`。
- 测试：重写 `preview-width.test.ts`（只剩常量断言，若无可测内容则删文件）与 `sidebar-fit.test.ts`：
  ① 宽视口返回期望宽；② 视口收窄压 Chat、给预览留足 `PREVIEW_WIDTH_MIN`；③ 极窄时 Chat 停在 `CHAT_WIDTH_MIN`；④ 收起态不消解；⑤ `minPageWidth` 两态。
- 此步 Workspace 仍引用旧导出 → 与 T2 同一提交落地，保证每条提交 `tsc` 全绿。

## T2 Workspace 改两栏

`src/components/workspace/Workspace.tsx`：

- 删 import：`AssetCanvas`、`ContextMenu`、`GroupContextMenu`、`GenerateFormHost`、dynamic 的 `RenameAssetModal` / `TextEditorModal` /
  `CreativeLibraryModal` / `Derived3DForm` / `LnaExplainer`、`isEngineBridgeEnabled`、`useCanvasPolling`、`usePendingDeleteFlush`。
- 删 state / ref / effect：`previewW`、`desiredPreviewW`、`PREVIEW_W_KEY`、`PREVIEW_FULL_KEY`、`previewFull` / `setPreviewFull` 订阅、
  `maxPreviewW` / `minPreviewW`、`startPreviewResize`、`expandPreviewFull`、`previousVersions` 与「新版本自动全宽」effect、`fullHydrated` 落盘 effect、
  `renderedPreviewW`；订阅 `versions` / `renameTarget` / `textEditor` / `libraryOpen` / `derived3dForm` 若已无用一并删。
- `applyLayout`：只算 `chatW = fitChatWidth(desiredChatW.current, vp.w, collapsed)`；`viewport` 只需宽度（保留对象形态亦可，但不再读 `h`）。
- 挂载 effect：不再读 `workspace.previewWidth` / `workspace.previewFull`（残值留在用户 localStorage 里无害，不主动清）。
- JSX：Chat 列 → `EdgeHandle(left)` → Chat 分隔条（保持现状）→ **`<div className="h-full min-w-0 flex-1"><PreviewPanel /></div>`**；
  删画布列、预览分隔条、spacer、absolute overlay。`EdgeHandle.pinned` 改为 `chatCollapsed || compareOn || filesTab` 保持不变（Files/对比时把手压在预览面板左缘，仍需常显）。
- 拖拽遮罩、`startResizeWith` 只剩 Chat 一个调用方——保留函数形态，删 `onFirstMove` 参数。
- `<Toast leftInset={chatSpanW} />`（`rightInset` 缺省 0），注释改为「居中于预览列」。
- 注释里所有「画布侧 / 画布列」的表述同步改为「预览侧 / 预览列」（`EdgeHandle` 的命中范围说明等）。
- 测试 `Workspace.test.tsx`（现 27 条）：
  - 删：自动全宽 4 条（158/178/189/199 行）、全宽状态 / 预览分隔条 6 条（262/277/290/300/328/344）、`425` 预览上限重算、`439` 分组框右键菜单、`451` 预览侧无把手。
  - 改：`101` → 「视口收窄压 Chat 列，预览列恒 ≥ `PREVIEW_WIDTH_MIN`，两栏不重叠」；`119` / `146` 按新最小页宽；`129` 期望宽不被改写只针对 Chat；
    `213` 改为「把手热区落在预览侧」；`225` 改为「对话栏收起后预览列吃满视口宽」。
  - 新增：工作台不渲染画布（无 `react-flow` 根节点 / 无画布搜索栏）；预览列是 flex 项而非 absolute overlay。

## T3 预览面板与舞台

- `PreviewPanel.tsx`：删 tab 行的全宽 / 恢复按钮与 `previewFull` / `togglePreviewFull` 订阅、相关注释；其右邻全屏按钮的「渲染条件与把手一致」注释改写。
- `GameFrame.tsx`：内层框 `h-full w-full` → `h-full w-full max-w-[calc(100cqh*16/9)]`（舞台已 `flex items-center justify-center` + `container-type:size`，
  超宽时自动左右居中露 `--color-canvas`）。注释说明「上限从预览列宽搬到舞台内，原因见 spec §3.1」。
- `store/index.ts`：删 `previewFull` 字段、初值、`togglePreviewFull`、`setPreviewFull` 及类型声明与注释。
- 测试：`PreviewPanel.test.tsx` 删 `375` 全宽按钮用例与 `previewFull` 复位行；`GameFrame.test.tsx` 新增「内层框带 16:9 max-width」断言
  （jsdom 不算布局，断言 class 即可）；删 `store/preview-full.test.ts`。
- **T1–T3 同一提交**（`feat: 工作台改为对话与预览两栏`），提交前 `tsc` + `pnpm test` 全绿。

## T4 删除画布目录

- `git rm -r src/components/canvas`。
- `lib/card-layout.ts` 第 15 行注释引用了 `components/canvas/nodes/*.tsx`：改为「尺寸常量沿用画布时期的卡片估算，仅供自动导入落位」。
- `tsc` 应全绿（T2 已断开唯一挂点）；若报错即为漏网引用，就地修。
- 提交：`chore: 移除资产画布组件`。

## T5 删除孤儿模块（含 Engine Bridge 界面）

- 删除（连同同目录 `*.test.ts(x)`）：
  - client：`useCanvasPaste`、`useAltBypass`、`useCanvasPolling`、`usePendingDeleteFlush`、`useFirstAppearance`、`useGenEstimate`。
  - lib：`asset-actions`、`asset-time`（含 `asset-time.dst.test.ts`）、`bulk-actions`、`canvas-drop`、`canvas-keys`、`context-target`、`derive-band`、
    `derive-policy`、`derived-3d`、`gen-estimate`、`gen-prefill`、`gen-progress`、`loaded-media`、`nudge`、`offscreen`、`popover-anchor`、`rf-nodes`、
    `rig-animation`、`rig-viewer`、`zoom`、`pgc/voices`。
  - bridge：`components/bridge/{EngineBridgeButton,EngineBridgePanel,SendToMenu,TransferCapsule,LnaExplainer}.tsx`、`EngineBridge.test.tsx`、
    `components/preview/PreviewPanel.bridge.test.tsx`。
- 删完**再跑一次孤儿扫描**（同 spec §2.2 的 import 图闭包脚本）：删除会产生二阶孤儿（如某 lib 只被已删 lib 引用），重复到不动点；
  `store/**`、`lib/engine-bridge/**` 即便变孤儿也**不删**（spec §8 第二阶段）。
- `pnpm lint`（检查未用 import）、`tsc`、`pnpm test` 全绿。
- 提交：`chore: 移除画布专属的 hooks / 纯逻辑与 Engine Bridge 界面`。

## T6 CI 夏令时守护连带

- `package.json` 删 `test:tz` 脚本；`.github/workflows/ci.yml` 删 test:tz 步骤及其注释；删 `tests/ci-tz-contract.test.ts`。
- `vitest.config.ts` / `eslint.config.mjs` 若有对 `asset-time.dst` 的特殊处理一并清（预期没有，grep 确认）。
- 提交：`chore(ci): 随 asset-time 下线移除 test:tz 守护`。

## T7 文案

- `components/chat/MentionPopover.tsx` 空态：`'No assets yet — files the agent generates or you attach will show up here'`。
- 若有测试断言旧文案（grep `generate some on the canvas`），同步更新。
- 并入 T8 前的一个 `feat:` 小提交。

## T8 文档

- `CLAUDE.md`：
  - 「项目概览」去掉多模态资产画布表述，改为「对话驱动 agent 生成游戏，右侧预览 / 切换版本；agent 产物与附件作为可 @ 提及的资产」。
  - 「架构」图把 `AssetCanvas(中)` 去掉。
  - 「画布与生成」整节替换为一段「已退役」说明：保留的数据层（`loadCanvas` / 自动导入 / 附件上传 / `card-layout` 落位）+ 指向本 spec。
  - 「UI/UX 范式 · 浮层与布局」：三栏壳 → 两栏；删「预览全宽是显式持久化状态」条；把手条目改为只剩对话栏一侧；z-index 阶梯删「画布 UI z-10」「Preview z-20」中不再成立的项。
  - 「常用命令」与 CI 说明删 `test:tz`。
  - 反模式里「覆盖前端拥有的坐标」等仍对数据层成立的条目保留。
- 提交：`docs: 两栏工作台口径同步 CLAUDE.md`。

## T9 收口

- 全量验证：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`；`grep -rn "components/canvas\|previewFull\|test:tz" src tests .github package.json` 无结果。
- 本地 `pnpm dev` 按 spec §7 逐条走查（含宽屏 16:9 信箱、窄视口横向滚动、@ 提及、Files / 对比 / 分享导出），截图留证。
- 干净上下文子代理按 spec + diff 评审；Critical / Important 修复，Minor 记入 spec。
- 合入方式按 T0 用户决定执行；若沿用 rezonalab 的四线拓扑，需先在新仓建 `dev` 并配 `scripts/release-board/epics.json`（新开需求「移除资产画布」登记本分支）。

## 风险与回退

- **漏删 / 误删**：T4、T5 都是纯删除，靠 `tsc` + lint 未用 import 兜底；回退即 revert 对应提交。
- **persist 残留**：`genTasksByProject` 等残值不再被消费，不报错（spec §5.2）；store 字段本阶段不动，水合形状不变。
- **宽屏游戏观感**：16:9 信箱是唯一行为变化点，走查时重点看；若产品要求铺满，改回 `w-full` 即可，不影响其他任务。
