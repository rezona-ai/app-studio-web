# 实现计划：画布撤销（⌘Z）与延迟删除

> 设计稿：`docs/superpowers/specs/2026-08-03-canvas-undo.md`
> 分支：`worktree-feat+canvas-undo`

任务按「并存加新 → 原子切换 → 删旧」排序，每步系统保持可运行、每个任务一次提交。纯逻辑按 TDD（先写失败测试）。

---

## T1 撤销栈骨架 + ⌘Z + 移动撤销 + 撤销反馈

打通「push → ⌘Z → 还原 + 反馈」这条主干，用最简单的一类操作（拖动落位）验证。

**改动**
- `src/store/types.ts` —— 新增 `UndoEntry` 判别联合（本任务只用 `positions`/`op:'move'` 分支，其余分支一并声明好避免后续反复改类型）。
- `src/store/index.ts`
  - `UIState` 加 `undoStack: UndoEntry[]`；**确认不进 `persist` 白名单**。
  - `pushUndo(entry)`：push + 深度上限 20 丢最旧。
  - `undo()`：pop → 按 `type` 分派 → 还原 → 反馈三件套（`setSuccess` 报操作名 + `setSelection(受影响 ids)` + `ensureVisible(包围盒左上角)`）。本任务只实现 `positions` 分派：`setAssetPositions` + 逐卡 `persistAssetPosition`（跳过 `pending_`）。
  - `switchProjectSession` 切项目在**同一次 `set`** 内清空 `undoStack`。
- `src/lib/canvas-keys.ts` —— 加 `shouldTriggerUndo(e, activeEl)`，复用 `isEditableTarget`。
- `src/components/canvas/AssetCanvas.tsx`
  - `persistDraggedNodes` 落位**前**先 `pushUndo` 拖动前坐标（从 `getNodes()` 前一帧位置取；注意此时 `store.assets` 尚未被 `setAssetPositions` 更新，直接读 store 即为「拖动前」）。
  - window `keydown` 监听 ⌘Z（与既有 zoom / delete / ⌘K 监听同款写法）。
- i18n（11 个 locale 文件）—— `canvas.undo.move`、`canvas.undo.done`（「已撤销：{{op}}」）。

**测试（先写，确认按预期失败）**
- `src/lib/canvas-keys.test.ts` —— ⌘Z / Ctrl+Z 命中；⌘⇧Z 不命中；焦点在 input/textarea/contentEditable 不命中。
- `src/store/undo.test.ts`（新）—— push/pop 顺序；深度上限 20 丢最旧；`positions` 撤销后 `assets` 坐标复原；切项目清空栈；空栈 `undo()` 为 no-op 不抛。

**验证**
```bash
pnpm exec vitest run src/lib/canvas-keys.test.ts src/store/undo.test.ts
```

---

## T2 一键整理撤销（含视口还原）

**改动**
- `src/lib/viewport.ts` —— 加 `registerSetViewport(fn)` / `setCanvasViewport(vp)`，与既有三个注册表同款（挂载注册、卸载注销）。
- `src/store/actions.ts` —— `tidyCanvas(sizeById, viewportBefore?)`：重排**前**把全部卡当前坐标 + `viewportBefore` push 成 `{ type:'positions', op:'tidy', viewport }`。
- `src/store/index.ts` —— `undo()` 的 `positions` 分派里，`op==='tidy'` 且带 `viewport` 时额外 `setCanvasViewport(viewport)`；此时**跳过** `ensureVisible`（视口已被显式还原，再平移会打架）。
- `src/components/canvas/AssetCanvas.tsx` —— `onTidy` 在调 `tidyCanvas` 前 `getViewport()` 取整理前视口并传入；`useEffect` 注册 `registerSetViewport`。
- i18n × 11 —— `canvas.undo.tidy`。

**测试**
- `src/store/undo.test.ts` 追加 —— 整理后撤销：坐标复原 + 注入的假 `setCanvasViewport` 收到整理前视口 + 不调 `ensureVisible`。

**验证**
```bash
pnpm exec vitest run src/store/undo.test.ts
```

---

## T3 重命名撤销

**改动**
- `src/store/index.ts` —— `renameAsset` 改名前 push `{ type:'rename', id, label: 旧名 }`（`prev` 已经读到，零额外查询）；`undo()` 加 `rename` 分派（复用 `renameAsset` 落库回旧名）。
  - ⚠️ 撤销走 `renameAsset` 会再 push 一条 undo entry → 无限自撤销。加内部 `renameAsset(id, label, { skipUndo: true })` 或抽 `applyRename` 内部函数供两处共用。**取后者**，避免可选参数污染公开 action 签名。
- i18n × 11 —— `canvas.undo.rename`。

**测试**
- `src/store/undo.test.ts` 追加 —— 改名后撤销回旧名；撤销**不再**往栈里 push（连按两次 ⌘Z 不会在两个名字间来回弹）。

**验证**
```bash
pnpm exec vitest run src/store/undo.test.ts
```

---

## T4 Toast 支持撤销按钮与自定义时长（并存加新，暂无调用方）

**改动**
- `src/store/types.ts` —— `ToastMessage` 加 `action?: { type: 'undo' }`、`durationMs?: number`。
- `src/store/index.ts` —— 新增语义入口 `setUndoToast({ code, message, durationMs })`（不给 `setError`/`setSuccess` 加参数，保持「kind 由方法名承载」的既有约定）。
- `src/components/ui/Toast.tsx`
  - `action?.type === 'undo'` 时在关闭按钮左侧渲染文字按钮，点击 → `useStore.getState().undo()` + `clearToast()`。
  - 自动消失时长改读 `shown.durationMs ?? 4000`。
  - **带 `action` 时 hover 不暂停**（否则撤销窗口照跑、按钮成假入口）；无 action 保留现有 hover 暂停。
  - 按钮沿用 Toast 内既有恒浅色固定深色文字语汇 + `motion-safe:active:scale-[0.92]`，不新增按钮组件。
- i18n × 11 —— `common.undo`。

**测试**
- `src/components/ui/Toast.test.tsx`（若无则新建）—— 有 action 渲染撤销按钮、点击调 `undo`；无 action 不渲染；`durationMs` 生效（假计时器）；有 action 时 hover 不阻止消失。

**验证**
```bash
pnpm exec vitest run src/components/ui/Toast.test.tsx
```

---

## T5 延迟删除机制（并存加新，UI 暂不切换）

本任务只加 `requestDeleteAssets` 及其配套，**不动任何 UI 入口**，`deleteCanvasItem` 保持原样可用。

**改动**
- `src/lib/pgc/client.ts` —— `deleteCanvasItem` 支持 `keepalive` 选项（`beforeunload` 送出用）。
- `src/store/actions.ts`
  - 闭包注册表 `pendingDeletes: Map<string, PendingDelete>`（沿用 `inflight` 做法，不进 store）。
  - `requestDeleteAssets(ids)`：拆分 `pending_` 占位卡（走原即时路径）与真实 item（快照 + 移除 + 起 `DELETE_GRACE_MS` 定时器 + `pushUndo` + `setUndoToast`）。
  - `flushPendingDelete(token)`：逐个 DELETE → 清注册表项 → **从 `undoStack` 移除该 token 的 entry**（撤销按钮存在 ⟺ 真能撤销）。
  - `flushAllPendingDeletes(opts?: { keepalive })`：切项目 / `beforeunload` 用。
  - `undo()` 加 `delete` 分派：清定时器 → 快照原位放回 → 删注册表项（**不 PATCH 坐标**，服务端 item 与坐标都没动过）。
  - `loadCanvas` 结果**过滤掉** `pendingDeletes` 覆盖的 id（否则待删项被拉回复活）。
  - `switchProjectSession` / `selectProject` 切项目前 `flushAllPendingDeletes()`。
- `src/client/` —— `beforeunload` 挂 `flushAllPendingDeletes({ keepalive: true })`（放既有 hook 或新建极薄 hook，副作用留在 `client/` 层）。

**测试**
- `src/store/pending-delete.test.ts`（新，注入假计时器 + 假 pgcApi）
  - 发起后卡片立即从 `assets` 移除、DELETE **尚未**发出；
  - 窗口到点后 DELETE 发出、entry 从栈移除；
  - 窗口内撤销：卡片原位复原、DELETE **从未**发出；
  - 窗口内 `loadCanvas` 返回含待删 item → 不复活；
  - 切项目 → 立即 flush；
  - `pending_` 占位卡不进窗口（走即时移除 + abort）；
  - 两组并存各自独立到点。

**验证**
```bash
pnpm exec vitest run src/store/pending-delete.test.ts
```

---

## T6 原子切换：删除入口改走延迟删除

**改动**
- `src/components/canvas/ContextMenu.tsx` —— 单选「删除」直接 `requestDeleteAssets([id])`，**不再** `openDeleteModal`；多选「删除 N 个」仍 `openDeleteModal`。
- `src/components/canvas/AssetCanvas.tsx` —— Delete/Backspace：单选直接删、多选开 modal。
- `src/components/canvas/DeleteAssetModal.tsx` —— 确认后改调 `requestDeleteAssets(ids)`（仍走延迟窗口，仍可撤销）。
- `src/store/index.ts` —— `deleteSelected` 改为委托 `requestDeleteAssets`。
- i18n × 11 —— `canvas.undo.delete`。
- 同步更新既有测试：`ContextMenu.test.tsx`、`DeleteAssetModal.test.tsx`。

**验证**
```bash
pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx src/components/canvas/DeleteAssetModal.test.tsx
```

---

## T7 删旧与全量验证

实现中发现的连带结果（计划未预料，实测确认）：**「删除中态」整套机制已不可达**。
唯一写 `deletingIds` 的地方是 `deleteCanvasItem` 的非占位分支，而延迟删除接管后该分支再无调用方
——卡片在发起那一刻就离开画布，根本不存在「删除请求在途」这个可见状态。按仓库「不堆叠废弃机制」的约定整块删除：

- `store/actions.ts` —— `deleteCanvasItem` 收敛为 `removePlaceholderAsset`（仅占位卡本地移除 + abort 在飞请求），不再对外导出；删除入口全局只剩 `requestDeleteAssets`。
- `store/types.ts` / `store/index.ts` —— 移除 `deletingIds` 状态与切项目清理。
- `components/canvas/nodes/NodeCard.tsx` —— 移除删除中覆盖层、`aria-busy`、去饱和容器（连带那层空壳 div）。
- `app/globals.css` —— 移除 `.node-deleting` 压制规则、`pulse-soft` keyframes 及其 reduced-motion 禁用项。
- i18n × 11 —— 移除 `canvas.deleting`（`chat.project.deleting` 是另一个键，保留）。
- 测试 —— 删除 `NodeCard.test.tsx` 的两个删除中态 describe、`actions.test.ts` 的三个悲观删除用例；其余 `deleteCanvasItem` 调用点改走 `requestDeleteAssets`（测真实公共入口）。

收口检查：

- `undoStack` 归 ServerState 但**不在** `partializeAppState` 白名单 → 不落盘；`localStorage` key `taluna-v4` 与 `layout.tsx` 防白闪脚本无需改动。
- 真实环境走一遍成功标准 1–9（`pnpm dev`，按 spec 九条逐条点）。

**验证**
```bash
pnpm lint            # 0 error（8 个既有 warning，均在未改动文件）
pnpm exec tsc --noEmit
pnpm test            # 214 files / 2189 tests
pnpm build
```

**验证**
```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

---

## 提交约定

- 每个任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
