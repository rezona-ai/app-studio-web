# 实现计划：画布拖拽吸附与对齐辅助线

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-align-guides.md`
> 分支：`feat/canvas-align-guides`

先纯几何（零风险、可单测），再接网格（一行 prop），最后接对齐与辅助线渲染。每步系统保持可运行、每任务一次提交。

---

## T1 对齐几何（纯函数）

**改动** 新建 `src/lib/align-guides.ts`

- `type Rect = { x, y, w, h }`、`type Guide = { axis: 'x' | 'y'; pos: number; from: number; to: number }`
- `visibleRects(nodes, viewport, size)` → 视口内卡的 `Rect[]`（约束 3；含 id 便于排除自身与选区成员）
- `snapToRects(moving: Rect, candidates: Rect[], threshold)` → `{ dx, dy, guides }`
  - 六线：x 取 `left/center/right` × 候选同三值，y 同理，各取**距离最小**的一条命中。
  - 两轴独立（约束 1）；无命中该轴 `dx/dy = 0`、不产 guide。
  - 辅助线端点：沿垂直方向取「移动卡 + 所有同值命中卡」的最小 / 最大边，各外延 `GUIDE_PAD = 12`（成功标准 4）。

**测试** 新建 `src/lib/align-guides.test.ts`

- 六条线各命中一例，断言 `dx/dy` 把边推到完全相等。
- 阈值边界：差 6 命中、差 7 不命中。
- 两轴独立：x 命中 y 不命中 → `dy === 0` 且只有一条 guide。
- 同轴多卡命中：只产**一条** guide，端点覆盖全部命中者并各外延 12。
- 候选为空 / 只有自己 → `{ dx: 0, dy: 0, guides: [] }`（拖第一张卡不能崩）。
- `visibleRects`：完全在视口外的卡被剔除，部分相交的保留。

**验证**
```bash
pnpm exec vitest run src/lib/align-guides.test.ts
```

---

## T2 网格吸附 + Alt 绕过

**改动** `src/components/canvas/AssetCanvas.tsx`

- `snapToGrid={!altHeld}`、`snapGrid={[SNAP_GRID, SNAP_GRID]}`（复用 `card-layout.ts` 既有常量，不新增档位）。
- Alt 监听：`keydown`/`keyup` 挂 window，落 `useState`（要触发重渲才能改 prop）+ ref（供 T3 的 `onNodesChange` 同步读）。
  ⚠️ 窗口失焦时 `keyup` 收不到 → 补 `blur` 复位，否则 Alt 状态卡死。

**测试** 新建 `src/client/useAltBypass.test.tsx`（`renderHook`，与 `useExitTransition` 等同款）

- 初始 false；`keydown` Alt → true；`keyup` → false。
- 窗口 `blur` 复位为 true→false（松键事件丢失时的兜底）。
- 卸载后不再响应事件（不漏监听）。

> **计划调整（2026-08-04）**：原计划写 `AssetCanvas.test.tsx` 断言传给 RF 的 props。实测仓库里**没有任何 RF mock 基础设施**，`AssetCanvas` 也一直没有单测（它是纯接线的集成组件）。为它现造一套 RF mock 成本高、护住的东西少，故把可测的部分下沉：Alt 判定进 `src/client/useAltBypass.ts`（hook 单测），吸附改写进 `lib` 纯函数（T3），RF 接线本身留给真机验收。

**验证**
```bash
pnpm exec vitest run src/client/useAltBypass.test.tsx
```

---

## T3 对齐拦截与辅助线渲染

**改动**

- `src/components/canvas/AlignGuides.tsx`（新）：`ViewportPortal` 内按 `Guide[]` 画 1px 青色虚线（`--color-teal`），`pointer-events: none`。
- `AssetCanvas.tsx`：包一层 `handleNodesChange`
  - 仅当 `dragging` 的 position 变更且非 Alt 时介入；否则原样透传 `onNodesChange`。
  - 单卡：以该卡 Rect 求 `snapToRects`；多卡：先算整组包围盒、求一个公共 `{dx,dy}`，再逐条 change 应用（约束 4）。
  - 候选集在 `onNodeDragStart` / `onSelectionDragStart` 时快照一次存 ref（约束 3），`onNodeDragStop` 清空并清 guides。
  - guides 存组件本地 `useState`，**不进 store**（约束 7 / 成功标准 9）。

吸附改写下沉为纯函数 `applyDragSnap(changes, ctx) → { changes, guides }`（同 T2 的调整理由），`AlignGuides` 只画 div、不碰 `ViewportPortal`（由 `AssetCanvas` 包在外面），这样两者都能脱离 RF 单测。

**测试** `src/lib/align-guides.test.ts` 追加 + 新建 `src/components/canvas/AlignGuides.test.tsx`

- 拖拽中的 position change 被改写成对齐值；非拖拽的 change 原样透传。
- 多卡拖拽：三条 change 收到**同一个**偏移（组内相对位置不变）。
- 绕过（Alt）时 change 不被改写、guides 为空。
- `AlignGuides`：给两条 guide → 渲染两个元素，竖线取 `--color-teal`；空数组 → 什么都不渲染。

**验证**
```bash
pnpm exec vitest run src/lib/align-guides.test.ts src/components/canvas/AlignGuides.test.tsx
```

---

## T4 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–9，重点四条**只有真机能验**的：
  1. 手感：6px 阈值在 100% / 50% 缩放下一致（成功标准 5）
  2. 辅助线跟随缩放平移不错位（`ViewportPortal` 是否用对）
  3. 多选拖拽组内相对位置一字不差（成功标准 6）
  4. 拖拽帧率：密集画布下不掉帧（候选快照策略是否奏效）
- **不需要真实生成**，用既有项目现成资产即可，不消耗积分。
- 验收后删 `.env` 副本、停 dev。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
