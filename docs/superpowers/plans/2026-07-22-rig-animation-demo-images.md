# Create animated character 动作演示图实现计划

对应设计：`docs/superpowers/specs/2026-07-22-rig-animation-demo-images.md`。

## 任务 1：锁定完整 preset 映射（TDD）

涉及文件：

- `src/lib/rig-animation.test.ts`
- `src/lib/rig-animation.ts`

步骤：

1. 先补 11 个人形和 5 个非人形 preset 的映射断言，并确认旧实现因非人形映射及新路径而失败。
2. 最小修改 `rigAnimationThumb()`，按完整 preset 映射到 `public/figma/rig/demos/*.webp`。
3. 保留裸动作名、`preset:` 前缀兼容和未知动作返回 `null` 的既有契约。

验证：

```bash
pnpm exec vitest run src/lib/rig-animation.test.ts
```

## 任务 2：生成并整理动作演示资产

涉及文件：

- `public/figma/rig/demos/*.webp`

步骤：

1. 先生成统一拓扑角色与视觉语言参考图。
2. 以参考图为约束，逐动作生成“主姿态 + 关键帧叠影 + 动态轨迹”正方形图示。
3. 检查主体、拓扑、动作方向、无文字/水印；转换为 192×192 WebP，再以 48×48 预览核对辨识度。
4. 保留生成提示词记录，便于后续扩展新 preset。

验证：

```bash
file public/figma/rig/demos/*.webp
```

## 任务 3：接入与组件验证

涉及文件：

- `src/components/canvas/Derived3DForm.test.tsx`
- `src/components/canvas/Derived3DForm.tsx`（仅在实际验证发现需要时修改）

步骤：

1. 补组件测试，确认人形与非人形卡片都渲染对应 WebP，路径仍经 `assetPath()`。
2. 在真实开发环境打开 rig 弹窗，分别注入人形和非人形 precheck 数据截图。
3. 以实际 48×48 呈现核对动作辨识度、裁切、浅/深主题对比；只针对发现的问题迭代资产。

验证：

```bash
pnpm exec vitest run src/components/canvas/Derived3DForm.test.tsx
```

## 任务 4：完整门禁

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

每个任务独立提交；资产生成与代码映射作为同一 `feat:` 特性组提交。
