# 实现计划：键盘归属仲裁（终审整改 A 批）

> 设计稿：`docs/superpowers/specs/2026-08-11-keyboard-layer-guards.md`
> 分支：`fix/keyboard-layer-guards`（worktree 建在 `.orca/worktrees/`）

每个任务都是**最小可独立测试、可独立评审**的一步；按铁律 1，每步先写复现该 bug 的失败测试。

## T1 · 纯函数守卫（无生产行为变更，先立地基）

`src/lib/canvas-keys.ts`：

- 新增 `shouldTriggerNudge(e, activeEl, lightboxOpen)`：方向键 + 焦点非输入 + `!lightboxOpen`。
  当前这段判定内联在 `AssetCanvas.tsx:795-797`，抽出来才可单测。
- `shouldTriggerSelectAll` 补**必填**第三参 `lightboxOpen`（沿用 `shouldTriggerCanvasDelete` 的先例与注释理由）。
- `shouldTriggerUndo` **不动**（spec C3）。

测试 `src/lib/canvas-keys.test.ts`：
- `shouldTriggerNudge`：四个方向键各自为真；非方向键假；`isEditableTarget` 为真时假；`lightboxOpen` 为真时假。
- `shouldTriggerSelectAll`：`lightboxOpen` 为真时假（**这条现在必红**）。
- 变异守护：把 `!lightboxOpen` 改成常量真，上面两条必须有一条红。

> 编译期守护（spec 成功标准 7）：`shouldTriggerSelectAll` 加必填参数后，`AssetCanvas.tsx` 的旧调用点
> 会 tsc 报错——这就是「漏传即编译失败」的证据，T2 顺带修好。

## T2 · 画布两个监听改用纯函数（成功标准 2、3、5）

`src/components/canvas/AssetCanvas.tsx`：
- 方向键监听（`:793` 起）改 `if (!shouldTriggerNudge(e, document.activeElement, lightboxOpen)) return;`。
  注意 `lightboxOpen` 要在 handler 内**当场取** `useStore.getState().lightbox != null`（不能进 deps，
  否则每次开关窗都重挂监听，且会丢掉在飞的 `nudgeRef`）。
- ⌘A 监听（`:821` 起）补第三参。
- ⌘Z 监听不动。

测试 `src/components/canvas/AssetCanvas.keyboard.test.tsx`（新文件，jsdom）：
- 【复现 #2 的落库侧】lightbox 开着 + 有选中 → 派发 `ArrowRight` → 断言 `persistAssetPositions` **未被调用**、
  `undoStack` 长度不变、`assets` 坐标不变。**先红**。
- 【复现 #3】lightbox 开着 → 派发 `⌘A` → `selectedIds` 不变。**先红**。
- 【不回归】lightbox 关着 + 有选中 → `ArrowRight` → 500ms 后落库照常发生。
- 【C3 不回归】lightbox 开着 → `⌘Z` → `undo` 被调用。

## T3 · Lightbox 拒吃输入框按键（成功标准 1）

`src/components/canvas/MediaLightbox.tsx`：handler 开头 `if (isEditableTarget(document.activeElement)) return;`
（放在 addMenu 分支**之前**——在输入框里连 AddMenu 的 Esc 也不该被抢）。

测试 `src/components/canvas/MediaLightbox.test.tsx` 补一组（该文件现无任何 input/textarea 用例）：
- 挂一个 `<textarea>` 并聚焦 → 派发 `Backspace` → 断言 `requestDeleteAssets` 未调用、`preventDefault` 未发生。**先红**。
- 同上派发 `Escape` → 窗不关；派发 `ArrowRight` → 不翻页。**先红**。
- 【不回归】焦点在窗内 → `Backspace` 删当前、`Escape` 关窗、`ArrowRight` 翻页。

## T4 · Lightbox 焦点管理（成功标准 2 的根治 + 6）

`MediaLightbox.tsx`：
- 对话框容器加 `tabIndex={-1}` + `ref`，`useEffect` 在 `lightbox` 从 null 变非 null 时 `focus()`。
- 开窗前把 `document.activeElement` 存进 ref，`requestClose` 的退场结束后还原（注意走既有 `useExitTransition`，
  别在退场动画期间就抢焦点回去）。

测试：
- 开窗后 `document.activeElement` 是对话框容器。
- 关窗后焦点回到开窗前那个元素。
- 【与 T2 的关系】T4 让 RF 两条方向键路径都不触发（节点 div 失焦）；T2 是纵深防御的第二道。
  两者都要有测试，不能因为 T4 生效就删掉 T2 的用例。

## T5 · 收尾

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build` 全绿（贴完整输出与退出码）。
- 真机复看四条：chat 里退格 / 窗内翻页看画布卡没动 / ⌘A / 关窗焦点。
- spec 的「明确不做」里那条 video seek 单独报给 Nick 定。

## 已知取舍

- **`nudgeRef` 在飞时开窗**：用户按了方向键、500ms 未到就打开 Lightbox，那次位移会在 `commit` 里照常落库
  （守卫拦的是**新按键**，不是已在飞的收口）。这是对的——那次位移是用户在画布上真做出来的，不该丢。
- **多选框级 RF 路径**（`react-flow__nodesselection` 的 onKeyDown 不受 `disableKeyboardA11y` 门控）
  靠 T4 的失焦规避，不额外加 prop。若真机发现多选态下仍能挪，再单独立项。
