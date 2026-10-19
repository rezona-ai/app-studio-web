# 实现计划：画布输入与浏览

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-input-browse.md`
> 分支：`feat/canvas-input-browse`

先纯逻辑，再三项各自独立接线（互不依赖，任一步都可单独回合）。每任务一次提交。

---

## T1 Lightbox 翻页（纯逻辑 + 组件）

**改动**
- 新建 `src/lib/lightbox-nav.ts`
  - `previewableAssets(assets)` → 只留 `image / video / 3d` 且 `status === 'ready'` 且有源字节的，保持入参顺序。
  - `stepAsset(list, currentId, dir)` → 相邻资产 id；到头返回 `null`（不环绕，约束 6）。
- `src/components/canvas/MediaLightbox.tsx` —— 加 ←/→ 圆钮（沿用现有关闭钮样式）与 `ArrowLeft/ArrowRight` 键；
  列表由 `AssetCanvas` 以 prop 传入（可见性口径属画布层知识，组件不自己算）。

**测试** 新建 `src/lib/lightbox-nav.test.ts` + `src/components/canvas/MediaLightbox.test.tsx` 追加
- `previewableAssets`：滤掉 text / 生成中 / 无源字节；保持顺序。
- `stepAsset`：中间元素两向都有；首元素向前为 `null`、末元素向后为 `null`；单元素两向皆 `null`；currentId 不在列表里返回 `null`。
- 组件：中间项两个箭头都在；首项左箭头 `disabled`；单张时两个箭头都不渲染；点右箭头 → `openLightbox` 收到下一个 id；按 `ArrowRight` 等价。

**验证**
```bash
pnpm exec vitest run src/lib/lightbox-nav.test.ts src/components/canvas/MediaLightbox.test.tsx
```

---

## T2 拖文件进画布

**改动** `src/components/canvas/AssetCanvas.tsx`
- 容器接 `onDragOver`（`preventDefault` 才能触发 drop）/ `onDragEnter` / `onDragLeave` / `onDrop`。
- 仅当 `dataTransfer.types` 含 `'Files'` 时才认（约束 3：拖卡片不触发）。
- `dragDepth` 计数抵消子元素间的 enter/leave 冒泡抖动。
- drop：`screenToFlowPosition(松手点)` → `validateUpload(files, UPLOAD_POLICY.canvas)` → 拒绝的发 `UPLOAD` Toast、
  接受的逐个 `uploadAsset(f, { spawnAt })`（多文件级联由既有 `avoidOverlap` 兜住）。
- 高亮层：`absolute inset-0 pointer-events-none` 的 teal 描边 + 柔光，仅 `dragging` 时渲染。

**测试** 新建 `src/lib/canvas-drop.test.ts`（把可测的部分下沉为纯函数）
- `filesFromDataTransfer(dt)`：取顶层文件、忽略目录项与非文件（`kind !== 'file'`）。
- `isFileDrag(types)`：含 `'Files'` 为真；只有 `'text/plain'` 等为假。
> AssetCanvas 是纯接线的集成组件、仓库里一直无单测（RF mock 成本高、护住的少，同 align-guides 那轮的判断），
> 故 DOM 事件接线本身留给真机验收，可测的判定下沉到 `lib/`。

**验证**
```bash
pnpm exec vitest run src/lib/canvas-drop.test.ts
```

---

## T3 工具条常驻「+」

**改动** `src/components/canvas/AssetCanvas.tsx` 的 `ZoomBar`
- 最左加一个 `IconButton variant="raised"` 的「+」，与缩放之间加既有分隔条。
- 点击 → `openAddMenu({ x, y: 按钮上方, spawnAt: 视口中心 })`（复用 `getViewportCenter`）。
- i18n × 11：`canvas.addAsset`。

**测试** 新建 `src/components/canvas/ZoomBar.test.tsx`？——`ZoomBar` 是 `AssetCanvas.tsx` 内的局部组件，
不导出。**不为测试而导出**（仓库反模式：为测试而加的包装曾被整块删除）。改为真机验收覆盖，
i18n key 由既有 `i18n.test.ts` 的形状校验兜住。

**验证**
```bash
pnpm exec tsc --noEmit && pnpm lint
```

---

## T4 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–9，重点四条**只有真机能验**的：
  1. 从 Finder 拖真实图片进画布 → 落在松手处、走通上传
  2. 拖入过程中高亮出现 / 离开消失；**拖画布内卡片不触发**
  3. 「+」打开菜单、新卡落视口中心
  4. Lightbox 翻页跟随类型筛选（只开 Image 时序列里没有视频）
- 上传消耗存储但**不消耗积分**；验收后删掉验收期间上传的测试资产、删 `.env` 副本、停 dev。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
