# 实现计划：分组框可访问性收口 + 光标菜单三处既有债

spec：`docs/superpowers/specs/2026-08-13-group-a11y-and-menu-debts.md`
分支：`feat/canvas-group-a11y-and-menu-debts`（worktree `.orca/worktrees/feat+canvas-group-a11y-and-menu-debts`）

七个任务，各自可独立测试、独立评审、独立提交。顺序按「先纯逻辑、后接线、最后视觉」排：纯函数先落地，后面的任务才能直接用。

---

## 任务 1（A2）：快捷键统一让位给任何浮层

**改动点**
1. `src/lib/canvas-keys.ts`：新增纯函数 `canvasOverlayOpen(flags)`（入参是一组布尔 / 可空字段，返回是否有浮层打开）；四条判据的第 4 个形参从 `lightboxOpen` 改名 `overlayOpen`（**只改名 + 语义扩大，判定位置不动**）。
2. `src/components/canvas/AssetCanvas.tsx`：四处调用点改为传 `canvasOverlayOpen(useStore.getState())`。
3. ⌘Z 那条**不动**（撤销不依赖选区，弹窗开着时也该能用）。

**测试**：`canvas-keys.test.ts` 给 `canvasOverlayOpen` 补表驱动（八个字段各单独为真 → true；全空 → false）；四条判据的既有用例把第 4 参当 `overlayOpen` 读，语义不变故不必改断言。`AssetCanvas.contextmenu.test.tsx` 补一条「素材库开着时 Backspace 不删框」。

**提交**：`fix(canvas): 删除与位移快捷键让位给任何浮层,不只 lightbox`

---

## 任务 2（A1）：把「入框/出框只能靠拖」钉成预期行为

**改动点**：`AssetCanvas.tsx` 的 nudge commit 处加注释说明**刻意不重判归属**及理由（决策 2）。零行为改动。

**测试**：`AssetCanvas.nudge.test.tsx` 补一条：卡片经方向键落进框的几何范围后，`assets[0].groupId` 仍为 undefined、且 `persistAssetPositions` 的调用**不带** groupChanges。这条是「反向锁」——它红的时候说明有人在给微调加归属重判，得先回来改 spec。

**提交**：`test(canvas): 钉住「方向键微调不改归属」这条预期行为`

---

## 任务 3（B1 + B2）：标题条改中性文字 + 中点对读屏隐身

**改动点**
1. `src/components/canvas/nodes/GroupNode.tsx`：标题条 `style={{ color: FRAME }}` 拆开——框名 `text-[var(--color-ink)]`、计数 `text-[var(--color-muted)]` 且**删掉 `opacity-60`**；中点也走 muted 并加 `aria-hidden`。框体描边 / 柔光底不动。
2. `src/components/canvas/AssetListDrawer.tsx`：三处裸 `·` 加 `aria-hidden`。

**测试**：`GroupNode.test.tsx` 断言框名与计数的类名取 ink / muted、不含 `opacity-60`、中点带 `aria-hidden`；`AssetListDrawer.test.tsx` 断言三处中点带 `aria-hidden`。

**提交**：`fix(ui): 分组标题文字改中性色补足对比度,分隔中点对读屏隐身`

---

## 任务 4（A4 + D3）：Tab 焦点环 + Enter/Space 选中 + 标题条可点选

**改动点**
1. `src/lib/canvas-keys.ts`：新增纯函数 `groupIdFromFocus(activeEl)` —— 从聚焦元素向上找 `.react-flow__node-group[data-id]`（RF 的节点 wrapper），返回框 id 或 null；再加 `shouldSelectFocusedGroup(key, activeEl, overlayOpen)`（`Enter` / `Space` + 焦点在框上 + 无浮层）。
2. `src/components/canvas/AssetCanvas.tsx`：新增一个 keydown effect —— 命中则 `preventDefault`（`Space` 不滚页）+ `selectGroup(gid)`。
3. `src/app/globals.css`：给 `.react-flow__node-group:focus-visible` 一条 `outline: 2px solid var(--color-teal); outline-offset: 2px`（焦点环与选中的柔光外晕视觉可分；无动画，不涉及 reduced-motion）。
4. `GroupNode.tsx`：标题条挂与框体同一对 `onMouseDownCapture` / `onClick`。

**测试**：`canvas-keys.test.ts` 表驱动两个新纯函数（含「焦点在卡片节点上 → null」「焦点在输入框 → 不触发」）；`GroupNode.test.tsx` 补「点标题条 → 选中」「标题条拖过之后的 click 不算点选」「双击标题条仍进改名态且顺带选中」；`AssetCanvas.contextmenu.test.tsx` 补「焦点在框 wrapper 上按 Enter → selectGroup」。

**提交**：`feat(canvas): 框支持 Tab 聚焦 + Enter 选中,标题条也可点选`

---

## 任务 5（A3）：手型 / ⌥ 下由 pane 兜住框的右键与点选

**改动点**：`AssetCanvas.tsx`
- 新增 `onPaneContextMenu`：`screenToFlowPosition` → `groupHitFor` 命中框则 `preventDefault` + `openGroupMenu`，否则不拦（保持今天的原生菜单行为）。
- `onPaneClick` 里同款命中判定：命中框 → `selectGroup(gid)`；没命中 → 照旧清掉所有浮层与选中。

**测试**：`AssetCanvas.contextmenu.test.tsx`（RF 桩夹具已捕获 props）补：喂一个落在框几何内的 `onPaneContextMenu` 事件 → `groupMenu` 打开且 `preventDefault` 被调；落在框外 → 不打开、不 `preventDefault`；`onPaneClick` 落框内 → 选中该框，落框外 → 清空。桩需要补 `screenToFlowPosition`（既有 `AssetCanvas.test.tsx` 已有同款桩法可抄）。

**提交**：`fix(canvas): 手型工具 / ⌥ 下框的右键与点选由 pane 兜住`

---

## 任务 6（D2）：菜单壳夹进视口 + z 阶梯 + Esc

**改动点**
1. `src/lib/popover-anchor.ts`：新增 `clampMenuToViewport(point, size, viewport)`，复用既有 `VIEWPORT_MARGIN` 与 `clamp`（含「菜单比视口还大 → 贴左上角」那条既有边界语义）。
2. `src/components/canvas/ContextMenuShell.tsx`：宽度已是常量 276px，高度用 `ResizeObserver` 实测（与 `AssetDetailPopover` 同款，内容行数不定）；遮罩 `z-40` → `z-[55]`、浮层 `z-50` → `z-[56]`；补 Esc 关闭。
3. 两个菜单（`ContextMenu` / `GroupContextMenu`）不改一行 —— 全部收在壳里。

**测试**：`popover-anchor.test.ts` 给 `clampMenuToViewport` 补表驱动（四角 + 超大菜单）；`ContextMenu.test.tsx` / `GroupContextMenu.test.tsx` 各补 Esc 关闭；`ContextMenu.test.tsx` 补 z 值断言（`z-[55]` / `z-[56]`）。

**提交**：`fix(ui): 光标菜单夹进视口、对齐 z 阶梯并支持 Esc 关闭`

---

## 任务 7（D1）：ja / ko 卡片量词统一

**改动点**：`src/i18n/locales/ja.ts` 的 `errors.positionSaveFailed` / `errors.groupAssignFailed` 把「件」改「枚」；`ko.ts` 同两条把「개」改「장」。

**测试**：i18n 既有的 key 集合一致性测试已覆盖结构；文案本身不写断言（会变成复述文案的死测试）。人工核读一遍。

**提交**：`fix(i18n): ja/ko 的卡片量词统一到枚 / 장`

---

## 每个任务后

任务 1–4 做完派一次评审、5–7 做完派一次评审（两批而非七次，任务粒度小且互不耦合）；Critical / Important 修完才继续。全部完成 → 终审全分支 → `--no-ff` 合回 dev → 合并结果上重跑完整验证 → `/walkthrough`。

## 已知风险

- **任务 5 的 pane 命中判定与橡皮筋框选起手的边界**：`onPaneClick` 只在「点」的时候触发（框选是拖，RF 不会派发 pane click），理论上不冲突；但 ⌥ 的语义本来就是「把框内让给框选」，命中判定会让「⌥ + 点框内空白」变成选中框而不是什么都不做 —— 这是新行为，需真机确认手感。
- **任务 4 的焦点环依赖 RF 的 DOM 类名** `.react-flow__node-group`（`react-flow__node-<type>`）。类名随 RF 版本走，写测试时把类名当契约钉一次，升级 RF 时会红在这里而不是静默失效。
- **任务 6 的高度实测**：菜单内容行数不定（资产菜单 3–5 项），首帧高度为 0 时不能把菜单夹到错位置——首帧先按内容顶部对齐，量到高度后再夹，与 `AssetDetailPopover` 同款处理。
