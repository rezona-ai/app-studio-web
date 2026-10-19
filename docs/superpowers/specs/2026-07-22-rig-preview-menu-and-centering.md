# 模型预览动作菜单重设计 + 动作切换居中修复

## 背景与问题

全屏预览 rig3d 资产时（`MediaLightbox` → `RiggedModelViewer showControls`）存在两个问题：

1. **动作菜单丑**：底部是一条通栏 `border-t + bg-surface` 的实心横条，占满画布宽度、切断画面，与项目浮层规范（`--color-pop` + `--shadow-popover` + backdrop-blur 的悬浮胶囊）不一致。
2. **切换动作后模型不居中**（两个独立根因，均已在真实浏览器复现验证）：
   - **主因：`bindMatrixInverse` 过期污染采样**。`SkinnedMesh` 只在 `updateMatrixWorld`（渲染时）刷新 attached 模式的 `bindMatrixInverse`；采样循环用的 `updateWorldMatrix` 子树递归不会触发该重写。切换动作时 pivot 已归零，但蒙皮顶点仍按「上一动作的居中位移」反解——采出的包围盒整体偏移上一次 pivot 偏移量并被 `boundsByClip` 缓存。表现即「首个动作正常、一切换就偏」（单测复现：期望中心 0 实测 -5）。
   - **次因：轨迹并集取景**。`sampleAnimationBounds` 对整段 clip 全时段轨迹取并集，带根位移的动作（walk 前移）并集盒远大于瞬时姿态，模型任一时刻只占盒子一角。
3. **切换动作卡顿数秒**：采样每帧对全部蒙皮顶点做两遍 JS 蒙皮（`computeBoundingBox` + `setFromObject(precise)`），25 帧 × 全顶点。真实浏览器实测 75k 顶点模型**同步阻塞 614ms**，Tripo 模型更重则达秒级。
4. **`THREE.Clock` 已弃用**（three 0.184 控制台警告），需迁移 `THREE.Timer`。

## 方案

### 居中：瞬时取景 + 逐帧跟随（推荐，采用）

把「一次取并集」换成「按时间采样逐帧跟随」：

- `sampleClipFraming(root, mixer, clip)`（`src/lib/rig-viewer.ts` 新纯函数）：沿 clip 均匀采样 N 帧，返回每帧包围盒**中心序列** `centers[]` 与**最大瞬时尺寸** `size`（各轴取所有采样帧的最大值）。
- **每个采样步先 `updateWorldMatrix(true, false)` 刷祖先，再强制 `updateMatrixWorld(true)` 递归子树**——后者才会触发 `SkinnedMesh` 重写、把 `bindMatrixInverse` 同步到当前世界矩阵，杜绝上一动作 pivot 位移的污染（主因修复）。
- **蒙皮顶点按预算抽样**（`SKINNED_VERTEX_BUDGET=1024`/网格/帧）：删除全顶点的 `computeBoundingBox` 与 `setFromObject(precise)`，改为 stride 抽样 `getVertexPosition`；静态网格用几何包围盒 × 世界矩阵。轻微低估由取景 padding（1.18）吸收。实测切换阻塞 **614ms → 16ms**（卡顿修复）。
- 相机按 `size` 构造的原点居中盒取景（复用 `cameraFrameForBounds`），距离只需容纳最大瞬时姿态，不再被整段轨迹撑大。
- 渲染循环里按 `currentAction.time / duration` 在 `centers[]` 上线性插值出当前中心，`pivot.position = -center`（带小系数 lerp 平滑，切动作 crossfade 时不跳变）——模型任意时刻都居中。
- 备选方案「逐帧实时算蒙皮包围盒」被否：每帧遍历全部顶点做 JS 蒙皮，高模上有明显开销；预采样插值成本恒定。
- 备选方案「剥离根骨骼位移」被否：改动画数据侵入大，且非人形拓扑根骨骼不统一。

`boundsByClip` 缓存改为按 clip 缓存 framing 采样结果，语义不变。

### 动作菜单：悬浮胶囊工具条

- 从 flex-col 底部通栏改为**画面内悬浮**：`absolute bottom-4 left-1/2 -translate-x-1/2`，不再挤压 3D 视口高度（视口回到全高，居中观感同步改善）。
- 外观走浮层令牌：`rounded-full bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]`，进场 `.anim-pop-in origin-bottom`。
- 动作 chip：`rounded-full px-3.5 py-1.5 text-[12px] font-medium`，默认态透明底 + `hover:bg-[var(--color-fill)]`，选中态 `bg-[var(--color-teal)]`（品牌青）+ 恒定深色字（与 TopupModal 的 `--color-on-teal` 先例一致）。
- 无动作时不渲染工具条（原「No animations」占位在悬浮形态下是噪音；卡片内嵌态不受影响，仅 `showControls` 生效）。
- 最多 5 个动作，单行放得下；不做滚动 / 折行特殊处理（YAGNI）。

### 播放循环

- `THREE.Clock` → `THREE.Timer`（`update()` + `getDelta()`，恢复渲染时 `reset()`）；帧间 delta 夹取 0.1s——主线程长停顿后的首帧不再把单次动作一帧播完 / 跟随中心跳变。

## 成功标准

- 单测证明：①蒙皮根位移 clip 的 `size` 为瞬时尺寸、`centers` 覆盖轨迹首尾；②「上一动作 pivot 偏移 + 渲染刷新过 `bindMatrixInverse` + 切换时 pivot 归零」时序下采样中心不被污染（修复前实测偏移 = 上一 pivot 偏移量）。
- 真实浏览器（合成 75k 顶点蒙皮 GLB + 真组件）验证：各动作切换后模型均居中，根位移动作 pivot 逐帧反向补偿；切换同步阻塞 614ms → 16ms。
- `pnpm exec tsc --noEmit`、`pnpm test` 全绿。
- 菜单视觉符合浮层规范（悬浮、pop 底、popover 影、teal 选中）。

## 复现/验证方法备忘

浏览器 harness：esbuild 打包真组件 + 浏览器内 `GLTFExporter` 合成蒙皮 GLB（blob URL），Playwright 驱动。注意两个坑：合成 clip 必须用完整 vec3 的 `VectorKeyframeTrack`（分量轨道经 GLTFExporter 往返会变成畸形轨道，mixer 向骨骼写 NaN）；`WebGLRenderer` 方法是构造器内赋值，调试钩子要挂 `Object3D.prototype.onBeforeRender`。
