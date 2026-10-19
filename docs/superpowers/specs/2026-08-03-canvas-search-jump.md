# 画布搜索跳转（命中计数 + Enter 逐个定位）

> 状态：设计稿 · 2026-08-03
> 关联：P0 三块之二。第一块「画布撤销」见 `2026-08-03-canvas-undo.md`（已回合 dev）；第三块「创作溯源」待立项。

## 目的

让画布搜索**真正可用**。

现状：`CanvasSearchBar`（`AssetCanvas.tsx:48`）有 ⌘K 聚焦、有防抖、有命中高亮 / 未命中减淡（`lib/rf-nodes.ts:25` 的 `matchState`，命中给 2px ink 描边、未命中 `opacity: 0.22`）—— 但它**只改变卡片的视觉不透明度，从不改变视口**。

于是发生的事是：

- 一键整理后的货架布局横向可达 `MAX_ROW_WIDTH = 3200`（`card-layout.ts:34`），命中卡极可能在屏幕外；
- 屏幕外节点被 `onlyRenderVisibleElements` 卸载，连 DOM 都不存在；
- 用户敲完关键词，**屏幕上什么也没发生**。

这不是「体验欠佳」，是功能不成立：搜索的主用途——「把我带到那张卡那里去」——完全缺失。

## 约束

1. **不改后端契约**，纯前端。搜索域仍是 `label + key`（见「明确不做」第 1 条）。
2. **不碰选中态**。搜索是浏览动作，不应隐含选中——否则用户搜完随手按 Delete 就会删掉命中卡，或右键 / 拖动意外作用到命中卡上。当前命中用独立的「搜索光标态」表达。
3. **只在当前可见的卡里找**：命中集 = `visibleKinds` 过滤后的卡 ∩ 匹配，`n/m` 的 m 同口径。否则 Enter 会飞到一个被类型过滤器隐藏的空位置。
4. **不破坏既有性能优化**：`buildRfNodes` 的按 id 缓存（审计 B1/B3）必须继续生效——新增的「搜索光标」维度要并入缓存键，否则敲一个字符就全量重渲。
5. **纯逻辑下沉可单测**：命中集计算与排序、游标推进、跳转缩放解析都是纯函数，放 `lib/`。副作用（`setCenter`）经既有 `lib/viewport.ts` 注册表。
6. **UI 复用既有令牌 / 组件 / 动效**：计数与快捷键提示复用搜索栏内既有的 chip 语汇（`--color-fill` + `--shadow-shortcut`），光标态复用 `--color-teal` 语汇，不新增按钮种类、不写一次性 keyframes。

## 成功标准

1. 搜索框内出现命中计数，形如 `3/47`；无搜索词时不显示；有词但零命中时显示 `0/0`（或等价的零态），不显示误导性的 `1/0`。
2. 在搜索框内按 Enter：视口飞到下一个命中卡并居中；`Shift+Enter` 反向。到末尾回环到第一个（反向同理）。
3. 当前命中卡有区别于其他命中卡的**搜索光标态**，用户能一眼认出「3/47 里的第 3 个」是屏幕上的哪张。
4. 跳转顺序是画布空间序（y 升序，同 y 按 x 升序），用户能预期「下一跳大致在下方」。
5. 当前缩放低于可读下限时，跳转把缩放提到下限；已高于下限则**保持不动**（放大到 200% 找细节时不被拉回）。
6. 跳转**不改变 `selectedIds`**；跳转后按 Delete 不会删掉命中卡。
7. 搜索词变化时游标重置到第一个命中；命中集为空时 Enter 无动作、不抛错。
8. 被类型过滤器隐藏的卡不计入命中、不会被跳到。
9. Esc 退出搜索：清搜索词 + 清光标态 + 失焦，**视口留在最后一跳的位置**。
10. 敲字符时不发生全量节点重渲（`buildRfNodes` 缓存仍复用未变节点）。
11. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 现状要点（实现前必读）

- **匹配逻辑已存在**：`lib/rf-nodes.ts` 的 `matchState(asset, q)` → `'none' | 'match' | 'dim'`，按 `(label + key).toLowerCase().includes(q)`。样式 `MATCH_STYLE` / `DIM_STYLE` 是模块级常量（引用稳定，缓存友好）。
- **`buildRfNodes` 缓存键**是 `(asset 引用, selected, match)` 三元组；要加第四维 `isCursor`。
- **搜索词 `query`** 是 `AssetCanvas` 的组件本地 state（不在 store），⌘K 聚焦 / Esc 清空的监听也在组件内。命中列表与游标属同一生命周期，**继续放本地 state**，不进 store（跨组件无人需要）。
- **视口注册表**已有四个：`registerViewportCenter` / `registerEnsureVisible` / `registerScreenToCanvas` / `registerSetViewport`（后者是上一块新增）。本块的跳转在 `AssetCanvas` 内部，直接用 `useReactFlow().setCenter`，**不需要**新注册表。
- **`ensureVisible` 语义是「越界才平移」**，与本块「无条件居中到目标」不同，不复用它。
- `MIN_ZOOM = 0.1` / `MAX_ZOOM = 2` 已是 `AssetCanvas` 模块级常量。
- 卡片尺寸：`cardSize(kind)` / `CARD_W` / `CARD_H`（`lib/card-layout.ts`）—— 居中要按卡片中心而非左上角。

## 方案

### 1. 命中集与游标：纯函数下沉

新建 `src/lib/canvas-search.ts`：

```ts
// 命中判定与 rf-nodes 的 matchState 共用同一口径(从本模块导出,rf-nodes 反过来引用它,避免两处漂移)
export function matchesQuery(asset: { label: string; key: string }, q: string): boolean;

// 命中集:可见卡 ∩ 匹配,按画布空间序(y 升序,同 y 按 x 升序)排序,返回 id 列表
export function searchHits(assets: Asset[], q: string): string[];

// 游标推进:回环。dir=1 前进 / -1 后退;空集返回 null
export function stepCursor(hits: string[], currentId: string | null, dir: 1 | -1): string | null;

// 跳转缩放:低于可读下限提到下限,否则原值不动
export const MIN_JUMP_ZOOM = 0.6;
export function resolveJumpZoom(current: number): number;
```

排序口径与 `card-layout.ts` 内部的 `byPos` 一致（y 优先、x 次之）。那是个文件内私有函数，不跨文件复用（`card-layout.ts` 刻意不含业务耦合）；本模块自带同口径实现并单测，注释交叉引用。

`MIN_JUMP_ZOOM = 0.6` 的取值理由写进注释：卡片最窄 180px，0.6 时屏幕上约 108px，缩略图与标题仍可辨认；再低就只是色块。

### 2. 搜索光标态：并入 buildRfNodes 缓存

`buildRfNodes(assets, selectedIds, q, cache)` → 增一个 `cursorId: string | null` 参数，缓存 `CacheEntry` 增 `isCursor: boolean` 维度。

光标卡的样式在 `MATCH_STYLE` 之上叠加更重的强调（模块级常量 `CURSOR_STYLE`，引用稳定）：teal 描边 + teal 柔光环，与「选中态」（teal 24% 描边 + `.node-beam` 光束）视觉可区分且不冲突。

**关键**：`cursorId` 只影响样式，绝不写 `selected` 字段——这是约束 2 的落点。

### 3. 搜索栏：计数 + 快捷键提示

`CanvasSearchBar` 增 `hits` / `cursorIndex` 两个 prop：

- 有搜索词时，在既有 `⌘ K` chip 左侧显示 `3/47`（复用同款 chip 样式，`font-mono` 对齐数字）；
- 零命中时显示 `0/0` 并给 chip 一个柔和的「无结果」色（复用 `--color-muted`，不引入 danger 色——搜不到不是错误）；
- 无搜索词时两者都不显示，回到现状外观。

`⌘ K` chip 在有搜索词时替换为 `↵` 提示（「Enter 跳下一个」），避免同时挤三个 chip。

### 4. 跳转：Enter / Shift+Enter

监听挂在 `<input>` 的 `onKeyDown`（不是 window）——搜索跳转只在搜索框聚焦时有意义，挂 window 会与 Composer 等其他输入的 Enter 打架。

```
Enter        → stepCursor(hits, cursor, +1) → setCenter(卡中心, { zoom: resolveJumpZoom(当前), duration: 300 })
Shift+Enter  → dir = -1
```

`isImeComposing(e)` 门控（复用 `lib/keyboard.ts`，与 Composer 一致）：中文输入法确认候选词时的 Enter 不触发跳转。

搜索词变化时游标重置为 `null`（下一次 Enter 从第一个命中开始）。

### 5. Esc

沿用现有行为（清词 + 失焦），额外清游标。**不动视口**——落成功标准 9。

## 取舍与明确不做

- **搜索域不扩到 prompt** —— `Asset.prompt` 至今是死字段（声明了但从无赋值，后端 `CanvasItemData` 也不返回）。等第三块「创作溯源」把 provenance 落进 `reference` 之后，搜索域自然能扩，届时只改 `matchesQuery` 一处。本块不为一个没有数据的字段写代码。
- **不做「只显示命中」过滤开关** —— 盘问已定：先做跳转，看实际手感再决定是否需要。
- **不做相关度排序** —— 画布资产名短、区分度低，相关度对用户是不可见黑盒，与「在空间里导航」错配。
- **不做搜索历史 / 高级语法（kind:image 等）** —— YAGNI。
- **不把搜索态搬进 store** —— 跨组件无人需要，放组件本地 state 即可；进 store 反而要处理切项目清理等额外不变式。
- **不解决「命中很多且分散」的通览需求** —— 那是 minimap 上标命中点或结果列表面板的事，属另一个议题。
