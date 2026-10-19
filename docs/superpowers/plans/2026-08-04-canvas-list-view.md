# 实现计划：画布资产列表视图（底部抽屉）

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-list-view.md`
> 分支：`feat/canvas-list-view`

先纯逻辑（可单测、零风险），再动既有结构（搜索词上提，唯一有回归风险的一步），最后堆 UI。每步系统保持可运行、每任务一次提交。

---

## T1 创建顺序与列表纯逻辑

**改动**
- `src/store/types.ts` —— `Asset` 增 `seq?: number`（服务端数字主键，创建顺序依据）。
- `src/lib/pgc/map.ts` —— `canvasItemToAsset` 带上 `seq: it.id`；**不进 `assetReference`**（服务端自有主键，回写无意义）。
- 新建 `src/lib/asset-list.ts`
  - `matchesQuery(asset, query)` —— 搜索域含 `label` 与 `provenance.req.prompt`，空 query 恒真。
  - `filterAssets(assets, visibleKinds, query)`
  - `sortAssets(assets, { by, desc })` —— `seq` / `label` / `kind`；**缺 `seq` 的历史资产恒排最后**，不与有序的混排。

**测试** 新建 `src/lib/asset-list.test.ts`
- 空 query 不筛；按 label 命中；按 prompt 命中（溯源里的提示词也能搜到）；大小写不敏感。
- `visibleKinds` 与 query 同时生效（交集）。
- 三种排序 + 升降序；`seq` 缺失者排最后；排序稳定（同键不乱序）。
- `src/lib/pgc/map.test.ts` 追加：`seq` 从 `it.id` 读入；`assetReference` **不含** `seq`。

**验证**
```bash
pnpm exec vitest run src/lib/asset-list.test.ts src/lib/pgc/map.test.ts
```

---

## T2 搜索词上提到 store（唯一有回归风险的一步）

`AssetCanvas` 的局部 `query` 上提为 `canvasQuery`，画布高亮与列表筛选共用一份。

**改动**
- `src/store/index.ts` —— `UIState` 加 `canvasQuery: string` + `setCanvasQuery`；**瞬态不持久化**（搜索词跨会话保留只会让人困惑）。
- `src/components/canvas/AssetCanvas.tsx` —— `CanvasSearchBar` 改读写 store；⌘K 聚焦、Esc 清空且失焦、`buildRfNodes` 的高亮口径全部保持不变。
- 高亮判定改调 `matchesQuery`，与列表同一口径（保证「画布上高亮的」与「列表里列出的」恒为同一批）。

**测试**
- `src/components/canvas/CanvasSearchBar.test.tsx`（若已存在则追加）：输入写进 store；Esc 清空并失焦；⌘K 聚焦。
- 既有画布搜索相关测试（`rf-nodes` / 搜索跳转那批）全绿 —— 这步只搬家不改语义，**任何一条既有测试变红都说明搬坏了**。

**验证**
```bash
pnpm exec vitest run src/components/canvas/ src/lib/rf-nodes.test.ts
```

---

## T3 抽屉外壳、开关与高度拖拽

**改动**
- `src/store/index.ts` —— `listOpen: boolean` + `listHeight: number` + `toggleList` / `setListHeight`；两者**进持久化白名单**（同 `inspectorOpen`）。
- 新建 `src/components/canvas/AssetListDrawer.tsx` —— 本任务只做外壳：容器 + 顶部拖拽把手 + 空态，暂不含表格。
- `src/components/canvas/AssetCanvas.tsx` —— 工具条加开关（同 minimap 写法）；挂载抽屉；`ZoomBar` 传 `bottomOffset={listOpen ? listHeight : 0}` 上移（ZoomBar 只收 prop，不读 store）。
- i18n × 11 —— `canvas.list.*`（开关 / 两种空态 / 列头）。

**测试** 新建 `src/components/canvas/AssetListDrawer.test.tsx`
- 关闭不渲染；开启渲染；退场走过渡。
- 高度拖拽改 store 且夹取在上下限内。
- `listOpen` / `listHeight` 进持久化切片。
- `ZoomBar` 随抽屉上移（断言 style/class 变化）。

**验证**
```bash
pnpm exec vitest run src/components/canvas/AssetListDrawer.test.tsx src/store/persist-storage.test.ts
```

---

## T4 表格：列、排序、选中联动

**改动**
- `AssetListDrawer.tsx` 补表格：五列（缩略图 · 名称 · 类型 · 来源 · 状态），列头点击排序带升降序箭头。
- 行交互：点击 → `setSelection` + `ensureVisible`；⌘/Shift 多选；右键 → `openContextMenu`。
- 画布选中 → 行高亮 + 滚动到可见。
- 行 hover → 画布卡片高亮（复用搜索命中的强调语汇）。
- 两种空态（无资产 / 无命中，后者给「清除筛选」）。

**测试**
- 列表只列可见类型且命中搜索的资产。
- 点行 → `selectedIds` 更新且调 `ensureVisible`。
- 画布选中 → 对应行有选中态。
- 列头点击切换排序与升降序。
- 两种空态分别渲染，「清除筛选」清掉 query 与 visibleKinds。

**验证**
```bash
pnpm exec vitest run src/components/canvas/AssetListDrawer.test.tsx
```

---

## T5 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–9，重点：抽屉与属性面板**同时打开**时的布局（这是选型时的主要顾虑）、窄窗（1200px）下的表现、搜索联动是否真筛。
- **本需求不需要真实生成**（用既有项目的现成资产即可），不消耗积分。
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
