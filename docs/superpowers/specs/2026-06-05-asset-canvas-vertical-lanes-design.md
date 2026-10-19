# 资产画布纵向泳道化 设计文档

日期：2026-06-05

## 背景与目标

当前资产画布把 5 类资产（图像/视频/音频/3D/文档）横向并排成「列」，每列用虚线边框 + 浅色底纹的盒子框出（`ZoneLayer`），列内资产由 d3-force 力导向吸向列中心。

Nick 提出两点优化：

1. **去掉资产类型的背景边框**，不同种类的资产**由上至下均匀排布**。
2. **新增资产后要更新布局**，避免资产之间的重叠。

经讨论确定的方向：

- 布局风格：**力导向有机带**（保留 d3-force 引擎，仅把 zone 中心由横向改纵向）。
- 类型标签：**完全留白**（去掉边框/底纹/标签，识别与筛选交给顶部 chips）。

## 几何约束说明

旧的横向 zone 很高（420），所以 hero 派生变体能做纵向扇形展开。改为横向泳道后泳道变矮，纵向扇形塞不下——派生变体将自然变为「同带内有机排布 + 父子连线（edge）体现血缘」。此为几何上不可两全的取舍，已接受。

## 方案

### 1. 泳道几何（`src/lib/zones.ts`）

`zoneFor` 由横向列改为纵向带：每类资产 = 一条横向泳道，按 `ZONE_ORDER` 由上至下等距堆叠。

- `BAND_W = 1200`（横向居中参考宽度，不做横向硬夹）
- `BAND_H = 220`（每类纵向槽位高）
- `BAND_GAP = 48`（带间距）
- 第 `i` 条带：`x = 0`，`y = i * (BAND_H + BAND_GAP)`，`width = BAND_W`，`height = BAND_H`
- `zoneCenter` 随之得到各带中心：image y≈110、video y≈378、audio y≈646、3d y≈914、doc y≈1182
- 5 类全部保留槽位（含暂无资产的 3D），保证「均匀」。

### 2. 移除盒子（`src/components/canvas/ZoneLayer.tsx`）

删除 `ZoneLayer` 组件文件，并从 `AssetCanvas` 移除其 import 与渲染。顶部类型 chips 保留不动。

### 3. 力导向重定向 + 消除重叠（`src/lib/force-layout.ts`）

- `forceX`/`forceY` 吸向新的纵向带中心：`forceY` 强一些（保证留在本带，strength≈0.18），`forceX` 弱一些（鼓励横向铺开，strength≈0.04）。
- **去掉横向 clamp**，仅夹 `y` 到本带高度内（`PAD_Y≈40`）。横向空间不设限 → 无论资产多少都有地方放，从根本上消除重叠（旧设计的重叠源于横向 zone 太小、clamp 把节点挤在一起）。
- 适当提高 `TICKS`（120 → 200）让分布更干净。
- 保留 `collide(70)`、`charge(-180)` 与确定性（无随机）。

### 4. 新增即重排（`src/components/canvas/AssetCanvas.tsx`）

现有 effect 在出现新（未 pinned）资产时，已对**全部未 pinned** 资产重跑力导向并写回（不只新节点）。配合第 3 点的横向无限空间，新增资产时整带重新均匀铺开、不再重叠。拖拽过的 pinned 节点保持原位并作为障碍物被避开。此文件除移除 `ZoneLayer` 外，布局逻辑无需改动。

### 5. SEED 初始数据（`src/server/scripts.ts`）

- 改为 **`pinned: false`**，初始坐标给到各自带中心附近（按类型内索引微偏移），交给力导向引擎统一排布。使初始视图与后续新增资产走同一套引擎、观感一致、自动不重叠。
- hero 纵向扇形不再保留（矮带塞不下），变为图像带内有机排布 + 父子连线。

### 6. 持久化迁移（`src/store/index.ts`）

persist key `taluna-v2` → `taluna-v3`，丢弃老用户残留的旧横向坐标/旧 pinned 状态，重新按新布局注入 SEED。

### 7. 测试

- `src/lib/force-layout.test.ts`：原「约束在 zone 边界内」用例改为「仅 y 约束在本带内」+ 新增「未 pinned 节点两两不重叠（间距 ≥ 碰撞直径的合理下界）」断言；保留 pinned 不变与确定性用例。
- `src/server/scripts.test.ts`：不校验坐标，无需改动。

## 验收标准

- 画布无任何盒子边框/底纹/类型文字标签。
- 5 类资产由上至下成带、带间等距；同带资产横向铺开、互不重叠。
- 触发 generate/derive 新增资产后，画布自动重排，新老未 pinned 资产之间无重叠；已拖拽（pinned）资产位置不变。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。
