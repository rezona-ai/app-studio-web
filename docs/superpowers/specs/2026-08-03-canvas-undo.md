# 画布撤销（⌘Z）与延迟删除

> 状态：设计稿 · 2026-08-03
> 关联：P0 三块之一（另两块「搜索跳转」「创作溯源」单独立项，本稿不涉及）

## 目的

给画布补上**撤销**这一层安全网，消除「操作不可逆 → 用户不敢动」的信任缺口。

当前画布上四类操作立即落库且**没有任何回退路径**：

| 操作 | 落点 | 现有保护 |
|---|---|---|
| 一键整理 | `actions.ts` `tidyCanvas` —— 重排**全部**卡片坐标 + 逐卡 fire-and-forget PATCH | **无** |
| 拖动落位 | `AssetCanvas.tsx` `persistDraggedNodes` → `setAssetPositions` + PATCH | **无** |
| 删除 | `actions.ts` `deleteCanvasItem` —— `DELETE /canvas/items/{id}` 硬删 | 二次确认 modal |
| 重命名 | `index.ts` `renameAsset` —— 乐观改名 + PATCH | 无（失败才回滚） |

其中**一键整理是最危险的按钮**：它挂在工具条最显眼处、无二次确认、一次点击就摧毁用户手工摆布的全部空间语义，且无法回退。

## 约束

1. **删除是硬删，服务端无 restore 端点**（`client.ts:103` 只有 `DELETE`，且没有通用 `POST /canvas/items` 创建端点，只有 generate/import/text/upload）。
   → 「删完再恢复」不可行。可撤销删除**只能**实现为**延迟删除**：先从画布移除 + 给撤销窗口，窗口结束才真正发 DELETE。
2. **不做重做（redo）**。单向栈，YAGNI；且 redo 与延迟删除组合会产生无法实现的语义（重做一个已真删的删除 = 需要重新创建 item）。
3. **不新增后端契约**。全部改动在前端，复用现有 PATCH / DELETE 端点。
4. **遵循既有架构不变式**：
   - store 是唯一落库入口，撤销栈进 store，撤销动作是 store action；
   - 撤销栈**瞬态不持久化**（撤销栈语义是「本次会话内的后悔」，刷新后服务端状态已是最新，持久化它属于仓库明列的反模式）；
   - 撤销栈**按项目隔离**，切项目即清空（避免在 A 项目撤销 B 项目的移动）；
   - 不可序列化的瞬态（定时器句柄）放 actions 闭包注册表，沿用 `inflight` 的既有做法；
   - store 不直接碰 React Flow，视口操作经 `lib/viewport.ts` 注册表，沿用 `registerEnsureVisible` 的既有做法。
5. **UI 复用既有令牌 / 组件 / 动效**，不新增按钮种类、不自造 toast、不写一次性 keyframes。

## 成功标准

1. 一键整理后按 ⌘Z，**卡片坐标与视口一起**回到整理前的状态，且坐标回写服务端。
2. 拖动一张或一组卡片后按 ⌘Z，回到拖动前坐标。
3. 删除单张卡：**不弹 modal**，卡片立即消失，Toast 出现并带「撤销」按钮；点撤销卡片原位复原，且服务端 item 从未被删除。窗口内不点，Toast 消失时才真正发出 DELETE。
4. 删除多张（≥2）：仍先弹二次确认 modal；确认后同样进入延迟窗口，仍可撤销。
5. 重命名后按 ⌘Z 回到旧名。
6. 撤销后：Toast 报出撤销了什么（「已撤销：一键整理」），受影响卡片被选中并保证进入视口（越界才平移，视口内不动）。
7. 焦点在输入框 / 文本域 / contentEditable 时，⌘Z 放行给浏览器原生文本撤销，不误触画布撤销。
8. 延迟窗口内刷新 / 关标签页 / 切项目，待删项**照常删除**（删除是承诺，只是给了几秒后悔）。
9. 延迟窗口内 `loadCanvas` 刷新画布（如 `run.finished` 后），待删项**不得复活**。
10. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` 全绿。

## 现状要点（实现前必读）

- **撤销栈无先例**，全仓库 `grep -i undo` 只有图标资源。
- `ToastMessage`（`store/types.ts:139`）= `{ code, message, kind }`，`Toast.tsx` 单槽、4s 自动消失、hover 暂停、**无 action 按钮**。
- `deleteCanvasItem`（`actions.ts:720`）对 `pending_` 占位卡走单独分支（abort 在飞请求 + 本地移除），对真实 item 走 `deletingIds` 删除中态 + guard 悲观流。
- `tidyCanvas`（`actions.ts:962`）已经是「一次 `set` + 对变位卡 fire-and-forget PATCH」；`onTidy`（`AssetCanvas.tsx:480`）在其后 `fitView` 并 `setProjectViewport` 持久化框景。
- `lib/viewport.ts` 已有三个注册表（`viewportCenter` / `ensureVisible` / `screenToCanvas`），AssetCanvas 挂载时注册、卸载时注销。
- `lib/canvas-keys.ts` 已有 `shouldTriggerCanvasDelete` 纯函数判定 + `isEditableTarget` 共用口径。

## 方案

### 1. 撤销栈：判别联合数据，不存闭包

```ts
// store/types.ts
export type UndoEntry =
  // 移动 / 一键整理共用同构 payload:把这批卡恢复到这批坐标。op 只用于 Toast 文案与是否还原视口
  | { type: 'positions'; op: 'move' | 'tidy'; pid: number; positions: { id: string; x: number; y: number }[]; viewport?: Viewport }
  | { type: 'rename'; pid: number; id: string; label: string }
  // 延迟删除:撤销 = 取消待删,不需要坐标回写(服务端 item 从未被删)
  | { type: 'delete'; pid: number; token: string };
```

存**数据**而非闭包：可单测、可断言、不违反「store 存状态不存行为」。`undo()` action 按 `type` 分派。

- `UIState.undoStack: UndoEntry[]`（瞬态，**不进 persist 白名单**）。
- 深度上限 20，`push` 时超出丢最旧。
- `switchProjectSession` 切项目时在**同一次 `set`** 内清空（沿用「切项目在同一次 set 内清空会话态」的既有不变式）。

### 2. 延迟删除

**定时器与快照放 actions 闭包注册表**（沿用 `inflight` 做法，不进 store）：

```ts
type PendingDelete = { pid: number; assets: Asset[]; timer: ReturnType<typeof setTimeout> };
const pendingDeletes = new Map<string, PendingDelete>();   // token → 待删组
```

流程：

1. **发起**（`requestDeleteAssets(ids)`，取代 UI 直接调 `deleteCanvasItem`）
   - `pending_` 占位卡**不进延迟窗口**，保持现状（立即移除 + abort 在飞请求）。理由：无服务端 item，且在飞请求已 abort 无法复原，「撤销」无从可撤。混在一组时只对真实 item 建窗口。
   - 真实 item：快照被删 assets → 从 `assets` 移除 → 登记 `pendingDeletes` + 起 `DELETE_GRACE_MS` 定时器 → push `{ type: 'delete', token }` → Toast 带撤销按钮。
2. **窗口到点**（`flushPendingDelete(token)`）：逐个 `DELETE`，成功后清 `pendingDeletes` 项，并把栈中该 token 的 entry 移除（**撤销按钮存在 ⟺ 真的还能撤销**，不留假入口）。
3. **撤销**：清定时器 → 快照 assets 原位放回 → 删 `pendingDeletes` 项。**不需要 PATCH 坐标**（服务端 item 与坐标都没动过）。

**四处边界（缺一个就是 bug）**：

| 边界 | 处理 |
|---|---|
| 切项目 | 立即 flush 全部待删（不能带着待删跨项目） |
| 刷新 / 关页 | `beforeunload` 用 `fetch(..., { keepalive: true })` 送出 DELETE |
| `loadCanvas` 刷新画布 | 结果里**过滤掉** `pendingDeletes` 覆盖的 id —— 否则待删项被重新拉回画布复活 |
| 窗口内又删了别的 | 多个 token 各自独立定时器并存；Toast 单槽会被后一条顶掉，但两条的删除都会按各自定时器正确执行，且 ⌘Z 仍能逐个撤销（栈中都在）。可接受。 |

### 3. Toast 加撤销按钮

`ToastMessage` 扩展两个可选字段（**存描述符不存闭包**，与撤销栈同一原则）：

```ts
export type ToastMessage = {
  code: string; message: string; kind: ToastKind;
  action?: { type: 'undo' };   // 渲染撤销按钮,点击 → useStore.getState().undo()
  durationMs?: number;          // 缺省 4000
};
```

- 撤销类 Toast `durationMs = DELETE_GRACE_MS`，与删除窗口**同一常量**，做到「Toast 在 ⟺ 可撤销」。
- 带 `action` 的 Toast **不受 hover 暂停影响**（否则 hover 住 Toast 时删除定时器照跑，撤销按钮变成假入口）。hover 暂停仅对普通 Toast 保留。
- 按钮样式复用 Toast 内既有的恒浅色文字按钮语汇（同关闭按钮的固定深色文字），不新增按钮组件。

### 4. 撤销后的反馈

1. Toast 报「已撤销：<操作名>」（`setSuccess` 通道）。
2. `setSelection(受影响 ids)` —— 天然获得既有 `.node-beam` 选中光束 + 视觉焦点，语义也对（撤销后这些正是当前操作对象），**零新增 CSS**。
3. `ensureVisible(受影响卡片包围盒左上角)` —— 复用既有注册表，越界才平移，视口内不动。
4. `op === 'tidy'` 额外还原视口：`tidyCanvas` 新增 `viewportBefore` 入参存进 entry，撤销时经新增的 `registerSetViewport` 注册表还原（与 `registerEnsureVisible` 同款机制）。

### 5. ⌘Z 判定下沉为纯函数

`lib/canvas-keys.ts` 加 `shouldTriggerUndo(e, activeEl)`：`(metaKey || ctrlKey) && key === 'z' && !shiftKey && !isEditableTarget(activeEl)`。与 `shouldTriggerCanvasDelete` 共用 `isEditableTarget` 口径，可单测。

监听挂 window（与既有 zoom / delete / ⌘K 快捷键一致）。焦点在 Chat 非输入区按 ⌘Z 也撤销画布操作 —— 画布是主工作区，且撤销栈只含画布操作，不会误撤对话。

## 取舍与明确不做

- **不做 redo** —— 见约束 2。
- **不做无限撤销 / 持久化撤销** —— 深度 20，瞬态。
- **不解决 tidy 撤销的 N 个 PATCH 风暴** —— 撤销一次整理会 fire-and-forget N 个 PATCH，与现状 `tidyCanvas` 本身的行为一致，不引入新问题。批量坐标端点属于另一个议题（P2「坐标回写无批量、失败静默」），不在本次范围。
- **不做撤销倒计时视觉**（Toast 上的进度条 / 秒数）—— Toast 消失即窗口结束已让语义自洽，倒计时是锦上添花，YAGNI。
- **多选删除保留 modal** —— 批量误删损失大，且依赖用户在几秒内反应不可靠，事前确认仍有价值。确认后同样进延迟窗口，两层保护不冲突。

## 落地后的偏差记录

1. **i18n 文案不用插值**。原打算 `canvas.undo.done`「已撤销：{{op}}」，但 Toast 的 `resolveErrorMessage(code, fallback, t)` 不透传 t 的 options，无法插值。改为每类操作一个完整句子的 code：`UNDO_MOVE` / `UNDO_TIDY` / `UNDO_RENAME` / `UNDO_DELETE` / `UNDO_DELETE_PENDING`。
2. **撤销栈归 ServerState 而非 UIState**。`tidyCanvas` 与延迟删除都在 `actions.ts` 入栈，而那层只依赖 `StoreSlice = KoubouState & ServerState`（刻意不经 `get()` 取 action，避免类型环）。上限规则下沉为纯函数 `store/undo-stack.ts` 的 `pushUndoEntry`，两层共用同一份。
3. **入栈位置分两种**：`move` / `rename` 在**发起处**（`AssetCanvas` / `RenameAssetModal`）入栈 —— 这样 `undo()` 能直接复用 `renameAsset` 回旧名而不自撤销递归；`tidy` / `delete` 在 **action 内**入栈，因为它们还有非 UI 的内部调用方（压缩包导入后自动整理）。
4. **延迟删除额外摘下在途 genTask**。被删卡若有异步生成任务在跑，留着会被轮询原位替换回画布（复活）；撤销时一并还原。这是计划未列出的第五处边界。
5. **「删除中态」整套删除**（见实现计划 T7）：延迟删除下卡片立即离开画布，`deletingIds` 再无写入方，该机制连同 NodeCard 覆盖层、`.node-deleting` CSS、`canvas.deleting` 文案一并移除。零用户可见影响（覆盖层已不可能渲染）。
