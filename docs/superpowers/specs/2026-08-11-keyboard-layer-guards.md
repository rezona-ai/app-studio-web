# 键盘归属仲裁：上层浮层开着时，画布与 Lightbox 都别偷按键

> 状态：设计稿 · 2026-08-11
> 分支：`fix/keyboard-layer-guards`（终审整改 A 批 / 共四批）
> 来源：2026-08-10 对 `origin/main..dev` 31 个功能回合的全量终审（31 个子代理，逐条对着 HEAD 代码核实）
> 关联：`2026-08-04-canvas-keyboard.md`（引入 ⌘A 与方向键微调）、`2026-08-09-lightbox-action-bar.md`（引入 Lightbox 的 Delete）

## 目的

三条缺陷共用同一个成因：**window 级键盘监听各自判断「这个键该不该我吃」，而判据写在组件里、彼此不知道对方存在**。
于是「谁在最上面」这件事没有任何一处代码说得清，新增一个监听就漏一次。

三条都已在 HEAD 上读到代码行，且都在正常路径上：

| # | 用户做的事 | 期望 | 实际 |
|---|---|---|---|
| 1 | 开着 Lightbox 看图，点左栏 chat 输入框打字，按退格删一个字 | 删掉一个字 | **字没删掉**（`e.preventDefault()`），**正在看的资产被送进删除窗口** |
| 2 | 点一张已选中的图卡开 Lightbox，按 →/← 连翻几张 | 只翻页 | 翻页的同时**身后那张选中卡被挪走并落库**，还占一格撤销栈；窗全覆盖画布，位移全程不可见 |
| 3 | 开着 Lightbox 按 ⌘A | 什么也不发生（或归上层） | 画布选区被改成全选，用户看不见 |

第 1 条 Esc / ←/→ 同样漏：在 chat 里按 Esc 会关掉 Lightbox，按方向键会翻页。

## 现状核实（全部为 HEAD 实读）

| 事实 | 位置 |
|---|---|
| Lightbox 的 keydown 挂 window，全程不读 `document.activeElement` | `src/components/canvas/MediaLightbox.tsx:101-124` |
| Lightbox **没有任何焦点管理**：开窗不移焦点、无焦点陷阱、关窗不还原 | 同上（全文件无 `focus()`） |
| Lightbox 是画布列内的 `absolute inset-0`，ChatPanel 是**兄弟栏**，不被遮住 | `MediaLightbox.tsx:175` · `Workspace.tsx:221/235` |
| Composer 的 textarea 不 `stopPropagation` | `src/components/chat/Composer.tsx`（全文零命中） |
| 方向键微调监听只判 `selectedIds` 与 `isEditableTarget`，**无 lightbox 守卫** | `src/components/canvas/AssetCanvas.tsx:795-797` |
| Delete 监听**有** lightbox 守卫，且 `lightboxOpen` 刻意做成必填参数 | `AssetCanvas.tsx:745-747` · `src/lib/canvas-keys.ts:11-27` |
| `shouldTriggerSelectAll` / `shouldTriggerUndo` 没有 `lightboxOpen` 参数 | `canvas-keys.ts:32-55` |
| **移动节点的是 RF 自己**，不是我们的监听：我们只管 500ms 收口落库 | `AssetCanvas.tsx:774-791` |
| RF 有两条方向键路径：**节点级**受 `isInputDOMNode \|\| disableKeyboardA11y` 门控；**多选框级**（`react-flow__nodesselection`）**不受**任何门控、也不查输入框 | `@xyflow/react@12.11.0` `index.js:2237` / `:2031` |
| 项目未设 `disableKeyboardA11y`，未关 `nodesFocusable` | `AssetCanvas.tsx:1080-1081` 附近 |
| 全仓 28 个 window keydown 监听，画布 6 + Lightbox 1，其余 21 个是各模态自己的 Esc（互不冲突） | 全仓 grep |

## 约束（盘问结论）

- **C1 修法：守卫下沉进 `canvas-keys.ts` 纯函数，上层参数必填**（Nick 拍板）。沿用 `shouldTriggerCanvasDelete`
  的既有先例——带默认值的话调用点忘了传就静默退回旧行为，而旧行为正是这里要修的无声 bug，**类型系统该在编译期拦住**。
  不抽全仓统一仲裁层（那会把 3 条缺陷的修复扩成 28 处触碰，回归面不成比例）。
- **C2 不用「window 捕获 + stopPropagation」拦 RF**。Lightbox 自己的监听也在 window（冒泡阶段），
  捕获阶段一 `stopPropagation` 会把 Lightbox 的翻页一起掐死。**根治点是给 Lightbox 补焦点管理**：
  开窗即把焦点收进对话框，RF 节点 div 失焦，RF 两条方向键路径都不再触发。
- **C3 ⌘Z 不加 lightbox 守卫**。在 Lightbox 里删掉一张后，用户很可能就想 ⌘Z 撤回；
  且 `undo` 不依赖画布选中。它与 Delete/⌘A 的语义不同，不能一刀切。
- **C4 输入框优先于所有层**。焦点在输入类元素时，Lightbox 与画布**都**不接管按键——
  包括 Esc（在 chat 里按 Esc 不该关窗）。判据复用既有 `isEditableTarget`，不新写一份。
- **C5 焦点还原**：关窗把焦点还给开窗前那个元素，否则关窗后焦点掉到 body、方向键又变成页面滚动。
- **C6 纵深防御**：即便焦点因故回到节点 div，画布侧的 nudge / ⌘A 仍要拒吃按键（C1 的守卫是第二道）。

## 方案

三层，缺一不可：

1. **Lightbox handler 开头拒吃**：`isEditableTarget(document.activeElement)` 为真即整体早退（含 Esc/←/→/Delete）。
2. **Lightbox 焦点管理**：开窗把焦点移到对话框容器（`tabIndex={-1}` + `focus()`），关窗还原到开窗前的
   `activeElement`。这条同时把 RF 的两条方向键路径从根上切断，并让浮层的无障碍语义正常（此前它连焦点都不接）。
3. **画布守卫下沉**：`canvas-keys.ts` 新增 `shouldTriggerNudge`、`shouldTriggerSelectAll` 补必填 `lightboxOpen`；
   两个监听改用纯函数判定。

## 成功标准

1. 开着 Lightbox，焦点在 chat textarea：按 Backspace 只删字、资产不进删除窗口；按 Esc 不关窗；按 ←/→ 不翻页。
2. 开着 Lightbox，焦点在窗内：←/→ 翻页，且画布上那张选中卡**坐标不变、不发 PATCH、不占撤销格**。
3. 开着 Lightbox 按 ⌘A：画布选区不变。
4. 开着 Lightbox 按 Delete：只删正在看的那张（既有行为不回归）。
5. 开着 Lightbox 按 ⌘Z：照常撤销（C3，不被守卫挡住）。
6. 关闭 Lightbox：焦点回到开窗前那个元素。
7. `shouldTriggerNudge` / `shouldTriggerSelectAll` 的 `lightboxOpen` 是必填，漏传即编译失败。

## 明确不做

- **Lightbox 里给 `<video>` 放行 ←/→ 做 seek**：终审列为 Minor，但「视频聚焦时方向键归视频还是归翻页」
  是产品口径决策，不在本批的已验缺陷内，**不在本轮顺手改**（避免静默扩大范围）。留给 Nick 单独定。
- **全仓统一仲裁层**（`activeKeyLayer`）：见 C1，记入工程健康度待办。
- **Lightbox 焦点陷阱（Tab 循环）**：本轮只做「开窗聚焦 + 关窗还原」，不做 Tab 环绕。
- **其余 21 个模态监听**：互不冲突，不动。
- **`aria-modal="true"` 的语义冲突不在本轮处置**（增量评审 Minor-3）：`MediaLightbox.tsx:207` 那个
  `aria-modal` 是既有属性，本轮未改；但本轮第一次给这个浮层接了焦点，冲突才显出来 ——
  成功标准 1 把「开着窗在 chat 里打字」定为**受支持路径**，而 `aria-modal=true` 是在告诉读屏
  「对话框之外一切不可用」，同时我们又刻意不做焦点陷阱。三者只能取二。
  处置：**记录，留给 Nick 定**。要么去掉 `aria-modal`（承认它不是真模态，是个可绕开的浮层），
  要么把「窗外可打字」降级为不承诺。改它属无障碍语义变更，不该顺手夹在一批 bug 修复里。

## 增量评审处置（2026-08-11，基于 `8c7fb239~1..424ceee0`）

评审做了 13 处变异实跑，四道指定守卫全部上锁；**未找到第四处假绿**（我自查出的三处已修）。
三条 Minor 的处置：

| # | 结论 | 处置 |
|---|---|---|
| 1 | C4 的「早退必须在 AddMenu 分支之前」零覆盖：把它挪到之后，全仓 3160 条一条不红 | **采纳**，补一条用例并变异验过（挪位即红） |
| 2 | 成功标准 5（⌘Z 不被守卫挡住）零覆盖，C3 是刻意的反向决策却没人守 | **采纳**，补一条用例并变异验过（把 ⌘Z 判定改成恒 false 即红） |
| 3 | `aria-modal` 语义冲突 | **记录不做**，见上「明确不做」末条 |

评审另外核过并判为非问题、我复核认同的三点：`outline-none` 只压掉程序化聚焦容器的焦点环，
内部按钮原生焦点环照在；`[open]` 布尔依赖与 `[lightbox]` 实测等价（注释里「反复搬焦点」属实但无可观测后果）；
`prev.isConnected` 是冗余保险（`focus()` 对脱离文档的元素本身就是 no-op），不为它补测试。
