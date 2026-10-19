# 实现计划：画布虚拟化体验修复

对应设计稿：`docs/superpowers/specs/2026-07-21-canvas-virtualization-ux.md`

## 任务拆分

1. **纯逻辑：loaded-media 缓存 + firstAppearance**
   - 新增 `src/lib/loaded-media.ts`：`hasLoadedMedia(src)` / `markLoadedMedia(src)`（模块级 Set）+ 测试。
   - 新增 `src/client/useFirstAppearance.ts`：`useFirstAppearance(key)` hook（useState 初始化器读缓存 + 登记）。
   - 验证：`pnpm exec vitest run src/lib/loaded-media.test.ts`

2. **映射层：thumbnail_url → preview.poster**
   - `src/store/types.ts`：`AssetPreviewData` 加 `poster?: string`。
   - `src/lib/pgc/map.ts`：`canvasItemToAsset` 归一 `thumbnail_url`。
   - 验证：`pnpm exec vitest run src/lib/pgc/map.test.ts`

3. **节点卡：重挂载不重播入场 + 图片免闪**
   - `NodeCard` 根节点 `anim-media-in` 按 `useFirstAppearance(asset.id)` 条件携带。
   - `ImageNode`：`loaded` 初值取 `hasLoadedMedia(src)`；`onLoad` 登记。
   - `VideoNode` / `ThreeDNode` / `AudioNode` 媒体区 `anim-media-in` 同法（key `${id}:media`）；`VideoNode` 加 `poster`。
   - 验证：`pnpm exec vitest run src/components/canvas/nodes`

4. **3D 海报态快照**
   - `ThreeDNode` 海报按钮：`poster` 有值渲染 `<img>`，无值回退图标 + 测试。
   - 验证：`pnpm exec vitest run src/components/canvas/nodes/ThreeDNode.test.tsx`

5. **全量验证**：`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
