# 实现计划：卡片删除中态重设计

对应设计稿：`docs/superpowers/specs/2026-07-22-deleting-state-redesign.md`

## 任务 1：globals.css 动效与压制规则

- 文件：`src/app/globals.css`
- 新增 `@keyframes pulse-soft`（opacity 1→0.55→1）与 `.anim-pulse-soft`（1.6s ease-in-out infinite）；
  新增 `.node-deleting .asset-generating-focus, .node-deleting .asset-generating-sheen { display: none; }`；
  `.anim-pulse-soft` 加入 reduced-motion 禁用列表。
- 验证：测试以读样式表文本断言规则存在（同 deploy 契约测试思路），`pnpm exec vitest run src/components/canvas/nodes`。

## 任务 2：NodeCard 删除中覆盖层重做

- 文件：`src/components/canvas/nodes/NodeCard.tsx`、`NodeCard.test.tsx`
- 卡根：deleting 时类从 `opacity-60` 改为 `node-deleting`（`pointer-events-none` 保留）。
- header + children 包内容容器：deleting 时 `grayscale opacity-60 motion-safe:scale-[0.98]` + 200ms transition。
- 覆盖层：遮罩保留；居中徽章（danger-soft 底 + danger/40 描边 + blur + `FigIcon trash` 18px danger 色）+ `.anim-pulse-soft`；`role="status"` + aria-label 不变。
- 测试（先写失败）：deleting 时卡根含 `node-deleting`、覆盖层含 trash 徽章（danger 色 + FigIcon mask 节点）、不再渲染 `.asset-generating-focus`（覆盖层自身无光环）；非 deleting 无以上节点。
- 验证：`pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`

## 任务 3：回收 StatusHalo 单消费者抽象

- 文件：`src/components/canvas/nodes/GeneratingPlaceholder.tsx`
- `StatusHalo` 内联回 `GeneratingPlaceholder`（视觉零变化），删除导出。
- 验证：`pnpm exec vitest run src/components/canvas/nodes/GeneratingPlaceholder.test.tsx` + `grep -r StatusHalo src` 无残留。

## 任务 4：全量验证 + 提交

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test`。
- `docs:` 与 `feat:` 成对提交，确认落点在 worktree 分支。
