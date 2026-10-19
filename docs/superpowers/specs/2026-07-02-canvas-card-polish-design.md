# 画布资产卡片交互优化设计稿

日期：2026-07-02
分支：`feat/canvas-card-polish`

## 背景

画布资产卡片（`NodeCard` 及右键 `ContextMenu`）当前有四处体验缺口，需逐一打磨：

1. hover 用 1px 上浮位移（"弹跳"），观感生硬，改为炫光阴影。
2. 右键菜单 **Use as reference** 的 `@` 图标显灰（`secondary` tone），与同菜单里 Rename/Delete 的 ink 色图标不一致。
3. **Rename** 只改本地 `assets[].label`，不落库——刷新 / 切项目 / 重连即被服务端旧名覆盖。
4. **Delete** 无二次确认（误删风险），且当前是乐观立即移除，删除在途无任何状态反馈。

后端契约已核（apifox PGC 项目 8405123，`Update Canvas Item`）：`PATCH /api/projects/{pid}/canvas/items/{item_id}` 的 `CanvasUpdateRequest` **支持 `name` 字段**（`maxLength 255`，接口描述明确"重命名传 name，仅改显式提供字段"）。故 Rename 复用这一既有 PATCH 端点，无需新增后端。

## 目标与非目标

**目标**：四项优化落地，遵循项目既有令牌 / 组件 / 动效语汇与单向数据流；纯逻辑同目录单测。

**非目标**：不改后端；不动 `@` 图标在 Composer 等其它位置的 `secondary` 全局 tone；不引入新的按钮种类 / 一次性 keyframes / 硬编码色值。

## 逐项设计

### 1. Hover：弹跳 → 炫光阴影

`NodeCard` 根 div 去掉 `motion-safe:hover:-translate-y-px`（位移弹跳）。**非选中态** hover 时叠加一层蓝色柔光晕（accent glow）：一层极淡的中性落影 + 一层无偏移、大扩散的蓝色泛光，读作"发光"而非"抬起"。

- 非选中静置：`shadow-[var(--shadow-card)]`（不变）。
- 非选中 hover：`hover:shadow-[0_2px_8px_-4px_rgba(0,0,0,0.10),0_0_20px_-2px_rgba(53,130,255,0.28)]`——第二层无偏移蓝泛光即"炫光"。边框保持 `--color-line-2` 中性，不转 accent，避免与选中态混淆。
- 选中态：完全不变（1.5px accent 环 + `.node-beam` 流光 + `0_4px_14px_-6px_rgba(53,130,255,0.4)` 蓝晕）；层级上"选中"仍明显强于"hover"。

过渡沿用根 div 已有的 `transition-[…,box-shadow,…] duration-150`（移除已废弃的 `transform`）。box-shadow 过渡不涉及位移 / 缩放，无需新增 `prefers-reduced-motion` 处理；`rgba(53,130,255,…)` 与选中态既有内联值同源（accent #3582ff 恒定不翻主题）。

> 说明：node 卡片选中态已有内联 `shadow-[…]` 精确值先例，本次 hover 泛光沿用同一"内联精确阴影"写法，不新增 `.node-*` 类。

### 2. Use as reference 图标：灰 → ink

`@` 图标（`figAsset.at`）全局注册为 `secondary`（恒 `--color-muted` 灰），因其在 Composer @提及处需保持灰。**仅在 `ContextMenu` 渲染处**给三个菜单项的 `FigIcon` 显式传 `tone="primary"`（= `currentColor`，与 pencil/trash 现状一致）。不动全局 `ICON_TONE`。

### 3. Rename：接资产更新接口（乐观更新 + 失败回滚）

**PGC client**（`src/lib/pgc/client.ts`）新增：
```ts
renameCanvasItem: (pid, itemId, name) =>
  pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { name } satisfies CanvasUpdateRequest),
```
`CanvasUpdateRequest`（`types.ts`）补 `name?: string | null`（对齐后端）。

`renameAsset` 从 `store/index.ts` 的纯 `set` **迁到 `actions.ts`（ServerActions）**，改为 async 乐观流程：
- 记旧 `label`；立即本地改名（弹窗随即关闭，跟手）。
- `pending_` 占位卡无服务端 item → 只本地改名，跳过 PATCH。
- 否则 `guard` 内 `await renameCanvasItem`；`await` 后 `if (get().currentProjectId !== pid) return`（切项目丢弃）。
- 失败（`guard` 已置 `lastError`→Toast）时回滚：仅当该资产的当前 `label` 仍等于本次提交的新名（用户未再次改名）才恢复旧名，避免覆盖后续编辑。

`RenameAssetModal` 无需改动（仍调 `renameAsset` 后 `requestClose`）。

### 4. Delete：二次确认弹窗 + 卡片删除中态

**确认弹窗** `DeleteAssetModal`（新组件，镜像 `RenameAssetModal` 的模态语言：`modal-backdrop` + `modal-pop` + `useRequestClose` 退场 + Esc / 遮罩关闭）：
- 标题 `canvas.deleteConfirmTitle`，正文 `canvas.deleteConfirmBody`（插值资产名）。
- 底部 Cancel（次级）+ Delete（`text-[var(--color-danger)]` 危险色，复用 `--color-danger` 令牌）。
- Delete 点击：`void deleteCanvasItem(asset.id); requestClose();`——删除中态随后显示在画布卡片上。
- 不绑定全局 Enter 触发删除（防误删）；autoFocus 落在 Cancel（安全默认）。

**store 状态**：`UIState` 增 `deleteTarget: { id } | null` + `openDeleteModal` / `closeDeleteModal`；transient `deletingIds: string[]`（不持久化，切项目随会话态清空）。`ContextMenu` 的 Delete 项改调 `openDeleteModal(asset.id)`（不再直接删）。

**`deleteCanvasItem`（actions.ts）改为悲观 + 删除中态**：
- `pending_` 占位卡：直接本地移除（无网络等待，不进删除中态）。
- 真实 item：先 `deletingIds` 入列 → `guard` 内 `await pgcApi.deleteCanvasItem`，成功且未切项目才从 `assets` 移除并清 `genTasks`；失败（Toast）卡片保留。
- `finally` 语义：无论成功 / 失败 / 切项目，末尾都从 `deletingIds` 移除该 id（成功卡已消失、失败卡复原）。

**卡片删除中态**（`NodeCard`）：读 `deletingIds.includes(assetId)`，为真时——卡片 `opacity` 压暗 + `pointer-events-none` + `aria-busy`，覆盖一层居中 spinner（复用全站 `animate-spin rounded-full border-2` 惯例），并隐藏派生「+」按钮。

## 数据流与不变式

- 全程走唯一 store：ContextMenu → action / open modal；modal → action；action 落 `assets` / `deletingIds` / `lastError`；`NodeCard` 只订阅。
- 沿用"`await` 后校验 `currentProjectId`"护卫；`deletingIds` 为瞬态不入 persist；切项目在同一次会话态清空里一并清 `deletingIds` / `deleteTarget`。
- 错误只经 `guard` 收敛为 `PgcError`→Toast，不吞未知错误。

## 测试计划（同目录 `*.test.ts(x)`）

- `client.test`（若有）/ 直接在 `actions.test.ts`：`renameAsset` 成功调 `renameCanvasItem(pid,id,name)` 并落本地；失败回滚旧名 + `lastError`；`pending_` 不调接口；切项目丢弃。
- `actions.test.ts`：`deleteCanvasItem` 成功前 `deletingIds` 含该 id、成功后移除 + `assets` 去除；失败后卡保留 + `deletingIds` 清空 + `lastError`；`pending_` 直接移除不调接口不入 `deletingIds`。
- `ContextMenu.test.tsx`：三个图标均 `tone="primary"`（或渲染断言）；Delete 点击调 `openDeleteModal` 而非 `deleteCanvasItem`。
- `DeleteAssetModal.test.tsx`（新）：渲染资产名；Cancel/遮罩/Esc 关闭；Delete 调 `deleteCanvasItem` + 关闭。
- `NodeCard`：`deletingIds` 含该 id 时渲染 spinner + `aria-busy`（若 NodeCard 无既有测试则新建轻量用例）。
- 全量 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm lint` 绿。

## i18n

en 为单一真相源，六语（en/zh/fr/ru/ja/vi）同步补：
- `canvas.deleteConfirmTitle`、`canvas.deleteConfirmBody`（含 `{{name}}` 插值）、`canvas.deleting`（删除中 spinner 的 aria-label）。
