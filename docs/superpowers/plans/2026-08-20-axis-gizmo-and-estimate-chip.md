# 3D 空间指示器 + 估价 chip 局部加载态 — 实现计划

设计稿：`docs/superpowers/specs/2026-08-20-axis-gizmo-and-estimate-chip.md`
分支：`feat/3d-axis-gizmo`（worktree `.orca/worktrees/gizmo`）

两个任务互相独立，可分别评审。

---

## 任务 1 — 估价 chip：图标恒在，只有数值格加载

**改**：`src/components/canvas/GenerateForm.tsx`（`EstimateChip`）· `src/i18n/locales/*.ts`

1. 先写失败测试（`GenerateForm.test.tsx`）：
   - loading 态**仍能查到闪电图标**（`gen-estimate` 那个 role="img" 容器在，不再整块换成裸 spinner）；
   - loading 态的可访问名是 `Estimating…`；
   - 三态下容器都存在，数值格分别是 spinner / 数字 / `—`。
2. `EstimateChip` 改成单一 return：外层容器恒渲染 `role="img"` + `aria-label`（按三态取名），内部「图标 + 数值格」；数值格按状态渲染 spinner / 数字 / `—`，带 `min-w-[3ch]` 与 `justify-end`。
3. 现有那条断言 `gen-estimate-loading` 的用例改口径（testid 保留在 spinner 上，便于继续断言）。
4. i18n 11 语新增 `canvas.gen.estimating`。

**验证**：`pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`

---

## 任务 2 — 三轴指示器

### 2a 纯几何（TDD，先测后码）

**新增**：`src/lib/axis-gizmo.ts` + `src/lib/axis-gizmo.test.ts`

1. 先写表驱动测试：
   - `orbitToDirection(0, π/2)` → `(0,0,1)`；`(π/2, π/2)` → `(1,0,0)`；`(0, 0)` → `(0,1,0)`（正俯视）。
   - `projectAxes` 在正面视角（dir=(0,0,1)）下：+X 落屏幕右（x>0, y≈0）、+Y 落屏幕上（y<0，**已翻转**）、+Z 深度最大且投影≈原点。
   - 正俯视 `dir=(0,1,0)`：全部有限、无 NaN（退化时改用 +Z 当参考轴）。
   - 返回值按 `depth` 升序。
2. 再实现两个函数。`projectAxes` 内部：`zc = dir`；`xc = cross(worldUp, zc)`，其长度 < ε 时改 `cross((0,0,1), zc)`；`yc = cross(zc, xc)`；六条轴各算 `(v·xc, -(v·yc), v·zc)`。

**验证**：`pnpm exec vitest run src/lib/axis-gizmo.test.ts`

### 2b 令牌 + SVG 组件

**改**：`src/app/globals.css`；**新增**：`src/components/canvas/AxisGizmo.tsx` + 测试

1. `globals.css`：`@theme` 里加 `--color-axis-x/y/z`，`[data-theme="dark"]` 覆盖三个（深稿提亮）。
2. `AxisGizmo({ dir })`：76×76 SVG，`pointer-events-none` + `aria-hidden`；按 `projectAxes(dir)` 顺序画线 + 箭头 + 正轴标签；`depth < 0` 降不透明度。
3. 测试：正轴用对应令牌色（`stroke` 含 `var(--color-axis-x)`）、负轴用 `--color-line` 且无标签、背面轴不透明度更低、容器 `pointer-events-none`。

### 2c model-viewer 两处接线

**新增**：`src/components/canvas/ModelViewerGizmo.tsx`；**改**：`MediaLightbox.tsx`（`ModelViewerBody`）· `src/components/files/FilesView.tsx`

1. `ModelViewerGizmo({ viewerRef })`：`useEffect` 订阅元素 `camera-change` → `getCameraOrbit()` → `orbitToDirection` → `setDir`；挂载时先读一次（事件在首帧前可能已发过）。渲染 `<AxisGizmo dir={dir} />`。
2. 两处宿主：把 `<model-viewer>` 的 ref 交给它（`ModelViewerBody` 现在用 callback ref 绑 load/error —— 改成同时存进一个 `useState<HTMLElement|null>`，因为 callback ref 的目标要能触发子组件重订阅）。
3. 测试：桩一个假 `model-viewer` 元素（带 `getCameraOrbit` + `addEventListener`），派发 `camera-change` 后断言轴位置变了；卸载后监听被摘。

### 2d rig3d 接线

**改**：`src/components/canvas/RiggedModelViewer.tsx`

1. 循环里每帧算 `dir = normalize(camera.position − controls.target)`；与上次的点积 > `1 - 1e-4` 就不 setState（挡浮点抖动）。
2. `showControls` 为真时（即 lightbox 全屏那条路）渲染 `<AxisGizmo dir={dir} />`；卡片缩略那条路不给。
3. 不动取景 / 动画 / dispose 逻辑。
4. 测试：three.js 在 jsdom 里跑不起来（既有测试也只覆盖到骨架），故这一处**不写渲染级用例**；由 2a 的几何单测 + 手工真机验证兜。计划里写明这条覆盖缺口。

---

## 收尾

1. 全量：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`。
2. 真机验：lightbox 开 model3d / rig3d、Files 开 glb，看三轴跟转、背面变淡、那一角仍能拖动。
3. 干净上下文子代理按 commit 范围独立评审（只给 spec + diff）。
4. Critical / Important 修完后 `--no-ff` 合回 dev，在合并结果上重跑完整验证。
