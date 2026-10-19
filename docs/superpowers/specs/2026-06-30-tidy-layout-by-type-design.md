# 资产画布「一键整理」按类型分行设计稿

> 日期:2026-06-30 · 分支:`feat/tidy-layout-by-type`
> 前序:`docs/superpowers/specs/2026-06-30-tidy-layout-flextree-design.md`(flextree 货架打包)
>       · `docs/superpowers/specs/2026-06-29-canvas-tidy-design.md`(初版树形整理)

## 背景与目标

现有 `tidyLayout`(`src/lib/card-layout.ts`)整理流程分四步:建森林 → 逐树 flextree 布局(局部坐标 + 包围盒)→ **货架打包成多行**(所有树盒按当前位置升序,从 `min(x,y)` 起从左到右铺、超 `MAX_ROW_WIDTH` 换行)→ 网格吸附。货架打包对**所有类型的树盒一视同仁**,卡片按位置混排。

本次目标:让「一键整理」**按资产类型分行排列**——整理后每个类型独占一个「行带」,行带从上到下按 `video → image → audio → 3D` 顺序排列,同类型卡片在本行带内从左到右铺、超宽自动换行。**只改第 3 步「货架打包」的编排顺序与分组**,前两步(单棵树的 flextree 布局、列宽累计、纵向居中)与第 4 步(吸附取整)完全不动。

## 关键决策(已与用户确认)

| 决策 | 选择 | 理由 |
|---|---|---|
| 触发入口 | **改造「一键整理」按钮**(`tidyCanvas` → `tidyLayout`) | 系统唯一会批量挪卡的入口;「按行排列整个画布」语义只在这里成立 |
| 派生关系 | **保留派生树形,按「树根类型」整体归行** | 用户显式选择;树盒不拆,内部父子连线与紧凑布局完全沿用前两步 |
| 行带顺序 | `video → image → audio → 3d`,doc / 未知类型确定性兜底排最后 | 用户点名前四类;doc 当前不存在,但枚举里有,需有确定性落点不抛错 |
| 行内换行 | **本类型行带内超 `MAX_ROW_WIDTH` 自动换行**,下个类型起新行带 | 复用既有换行阈值;同类型多卡时不撑成超宽单行 |
| 空类型 | **跳过,不留空行带** | 无该类型卡时不产生空白行 |
| 组内顺序 | 沿用现有「按当前 (y,x) 升序」 | 「梳理」而非「打乱」,确定性可测,贴近原排布 |
| 锚点 / 相机 | **不动**,锚点仍取全部卡 `min(x,y)` | 沿用前序:整理后停在原视野 |

> 与 flextree 前序 spec 第 127 行「不做:不按资产类型分组」的关系:那条是该 spec 的 YAGNI 边界,本 spec 是其后继需求,**有意解除该限制**,在已落地的货架打包之上叠加类型分组。

## 架构与单向数据流

沿用分层:纯落位逻辑在 `lib/card-layout.ts`,状态变更走 `tidyCanvas` action,UI 只调 action。本次唯一新增的数据是**节点类型(`kind`)的喂入**与**类型优先级常量**。

```
ZoomBar「整理」 ──onTidy──▶ AssetCanvas.onTidy
                              │ getNodes() 读 measured → sizeById(沿用)
                              ▼
                          store.tidyCanvas(sizeById)
                              │ assets ⨝ sizeById → TidyNode[](新增 kind: a.kind)
                              │ tidyLayout(nodes, TIDY_ROW_KIND_ORDER)  ← 新增第二参
                              ▼
                          一次 set 写入全部新 position → 节点同步 → .canvas-tidying 平滑过渡(复用)
```

## 组件设计

### ① 类型优先级常量(`src/lib/asset-kind.ts`)

新增**整理专用**的行带顺序常量,与现有 `KIND_ORDER`(图例顺序,image-first,**不改**)解耦:

```ts
// 一键整理「按类型分行」的行带顺序(自上而下);与图例 KIND_ORDER 解耦,可独立调整
export const TIDY_ROW_KIND_ORDER: AssetKind[] = ['video', 'image', 'audio', '3d', 'doc'];
```

### ② 数据形状(`src/lib/card-layout.ts`)

`TidyNode` 增加可选 `kind`(字符串,**不引入 `AssetKind` 业务枚举**,保持 `card-layout.ts` 无业务耦合;`Asset` 结构兼容可直接传入):

```ts
export interface TidyNode { id: string; parentId?: string; position: XY; width?: number; height?: number; kind?: string }
```

`TreeBox` 增加 `kind`(该树**根节点**的 kind),供第 3 步分组:

```ts
interface TreeBox { localPos: Map<string, XY>; w: number; h: number; kind?: string }
```

`layoutTree(root)` 末尾返回时带上 `kind: root.kind`;防环兜底分支(无根可达节点按原序补为根)的盒同理带 `n.kind`。

### ③ `tidyLayout(nodes, kindOrder?)` —— 第 3 步改造

签名新增**可选**第二参 `kindOrder?: string[]`(缺省时退化为现状,见兼容性):

```ts
export function tidyLayout(nodes: TidyNode[], kindOrder?: string[]): Map<string, XY>
```

**第 1、2 步不变**(建森林、逐树 flextree 布局得 `boxes: TreeBox[]`)。

**第 3 步「货架打包」改造**为「分组 → 按类型顺序逐组铺行带」:

1. **分组**:把 `boxes` 按 `box.kind` 分桶(`Map<kindKey, TreeBox[]>`)。桶内顺序保持 `boxes` 的现有顺序(即按根当前 (y,x) 升序)。
2. **定组序**:
   - 若 `kindOrder` 提供:先按 `kindOrder` 列出的类型依次取桶;`kindOrder` 未列到的类型(及 `kind` 为 `undefined`)按**首次出现顺序**(`boxes` 遍历序,确定性)追加在最后。
   - 若 `kindOrder` 缺省:所有盒归为**单一组**(等价现状,见兼容性)。
3. **逐组铺行带**:游标 `cx=baseX, cy=baseY, rowH=0`(`baseX/baseY` 仍取全部卡 `min(x,y)`);**按定好的组序**,每开始一个新组先 `cx=baseX`(强制起新行,即「分行」),组内沿用现有货架逻辑:
   - 每个盒:若 `cx > baseX` 且 `cx + box.w > baseX + MAX_ROW_WIDTH` → 本组内换行(`cy += rowH + COMPONENT_GAP; cx = baseX; rowH = 0`);写该盒各节点全局坐标 `(cx + localx, cy + localy)`;`cx += box.w + COMPONENT_GAP; rowH = max(rowH, box.h)`。
   - 组结束:`cy += rowH + COMPONENT_GAP; cx = baseX; rowH = 0`(下个类型起**新行带**)。
   - 空组(无盒)自然跳过,不推进 `cy`,不留空行带。

**第 4 步不变**(网格吸附 + 取整)。

**兼容性(关键不变式)**:`kindOrder` 缺省 → 所有盒单一组 → 单组内连续货架打包 = 现有第 3 步逐字节等价。现有 9 条 `tidyLayout` 测试均**不传** `kindOrder`、节点**不带** `kind`,故行为不变,全绿。

**无重叠论证(增量)**:组内无重叠沿用前序论证;组间因每组起新行(`cy` 在上一组所有行之下 + `COMPONENT_GAP`)且 `cx` 回 `baseX`,纵向区间不相交 → 全局无重叠。

### ④ 接线(`src/store/actions.ts`)

`tidyCanvas` 构造 `TidyNode` 时带上 `kind: a.kind`,调用时传入 `TIDY_ROW_KIND_ORDER`:

```ts
const tidyNodes: TidyNode[] = assets.map((a) => {
  const s = sizeById?.[a.id];
  return { id: a.id, parentId: a.parentId, kind: a.kind, position: a.position, ...(s ? { width: s.width, height: s.height } : {}) };
});
const layout = tidyLayout(tidyNodes, TIDY_ROW_KIND_ORDER);
```

其余(diff、一次 `set`、`pending_` 不回写、逐项 fire-and-forget `persistAssetPosition`、`await` 后校验 pid)**全部沿用**。`tidyCanvas` 仍是唯一落库入口。

### ⑤ UI / 动画 / i18n / 图标

**全部沿用,无需改动**:`.canvas-tidying` transition、`ZoomBar` 整理按钮、`figAsset.tidy` 图标、`canvas.tidy` 四语文案。位置一变,既有 transition 自动平滑过渡到新行带。

## 测试(TDD,`src/lib/card-layout.test.ts` 追加;不改既有 9 条)

新增用例(均显式传 `kindOrder` 与节点 `kind`):

1. **多类型按行带顺序**:四张独立卡 `video / image / audio / 3d`(乱序输入),断言整理后 y 严格递增且顺序为 video < image < audio < 3d,各带 x 回到 `baseX`。
2. **派生树按根类型归行**:根 `video`、子 `image` + 子 `audio` 的一棵树,加独立 `image` 卡;断言整棵树(含 image/audio 子卡)全部落在最上行带(video),独立 image 卡落在其下行带,且**子卡 y 不与独立 image 卡同带**(验证「不拆树」)。
3. **同类型超宽本带内换行**:同类型多张宽盒使首行累计宽超 `MAX_ROW_WIDTH`,断言在本带内换到第二行(x 回 baseX、y 下移),下一类型再起新带(y 更大)。
4. **空类型跳过**:只有 video 与 3d、无 image/audio,断言 3d 带紧接 video 带下方,中间不留 image/audio 的空行高度。
5. **未列类型 / 无 kind 兜底**:`kindOrder=['video']`、另有 `image` 与无 kind 节点,断言未列类型按首次出现序追加在 video 带之后,不抛错、全员有坐标。
6. **缺省兼容**:同一组节点分别 `tidyLayout(nodes)` 与 `tidyLayout(nodes, undefined)`,断言与不带 kind 的现状输出一致(可与既有「货架多行」用例同构对照)。

store 侧(`src/store/actions.test.ts`,若已有 `tidyCanvas` 用例则扩展):断言 `tidyNodes` 带上了 `a.kind` 且 `tidyLayout` 收到 `TIDY_ROW_KIND_ORDER`(可对一个跨类型场景断言最终 `assets` 坐标按行带分布)。

## 不做(YAGNI)

- **不打散派生树**(不按每张卡自身类型拆到各自行带)——已明确选「按树根类型归行」。
- **不改 `KIND_ORDER`**(图例顺序)与图例 UI。
- 不引入 doc 的特殊 UI(当前无 doc 类型,仅作兜底排序)。
- 不动相机(不 fitView)、不改锚点语义。
- 不新增按钮 / 开关 / 硬编码色值 / keyframes;动画复用 `.canvas-tidying`。
- 不改前两步 flextree 布局与第 4 步吸附。

## 落地约束清单

- `tidyLayout` 保持纯函数、不可变返回、确定性可测;`kindOrder` 缺省必须与现状逐字节兼容(既有 9 条用例不得改、全绿)。
- `card-layout.ts` 不引入 `AssetKind` 业务枚举,`TidyNode.kind` 用 `string`;类型优先级常量放 `asset-kind.ts`。
- `tidyCanvas` 仍是唯一落库入口;坐标 int 化尊重后端 `canvas_x/y` 契约;`pending_` 卡不回写。
- 注释中文,解释「为什么」(组间不重叠论证 / 按根类型归行的不变式 / 缺省兼容)。
