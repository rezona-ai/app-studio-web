# 实现计划：整卡拖拽 + 侧边跟随「+」

设计稿：`docs/superpowers/specs/2026-08-03-card-drag-and-hover-derive.md`

任务顺序按「先纯逻辑（可单测）→ 再 UI 组装 → 最后逐卡门控」排，每个任务独立可测、完成即提交。

## 任务 1：触发带几何纯函数

**文件**：`src/lib/derive-band.ts`（新）、`src/lib/derive-band.test.ts`（新）

- 导出常量 `DERIVE_BAND_INSIDE = 6`、`DERIVE_BAND_OUTSIDE = 64`、`DERIVE_BAND_W = 70`、`DERIVE_BAND_TOP_PCT = 20`(纵向中段 60%)。
- 导出 `followOffset(band: { left, top, width, height }, clientX, clientY): { dx, dy, insideCard }`：
  - `scale = band.width / DERIVE_BAND_W`（带宽固定 70 卡内 px，实测宽度即含画布缩放）；
  - 锚点在带内局部坐标 `(DERIVE_BAND_INSIDE, band.height / scale / 2)`；
  - `dx = (clientX - band.left) / scale - DERIVE_BAND_INSIDE`、`dy = (clientY - band.top) / scale - 卡高/2`（均为卡内 px，直接喂给 `translate()`）；
  - `insideCard = dx < 0`（指针尚未越过卡片右边缘）。
  - `scale <= 0`（带未布局 / 隐藏）时返回 `null`，调用方跳过。

**TDD**：先写失败测试 → 缩放 1 时 dx/dy 与像素偏移一一对应；缩放 2 时偏移折半；指针在卡内侧 `insideCard=true`、卡外侧 `false`；`width=0` 返回 `null`。

**验证**：`pnpm exec vitest run src/lib/derive-band.test.ts`

## 任务 2：`NodeCard` 触发带与跟随「+」

**文件**：`src/components/canvas/nodes/NodeCard.tsx`、`src/app/globals.css`、`src/components/canvas/nodes/NodeCard.test.tsx`

1. `globals.css` 动效段新增 `.derive-plus-follow { transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1); }`，并加入 `prefers-reduced-motion` 禁用列表（置 `transition: none`，不能用 `display:none` —— 该块现有条目是靠 `display:none` 禁用纯装饰动画，`+` 是功能元件，不可消失）。
2. `NodeCard` 内：
   - `canDerive = derivableKinds(kind).length > 0 || canDerive3d(asset)`，且 `!assetId.startsWith('pending_')`；
   - `canDerive` 为真时渲染触发带 `<span data-derive-band className="absolute" style={{ left: width - 6, width: 70, top: '20%', bottom: '20%' }} onPointerMove onPointerLeave />`（**不挂 `nodrag`**，按下即拖卡）；
   - `follow` 局部 state（`{ dx, dy, insideCard } | null`），`pointerType === 'touch'` 的事件直接忽略；
   - `useExitTransition(follow != null, 180)` 驱动非选中态的退场（`closing` 时偏移归零 + `.anim-fade-out`）；
   - `+` 渲染结构改两层：外层锚点保持现状 class（不过渡），内层挂 `.derive-plus-follow` + `transform: translate(dx, dy)`；
   - 可见性：`soleSelected || 悬停态挂载中`，且多选（`selectedIds.length >= 2`）恒不出；
   - `+` 的 `pointerEvents`：`follow?.insideCard ? 'none' : 'auto'`。

**测试**（jsdom 下 `getBoundingClientRect` 恒为 0，需 stub 带元素的矩形）：
- 非选中 + 未悬停：无 `+`；
- 非选中 + 带内 `pointerMove`：出现 `+`，`transform` 含跟随偏移；
- 悬停后 `pointerLeave`：偏移归零且 180ms 后卸载；
- 多选态下带内悬停：仍无 `+`；
- 单选本卡：无悬停也有 `+`（守住现状，原两条测试保留）；
- 指针在卡内侧时 `+` 为 `pointer-events: none`。

**验证**：`pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`

## 任务 3：五类卡片媒体交互按 `selected` 门控

**文件**：`ImageNode.tsx` / `VideoNode.tsx` / `AudioNode.tsx` / `ThreeDNode.tsx` / `TextNode.tsx` 及各自 `*.test.tsx`

- `ImageNode`：`canExpand` 增加 `selected` 条件（`nodrag`/`cursor-zoom-in`/`onMouseDown`/`onClick` 一起消失）。
- `ThreeDNode`：`ReadyBody` 收 `selected`；非选中时容器不挂 `nodrag`/`onMouseDown`，放大按钮整块 `pointer-events-none`。
- `VideoNode`：`ReadyBody` 收 `selected`；非选中时容器不挂 `nodrag`/`onMouseDown`，播放按钮与放大按钮 `pointer-events-none`（视觉保留）。
- `AudioNode`：`PlayerBody` 收 `selected`；非选中时播放器 `pointer-events-none` 且不挂 `onMouseDown`。
- `TextNode`：`onDoubleClick` 仅在 `selected` 时挂；非选中时 md 容器 `pointer-events-none`（挡掉链接点击与文本选区）。

**测试**：每类卡各补「非选中态点击不触发预览/播放/编辑」+「选中态照旧触发」两条（图片、3D、文本已有测试文件可扩；视频、音频需新建测试文件）。

**验证**：`pnpm exec vitest run src/components/canvas/nodes/`

## 任务 4：全量验证与真实环境自查

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test`
- `pnpm dev` 手动过一遍成功标准 1–6（尤其：带内按住能拖卡、带外能点 `+`、复位动画、多选不出 `+`）。

## 提交划分

- `docs:` 设计稿 + 计划（本次两文件，先提）
- `feat:` 任务 1
- `feat:` 任务 2
- `feat:` 任务 3
