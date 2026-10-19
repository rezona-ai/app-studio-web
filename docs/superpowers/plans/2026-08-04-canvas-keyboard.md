# 实现计划：画布键盘手感

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-keyboard.md`
> 分支：`feat/canvas-keyboard`

两项互不依赖：先做 ⌘A（小而独立），再修方向键落库（本组的主菜）。每任务一次提交。

---

## T1 ⌘A 全选当前可见

**改动**
- `src/lib/canvas-keys.ts` —— 加 `shouldTriggerSelectAll(e, activeEl)`：`(meta|ctrl) + a`、无 shift、
  焦点不在输入类元素（复用 `isEditableTarget`）。
- `src/components/canvas/AssetCanvas.tsx` —— 监听并 `setSelection(visibleAssets.map(a => a.id))`。

**测试** `src/lib/canvas-keys.test.ts` 追加
- ⌘A / Ctrl+A 触发；单独 `a`、⌘⇧A 不触发。
- 焦点在 input / textarea / contenteditable 时不触发（放行文本全选）。
- 与既有 `shouldTriggerUndo` / `shouldTriggerCanvasDelete` 同款边界（大写 `A` 也认）。

**验证**
```bash
pnpm exec vitest run src/lib/canvas-keys.test.ts
```

---

## T2 方向键微调落库 + 合并撤销

**改动**
- 新建 `src/lib/nudge.ts` —— `isArrowKey(key)`、`NUDGE_COMMIT_MS = 500`、
  `nudgedPositions(nodes, ids)`（从 RF 节点取最终坐标，过滤占位卡）。
- `src/components/canvas/AssetCanvas.tsx`
  - keydown 是方向键且有选中且焦点不在输入元素 → 若无进行中的微调，快照 store 当前坐标（撤销目标）+ 置 `isDraggingRef`；
    重置 500ms 收口计时器。
  - 收口：从 `getNodes()` 读最终坐标 → `setAssetPositions` → 若真有位移则 `pushUndo({type:'positions',op:'move'})`
    → `persistAssetPositions` → 复位 `isDraggingRef`。
  - 卸载时清计时器（避免切项目后还写旧项目坐标）。

**测试** 新建 `src/lib/nudge.test.ts`
- `isArrowKey`：四个方向为真，其他键为假。
- `nudgedPositions`：只取选中的、剔除 `pending_`、坐标取自节点而非 store。
> 收口时序本身在 `AssetCanvas`（无单测，同前几轮判断），由真机验收覆盖：
> 「刷新后仍在新位置」「连按 5 下一次撤销」「微调期间不产生每帧请求」都只有真机能验。

**验证**
```bash
pnpm exec vitest run src/lib/nudge.test.ts src/lib/canvas-keys.test.ts
```

---

## T3 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–9，重点五条**只有真机能验**的：
  1. 方向键微调后**刷新仍在新位置**（现状会退回 —— 这是本组要修的核心）
  2. 连按 5 下 → ⌘Z 一次全退；相隔 >500ms 的两段 → 两步撤销
  3. 微调期间 PATCH 次数：连按 N 下只应在停手后发一次（数 fetch）
  4. ⌘A 在搜索框里仍是全选文本，画布选区不变
  5. 空格平移 / ⌘ 点击多选不回退
- **不需要真实生成**，不消耗积分。
- 验收后还原被挪动的卡片坐标、删 `.env` 副本、停 dev。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` / `fix:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
