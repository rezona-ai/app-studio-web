# 资产卡片生成占位视觉实现计划

## 任务 1：生成并接入四张占位图

涉及文件：

- `public/assets/generating/image.jpg`
- `public/assets/generating/video.jpg`
- `public/assets/generating/audio.jpg`
- `public/assets/generating/3d.jpg`

步骤：

1. 使用同一基础提示词分别生成 image / video / audio / 3d 四张横向抽象 3D 插画。
2. 检查风格、主体安全区、无文字与无水印要求。
3. 统一缩放并压缩为 JPEG，控制静态资源体积。

验证命令：

```bash
file public/assets/generating/*.jpg
du -h public/assets/generating/*.jpg
```

## 任务 2：以失败测试定义共享生成占位行为

涉及文件：

- `src/components/canvas/nodes/GeneratingPlaceholder.test.tsx`
- `src/components/canvas/nodes/ImageNode.test.tsx`
- `src/components/canvas/nodes/ThreeDNode.test.tsx`

步骤：

1. 先写四种类型映射到四张 basePath 资源的测试。
2. 断言生成状态保留唯一 `role="status"`，且不再渲染 `animate-spin`。
3. 覆盖图像重新生成时“旧图保留 + 统一生成覆盖层”的行为。
4. 运行测试并确认因组件尚不存在或旧 spinner 仍存在而失败。

验证命令：

```bash
pnpm exec vitest run src/components/canvas/nodes/GeneratingPlaceholder.test.tsx src/components/canvas/nodes/ImageNode.test.tsx src/components/canvas/nodes/ThreeDNode.test.tsx
```

## 任务 3：实现共享占位组件与统一动效

涉及文件：

- `src/components/canvas/nodes/GeneratingPlaceholder.tsx`
- `src/components/canvas/nodes/ImageNode.tsx`
- `src/components/canvas/nodes/VideoNode.tsx`
- `src/components/canvas/nodes/AudioNode.tsx`
- `src/components/canvas/nodes/ThreeDNode.tsx`
- `src/app/globals.css`

步骤：

1. 实现 `GeneratingPlaceholder`，通过 `assetPath()` 映射四类本地图片。
2. 替换四个节点内散落的纯色、静态波形和 spinner 生成态。
3. 复用 `anim-media-in`、`skeleton-shimmer` 与 `brand-float`，只补占位图遮罩样式，不新增专用 keyframes。
4. 在 reduced-motion 媒体查询中关闭全部新增动画。
5. 运行定向测试转绿并重构重复样式。

验证命令：

```bash
pnpm exec vitest run src/components/canvas/nodes/GeneratingPlaceholder.test.tsx src/components/canvas/nodes/ImageNode.test.tsx src/components/canvas/nodes/ThreeDNode.test.tsx
```

## 任务 4：真实页面核验与完整质量门

步骤：

1. 启动本地开发服务器，在真实画布中制造四类 generating 卡片。
2. 截图核验四类占位图裁切、暗色/浅色主题、并行卡片动画与生成完成淡入。
3. 模拟 `prefers-reduced-motion`，确认新动画全部停止且状态仍可识别。
4. 运行项目完整质量门并检查 diff。

验证命令：

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
git diff --check
```
