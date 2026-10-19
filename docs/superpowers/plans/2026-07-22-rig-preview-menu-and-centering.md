# 实现计划：模型预览动作菜单 + 居中修复

对应设计稿：`docs/superpowers/specs/2026-07-22-rig-preview-menu-and-centering.md`

## 任务 1：取景纯函数改造（TDD）

- 文件：`src/lib/rig-viewer.ts` + `rig-viewer.test.ts`
- 先写失败测试：根位移 clip 下 `sampleClipFraming` 返回**最大瞬时尺寸**（≈单帧尺寸而非轨迹并集）与逐帧中心序列；`centerAtProgress` 线性插值；空包围盒返回 null。
- 实现 `sampleClipFraming` / `centerAtProgress`，**删除** `sampleAnimationBounds`（唯一调用方即本次改造，不留 dead code）。
- 验证：`pnpm exec vitest run src/lib/rig-viewer.test.ts`

## 任务 2：RiggedModelViewer 接入逐帧跟随

- 文件：`src/components/canvas/RiggedModelViewer.tsx`
- `boundsByClip` → `framingByClip`；相机按 size 盒取景；渲染循环内按 action 播放进度插值中心、pivot lerp 跟随；静态 GLB 退化为单中心。
- 验证：`pnpm exec tsc --noEmit` + 全量 `pnpm test`

## 任务 3：动作菜单悬浮胶囊化

- 文件：`src/components/canvas/RiggedModelViewer.tsx`（showControls 分支）
- 底部通栏 → 画面内 `absolute bottom-4` 悬浮胶囊（pop 底 + popover 影 + blur + `.anim-pop-in`）；无动作时不渲染。
- 验证：lint + 现有组件测试；Playwright/mock 截图核对视觉（有条件时）

## 任务 4（迭代）：bindMatrixInverse 污染修复 + 采样降本（TDD）

首版上线后实测「切换后仍不居中 + 切换卡顿数秒」，定位出主因是 `bindMatrixInverse` 过期（见 spec 迭代补充）。

- `rig-viewer.test.ts` 先写失败测试：蒙皮场景复刻组件时序（pivot 偏移 + `scene.updateMatrixWorld` + 归零后采样），断言中心不被污染。
- `rig-viewer.ts`：采样步内 `updateWorldMatrix(true,false)` + `updateMatrixWorld(true)`；全顶点采样改 `SKINNED_VERTEX_BUDGET` 抽样，删 `computeBoundingBox`/`setFromObject(precise)`。
- `RiggedModelViewer.tsx`：`Clock`→`Timer` + delta 夹取；组件测试 mock 同步补 `Timer`/`updateMatrixWorld`/`getAttribute`。
- 验证：`pnpm exec vitest run src/lib/rig-viewer.test.ts` + 浏览器 harness（切换耗时与逐帧跟随数值 + 截图）+ 全量 tsc/lint/test
