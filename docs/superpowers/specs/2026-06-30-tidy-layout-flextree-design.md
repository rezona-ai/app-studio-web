# 资产画布「一键整理」增强(flextree)设计稿

> 日期:2026-06-30 · 分支:`feat/tidy-flextree`
> 前序:`docs/superpowers/specs/2026-06-29-canvas-tidy-design.md`(初版树形整理)

## 背景与目标

初版 `tidyLayout`(`src/lib/card-layout.ts`)已实现纯函数树形整理:列=深度、**每个叶子占全局唯一一行**、内部节点居中、树之间纵向堆叠留一行、固定尺寸估值 `CARD_W=180 / CARD_H=150`、`min(x,y)` 锚点、防环。

参考竞品 liblib「整理画布」(实测为 React Flow + **ELK.js `layered`** 布局)的做法,本次在**不引入 elkjs**(异步 + Web Worker + 为通用 DAG 设计,与本项目纯函数、单父森林不匹配)的前提下,把其中真正增值的编排思想移植进现有纯函数,产出**增强版 `tidyLayout`**。

吸收的四项能力(已与用户确认全要):

1. **多行货架打包** —— 卡片/树多时不再堆成一条无限高的竖列,按最大行宽换行铺成多行网格(对应 ELK 的连通分量分别布局再拼接)。
2. **按真实节点尺寸** —— 用每张卡的真实宽/高算列宽行高,宽视频卡 / 高卡不重叠、间距贴合内容。
3. **ELK 式紧凑(子树相对定位)** —— 改用真正的 Reingold–Tilford / flextree:不同深度的分支可复用纵向空间,整体更矮。
4. **网格吸附** —— 最终坐标吸附到固定网格,布局更规整。

## 关键决策(已与用户确认)

| 决策 | 选择 | 理由 |
|---|---|---|
| 实现路线 | **纯函数 flextree 重写**,不引入 elkjs | 贴合 `card-layout.ts` 纯同步、可单测;数据是单父森林,不需要 DAG 引擎;无新依赖、无 Worker |
| 真实尺寸来源 | **画布 React Flow `measured` 喂入 + 常量兜底** | 尺寸真值在画布层(`node.measured`),`Asset` 无尺寸字段;无尺寸时退回 `CARD_W/CARD_H`,行为不破 |
| 树之间排布 | **货架多行铺开**(取代纵向堆叠) | 树/游离卡多时避免无限高竖列;锚点仍 `min(x,y)`,相机不动,沿用初版决策 |
| 相机 | **不动**(不 fitView) | 沿用初版:锚点保证留在原视野 |
| 紧凑策略 | **子树相对定位**(放弃"每叶独占一行") | 用户显式选择;更接近 ELK 观感、更省纵向空间 |

## 架构与单向数据流

沿用分层:纯落位逻辑在 `lib/`,状态变更走 store action,UI 只调 action。本次新增的是**真实尺寸的喂入链路**。

```
ZoomBar「整理」 ──onTidy──▶ AssetCanvas.onTidy
                              │ getNodes() 读 node.measured → sizeById
                              ▼
                          store.tidyCanvas(sizeById)
                              │ 1. assets ⨝ sizeById → TidyNode[]
                              │ 2. tidyLayout(nodes)  ← lib/card-layout.ts(纯函数)
                              │ 3. 一次 set 写入全部新 position
                              │ 4. 逐个 persistAssetPosition(变位且非 pending_)
                              ▼
                          assets 更新 → 节点同步 → .canvas-tidying transition 平滑滑动(已存在,复用)
```

## 组件设计

### ① 数据形状与常量(`src/lib/card-layout.ts`)

`TidyNode` 增加可选尺寸,签名向后兼容(旧调用 `tidyLayout(assets)` 仍编译,尺寸缺失走兜底):

```ts
export interface TidyNode { id: string; parentId?: string; position: XY; width?: number; height?: number }
```

新增常量(均可调):

| 常量 | 默认值 | 含义 |
|---|---|---|
| `COMPONENT_GAP` | `60`(≈ 1.5·GAP_Y) | 货架打包时,树盒之间(横向)与行之间(纵向)的留白 |
| `MAX_ROW_WIDTH` | `3200` | 货架换行阈值:一行累计宽超过它就换到下一行 |
| `SNAP_GRID` | `10` | 网格吸附粒度,`snap(n)=round(n/SNAP_GRID)·SNAP_GRID` |

复用既有 `GAP_X`(层间横向)、`GAP_Y`(同层纵向)、`CARD_W/CARD_H`(尺寸兜底)。

### ② `tidyLayout(nodes)` —— 四步纯算法

输入 `TidyNode[]`,输出 `Map<string, XY>`(id → 新左上角坐标)。`w(n)=n.width ?? CARD_W`、`h(n)=n.height ?? CARD_H`。

**第 1 步 · 建森林**(沿用初版)
有效父校验(`parentId` 在集合内且非自指),`childrenOf` 按当前 (y,x) 排序,`roots` 按当前 (y,x) 排序;`visited` 防环兜底(纯环里无根可达的节点按原序补为根)。

**第 2 步 · 逐树 flextree 布局(局部坐标,原点在该树左上角)**

- **列 = 深度,按真实宽度累计**:先求该树各深度的最大宽 `colWidth[d] = max{ w(n) | depth(n)=d }`,再 `colX[d] = Σ_{k<d}(colWidth[k] + GAP_X)`,节点 `x = colX[depth]`。宽卡撑宽整列,后续列右移(不再固定步距)。
- **行 = 子树相对定位(Reingold–Tilford,变高)**:递归 `place(node)` 返回该节点子树占据的纵向区间 `[top, bottom]`:
  - 叶子:占 `[yCursor, yCursor + h(node)]`,自身 `y = yCursor`,返回该区间。
  - 内部:依次对子节点调用 `place`,**第 i 个子节点的 yCursor = 前一子树 bottom + GAP_Y**(子树整体不重叠);子树全部布完后,自身 `y = 首末子节点中心连线的中点 − h(node)/2`(纵向居中于子树),其纵向区间为 `[min(自身top, 首子top), max(自身bottom, 末子bottom)]`。
  - **紧凑性来源**:纵向游标只在「同一父的兄弟之间」按子树实际高度推进;不同父(不同列)的子树各自从其父的游标起算,因此**不同深度的分支可复用同一段 y**,整体高度由最宽子树层决定,而非全树叶子数 → 比初版更矮。
- 记录树包围盒:`treeW = colX[maxDepth] + colWidth[maxDepth]`;`treeH = max(所有节点 bottom) − min(所有节点 top)`,并把局部坐标平移到 `top=0, left=0`。

**第 3 步 · 货架打包成多行**(锚点 = 全局 min(x,y),相机不动)

- `baseX = min{当前所有卡 x}`,`baseY = min{当前所有卡 y}`。
- 树盒按各自成员当前 (最小 y, 最小 x) 升序排(「梳理」而非「打乱」,确定性可测)。
- 游标 `cx=baseX, cy=baseY, rowH=0`;对每棵树盒:
  - 若 `cx > baseX` 且 `cx + treeW > baseX + MAX_ROW_WIDTH` → 换行:`cy += rowH + COMPONENT_GAP; cx = baseX; rowH = 0`。
  - 该树每个节点全局坐标 = `(cx + 局部x, cy + 局部y)`。
  - `cx += treeW + COMPONENT_GAP; rowH = max(rowH, treeH)`。
- 游离单卡 = 1 节点的树(`treeW=w, treeH=h`),自然流入网格。

**第 4 步 · 网格吸附 + 取整**
每个最终坐标 `x→snap(x), y→snap(y)`,`snap(n)=Math.round(n/SNAP_GRID)*SNAP_GRID`;结果即整数,尊重后端 `canvas_x/y` 的 int 契约。

**无重叠论证**:同一树内,同列(同深度)节点的子树纵向区间两两不相交(兄弟游标按 bottom+GAP_Y 推进),父居中只发生在自己列、自己子树区间内;不同树盒在货架里按宽/高 + COMPONENT_GAP 互不相交。故全局无重叠。

### ③ 接线:真实尺寸喂入

- **`AssetCanvas.onTidy`**(`src/components/canvas/AssetCanvas.tsx`):用 `useReactFlow().getNodes()` 读各节点 `measured.width/height`(无则跳过该 id),build `sizeById: Record<string, {width:number; height:number}>`,调 `tidyCanvas(sizeById)`。
- **`tidyCanvas(sizeById?)`**(`src/store/actions.ts`):把 `assets` 映射成 `TidyNode`(`width/height` 取 `sizeById[a.id]`,缺失留空走兜底),调 `tidyLayout`;其余逻辑(diff、一次 `set`、`pending_` 不回写、逐项 fire-and-forget `persistAssetPosition`、`await` 后校验 pid)全部沿用。
- store 类型:`ServerActions.tidyCanvas` 签名补可选参 `sizeById`。

### ④ 平滑动画 / 按钮 / i18n / 图标

**全部沿用初版,无需改动**:`.canvas-tidying` 的 `transform` transition(已在 `globals.css`,含 `prefers-reduced-motion` 禁用)、`ZoomBar` 整理按钮、`figAsset.tidy` 图标、`canvas.tidy` 四语文案。节点位置一变,既有 transition 自动平滑过渡到货架新位。

## 测试(TDD,重写 `tidyLayout` 用例)

行为有意改变(树之间由纵向堆叠 → 货架多行;叶子不再独占全局行),初版用例需重写。`src/lib/card-layout.test.ts`:

- 空数组 → 空 Map。
- 真实尺寸列宽累计:某深度放一个宽卡(如 600 宽),其后列的 x 右移量 = 该列最大宽 + GAP_X。
- 子树紧凑无重叠:构造两个深度不同的兄弟子树,断言其叶子的 y 区间可复用(整体高度 < 初版"叶子数 × ROW")、且同列节点两两不重叠。
- 内部节点纵向居中于其首末子节点。
- 货架换行:构造多棵树使首行累计宽超 `MAX_ROW_WIDTH`,断言第 N 棵起 y 进入第二行、x 回到 baseX。
- 网格吸附:输出坐标均为 `SNAP_GRID` 的整数倍。
- 锚点:整体平移到当前 `min(x,y)`。
- 防环:`parentId` 自指 / 互指不死循环、每节点都有坐标。
- 兜底:`TidyNode` 不带尺寸时退回 `CARD_W/CARD_H`,行为与含尺寸路径一致(只是尺寸值不同)。

store 轻量测试(`src/store/`):`tidyCanvas(sizeById)` 后 `assets` 坐标 == `tidyLayout` 输出;仅对变位且非 `pending_` 卡触发 `persistAssetPosition`(对 `pgcApi`/`persistAssetPosition` 打桩断言调用集合);`sizeById` 透传进 `tidyLayout`(可对宽卡断言列右移)。

## 不做(YAGNI / 沿用既有)

- 不引入 elkjs / Web Worker。
- 不动相机(不 fitView);锚点已保证留在原视野。
- 不按资产类型分组、不做规则网格强对齐(仅在自由树形上做货架打包)。
- 不新增批量坐标回写端点(复用逐项 fire-and-forget)。
- 不持久化「整理」开关或动画态。

## 落地约束清单

- `tidyLayout` 保持纯函数、不可变返回、确定性可测;`tidyCanvas` 仍是唯一落库入口;坐标 int 化尊重后端契约。
- 真实尺寸缺失时必须有常量兜底,旧调用 `tidyLayout(assets)` 不得编译失败。
- 不新增硬编码色值 / 一次性 keyframes / 新按钮种类;动画复用既有 `.canvas-tidying`。
- 注释中文,解释「为什么」(不变式 / 无重叠论证 / 锚点语义)。
