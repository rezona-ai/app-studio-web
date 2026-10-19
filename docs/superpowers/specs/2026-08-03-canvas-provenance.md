# 创作溯源落库与资产属性面板

> 状态：设计稿 · 2026-08-03
> 关联：P0 第三块「创作溯源」的**第二步**（收尾）。第一步是 `2026-08-03-canvas-gen-failure-retry.md`（已回合 dev）。
> 同块前两块：`2026-08-03-canvas-undo.md`、`2026-08-03-canvas-search-jump.md`（均已回合）。

## 目的

让用户能回答画布上最高频的两个问题，且**跨刷新有效**：

1. 「这张图我当时用什么模型、什么提示词生成的？」
2. 「我想要一张和这张几乎一样、只改一个词的 —— 怎么办？」

现状是两个都答不了：

- **`Asset.prompt` 是个死字段**。`store/types.ts` 声明了它，`actions.ts` 里没有任何地方赋值；卡片上也从不渲染。
- **后端 `CanvasItemData` 不返回 prompt / model / created_at**（`created_at` 只在 project 与 version 上）。
  > ⚠️ **2026-08-09 前提已变**：后端 `CanvasItemData.created_at` 已下发并进了前端契约
  > （`specs/2026-08-08-canvas-time-dimension.md`）。但 `provenance.at` 的口径**不变** ——
  > 它记的是导入 / 登记时刻，与「建卡时间」不是同一事件（异步登记差一整个生成周期）。

- 生成参数目前只活在 `retrySpecs`（上一步引入的 actions 闭包注册表），**刷新即失效**——而「这张图当时怎么来的」恰恰是隔几天才会问的问题。

结果：用户想复现一张满意的资产，只能重新打开生成表单凭记忆手打一遍。对比 Midjourney / Krea / ComfyUI，prompt 与参数是挂在资产上的一等公民，"Reroll / Vary / Remix" 就是产品的核心循环 —— 这个循环我们目前是断的。

## 约束

1. **不阻塞在后端排期上**。provenance 由前端自己写进 `reference`；读取时**后端顶层字段优先、缺失回落 `reference`**，后端哪天加了字段自动生效、不加也无副作用。仓库已有先例：`VersionData.credits_spent` 就是这个模式。
2. **`reference` 不是自由 JSON —— 必须做成 Asset 一等字段**。`assetReference()`（`pgc/map.ts:98`）是从 Asset 已知字段**从头重建**的，未知键一律丢弃；而它挂在每次坐标回写上（3 个调用点）。旁路写进 `reference` 的东西，用户拖一下卡片就没了。必须走 `canvasItemToAsset` 读入 → `assetReference` 吐回 的完整链路，与 `sourceFilename` / `importRelPath` / `links` 同款。
3. **存完整请求体**，使「以相同参数再生成」跨刷新成立。
4. **`retrySpecs` 退役**。落库 provenance 完全覆盖它的职责，按仓库「不堆叠废弃机制」的规矩整套删掉，不留两套并存。
5. **面板不动三栏壳**。画布内右侧浮动面板，复用既有浮层语汇（`bg-[var(--color-pop)]` + `shadow-popover` + `backdrop-blur`），走 z-10 画布 UI 层，不与 Preview 覆盖层打架。
6. **开合是显式开关且持久化**，同 minimap 那样挂底部工具条 —— 点选是画布上最高频的动作（拖拽前先选中），自动弹出会很吵。
7. **不改后端契约、不加后端字段**。

## 成功标准

1. 前端发起的四类生成（image / video / audio / 3d）成功落卡后，其完整请求体随 `reference` 落库；**刷新页面后仍读得到**。
2. 属性面板开关在底部工具条，开合状态持久化（刷新后保持）。
3. 面板开启 + 选中一张卡 → 显示：提示词（可复制）、模型、生成参数、类型、来源（generated / derived / uploaded / reference）、血缘上下游（可点跳转）。
4. 面板开启 + 未选中 → 显示引导文案，不显示空白面板。
5. 面板里的「以相同参数再生成」按钮：用落库参数重发，**刷新后依然可用**（这是与上一步 `retrySpecs` 的本质区别）。
6. 无 provenance 的资产（agent 生成 / 上传 / 素材库导入 / 本次改动前的历史资产）：面板只显示可得信息，**提示词段整段不渲染**（不显示空标签），再生成按钮不出现。
7. 坐标回写（拖拽）后 provenance **不丢失** —— 这是约束 2 那个坑的回归防线，必须有测试。
8. `retrySpecs` 整套从代码库消失，失败卡重试改读落库 provenance；失败卡重试的既有行为（原参数重发、`retryable=false` 走预填表单）不回退。
9. 多选时面板显示选中数量与批量信息，不崩、不只显示第一张。
10. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 现状要点（实现前必读）

- **`placeAndLink`（`actions.ts:397-411`）已对每张新卡回写一次 `reference`**。provenance 只要在那之前挂上 Asset，就搭顺风车落库，**零额外请求**。这是本设计最省的一处。
- `runGen(kind, count, opts, call, spec?)` 已有 `spec: RetrySpec` 入参（上一步为 `retrySpecs` 加的）——正好复用为 provenance 的来源，不必再改四个 `generate*` 的签名。
- `retrySpecs` 相关面：`store/gen-retry.ts`（类型 + 上限 + 迁移纯函数）、`actions.ts` 里的注册表与 `peekRetrySpec`/`takeRetrySpec`/`runRetry`、`store/index.ts` 的 `retryGeneration`/`openRetryForm`、`gen-retry.test.ts`。退役时前三者删除，两个 action 保留但改读 Asset。
- `parseGenPrefill`（`components/canvas/gen-prefill.ts`）已能把原始请求体反解成表单值 —— 面板的「再生成」与失败卡的「修改后重试」共用它。
- 浮动面板可参考 `CanvasFilterButton` 的 popover 与 `ZoomBar` 的工具条按钮写法。
- `Asset.prompt` 是死字段，本次一并**删除**（被 provenance 取代，不留两个语义重叠的字段）。

## 方案

### 1. 数据模型

```ts
// store/types.ts
export interface AssetProvenance {
  kind: 'image' | 'video' | 'audio' | '3d';   // 决定重发走哪个 generate*
  req: Record<string, unknown>;               // 原始请求体(prompt / model / 各类参数)
  at: string;                                 // 生成时刻 ISO(导入/登记时刻;与后端 created_at 口径不同,见上方 ⚠️)
}
// Asset 上新增 provenance?: AssetProvenance;(并删掉死字段 prompt)
```

- 写：`assetReference()` 增 `if (a.provenance) ref.provenance = a.provenance;`
- 读：`canvasItemToAsset()` 优先取后端顶层字段（若将来有），回落 `reference.provenance`；两者都无则 `undefined`。
- 落点：`runGen` 拿到 `spec` 后，在 `settleGenPlaceholders` / `startAsyncGen` 把 provenance 挂到真实 Asset 上，由 `placeAndLink` 既有回写顺带落库。

### 2. `retrySpecs` 退役（并存加新 → 原子切换 → 删旧）

`retryGeneration` / `openRetryForm` 改为读 `asset.provenance`：

| | 退役前（会话内） | 退役后（落库） |
|---|---|---|
| 数据源 | `retrySpecs` 闭包 Map | `asset.provenance` |
| 刷新后 | 失效 → 降级开空表单 | **仍可用** |
| 上限 | 50 条 | 无（随资产走） |
| 键迁移 | 占位卡→真实 id 需手动迁移 | 不需要（挂在 Asset 上） |

成功标准 8 要求删干净：`gen-retry.ts` 整个文件、`actions.ts` 的注册表与三个 helper、`gen-retry.test.ts` 里针对注册表生命周期的用例。

### 3. 属性面板

新建 `src/components/canvas/AssetInspector.tsx`：

- 位置：画布列右侧，`absolute right-5 top-16 bottom-24`，宽 280，`z-10`。浮层外观复用既有令牌。
- 开关：底部工具条加一枚 `IconButton`（同 minimap 那枚的写法），状态进 store `inspectorOpen` 并**持久化**（进 `partialize` 白名单，与 `visibleKinds` 同级）。
- 分区：
  1. **预览缩略** + 名称 + 类型徽章
  2. **提示词** —— 可滚、可一键复制；`provenance` 缺失时整段不渲染
  3. **模型与参数** —— 由 `parseGenPrefill` 反解后按 `GEN_FIELDS` 的 label 列出，只列用户设过的
  4. **来源与血缘** —— source 语义 + 上游/下游可点跳转（复用 `ensureVisible` + `setSelection`）
  5. **动作** —— 「以相同参数再生成」（有 provenance 时）
- 多选：显示「已选 N 项」+ 类型分布，动作区给批量项（本期只列删除，不新增能力）。
- 退场走 `useExitTransition`，不直接卸载。

## 取舍与明确不做

- **不做面板内编辑**（改名除外已有入口）—— 面板本期是只读溯源视图，避免与生成表单职责重叠。
- **不给历史资产补 provenance** —— 前端无从知晓；等后端字段上线自动覆盖（约束 1 的预留就是为此）。
- **不覆盖 agent 在对话里生成的资产** —— 那条路的 prompt 在 koubou 会话里，前端拿不到；属于后端字段上线后才能解的问题，本期面板对这类资产只显示可得信息。
- **不做「生成变体 / Vary」** —— 那是新能力不是溯源，独立议题。
- **不为窄窗强行把面板钉在视口上** —— 预览拖宽把画布列挤到 `CANVAS_WIDTH_MIN`(520) 以下时，外层横向滚动、
  内层保持最小宽，右锚的画布 UI（搜索栏 / 缩放条 / 过滤按钮 / 本面板）一起滚出可视区，**这是既定设计，靠滚动查看**。
  曾试过改 `fixed` + 由 Workspace 透传 `rightInset` 强制可见，实测反而更差：1200px 窗宽下面板占据 `520–800`，
  而可见画布只有 `518–820` —— 等于把用户仅剩的那点画布全糊住；且它不再跟其他画布 UI 一起滚动，一滚就脱节。
  已回退，勿再"修"。
- **不在面板里显示积分消耗** —— 后端未按 item 提供，`credits_spent` 只到 version 粒度。
