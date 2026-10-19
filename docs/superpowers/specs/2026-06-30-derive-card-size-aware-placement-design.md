# 派生卡按类型尺寸落位(消除重叠)设计稿

> 日期:2026-06-30 · 分支:`fix/derive-card-overlap`
> 相关:`src/lib/card-layout.ts`(落位纯函数)· `src/store/actions.ts`(落位接线)

## 背景与问题

派生生成资产时,新卡与已有卡重叠(见用户反馈截图:父 image 卡派生出 image「生成更多场景」与 video「Video」两张子卡,后者压进前者底部)。

**根因**:纵向堆叠用了一刀切的固定 `CARD_H = 150`,但这个 150 实际只是 **image 卡的媒体区高度**,不是整卡高度;且各类型卡真实宽高都不同。

| 类型 | NodeCard `width` | 媒体高 | 整卡高(媒体 + header/padding/边框 ≈50) |
|---|---|---|---|
| image | 180 | 150 (`h-[150px]`) | ≈198 |
| video | 200 | 132 (`h-[132px]`) | ≈182 |
| 3d | 180 | 140 (`h-[140px]`) | ≈190 |
| audio | 210 | ~76 | ≈122 |
| doc | 210 | ~100 | ≈148 |

`childPosition`(`card-layout.ts:17`)堆第二个兄弟卡:`y = max(兄弟.y) + CARD_H(150) + GAP_Y(40)`,只下移 190px。但上面那张 image 卡真实高 ≈198px → 第二张子卡压进它底部 ≈8px(画布坐标,缩放下视觉放大),即重叠。`avoidOverlap` 的碰撞判定同样用 150,因此误判「不重叠」、不纠正。

## 目标

落位**按卡片类型用各自真实尺寸**,而非一刀切 150,使派生兄弟卡纵向不再重叠。修复落在纯函数 `card-layout.ts` + 落位接线 `actions.ts`,不引入运行期 DOM 测量耦合(尺寸是按类型静态的)。

## 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 尺寸来源 | **按类型的静态常量表**(对齐 `nodes/*.tsx` 的 NodeCard width 与媒体高 + 外壳) | 卡片高度按类型静态(标题 `truncate` 单行、媒体定高),无动态换行;常量纯/可测、无运行期耦合,改节点 CSS 时同步此表 |
| 估值取向 | **偏大取整**(真实高 + 小余量) | 宁可多留几像素白也不重叠;低估 = 复现本 bug |
| 堆叠基准 | 堆到「最低兄弟的**真实底边** `y + 高`」之下 + `GAP_Y` | 兄弟高度不一时(如 image 上、audio 下)也能正确接续 |
| 横向偏移 | 子卡 x = 父卡 `x + 父真实宽 + GAP_X` | 父为 doc/audio/video(宽 210/200)时不再用 180 低估间距 |
| `avoidOverlap` | **本次不改** | 修好 `childPosition` 后兄弟卡已不重叠,`avoidOverlap` 作为后置兜底对其返回值判定为「无碰撞」原样放行;其固定 `CARD_H` 的非派生场景低估是既有、独立、低频问题,遵循「单一修复」不顺手扩面 |
| 兼容 | `childPosition` 缺省尺寸退回 `CARD_W/CARD_H` | XY 满足新 `Box`(w/h 可选);不传 h 时新逻辑 `max(y + CARD_H) + GAP_Y` 与旧 `max(y) + CARD_H + GAP_Y` 逐字节等价 |

## 设计

### ① 类型尺寸表(`src/lib/card-layout.ts`)

新增按类型尺寸常量(键用 `string`,**不引入 `AssetKind` 业务枚举**,保持本文件无业务耦合)与取尺寸 helper;`CARD_W/CARD_H` 保留为兜底默认(image 量级):

```ts
// 各类型卡估算尺寸:对齐 components/canvas/nodes/*.tsx 的 NodeCard width 与媒体高 + 外壳
// (header+padding+边框 ≈50)。取偏大整值——宁可多留白也不重叠。改节点 CSS 时同步此表。
export const CARD_SIZE: Record<string, { w: number; h: number }> = {
  image: { w: 180, h: 200 },
  video: { w: 200, h: 190 },
  '3d':  { w: 180, h: 195 },
  audio: { w: 210, h: 130 },
  doc:   { w: 210, h: 155 },
};
// 取某类型卡尺寸,未知类型退回通用兜底(image 量级)
export function cardSize(kind?: string): { w: number; h: number } {
  return (kind != null && CARD_SIZE[kind]) || { w: CARD_W, h: CARD_H };
}
```

### ② `childPosition` 改为尺寸感知(`src/lib/card-layout.ts`)

引入带可选宽高的 `Box`,父/兄弟均按 `Box` 传入:

```ts
export interface Box extends XY { w?: number; h?: number }

// 树形落位:首子在父右侧、y 与父对齐;后续堆在「最低兄弟真实底边」之下。
// 尺寸缺省退回 CARD_W/CARD_H(与旧行为逐字节兼容)。
export function childPosition(parent: Box, siblings: Box[]): XY {
  const x = parent.x + (parent.w ?? CARD_W) + GAP_X;
  if (siblings.length === 0) return { x, y: parent.y };
  const bottom = Math.max(...siblings.map((s) => s.y + (s.h ?? CARD_H)));
  return { x, y: bottom + GAP_Y };
}
```

> 兼容论证:siblings 不带 h 时 `max(s.y + CARD_H) + GAP_Y = max(s.y) + CARD_H + GAP_Y`,与旧实现完全相同;父不带 w 时 x 偏移仍为 `CARD_W + GAP_X`。故既有「单子 / 双子(image)」断言里**只有显式喂入真实尺寸的用例才变化**。

### ③ 落位接线喂入类型尺寸(`src/store/actions.ts`)

`placeTarget` / `placeAndLink` 把父与兄弟的 `kind` 经 `cardSize` 转成 `Box`:

```ts
const placeTarget = (opts, placed: Box[]): XY => {
  const existing = get().assets;
  const parent = opts?.sourceItemId ? existing.find((e) => e.id === opts.sourceItemId) : undefined;
  if (parent) {
    const siblings: Box[] = [
      ...existing.filter((e) => e.parentId === parent.id).map((s) => ({ ...s.position, ...cardSize(s.kind) })),
      ...placed,
    ];
    return childPosition({ ...parent.position, ...cardSize(parent.kind) }, siblings);
  }
  ...
};
```

`placeAndLink` 内同批已落位 `placed` 也带上 `cardSize(a.kind)`(高度供后续兄弟堆叠基准):

```ts
const prev: Box[] = placed.map((p) => ({ ...p.position, ...cardSize(p.kind) }));
```

`avoidOverlap` 调用与签名**不变**(仍按 `XY`);`addGenPlaceholder` 调用 `placeTarget(opts, [])` 不变。

## 测试(TDD)

### `src/lib/card-layout.test.ts`(纯函数)

1. **兄弟卡按真实底边堆叠**:父 + 两个带 `h` 的兄弟(首子 image h=200),断言第二子 `y = 首子.y + 200 + GAP_Y`(而非 `+ CARD_H`),且 ≥ 首子底边 → 不重叠。
2. **不等高兄弟**:兄弟 A(y=0,h=200)、B(y=240,h=130),新子堆到 `max(0+200, 240+130) + GAP_Y = 370 + GAP_Y`。
3. **父宽生效**:父带 w=210,首子 `x = parent.x + 210 + GAP_X`。
4. **缺省兼容**:`childPosition(parentXY, [siblingXY,...])` 不带 w/h,断言与旧公式 `max(y)+CARD_H+GAP_Y` 一致(锁回归)。
5. **cardSize 兜底**:`cardSize(undefined)` / `cardSize('unknown')` 返回 `{CARD_W, CARD_H}`;`cardSize('video')` 返回表内值。

### `src/store/actions.test.ts`(接线)

- 现有「双 image 子卡」用例:第二张子卡 y 从 `200 + CARD_H + GAP_Y` 更新为 `200 + cardSize('image').h + GAP_Y`(引常量、不硬编码)。
- 新增「混合类型派生」:image 父派生 image 子 + video 子,断言 video 子 y 落在 image 子真实底边之下、两卡矩形不相交。

## 不做(YAGNI)

- 不改 `avoidOverlap` 签名 / 碰撞算法(见决策表)。
- 不引入运行期 DOM 测量 / 尺寸注册通道(尺寸按类型静态,常量足矣)。
- 不动自动导入(`importGeneratedAsset`)的视口中心落位路径。
- 不改 `tidyLayout`(其已支持 `sizeById` 真实测量)。
- 不引入新组件 / 硬编码色值 / keyframes。

## 落地约束

- `card-layout.ts` 保持纯函数、不可变返回、确定性可测;不引入 `AssetKind` 业务枚举(`CARD_SIZE` 键用 `string`)。
- `childPosition` 缺省尺寸必须与旧行为逐字节兼容(回归用例锁定)。
- store 仍是唯一落库入口;坐标 int 化尊重后端 `canvas_x/y` 契约。
- 注释中文,解释「为什么」(兼容不变式 / 偏大取整避重叠 / 尺寸表对齐节点 CSS)。
