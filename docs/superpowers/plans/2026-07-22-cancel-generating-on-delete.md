# 实现计划：删除生成中卡片中断请求 + 删除动效对齐

对应设计稿：`docs/superpowers/specs/2026-07-22-cancel-generating-on-delete.md`

## 任务 1：pgc() 支持外部 AbortSignal

- 文件：`src/lib/pgc/client.ts`、`src/lib/pgc/client.test.ts`
- `pgc()` 末参改为可选 `signal?: AbortSignal`：有 signal 时 `AbortSignal.any([signal, AbortSignal.timeout(ms)])`，无则维持现状；catch 里 `AbortError` → `PgcError('ABORTED', …, 0)`（先于 NETWORK 归一判定）。
- `genImage/genAudio/genVideo/genModel3d/genRig3d/genRetexture` 增加可选 signal 形参透传。
- 测试（先写失败）：外部 signal abort → 抛 `PgcError` 且 `code === 'ABORTED'`；无 signal 路径不回归（现有用例保持绿）。
- 验证：`pnpm exec vitest run src/lib/pgc/client.test.ts`

## 任务 2：在飞注册表 + 删除中断（store）

- 文件：`src/store/actions.ts`、`src/store/actions.test.ts`
- 把 `uploads` Map 泛化为在飞注册表：`Map<placeholderId, { controller, group: string[], deleted: Set<string> }>`，同组占位卡共享句柄。API：`registerInflight(ids, controller)` / `markInflightDeleted(id)`（标删 + 全组删完 abort + 移除映射）/ `unregisterInflight(ids)` / `inflightDeleted(id)`。
- `runGen`：建 controller → 注册占位卡组 → `call(pid, placeholderIds, signal)` → finally 注销全组；catch 里 ABORTED 静默返回（不 remove、不抛）。
- 六个 `generate*` 与 `resolveTextRef` 后的实际调用把 signal 传给对应 pgcApi 端点；catch 里 ABORTED 不上报 `asset_generate_fail`、不照抛。
- `settleGenPlaceholders`：落卡前按下标对位查 `inflightDeleted(placeholderIds[i])`，已删的跳过并 `void pgcApi.deleteCanvasItem` 清服务端 item。
- `startAsyncGen`：占位卡已标删 → `void pgcApi.deleteCanvasItem(pid, task.item.item_id)`，不 adopt 不登记任务。
- `deleteCanvasItem` pending 分支：`abortUpload(itemId)` 改为 `markInflightDeleted(itemId)`（上传组恒 1，行为等价）。
- 测试（先写失败）：
  1. 删除唯一占位卡 → 传入端点的 signal 已 aborted；settle 不落卡。
  2. 图像 n=2 删一张 → signal 未 aborted；settle 只落另一张，已删那张的服务端 item 被 delete。
  3. n=2 两张都删 → signal aborted。
  4. abort 竞态：请求已成功返回后才删（异步 POST）→ 服务端 item 被 delete，genTasks 不含该任务。
  5. ABORTED 不弹 Toast（`lastError`/`toast` 保持 null）。
- 验证：`pnpm exec vitest run src/store/actions.test.ts`

## 任务 3：删除中覆盖层换新光环

- 文件：`src/components/canvas/nodes/GeneratingPlaceholder.tsx`（抽 `StatusHalo` 导出）、`src/components/canvas/nodes/NodeCard.tsx`、相关测试
- `StatusHalo`：现 GeneratingPlaceholder 内层光环（size-10 ring + 中心点 + brand-float + backdrop-blur）原样抽出，颜色随 `currentColor`；GeneratingPlaceholder 内联处替换为它（视觉零变化）。
- NodeCard deleting 覆盖层：压暗层保留，`animate-spin` spinner 换 `StatusHalo`，容器 `style={{ color: KIND_META[kind].colorVar }}`；`role="status"` + aria-label 不变（text 卡无类型占位图但有类型色，正常取色）。
- 测试：deleting 态渲染出光环节点且 `role="status"` 的 aria-label 为删除中文案；GeneratingPlaceholder 现有测试保持绿。
- 验证：`pnpm exec vitest run src/components/canvas/nodes`

## 任务 4：全量验证 + 提交

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test`（在 worktree 内跑，退出码为准，IDE 诊断不作数）。
- 提交：`docs:` 与 `feat:` 成对；确认落在 worktree 分支。
