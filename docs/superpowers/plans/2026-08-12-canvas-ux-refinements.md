# 实现计划：画布交互五项打磨（2026-08-12）

对应 spec：`docs/superpowers/specs/2026-08-12-canvas-ux-refinements.md`
分支：`feat/canvas-ux-refinements`（worktree `.orca/worktrees/feat+canvas-ux-refinements`）

每个任务一次提交，提交后派干净上下文子代理按 commit 范围评审（只给 spec + diff）。
替换既有机制的两处（资产细节形态、框内手势）按「并存加新 → 原子切换 → 删旧」推进。

---

## T1 对齐口径收窄到边缘 + 辅助线不外延

**改动**
- `src/lib/align-guides.ts`：`xEdges` / `yEdges` 去掉中线特征值（只留 `r.x` / `r.x+r.w`）；`GUIDE_PAD` 12 → 0。
- `src/components/canvas/AlignGuides.tsx`：虚线改为显式 4/4 节奏的 `repeating-linear-gradient`（`1/zoom` 补偿改作用于线宽方向的尺寸），不再用 `border-dashed`。

**测试（先写失败测试）**
- `align-guides.test.ts`：① 两卡中心对中心相距 2px 时**不**吸附、不产生 guide（现在会）；② 边对边命中时 guide 的 `from/to` 正好等于参与卡的最外缘（无 ±12）。
- `AlignGuides.test.tsx`：断言渲染出的虚线用的是 gradient 背景而非 `border-*-dashed`，且尺寸随 zoom 补偿。

**验收**：`pnpm exec vitest run src/lib/align-guides.test.ts src/components/canvas/AlignGuides.test.tsx`

---

## T2 对齐开关（统辖网格 + 边缘对齐）

**改动**
- `src/store/index.ts`：`UIState` 加 `alignEnabled: boolean`（初值 `true`）、action `toggleAlign`；加入 `partializeAppState`。
- `src/components/canvas/AssetCanvas.tsx`：
  - `snapToGrid={alignEnabled && !altBypass}`；
  - `applyDragSnap` 的 `bypass: altBypass || !alignEnabled`；
  - 关闭时 `setGuides([])` 不产生残留线。
- `ZoomBar` 增一枚 `IconButton`（`figAsset.grid`，`raised-active` 表示开），放在 minimap 与列表按钮之间。
- i18n 11 语新增 `canvas.alignToggle`。

**测试**
- store 测试：默认开、toggle 翻转、进持久化切片。
- `AssetCanvas.test.tsx`（沿用现有 RF 测试脚手架）：关闭态下拖拽不产生 `align-guide-*` 节点；开启态下产生。

**验收**：`pnpm exec vitest run src/store src/components/canvas/AssetCanvas.test.tsx` + `pnpm exec tsc --noEmit`

---

## T3 资产列表面板：自适应高度 + 垂直居中

**改动**
- `src/components/canvas/AssetListDrawer.tsx`：根容器定位由 `top-16 bottom-24` 改为垂直居中（`top-1/2 -translate-y-1/2`），高度 `h-auto` + `min-h-[240px]` + `max-h-[min(520px, 可用高度)]`；列表区保持 `min-h-0 flex-1` 内滚。
- 拖拽把手 `inset-y-2` 不变。

**测试**
- `AssetListDrawer.test.tsx`：断言根容器带居中定位与高度夹取的类；`min-h-0` 仍在列表区（防内滚失效）。

**验收**：`pnpm exec vitest run src/components/canvas/AssetListDrawer.test.tsx`

---

## T4a 抽出共用件（行为不变的纯重构）

为「细节 + 动作」合成一个浮窗做准备，先把两边要复用的部分抽出来，**此步不改任何可见行为**。

**改动**
- 新 `src/components/canvas/AssetDetailBody.tsx`：把 `AssetInspector.tsx` 里的 `SingleAsset` / `KindBadge` / `SectionLabel` / `LineageLink` 原样搬过来导出；`AssetInspector` 改为 import 它。
- 新 `src/lib/asset-actions.ts`：把 `ContextMenu` 单选那四项（引用 / 重命名 / 下载 / 删除）的**可用性判据与项定义**抽成纯函数 `singleAssetActions(asset)`，返回 `{ key, icon, labelKey, disabled }[]`；副作用（onClick 里调 action）留在组件侧按 key 分派。
- `ContextMenu.tsx` 单选分支改用 `singleAssetActions`。

**测试**
- `asset-actions.test.ts`：各类资产的项集合与置灰判据（对齐今天 `canMention` / `canDownloadAsset` 的结果）。
- 现有 `ContextMenu.test.tsx` / `AssetInspector.test.tsx` 全绿即证明行为未变。

**验收**：`pnpm exec vitest run src/lib/asset-actions.test.ts src/components/canvas/ContextMenu.test.tsx src/components/canvas/AssetInspector.test.tsx`

---

## T4b 贴卡浮窗（并存加新 + 原子切换右键）

**改动**
- `src/store/index.ts`：加 `assetDetail: { id: string; anchor: 'card' } | { id: string; anchor: 'cursor'; x: number; y: number } | null`（瞬态，不持久化）+ actions `openAssetDetail` / `closeAssetDetail`；切项目 / 资产被删 / 被筛掉时清空。
- 新 `src/components/canvas/AssetDetailPopover.tsx`：
  - 上段 `AssetDetailBody`，下段动作区（`singleAssetActions` + 分派）；
  - `anchor: 'card'` 时从 RF store 取该节点当前 position（拖拽期 RF 领先 store，取 RF 那份才跟手）+ `useViewport` 换算成屏幕坐标，屏幕像素口径渲染；`anchor: 'cursor'` 时用固定屏幕坐标、不跟随；
  - 贴边夹取沿用既有菜单口径（优先右侧，不够翻左；上下夹进视口留 8–12px）；
  - 遮罩：点击 / `onWheel` / Esc 关闭（`onWheel` 关闭以放行画布缩放，同 ContextMenu 的坑）。
- 新 `src/lib/popover-anchor.ts`：锚点 → 最终屏幕坐标的纯函数（画布坐标×zoom+offset、翻转与夹取），单测。
- `AssetCanvas.tsx`：`onNodeContextMenu` 单选走 `openAssetDetail`，多选仍 `openContextMenu`；`onSelectionContextMenu` 不变；挂载 `<AssetDetailPopover />`。
- `AssetListDrawer.tsx`：行右键单选走 `openAssetDetail({ anchor: 'cursor' })`，多选仍 `openContextMenu`。
- `ContextMenu.tsx`：删掉单选分支（此后只服务多选），`menu.ids.length === 1` 不再可能。

**测试**
- `popover-anchor.test.ts`：右侧空间不足翻左；上下夹取；zoom 变化只改位置不改尺寸。
- `AssetDetailPopover.test.tsx`：单选渲染细节 + 四项动作；点击动作走对应 action；Esc / 滚轮关闭。
- `AssetCanvas` 测试：单选右键不再出 ContextMenu、出浮窗；多选右键仍出 ContextMenu。

**验收**：`pnpm exec vitest run src/components/canvas src/lib/popover-anchor.test.ts`

---

## T5 删旧：右侧常驻面板与工具条开关

**改动**
- 删 `src/components/canvas/AssetInspector.tsx` 与其测试（内容已在 `AssetDetailBody`）。
- `AssetCanvas.tsx`：删 `inspectorOpen` / `toggleInspector` 的读取与传参、ZoomBar 的详情按钮与相关 props。
- `src/store/index.ts`：删 `inspectorOpen` / `toggleInspector` 及其 `partialize` 项。
- `GenTaskBadge.tsx`：右偏移恒 `right-5`（不再让位于面板）。
- i18n：`canvas.inspector.toggle` 词条清理（其余 `canvas.inspector.*` 仍被 `AssetDetailBody` 使用，保留）。

**验收**：`pnpm test` 全绿 + `pnpm lint` + `pnpm exec tsc --noEmit`（此步专抓残留引用）

---

## T6 成组立即生效

**改动**
- `src/lib/ids.ts`：加 `pending_group_` 前缀常量与 `isPendingGroupId`。
- `src/store/actions.ts` `createGroupFromSelection`：
  1. 同步 `set` 出临时框（临时 id、几何、颜色）并把成员 `groupId` 指向它；
  2. 发 `createCanvasGroup`；
  3. 成功：把框 id 与成员 `groupId` 从临时 id 重映射为真 id，冲刷乐观期堆积的回写（按框 id 存「最终状态」，只发一次）；
  4. 失败：移除临时框、成员归属回滚，`setError({ code: 'GROUP_CREATE_FAILED' })`。
- 乐观期回写拦截：`renameGroup` / `updateGroupGeometry` / `moveGroup` / `assignGroup` 遇临时 group id 时**只改本地**并把最终状态记进 pending 表，由步骤 3 冲刷。
- `src/i18n/errors.ts` + 11 语：`GROUP_CREATE_FAILED` → `errors.groupCreateFailed`。

**测试**
- `actions.test.ts`：① 创建期间（promise 未 resolve）框已在 `groups` 且成员 `groupId` 已指向它；② 失败后框消失、成员归属恢复、toast 为 `GROUP_CREATE_FAILED`；③ 乐观期改名 + 缩放，真 id 到位后只发一次带最终状态的 PATCH；④ 乐观期往框里拖卡，真 id 到位后归属回写带真 id。

**验收**：`pnpm exec vitest run src/store/actions.test.ts`

---

## T7 框内空白拖动分组 + ⌥ 框选

**改动**
- `src/lib/rf-nodes.ts` `buildGroupNodes`：`style.pointerEvents` 由 `none` 改为 `auto`；`dragHandle` 去掉（改为整框可拖）—— 或保留 `dragHandle` 并把框体也打上该 class，取实现更稳的一种，在提交信息中说明。
- `src/components/canvas/nodes/GroupNode.tsx`：框体 `pointer-events-auto`；⌥ 按下时框体临时 `pointer-events: none`（让事件穿透到 pane，橡皮筋框选照常起手）。⌥ 态读现有 `useAltBypass`。
- 卡片仍在框之上（`zIndex:-1` 不变），框内点卡仍是拖卡。

**测试**
- `GroupNode.test.tsx`：框体默认 `pointer-events-auto`；⌥ 按下后转 `none`；标题条与把手行为不变。
- `rf-nodes.test.ts`：分组节点的 pointerEvents / dragHandle 契约。

**验收**：`pnpm exec vitest run src/components/canvas/nodes/GroupNode.test.tsx src/lib/rf-nodes.test.ts`

---

## T8 移入 / 移出分组高亮

**改动**
- `AssetCanvas.tsx` `onNodeDrag`（拖卡分支，非拖框）：按被拖卡中心实时 `groupHitFor` 算命中框 id，存组件本地 state（瞬态，不进 store）；`onNodeDragStop` / `onNodeDragStart` 清空。
- 传给 `buildGroupNodes` 的 data 加 `highlight: 'drop' | 'leave' | null`：命中框 = `drop`；被拖成员的原框且当前命中≠原框 = `leave`。
- `GroupNode.tsx`：`drop` → 描边转 `--color-teal` + 底色加深；`leave` → 描边转虚线并减淡。两态都在 `prefers-reduced-motion` 下退化为无过渡。
- 拖拽期需要更新框节点的 data，但 sync effect 在拖拽期被 `isDraggingRef` 挡住 —— 与 `onNodeDrag` 里已有的成员跟随同法，直接 `setRfNodes` 只改框节点的 data（不碰被拖节点）。

**测试**
- `canvas-group.test.ts`：高亮判定纯函数（命中框 / 原框 / 无框三种输入 → 两态）。
- `GroupNode.test.tsx`：两态的视觉契约（描边色 / 虚线）。

**验收**：`pnpm exec vitest run src/lib/canvas-group.test.ts src/components/canvas/nodes/GroupNode.test.tsx`

---

## 合并前

1. 终审全分支（干净上下文子代理，spec + 全 diff）；
2. 合并结果上重跑 `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`；
3. `--no-ff` 合并进 dev，跑 `/walkthrough` 出走读并更新 `docs/FEATURE-MAP.md`。

## 已知风险

- **T7 推翻旧决策**：框内空白从「框选」变「拖框」是肌肉记忆级改动，⌥ 补回框选。若真机上 ⌥ 与浏览器/系统手势冲突（macOS 上 ⌥ 拖拽常被截走 keyup，`useAltBypass` 已有 blur 兜底），备选是改用空格或中键。
- **T4b 跟随性能**：浮窗每帧读 RF store 节点位置，只订阅单个节点的 position（RF 的 `useStore` 选择器 + 浅比较），避免整块画布重渲。
- **T6 重映射**：临时 group id 泄漏到后端是最大风险面（会 404），故所有回写路径都要过 `isPendingGroupId` 门。
