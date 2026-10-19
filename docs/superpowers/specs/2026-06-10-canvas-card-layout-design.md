# 画布资产卡片排布规则改造设计

日期:2026-06-10
状态:已确认

## 背景与动机

当前画布使用「泳道 + d3-force 力导向」自动排布:`src/lib/zones.ts` 按资产类型分 5 条横向泳道,`src/lib/force-layout.ts` 在新资产出现时对所有未 pinned 卡片跑一次力导向模拟。问题:

- 卡片位置由系统决定,与用户的空间心智模型脱节——双击某处生成,卡片却出现在泳道里;
- 力导向会在新资产加入时挪动既有卡片,画布"自己会动";
- 加号派生的资产与源资产仅有连线关系,空间上不相邻,树形结构不直观。

本次改造把排布哲学从「系统自动排布」换成「位置在创建那一刻确定,之后只有用户能动」。

## 目标

1. 删除泳道与 d3-force 力导向机制,任何时刻都不再自动挪动已有卡片。
2. 双击画布空白处生成的卡片,落位在用户点击的位置。
3. 加号派生的资产按树形拓扑落位在源资产旁边(右侧)。
4. 无点击坐标的资产(上传/自动导入/历史资产)有合理的兜底落位。

## 非目标

- 不做子树自动整形/重平衡(用户拖动后的布局永久保留,见「方案取舍」);
- 不改动连线(parentId/edge)机制、生成弹窗交互、卡片视觉;
- 不做手动连线、框选等新画布能力。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 排布策略 | 方案 A:增量放置——位置只在创建时计算一次,系统永不挪动既有卡片(方案 B 子树自动整形被否决,因其会移动用户拖好的卡片,与改造动机矛盾) |
| 树形方向 | 父节点右侧、子节点垂直堆叠(加号在卡片右侧,连线左→右,类似横向思维导图) |
| 重叠处理 | 简单避让:目标位置与已有卡片重叠时沿固定方向(向下)步进偏移,直到找到空位 |
| 兜底位置 | 运行时上传/导入放当前视口中心(多个级联错开);初始加载无坐标的历史资产在原点附近确定性级联,靠 fitView 保证可见 |

## 设计

### 1. 删除自动排布机制

- 删除 `src/lib/force-layout.ts`、`src/lib/force-layout.test.ts`,以及 `AssetCanvas.tsx` 中监听新资产触发重排的 useEffect(含 `seenIdsRef`)。
- `src/lib/zones.ts` 中排布相关内容(`Zone`/`zoneFor`/`zoneCenter`/`zonesMap`/`BAND_*`/`nextLanePosition`/`LANE_*`)删除;`ZONE_ORDER`/`ZONE_LABEL` 是资产类型元数据,与排布无关,迁移到 `src/lib/asset-kind.ts`(更名为 `KIND_ORDER`/`KIND_LABEL`),调用方 `MentionPopover`、`KindLegend`、`store/index` 同步改 import。迁移后删除 `zones.ts` 与 `zones.test.ts`。
- 移除 `Asset.pinned` 字段(其唯一作用是保护卡片不被力导向重排):`store/types.ts`、`setAssetPosition` 签名、`lib/assets.ts` 工厂、`pgc/map.ts` mapper、相关测试同步清理。
- 从 `package.json` 移除 `d3-force` 与 `@types/d3-force` 依赖。

### 2. 落位规则总览

三条创建路径,各自计算目标位置,最后统一过重叠避让:

| 路径 | 目标位置 |
| --- | --- |
| 双击空白处生成 | 点击点的画布坐标(卡片中心对齐点击点) |
| 加号派生生成 | 树形规则:父节点右侧,兄弟节点下方 |
| 上传 / 自动导入(无点击坐标) | 当前视口中心,多个级联错开 |

位置在前端创建资产时确定,通过现有 `updateCanvasReference`(`assetReference(a)`)持久化到 `reference.position`——生成接口请求体不支持坐标参数,沿用 `linkParent` 已验证的「本地即时落位 + fire-and-forget 回写」模式。

### 3. 新模块 `src/lib/card-layout.ts`(纯函数)

替代 `force-layout.ts`/`zones.ts` 的排布职责,全部为可单测的纯函数:

```ts
// 卡片估算尺寸与间距常量(实现时按真实渲染尺寸校准)
export const CARD_W = 180, CARD_H = 150, GAP_X = 80, GAP_Y = 40;

// 树形落位:第一个子节点在父节点右侧、y 与父对齐;
// 后续子节点堆叠在最下方兄弟之下(siblings 为同父已有子节点位置)
export function childPosition(parent: XY, siblings: XY[]): XY;

// 点击落位:卡片中心对齐点击的画布坐标(半宽半高偏移)
export function spawnAtPoint(point: XY): XY;

// 兜底落位:视口中心起,第 i 个按固定步距级联错开
export function cascadePosition(origin: XY, index: number): XY;

// 重叠避让:目标位置与 occupied 中任一卡片矩形重叠时,向下步进 (CARD_H + GAP_Y) 重试,
// 设最大迭代次数(如 50)兜底后原样返回
export function avoidOverlap(target: XY, occupied: XY[]): XY;
```

多级派生天然支持:每个节点对自己的子节点重复同样规则。一次生成返回多个 item 时,逐个调用 `childPosition`(前一个的落位计入下一个的 siblings)。

### 4. 点击位置透传链路

- `AddMenuState` 新增 `spawnAt?: { x: number; y: number }`(画布 flow 坐标)。`AssetCanvas.onPaneDoubleClick` 用 React Flow 的 `screenToFlowPosition` 换算后传入 `openAddMenu`;加号路径不传(位置由树形规则决定)。
- `GenFormState` 同样新增 `spawnAt`,`AddAssetMenu.openGen` 透传。
- 生成 actions(`generateImage/Audio/Video/Model3d`)第二参从 `sourceItemId?: string` 改为 `opts?: { sourceItemId?: string; spawnAt?: XY }`,内部决定落位:
  - 有 `sourceItemId` → `childPosition`(父节点为源资产,siblings 为已有同父子节点);
  - 有 `spawnAt` → `spawnAtPoint`;
  - 都没有 → `cascadePosition`(视口中心)。
  - 结果统一过 `avoidOverlap`,写入资产 `position`,经 `updateCanvasReference` 持久化(派生路径并入 `linkParent` 的回写,避免两次请求)。

### 5. 视口中心获取

actions 层(非 React 环境)需要拿到当前视口中心:新建轻量模块 `src/lib/viewport.ts`,提供 `registerViewportCenter(fn)` / `getViewportCenter(): XY | null`。`AssetCanvas` 的 `Inner` 在 mount 时注册(基于 `useReactFlow` 的换算函数),unmount 时注销。`getViewportCenter()` 返回 null 时(画布未挂载)回退原点 `{0,0}`。

适用路径:`uploadAsset`(上传成功后前端落位 + 回写)、`importGeneratedAsset`(替换原 `nextLanePosition`,改传视口中心级联坐标作 `canvas_x/canvas_y`)。

### 6. 初始加载兜底

`canvasItemsToAssets` 对无任何坐标(无 `reference.position` 且无 `canvas_x/canvas_y`)的历史资产,按列表序在原点附近确定性级联落位(`cascadePosition({0,0}, i)`),不回写服务端;画布 `fitView` 保证可见。已有坐标的存量资产位置保持原样,加载后不再有任何自动重排。

### 7. 数据与持久化调整

- `pgc/map.ts`:`canvasItemToAsset` 移除 `pinned` 计算;`assetReference` 不变。
- `pollGenTasks` 合并逻辑:原「pinned 才保留本地坐标」改为**始终保留本地 `position`**——位置归前端所有,创建时已落位,轮询结果不得覆盖(也规避回写未完成时被服务端旧坐标冲掉的竞态)。
- 拖拽持久化(`onNodeDragStop` → `persistAssetPosition`)不变,仅去掉 `pinned` 参数。

### 8. 测试策略

- `card-layout.test.ts`:`childPosition`(首个/多个兄弟/多级)、`spawnAtPoint`、`cascadePosition`、`avoidOverlap`(无重叠/单次避让/连续避让/迭代上限)纯函数单测。
- `actions.test.ts`:三条路径的落位与持久化调用断言;`pollGenTasks` 始终保留本地坐标。
- 更新/删除受影响测试:`force-layout.test.ts`、`zones.test.ts`(删),`map.test.ts`、`selectors.test.ts`、`add-asset.test.ts` 等去 `pinned`/`nextLanePosition` 引用。

## 风险与边界

- **树形落位基于"当下"快照**:父节点被拖走后再派生,子节点跟随父节点新位置——符合预期;已落位的子节点不跟随,属方案 A 的接受成本。
- **卡片实际高度随类型不同**(图像/视频/音频卡高度不一),`CARD_H` 取偏大估值保证避让有效,实现时校准。
- **多端并发**:位置回写是 fire-and-forget,与现有 `linkParent` 一致,失败不阻塞 UI,刷新后以服务端为准。
