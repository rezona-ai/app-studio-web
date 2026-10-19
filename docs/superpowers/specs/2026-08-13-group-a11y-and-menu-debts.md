# 分组框：可访问性收口 + 光标菜单三处既有债

日期：2026-08-13
状态：已批准（三条决策由 Nick 逐条确认）
前置：`2026-08-12-canvas-group-theming-and-menu`、`2026-08-13-group-title-and-key-delete`（本次清的是这两份 spec 记下的 A/B/D 组缺口）

## 目的

清掉前两回合留档的 9 条缺口（A 组 4 条功能、B 组 2 条可访问性、D 组 3 条一致性）。E 组（无症状 / 流程类）不动。

## 约束

- 不改分组的几何 / 归属链路与 `deleteGroup` 的「拆框留卡 + 5 秒撤销」。
- 判据继续沉在 `lib/` 的纯函数里单测；组件里不写散装 if。
- 颜色只用既有语义令牌，不新增令牌；动效复用既有类。
- 光标菜单的外观改动一律落在 `ContextMenuShell`（资产选区菜单与分组菜单共用），不在调用方各改一份。

## 决策

### 决策 1（B1）：标题条文字改中性色，描边留品牌青

框名用 `--color-ink`、计数用 `--color-muted`，并**去掉计数那段的 `opacity-60`**；框体描边与柔光底继续用品牌青。浅色稿下文字对比度从 1.85:1 / 1.5:1 提到 ≥ 7:1，「这个框是青的」这个识别度靠描边保住。

代价明说：label 不再是主题色，与最早那条「边框和 label 都用主题色」的要求有出入 —— Nick 在看过真机浅色稿后选了可读性优先。

顺带（B2）：分隔中点 `·` 加 `aria-hidden`，`AssetListDrawer` 里三处裸 `·` 一并加（要么两处都加，要么都不加，不留半套）。

### 决策 2（A1）：入框 / 出框**只能靠拖**，方向键微调不改归属

明确声明为**预期行为**而非缺口：方向键只微调坐标，不重判归属。理由是微调的意图是「对齐位置」，不是「改变归属」；而拖拽是明确的搬运手势。

代价明说：用方向键把卡推进框里，视觉在框内但不是成员（拖框不带它走、删框不影响它）。这条要写进代码注释与本 spec，并**补一条测试钉住**——防止日后有人把它当漏项「顺手修好」。

### 决策 3（A4）：Tab 聚焦给焦点环，`Enter` / `Space` 才选中

框节点**本来就在 Tab 序里**（RF 的 `nodesFocusable` 默认 true ⟹ 节点 wrapper 带 `tabIndex=0`；前一份 spec 记的「框不可聚焦」不准确）。缺的只是「聚焦之后怎么成为删除目标」：

- 聚焦 → 只出 `:focus-visible` 焦点环（`outline`，与选中态的柔光外晕 `box-shadow` 视觉可分）。
- `Enter` / `Space` → 置 `selectedGroupId`（走既有 `selectGroup`，卡片选区照旧被清）。
- 随后 `Backspace` / `Delete` 走既有删框链路。

选「显式激活」而不是「聚焦即选中」：后者会让 Tab 路过画布时每经一个框都清一次卡片选区 —— 只想 Tab 到工具条的人会莫名丢选区。

RF 的 `Enter`/`Space` 选中只对 `selectable` 节点生效，而框刻意不可选，所以这条得自己接：判据做成纯函数（从 `document.activeElement` 解出框 id），监听挂在画布层的 window keydown 上——与既有的删除 / 撤销 / 全选同一层。

### 决策 4（A2）：删除与位移类快捷键统一让位给**任何**打开的浮层

现状只挡 lightbox。四条判据（删卡 / 删框 / 全选 / 方向键微调）的 `lightboxOpen` 形参统一改名 `overlayOpen`，由新纯函数 `canvasOverlayOpen(flags)` 计算，覆盖：lightbox、删除确认弹窗、文本编辑弹窗、生成弹窗、3D 派生弹窗、素材库、充值弹窗、重命名弹窗。

**刻意扩大到四条而不只是删除那两条**：同一类 bug（焦点落在弹窗按钮上按方向键，把弹窗背后的卡挪走）在其余判据上一模一样，而改动是同一个形参。⌘Z 撤销**不并入** —— 撤销不依赖选区、也不动焦点所在的东西，弹窗开着时撤销上一次画布操作是合理的。

### 决策 5（A3）：手型工具 / ⌥ 下，框的右键与点选改由 pane 兜住

那两种状态下框体 `pointer-events: none`（决策 5 的落点，为的是把手势让给平移 / 框选），于是右键穿到 pane、弹出浏览器原生菜单，点选也点不中。

修法不动 `pointer-events`（那是 all-or-nothing，改回去会把平移 / 框选又抢走），而是给画布接 `onPaneContextMenu` / 复用 `onPaneClick`：把屏幕坐标经 `screenToFlowPosition` 换成画布坐标，用**既有纯函数** `groupHitFor` 判命中 —— 命中框就走框的菜单 / 点选，没命中就照旧。

### 决策 6（D2）：菜单壳的三处既有债一次收掉

1. **夹进视口**：浮层不再裸用 `left/top`，经新纯函数 `clampMenuToViewport(point, size, viewport)` 夹取，复用 `popover-anchor.ts` 既有的 `VIEWPORT_MARGIN`（12px）。今天在画布右下角右键，276px 宽的菜单会被裁掉。
2. **z 阶梯对齐 CLAUDE.md**：遮罩 `z-40` → `z-[55]`、浮层 `z-50` → `z-[56]`（现值与 Modal 遮罩同层，语义上说不通）。
3. **Esc 关闭**：与贴卡浮窗一致。

### 决策 7（D1）：ja / ko 的卡片量词统一到「枚」/「장」

新增的 `memberCount` 用的是卡片状薄物的地道量词，而 `errors.positionSaveFailed` / `errors.groupAssignFailed` 用通用量词（ja「件」、ko「개」）。统一到前者，改那两条 errors 文案（各 2 处）。

### 决策 8（D3）：标题条也能点选框

标题条挂与框体同一对 `onMouseDownCapture` / `onClick` 判据。与双击改名不冲突：单击选中是幂等的，双击时先选中再进编辑态，两者不互斥（`dblclick` 前必然先到一次 `click`，那次 click 只是把框选上）。

## 成功标准

1. 浅色稿下标题条文字（框名与计数）对比度 ≥ 7:1；框仍能一眼看出是青色描边；深色稿不回退。
2. 读屏读标题条时不再读出中点；`AssetListDrawer` 三处同款处理。
3. 方向键把卡推进框里不改归属，且有测试钉住这条**预期行为**。
4. Tab 能聚焦到框并出现焦点环（与选中外晕可分）；`Enter` / `Space` 选中；随后 `Backspace` 删框。Tab 路过框**不**改变卡片选区。
5. 任一浮层（含素材库 / 生成弹窗 / 充值弹窗等）打开时，`Backspace`/`Delete`/⌘A/方向键都不作用于画布；⌘Z 仍可用。
6. 手型工具或按住 ⌥ 时，框内空白右键仍弹分组菜单、单击仍能选中框，且不弹浏览器原生菜单。
7. 画布任意角落右键，菜单四边距视口 ≥ 12px；Esc 关闭；z 值符合 CLAUDE.md 阶梯。
8. ja / ko 三处卡片量词一致。
9. `pnpm lint` / `tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 真机验收结论（dev 3444，Pokemon 项目）

逐条实测，数字都是浏览器里量出来的：

1. **B1 对比度**：浅色稿下标题三段文字（框名 / 中点 / 计数）全部 `rgb(18,18,18)` on `#f8f7f7` = **17.52:1**，远超成功标准的 7:1；`opacity` 全为 1（`opacity-60` 已清）。
2. **A4 键盘链路**：wrapper 实测带 `tabindex=0` 与 `aria-label="Group"`；**Tab 一下**即到框，焦点环为 `2px solid rgb(31,212,207)` + `offset 2px`；程序化 `.focus()` **不**出环（`:focus-visible` 的正确行为）；聚焦时框未被选中，按 Enter 才选中且卡片选区为 0；随后 Backspace 删框 —— 节点 8→7（框消失、卡全留）+ 撤销 Toast。收尾时又用同一条链路删掉了测试框（6 个节点，框 0）。
3. **A3 pane 补判**：切到手型工具后，框内空白处 `elementFromPoint` 命中的确实是 `react-flow__pane`（框体让开了指针），而右键仍弹出「Rename / Delete frame」两项 —— 不再是浏览器原生菜单。
4. **D2 菜单壳**：z 值实测 浮层 `56` / 遮罩 `55`（对齐 CLAUDE.md 阶梯）；Esc 关闭生效。**夹取这条真机没凑出触发场景**（要在贴视口边缘处开一个足够高的菜单，几次尝试都落在框外或预览面板上），按「纯几何有表驱动单测 + 壳里的纵向接线由 `offsetHeight` 桩钉住 top」记账，未在真机上直接目击。

## 终审记录（本轮处置与留档）

**采纳并修的**：⌘Z 的错误理由（I1，见下）、计数对比度（I2，Nick 定为「计数也用 ink，靠字重分层」）、`aria-hidden` 藏掉词间空格导致读屏连读（I3）、`canvasOverlayOpen` 漏 `addMenu` 等 6 项（I4a/b/c）、RF 契约没真钉住（M1，新增渲染真 ReactFlow 的锁）、菜单壳首测高度改 `useLayoutEffect`（M2）、渲染期读 `window` 的隐式前提写进注释（M3）、框缺可访问名（M5）、`shouldSelectFocusedGroup` 不看修饰键（M6）、第三处中点没断言（M9）、纵向夹取接线无覆盖（M10）、两处冗余 cast（M11）。

**I1 只采纳一半（重要）**：终审建议「⌘Z 也并入 `overlayOpen`」。**没有采纳** —— `AssetCanvas.test.tsx` 有一条专门用例锁着「lightbox 开着按 ⌘Z 照常撤销」，注释写明那是 `2026-08-11-keyboard-layer-guards` **C3 的反向决策**，且该用例的存在理由正是「防后来人顺手给所有判定都补守卫」。行为照旧，但终审指出的**理由错误**属实并已改正：`undo` 的三条分支都会 `setSelection` + `ensureVisible`，所以真实代价是「浮层开着时撤销会静默换掉看不见的选区并挪动视口」，不是「无副作用」。

**留档不修**：

1. **焦点环与选中外晕在「聚焦 + 选中」并存时几乎重合**（M4）：本功能的常态路径是 Tab 聚焦 → Enter 选中，之后焦点仍在框上。实心 2px 青线（`outline-offset: 2px`）与 3px 柔光（`box-shadow`）叠在一起像一圈。单独出现时可分（一硬一柔）。要收可把焦点环改 `outline-offset: 4px` 或换 `dashed`，需真机比对手感。
2. **Space 一键两用**（M7）：RF 的 `panActivationKeyCode` 默认就是 `Space`，框聚焦时按 Space 会同时「选中框」+「arm 平移」（`preventDefault` 不影响 RF 的 `useKeyPress`）。无功能损坏，语义重叠。
3. **`·` 与 z 阶梯都只改了一半**（M8）：`TurnFooter.tsx` 还有第 4 处裸 `·`（在模板字符串里，要拆成 JSX）；`AddAssetMenu` / `AssetDetailPopover` 仍是 `z-40/z-50`。实际重叠不可达（那两个遮罩接了 `onContextMenu`，右键先关掉自己），纯一致性问题。
4. **commit 正文仍超「至多 3–5 行」**（M11）：本轮几个 commit 是 5–6 行 why + 1 行验证。内容合规（无会话日志），只是行数超。
5. **`pnpm build` 本轮未在分支上验完**：终审跑到 13 分钟仍卡在 `Creating an optimized production build`，父进程与 9 个 worker 全 0% CPU，疑似与主检出的两个 dev server 争 Turbopack 缓存（Next 把 workspace root 认成主检出）。已排除网络（Google Fonts 200/0.11s）。类型那一半由 `tsc --noEmit` 覆盖；按 CLAUDE.md 在**合并结果上**补跑，CI 也会兜一道。

## 明确不做

- E 组四条（乐观期 id 重映射、滚轮卸载丢草稿、`onSelectionEnd` 补跑、`buildGroupNodes` 引用复用）与 commit 正文行数那条流程记录。
- 多选框、框与卡混合选区、F2 改名快捷键。
- 极窄框下标题溢出（C 组，`min-w-[3ch]` 与输入框 `w-full` 两条）——本轮不含 C 组，Nick 只点了 A/B/D。
