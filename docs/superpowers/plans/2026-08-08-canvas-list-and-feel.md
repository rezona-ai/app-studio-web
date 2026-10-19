# 实现计划：列表与手感的四条修补

> 设计稿：`docs/superpowers/specs/2026-08-08-canvas-list-and-feel.md`
> 分支：`fix/canvas-list-and-feel`（worktree：`.orca/worktrees/fix+canvas-list-and-feel`）
> 铁律：每条先写复现它的失败测试，看到它红，再写生产代码。

## 任务顺序的理由

T3（排序）与 T4（落位）动的是 `lib/` 纯函数与画布，与列表组件零交集，**放最前**——
纯逻辑 TDD 最干净，也先把「刚生成的卡在哪」这条最影响日常的修掉。
T1（滚动）与 T2（Shift 多选）都动 `AssetListDrawer.tsx`，串行做；
T2 依赖 T1 引入的「本次变化来自列表」标记（两者都要判断点击来源），故 T1 在前。

---

## T3 · 无 `seq` 视作 +∞

**先写的失败测试**（`src/lib/asset-list.test.ts`）

- `desc:true（默认）→ 无 seq 的占位卡排最前`（现状红：排最后）
- `desc:false → 无 seq 的占位卡排最后`（现状红：也在最后，即不随翻转）
- `多张占位卡之间保持稳定原序`（同为 +∞ 时靠装饰索引兜底）
- `有 seq 的资产相对顺序不变`（回归，spec 标准 6）

**改动**（`src/lib/asset-list.ts`）

- `compareBy` 的 `by==='seq'` 分支：`null` 视作 `+Infinity` 参与比较
- 删掉 `sortAssets` 里「无 seq 不随升降序翻转」的特判（`:43-46`）
- 改掉 `:22` 那句描述不存在人群的注释，写明真正无 seq 的只有 `pending_` 占位卡、
  以及为什么它该被当成「最新」

**变异验证**：把 `+Infinity` 改成 `-Infinity` → 前两条应翻面变红。

**独立可评审**：是。

---

## T4 · 拖放按 index 级联

**先写的失败测试**（`src/components/canvas/AssetCanvas.test.tsx`，若无则新建）

- `拖入 3 个文件 → uploadAsset 被调用 3 次,三次的 spawnAt 两两不同`（现状红：三次相同）
- `首张的 spawnAt 精确等于松手处`（约束 1，防级联把首张也推走）
- `拖入 1 个文件 → spawnAt 与改动前一致`（回归，spec 标准 8）

断言打在 `uploadAsset` 的入参上（mock store action），不依赖真实上传。

**改动**（`src/components/canvas/AssetCanvas.tsx:936-938`）

- `for...of` 改 `accepted.forEach((f, i) => ... { spawnAt: cascadePosition(spawnAt, i) })`
- 从 `@/lib/card-layout` 引入 `cascadePosition`
- 改掉那句错误注释：`avoidOverlap` 是**批内**避让，跨 `uploadAsset` 调用不生效

**变异验证**：把 `cascadePosition(spawnAt, i)` 改回 `spawnAt` → 第一条应变红。

**独立可评审**：是。

---

## T1 · 选中变化时滚动到对应行

**先写的失败测试**（`src/components/canvas/AssetListDrawer.test.tsx`）

- `外部改 selectedIds（模拟画布点选）→ 对应行的 scrollIntoView 被调用,参数含 block:'nearest'`
  （现状红：根本没调）
- `点击列表行本身 → 不触发 scrollIntoView`（spec 标准 2，防与用户滚动位置打架）
- `selectedIds 为空 → 不调`
- `多选时只滚到末位那个`

jsdom 无布局，`Element.prototype.scrollIntoView` 需打桩（`vi.fn()`）；断言调用与入参。

**改动**（`src/components/canvas/AssetListDrawer.tsx`）

- 行组件挂 `ref`，父层用 `Map<id, HTMLElement>` 或给选中行单独挂 ref
- `useEffect` 依赖 `selectedIds`，取末位、`scrollIntoView({ block:'nearest' })`
- `fromListRef`：行 `onClick` 里置 true，effect 见到就跳过并清掉
- 滚动容器加 `motion-safe:scroll-smooth`（约束 3，reduce 下瞬时）

**变异验证**：去掉 `fromListRef` 判断 → 第二条应变红。

**独立可评审**：是。

---

## T2 · Shift 范围多选

**先写的失败测试**

纯函数（`src/lib/asset-list.test.ts`）：
- `rangeBetween(rows, anchor, target) 取闭区间`
- `锚点在目标之后 → 结果相同（区间无方向）`
- `锚点不在 rows 里（已被过滤/排序变了）→ 退化为 [target]`（spec 标准 4）
- `锚点 === 目标 → [target]`

组件（`AssetListDrawer.test.tsx`）：
- `点第 3 行 → Shift 点第 12 行 → setSelection 收到第 3–12 行的 id`
- `反向（先 12 后 Shift 3）→ 同一集合`
- `Shift 点击不更新锚点`（连续 Shift 点击应始终以最初锚点为准）

**改动**

- `src/lib/asset-list.ts` 新增 `rangeBetween(rows, anchorId, targetId): string[]`（纯函数）
- `AssetListDrawer.tsx`：`anchorRef` 存锚点 id；`onClick` 加 `e.shiftKey` 分支（放在
  `metaKey||ctrlKey` 之前判，两者同按时以 Shift 为准）；非 Shift 点击时更新锚点

**变异验证**：把 `rangeBetween` 改成开区间 → 组件那两条应变红。

**独立可评审**：是。

---

## 验收

1. 四道闸门在**合并结果**上重跑，完整命令 + 输出 + 退出码留档（铁律 3）。
2. 每个任务提交后派干净上下文子代理独立评审（只给 spec + 该 commit 的 diff）。
   **每个评审者一份隔离副本做变异**（`cp -R src` + 软链 `node_modules` 到 scratchpad），
   绝不在共享 worktree 原地改 —— 上一轮六个评审共用一个 worktree 真撞上了污染。
3. 合并前终审全分支，并**单独派一轮审「评审后新写的修复」**（上一轮那批风险最高、
   且差点没人看，两条 ABA 缺陷就是在那里抓到的）。
4. **真机验收**：本轮四条全部零 credit 可验（拖放用任意本地图片、排序与多选种 store 态即可），
   没有借口跳过。⚠️ 上一轮的真机验收欠着，本轮不要再欠。
5. 若 `CreativeLibraryModal.test.tsx` 偶发红再现：按交接文档新线索，先试单独调高该文件
   `testTimeout` 看是否消失（能消失即坐实是时限问题而非竞态），并完整保存输出。

## 实跑记录（2026-08-08）

worktree `.orca/worktrees/fix+canvas-list-and-feel`，Node 22 / pnpm 11.5.3。

### 四道闸门（**在分支尖端**，即采纳全部评审意见之后）

| 闸门 | 命令 | 退出码 | 输出 |
|---|---|---|---|
| lint | `pnpm lint` | 0 | `✖ 9 problems (0 errors, 9 warnings)`（既有基线，零新增） |
| 类型 | `pnpm exec tsc --noEmit` | 0 | 无输出 |
| 测试 | `pnpm test` | 0 | `Test Files 255 passed (255)` / `Tests 3018 passed (3018)` |
| 构建 | `pnpm build` | 0 | — |

测试总数：2978（dev 基线）→ 2981（T3）→ 2984（T4）→ 2988（T1）→ 3000（T2）
→ 3001（rv-sort 采纳）→ 3012（rv-scroll/rv-shift 采纳）→ 3017（锚点测试 + 哨兵回归）
→ **3018**（改用 `nearAt`）。

### 变异验证（每条都做，共 10 次）

| 任务 | 变异 | 结果 |
|---|---|---|
| T3 | `+Infinity` → `-Infinity` | 3 条红 |
| T4 | `cascadePosition(spawnAt, i)` → `spawnAt` | 2 条红 |
| T1 | 去掉 `fromListRef` 判断 | 1 条红（「点击列表行不触发滚动」） |
| T1 | `block:'nearest'` → `'center'` | 1 条红 |
| T1 | 滚到首位而非末位 | 1 条红 |
| T2 | 闭区间 → 开区间 | 8 条红 |
| T2 | Shift 也更新锚点 | 1 条红（「连续 Shift 从最初锚点算起」） |
| T2 | `meta` 判在 `shift` 之前 | 1 条红（「Shift 优先于 ⌘」） |

### 核实中查出的、交接文档没写的前提

- **默认排序是 `{ by:'seq', desc:true }`（最新在前，`store/index.ts:313`）** —— 占位卡沉底确实是缺陷；
  若默认是升序则它排最后反而正确。这个前提不查清，T3 可能改反。
- **`occupiedBoxes` 读的是整个 store 的 assets（`actions.ts:503`），不只本批** ——
  所以跨 `uploadAsset` 调用的避让本来是有效的，唯独带 `spawnAt` 的首张会跳过它。
  这坐实了缺陷 4 的成因是「首张跳过避让」，而非「避让只看批内」。
- **「列表 → 画布」方向早已存在**（行点击调 `ensureVisible`，`AssetListDrawer.tsx:72`），
  缺的只有反向。

### 踩到的坑

- **`AssetCanvas` 此前没有测试文件**，T4 新建。两处 jsdom 特性要绕：
  ① 无布局 ⟹ 真实 `screenToFlowPosition` 算出 `NaN`，只好局部 mock 这一个方法为恒等映射
  （其余 xyflow 能力保持真实）；② jsdom 没有 `DragEvent` 构造器，`fireEvent.drop` 退化成普通
  `Event`，`clientX/clientY` 带不进去 —— 改用 `createEvent` + `defineProperty` 手工补坐标。
- **T2 顺带做了一次结构调整**：选区计算从 `ListRow` 上移到父层。不是重构癖 ——
  区间必须按**当前 `rows`**（已排序、已过滤）取，而只有父层持有 `rows`。

## 独立评审与采纳（2026-08-08）

四个干净上下文子代理，各只给 spec + 对应 commit 的净 diff，**每人一份隔离副本做变异**
（`cp -R src` + 软链 `node_modules` 到 scratchpad）—— 上一轮六个评审共用一个 worktree 真撞上了污染，
这轮的做法有效：四份报告的 `git status` 都证明共享仓库零残留。

| 评审 | commit | Critical | Important | Minor |
|---|---|---|---|---|
| rv-sort | `65668cf6` 排序 | 0 | 0 | 3 |
| rv-scroll | `44a4b8eb` 滚动 | 0 | **2** | 3 |
| rv-shift | `7bc50dfa` 多选 | 0 | **2** | 6 |
| rv-drop | `63f916ac` 落位 | 0 | **3** | 3 |

### 七条 Important 的处置（全部采纳）

1. **rv-scroll I1 / rv-shift M-3：`fromListRef` 布尔标记会残留**。它只在 effect 里消费，
   而有几类点击**不改 `selectedIds` 引用**（点已是唯一选中的那一行 → `setSelection` 判等 no-op；
   Shift 点出同一区间同理）⟹ effect 不跑、标记永久留 `true` ⟹ 吞掉**下一次**画布点选的滚动。
   改存「这次点击将产生的末位 id」后自愈。
2. **rv-scroll I2：抽屉常驻挂载，打开时不滚**。`AssetCanvas` 无条件渲染 `<AssetListDrawer />`，
   靠 `mounted` 返回 null；effect 只依赖 `last` ⟹ 关着时在画布选了卡、打开列表那一行不滚 ——
   恰是最需要定位的时刻。依赖加 `mounted`。
3. **rv-shift I-1：陈旧锚点**。锚点只认「列表内非 Shift 点击」，而画布点选 / 框选 / ⌘A /
   右键 / Inspector 跳转 / 撤销恢复都不动它 ⟹ Shift 算出的区间与用户**看到的**选中态脱钩
   （实测：列表点 A → 画布改选 D → Shift 点 E，得到 a..e 而非 d..e）。改为在滚动 effect 里跟随。
4. **rv-shift I-2：普通单击的 `ensureVisible` 无测试**（删掉它 51 条全绿）—— 这恰是本次
   「选区计算上移到父层」唯一被搬动的既有行为。补 3 条（普通单击调、⌘ 与 Shift 不调）。
5. **rv-drop I-1：我的注释仍是假命题**。「`avoidOverlap` 是批内避让、跨调用不生效」——
   `occupiedBoxes` 读的是**整个 store**，跨调用避让本来有效（粘贴多文件正是靠它铺开）。
   成因只有「带 `spawnAt` 的首张跳过避让」一条。**而这句与我自己在本 plan 里写的结论自相矛盾。**
6. **rv-drop I-2：级联方案的依据被推翻** → 改用 `nearAt`，详见 spec 方案 4 的「初版为什么不够」。
7. **rv-drop I-3：测试三处盲点**。坐标变换桩是恒等映射 ⟹「删掉变换」的变异存活；
   `items: []` 让测试走上真机不走的回退分支（`filesFromDataTransfer` **优先 items**）。
   改用非恒等桩 + 真机 `items` 形状（含一个目录项，顺带钉住「目录不收」）。两个变异现已被抓。

### 采纳的 Minor（择要）

`compareBy` 注释的理由改准（相减版**不会**排错，真正问题是 NaN 绕过显式的装饰索引兜底）；
失败态占位卡置顶补测试 + 写进 spec；⌘+Shift 改为把区间**并入**现有选区（对齐 Finder /
资源管理器 / VS Code）；`rangeBetween` 改成全函数以消掉不可达的空区间兜底；
补 `aria-multiselectable` 与 `select-none`；修正「方向键 nudge / 搜索跳转会换选中」这两条
不成立的表述（**是 spec 先错、代码注释照抄了**，两者都已改）。

### 本轮我自己的四处错（记账）

1. 一句**与自己 plan 自相矛盾**的注释（rv-drop I-1）。
2. 「与双击生成多张观感一致」是假断言 —— 它进了给 Nick 的选项描述，**导致一次在错误前提下的决策**，
   评审推翻后重新问过才改。
3. 测试走了真机不走的分支（`items` 回退）。
4. **修 I-1 时引入一个哨兵冲突**：`fromListRef` 用裸 `string | null`，而「⌘ 点掉最后一条」
   会让列表点击产生空选区、本次末位就是 `null` —— 与「无待消费标记」撞哨兵。
   这个是**补测试时自己抓到的**（先修后补测试，测试立刻报红），已裹一层对象消歧义并钉成回归。

## 真机验收（2026-08-08，dev :3013 打 pgc dev，项目 1633「P0-A 验收」）

全程**零 credit**：只用浏览器现造的 8×8 PNG 走上传路径（上传不计费），未触发任何生成。

| 标准 | 方法 | 结果 |
|---|---|---|
| 7 拖放落点 | 真实 `DataTransfer`（`items` 由浏览器填，**jsdom 覆盖不到的那条路径**）拖 3 个文件 | ✅ 8 张 `upl-` 卡坐标两两全不同：`310,225 / 310,490 / 410,375 / 410,855 / -110,375 / 350,455 / -170,695 / 90,935` |
| 8 单文件回归 | 同上单文件 | ✅ 落在松手处 |
| 1 画布→列表滚动 | 列表 15 行（`scrollHeight 672 > clientHeight 522`），画布上点选**末行**对应的卡 | ✅ `scrollTop 0 → 144.5`，该行进入视野 |
| 2 列表点击不滚 | 点第 4 行 | ✅ `scrollTop` 不变，选中已切换 |
| 3 Shift 区间 | 点第 4 行 → Shift 点第 8 行 | ✅ 第 4–8 行全选；反向 Shift 点第 1 行 → 第 1–4 行 |
| 4 / ⌘+Shift 并入 | 已选 1–4 → ⌘ 点第 12 行 → ⌘+Shift 点第 14 行 | ✅ 得 1–4 + 12–14，**先前攒的散条目没丢** |
| 5 占位卡置顶 | 拖放后 120ms 采样（上传在飞、卡仍是 `pending_`） | ✅ 占位卡（标签「Image」）排在第一行，在所有已落库卡之上 |
| 9 降低动态 | 读 `<ul>` 的 computed style | ✅ `scroll-behavior: smooth`（当前 no-preference），类真的生效而非只挂着；reduce 下该 `@media` 整条不生效 → 回落 `auto` = 瞬时 |
| 顺带 | 同一次读取 | ✅ `user-select: none`（Shift 点击不拉出原生文本选区）、`aria-multiselectable="true"` |

**采样口径说明**：画布用了虚拟化（`onlyRenderVisibleElements`），最初只渲染视口内 2 个节点，
一度让我误判「上传失败」。改用列表抽屉取全量 + ⌘1 fit view 后 15 个节点全部渲染，才拿到上面的坐标。

## 未验到

- **标准 6（有 seq 资产相对顺序不变）** 只有单测覆盖，真机未专门构造对照 —— 属低风险回归，
  且 15 行列表的顺序目视与 seq 递减一致。
- **混合类型拖放（首个是 .txt/.md）** 未真机验：终审 fin-branch 已用 store 层探针证明它会
  「文本卡精确压在图片上」，spec 标准 7 已收成「同类文件」口径并列为已认领边界（本轮不修）。
- **多个文本文件拖放的顺序依赖**（终审 fin-rewrites 的 M-8）：`await file.text()` 的续体
  理论上可能乱序，实测恒按发起序执行，属理论风险，未构造极端用例。
- **⌘+Shift 只增不减**（fin-rewrites 的 M-7）：与 Finder「在设锚那次快照选区」的模型有差距，
  连点两次 ⌘+Shift 收窄不回来。仍严格优于改动前的整体替换，已写进 spec 的「已知与惯例的差距」。
- **`markAssetsFailed` 不写 seq 这条不变式**（fin-rewrites 的 M-2）：`asset-list.test.ts` 那条
  「失败态占位卡置顶」测的是排序函数、不是 `markAssetsFailed` 本身；变异让它顺手写 `seq: 0` 能全绿逃逸。
  跨模块不变式，要守得在 `actions` 那侧加断言，本轮未做。
