# Agent 资产生成事件 v2 适配 Implementation Plan

**Goal:** 适配 Koubou 新版 media 事件协议：丢弃单发 `media.generated`，认两阶段 `media.task_submitted` / `media.tasks.status`；对话工具卡只渲染已就绪资产预览；就绪资产自动导入与历史预填的下游链路保持不变。

> **修订（2026-06-17，实测后定稿）**：初版加过生成态反馈（生成中/进度/失败），实测 agent 不保证把就绪状态发回聊天（资产经 `run.finished` 后 `loadCanvas` 从 PGC 落画布），中间态卡永远停在「已提交」。故去掉生成态反馈，`parseMediaItems` 在协议层只挑就绪 item，`MediaItem` 仅 `{ kind, path, previewUrl }`。详见 design 同名修订。

**Architecture:** 见同名 design。归一在协议层（`parseMediaItems` → `MediaItem[] | null`），`apply-koubou.foldResults` 把数组挂到 tool part，`collectReadyMedia` 仍输出 `ReadyMedia[]`（下游零改动），`ToolCard` 按 `item.status` 渲染。

## Global Constraints

- 测试与源码同目录（`*.test.ts(x)`），vitest `@`→`src`；注释/commit message 中文，一句话总结。
- **只取契约约定字段**：`asset_path`/`preview_url`/`status`/`progress`/`task_id`，不臆测 camelCase 别名兜底。
- 纯逻辑 TDD：先红后绿。改动集中在 `protocol.ts` / `apply-koubou.ts` / `store/types.ts` / `media-import.ts` / `ToolCard.tsx` + 各自测试，外加 `koubou-seed.test.ts`、`store/actions.test.ts`、`useCanvasAutoImport.test.tsx` 的 fixture 适配。

---

### Task 1: 协议层 `MediaItem` + `parseMediaItems`

**Files:** Modify `src/koubou/protocol.ts`（删 `MediaGenerated`/`parseMediaGenerated`），`src/koubou/protocol.test.ts`（替换 `parseMediaGenerated` describe）。

- 类型 `MediaStatus`、`MediaItem`、`parseMediaItems(text): MediaItem[] | null`（实现见 design）。
- 测试：task_submitted→单条 `submitted`；tasks.status 含 ready/pending/failed→逐项归一（`path`=asset_path、`previewUrl`=preview_url、`progress`、`status`）；非 media JSON→null；纯文本→null；malformed→null。

### Task 2: `Part.media` 类型

**Files:** Modify `src/store/types.ts`（import `MediaItem`，tool 变体 `media?: MediaItem[]`）。无独立测试，靠 tsc + 下游测试。

### Task 3: `apply-koubou.foldResults` 挂载数组

**Files:** Modify `src/koubou/apply-koubou.ts`（import 换 `parseMediaItems`，`media: parseMediaItems(text) ?? undefined`），`src/koubou/apply-koubou.test.ts`（两处 fixture/断言改 `media.tasks.status` + `media?.[0]?.path/previewUrl`）。

### Task 4: `collectReadyMedia` 遍历数组

**Files:** Modify `src/lib/media-import.ts`（`collectReadyMedia` 遍历 `p.media`，仅取 `item.status==='ready' && item.path`，`basename(item.path)` + `item.previewUrl`），`src/lib/media-import.test.ts`（helper 改 `MediaItem[]`，补 item 级 pending/failed 跳过）。同步 `src/store/koubou-seed.test.ts`（fixture 改 tasks.status ready item）、`src/store/actions.test.ts:83`（media 改数组）。

### Task 5: `ToolCard` 就绪预览渲染

**Files:** Modify `src/components/chat/ToolCard.tsx`（`part.media` 逐项渲染就绪预览：image→`<img>`、video→`<video>`、audio→`<audio>`，无 `previewUrl`/3d→不渲染；原始 JSON 抑制沿用 `!part.media`），`src/components/chat/ToolCard.test.tsx`（媒体用例改数组、断言无生成态文案）。同步 `src/client/useCanvasAutoImport.test.tsx`（fixture 改数组）。

### Task 6: 全量校验

`pnpm lint && pnpm exec tsc --noEmit && pnpm test`（如需 `pnpm build`）。手动冒烟（后端可达）：对话触发图像生成，确认 submit 卡「已提交生成任务」、check 卡「生成中→预览」、就绪后画布自动导入。

## 自检（design 覆盖）

- ✅ 丢 media.generated、认 task_submitted/tasks.status → Task 1。
- ✅ 工具卡只渲染就绪预览（去掉生成态反馈）→ Task 5。
- ✅ 就绪资产自动导入 + 历史预填不变 → Task 4（`ReadyMedia` 契约不变）。
- ✅ 容错（null 回退通用文本、未知 status→pending）→ Task 1。
- 类型一致性：`parseMediaItems`/`MediaItem`/`Part.media`/`collectReadyMedia` 跨任务签名已对齐。
