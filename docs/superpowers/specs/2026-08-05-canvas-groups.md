# 画布分组框：用户心智分类的组织层

> 状态：设计稿 · 2026-08-05
> 后端契约：`pgc-server` `docs/api/canvas.md` 的「分组框（容器实体）」四个端点 + item 顶层 `group_id`
> 契约已真机验证（12 项，见本文末「契约核实」）；`pgc-canvas-groups` flag 已在 dev 开启
> 前置：`2026-08-05-canvas-batch-position`（移动框要一次批量回写全体成员坐标，靠它）

## 目的

画布的类型开关（image / video / audio / 3d / text）解决不了「主角 / 敌人 / 关卡 1 / UI / 音效」
这类**用户心智分类**——项目做到 100+ 资产时，只看 image 依然是一片混沙。框就是这个组织层。

后端把归属落在 canvas item 的**顶层 `group_id`** 而非 `reference.group_id`：`reference` 由前端整体
覆盖写，分组放里面的话用户拖一下卡就没了；顶层列还让服务端删框时能一条 SQL 清干净成员。

## 六个已定的决策（盘问结论）

1. **容器模型**：框是用户摆放 / 缩放的矩形，**几何是真相**，`group_id` 是它的持久化投影。
   卡拖进框的几何范围即写 `group_id`，拖出即清；移动框带动成员。
   （对照被否的「标签模型」：归属只认菜单不认位置 —— 那样后端的 `canvas_x/y/width/height` 白存。）
2. **只标题条可拖**：框体内部 `pointer-events: none` 完全穿透，**框选手势与今天一字不变**
   （`selectionOnDrag`，`AssetCanvas.tsx:991`）。移动框 = 拖标题条，缩放 = 拖边 / 四角。
   与 FigJam 的 frame 一致（frame 靠名字标签抛）。
3. **tidy 只整理框外的卡**：框内成员与框本身一律不动，tidy 重排未入框的卡并**避开框的占位**。
   保证 `group_id` 永不因整理而变。（「tidy 认框、框内各自排」是下一轮的量。）
4. **撤销只覆盖删框**：复用现有 `delete` 类型的「延迟删除 + 撤销=取消待删」手法。
   建框误操作直接删掉即可；入 / 出框误操作拖回去即可（手势本身就是逆操作）。
5. **严格最小可用**：建框 / 框改名 / 拖入拖出 / 移动缩放框 / 删框（可撤销）+ tidy 避开框。
   **折叠（`collapsed`）、按框筛选、列表面板按框分组、框内自动布局全部延后。**
6. **建框只有一个入口**：选中一批卡 → 「圈成一组」，框 = 这批卡的包围盒 + 边距，**卡一张都不动**。
   不做工具条「新建空框」（那条路要卡真移位，违背「系统不挪卡」）。

## 我自行判定的部分（非决策，但必须写下来免得成为默默假设）

- **入框判定用卡的中心点**落在框矩形内（Figma 口径）。不用「完全包含」——大卡放不进小框；
  也不用「相交」——边缘擦到就入组、多框重叠时歧义大。
- **重叠框取面积最小的那个**（最内层语义）。后端不管几何，仲裁全在前端。
- **框是独立的 RF node，绝不用 RF 的 `parentId` 父子机制**。RF 的父子会把子节点坐标变成
  **相对父节点**的坐标，与仓库既有契约「画布坐标是绝对值、位置归前端所有」直接冲突，
  且会污染 `canvas_x/canvas_y` 的语义。框与卡都是绝对坐标的兄弟节点，框的 `zIndex` 在卡之下。
- **移动框 = 前端自己算 delta**，加到全体成员的绝对坐标上，成员走**一次批量端点**回写
  （`2026-08-05-canvas-batch-position` 正好用上），框自身一个 `PATCH /canvas/groups/{gid}`。
- **缩放框只改框、不动成员**；缩放后按中心点规则落在框外的成员**退组**（几何是真相的必然推论）。
- **空框保留、不自动删**：成员被拖空后框还在（用户可以再拖回去）。删框是显式动作。
- **flag 关闭时分组 UI 完全不渲染**：`GET /canvas/items` 的 `groups` 为 `null` 即判定功能未开，
  连「圈成一组」入口都不出现（`[]` 是「开了但一个框都没建」，两者语义不同，不可混）。

## 约束

1. **归属的唯一写入口是批量 / 单条 item PATCH 的 `group_id` 字段**，不碰 `reference`。
   `reference` 的整体覆盖语义不变（`assetReference` 不新增 group 键）。
2. **坐标与归属在同一次批量请求里写完**：拖卡入框会同时改 `canvas_x/y` 与 `group_id`，
   必须一条 item 带齐，否则中途失败会留下「坐标变了归属没变」的半态。
3. **归属失败与坐标失败要分开报**。批量端点里悬空 `group_id` 是 `200 + failed[].code =
   CANVAS_GROUP_NOT_FOUND`（**不抛错**），而单条 PATCH 同样情形是 `422` —— 同一个 code 挂在
   两个 HTTP 状态上。现有 `persistAssetPositions` 把 `failed.length` 一律计进「N 张卡的位置未能保存」，
   分组失败混进去文案就是错的 → **入框走独立的 action，不复用坐标那条路径**。
4. **框的坐标 / 尺寸归前端所有**，与卡坐标同一口径：本地即时生效、fire-and-forget 回写，
   轮询 / 重连 / `loadCanvas` **不得覆盖**已有的框几何（沿用 `preserveFrontendOwned` 的思路）。
5. **`groups` 是 `null` / `[]` / 非空三态**，UI 分别对应「不渲染分组」/「渲染但无框」/「渲染」。
6. **框数上限 500**（后端超限 `422 CANVAS_GROUP_LIMIT_EXCEEDED`）；`name` 1..255；
   `color` 后端**不校验**（真机确认原样存取）→ 合法性由前端保证。
7. 纯逻辑（包围盒、中心点命中、重叠仲裁、delta 平移）下沉 `lib/` 可单测；IO 留 action。
8. UI 复用既有令牌 / 基础组件 / 动效类：框标题条用 `--color-line` 描边 + 框色柔光，
   不新增按钮种类、不自造 toast、不写一次性 keyframes。

## 成功标准

1. 选中 3 张散落的卡 → 「圈成一组」→ 出现一个包住它们的框，**3 张卡坐标一张都没变**，
   三者 `group_id` 落库。
2. 拖第 4 张卡进框 → 松手即入组（`group_id` 落库），坐标与归属**在同一个请求**里。
3. 把卡拖出框 → `group_id` 变 `null`。
4. 拖框标题条 → 框与全体成员一起移动；成员坐标**一次批量请求**回写，框自身一个 PATCH。
5. 拖框边 / 角缩放 → 只改框；被挤出框外的成员退组。
6. **框内空白处左键拖 = 框选**（与无框时完全一致，muscle memory 零成本）。
7. 框标题条双击改名 → `PATCH /canvas/groups/{gid}` 落库。
8. 删框 → 框消失、**成员卡一张不少**、成员 `group_id` 回 `null`；⌘Z 能整框恢复（含名字 / 颜色 /
   尺寸 / 全体成员归属）。
9. 一键整理 → 框与框内成员纹丝不动，框外的卡重排且**不压在框上**。
10. flag 关闭（`groups === null`）→ 画布上看不到任何分组 UI，「圈成一组」入口不出现。
11. 刷新后框的位置 / 尺寸 / 名字 / 颜色 / 成员归属全部还在。
12. 悬空 `group_id`（框已被别的标签页删掉）→ 只提示归属失败，**不混进坐标失败的文案**。

## 方案

| 文件 | 职责 |
|---|---|
| `src/lib/pgc/types.ts` | `CanvasGroupData` / `CanvasGroupCreateRequest` / `CanvasGroupUpdateRequest` / `CanvasGroupListData`；`CanvasItemListData` 加 `groups?: CanvasGroupData[] \| null` |
| `src/lib/pgc/client.ts` | `listCanvasGroups` / `createCanvasGroup` / `updateCanvasGroup` / `deleteCanvasGroup` |
| `src/lib/canvas-group.ts`（新） | 纯函数：`boundingBoxOf(assets, padding)`（圈成一组的框几何）· `groupHitFor(center, groups)`（中心点命中 + 面积最小仲裁）· `membersOf(assets, gid)` · `translateGroup(group, members, delta)` · `GROUP_LIMIT`/`GROUP_PADDING` |
| `src/lib/pgc/map.ts` | `canvasGroupToGroup`（→ store `Group`）；`canvasItemToAsset` 读顶层 `group_id` 进 `Asset.groupId`；整表替换时保留前端所有的框几何 |
| `src/store/types.ts` | `Asset.groupId?: string`；`ServerState.groups: Group[] \| null`（`null` = flag 关）；`UndoEntry` 加 `{ type: 'deleteGroup'; pid; token }` |
| `src/store/actions.ts` | `createGroupFromSelection` · `renameGroup` · `updateGroupGeometry` · `deleteGroup`（延迟删除 + 撤销）· `assignGroup(ids, gid \| null)`（**独立于 `persistAssetPositions`**，约束 3）· `moveGroup`（delta 平移 + 一次批量成员回写）；`loadCanvas` 一并接 `groups` |
| `src/components/canvas/GroupNode.tsx`（新） | 框的 RF 自定义节点：标题条（可拖 / 双击改名 / 删除按钮）+ 内部 `pointer-events:none` 的框体 + 四边四角 resize handle |
| `src/components/canvas/AssetCanvas.tsx` | 注册 `group` node type、框 node 与卡 node 合成、`onNodeDragStop` 按中心点判归属、选中后「圈成一组」入口 |
| `src/lib/card-layout.ts` | `tidyLayout` 加「已占框区域」入参：框内成员剔除、框矩形作为避让障碍 |

### 归属写入的独立路径（约束 3 的落点）

```
assignGroup(ids, gid)
  → 本地即时改 Asset.groupId
  → batchUpdateCanvasItems(pid, ids.map(id => ({ item_id: id, group_id: gid })))
  → failed[] 里 CANVAS_GROUP_NOT_FOUND ⇒ 本地回滚该卡 groupId + Toast「归属未能保存」
```

与坐标不同，**归属失败要回滚本地**：坐标不回滚是因为「卡留在用户放的地方」比跳回去好，
而归属是不可见状态，本地留着错的归属会让下次几何判定与服务端打架。

拖卡入框是坐标 + 归属同时变（约束 2），故走一个合并的 `persistDraggedNodes` 分支：
一条 item 同时带 `reference` / `canvas_x` / `canvas_y` / `group_id`。

## 明确不做

- **折叠 `collapsed`**：字段接进类型但不渲染。折叠要重新定义血缘边接到哪、搜索命中怎么高亮、
  选中集算不算、框外卡的避让 —— 边界比看上去多，单独一轮。
- **tidy 认框**（框内各自排）：见决策 3。
- **列表面板按框分组 / 按框筛选**：`asset-list.ts` 是纯函数好加，但价值不如折叠，延后。
- **框套框**：后端 `group_id` 是单层引用，没有 parent group 字段，本期无从表达。
- **跨项目 / 跨框的成员批量搬运 UI**：靠拖拽即可，不做专门的「移动到框…」菜单。
- **拖框「吞并」路过的卡**：把框拖到一批散卡上，这些卡中心虽已落在框内但**不入组**
  （`moveGroup` 不做入组判定）。这是「几何是真相」的一个有意例外：拖框的意图是搬动已有成员，
  顺手吞并路过的卡会让人不敢拖框。要入组请把卡拖进去（评审 M8 指出 spec 原先既没写明也没收口）。
- **缩放把手的键盘可达性与视觉提示**：目前是 8 个 10px 透明命中区、无 aria、无 hover 显影
  （评审 M5）。补 aria 与显影要连带 11 语言词条与一套 hover 态，本轮不做。
- **`color` 选色 UI**：本期框色从固定调色板轮取（`--color-{image,video,audio,3d,doc}` 那套已有令牌），
  不做取色器。

## 真机验收（2026-08-05，dev :3011 打 pgc dev，项目 1044 / 33 张卡，`pgc-canvas-groups` 已开）

手法：Playwright **真实鼠标**（`page.mouse`）+ `window.__store` 读状态。

### 已通过

| 标准 | 实测 |
|---|---|
| 1 圈成一组 | 3 张散落卡 → 框几何 = 包围盒，**3 张坐标一字未变**，三者 `group_id` 落库 |
| 2 拖入框 | 松手即 `groupId` 落地 |
| 3 拖出框 | 卡从 (1340,580) → (1340,1250)，`groupId` 变 `null`，中心确在框外 |
| 4 拖框带动成员 | 框位移 (134,96)，**3 个成员位移逐个完全一致** |
| **6 框内空白处拖 = 框选** | **正常选中 3 张卡、框未被拖动**（修复前选中 0 张，见下） |
| 7 改名 | 本地即时 + `PATCH /canvas/groups/{gid}` 落库 |
| 8 删框 + 撤销 | 只删框不删卡（卡数 33 不变、4 个成员归属清空、窗口内不打服务端）；⌘Z 后框与 4 个成员归属**全回来**，全程未发 DELETE |
| 11 刷新持久 | 框的位置/尺寸/名字/颜色 + 3 个成员归属，刷新后**逐字一致** |
| `groups` 三态 | flag 开时为 `[]`（非 `null`） |

### 真机抓到的缺陷（单测看不见，已修）

**框体穿透原先是破的 —— 决策 2 实际不成立。** A/B 对照：不修则框内空白处拖**选中 0 张**（手势被框吞），修后正常选中 3 张。

根因：**RF 把 `pointer-events: all` 写成节点容器的 inline style**。只在组件内部子 div 上设 `pointer-events: none` 不够；加 CSS 规则**也无效**（实测计算值仍为 `all`，inline 压不过）。唯一落点是写进 `node.style`——RF 先写自己那几个属性、再展开 `node.style`。

### 第二轮真机验收（2026-08-06，专验评审新修的三处）

| 项 | 实测 |
|---|---|
| **5 缩放退组**（评审 C1 新实现） | 拖南把手把框收到高 400（底边 104）→ 中心 y=360/620 的两张**退组**、y=-140/100 的两张留组；网络记录为「框 PATCH（height 400）+ 批量 PATCH 只带 `group_id: null` 两条」，成员 4→2 |
| **I1 西向缩放夹取** | 拖西把手远超最小宽度 → `w` 停在 **120**、左边界停在 `x + (w-120)` 不再跟手、**右边界一动没动**（修复前 `w` 停住而 `x` 继续滑） |
| **I2 拖框无弹回** | 框位移 (184,136)，**4 个成员位移逐个一致**；松手后等 1.5s 待 store 回流，**渲染位置与 store 逐值相等**（无弹回） |

⚠️ **一处观测未能解释**：同一个「拖南把手缩框」操作，**第一轮观测为阴性**（框高变了但 4 个成员一个没退组、无任何归属请求），第二轮同样手势稳定通过且有网络记录为证。差别只在第一轮是刚 `createGroupFromSelection` 之后立刻拖（中间等了 1.2s）。我没能复现阴性态，故**不能断言它不存在**——怀疑是建框后成员归属尚未落定时拖缩放的时序，值得留意。

### 未验到的

- ~~**5 缩放退组**~~：已在第二轮验过（见上）。此前本文写「逻辑由单测覆盖」是不实的 —— 评审（C1）查出该逻辑当时
  **根本没实现**（`assignGroup` 只有建框一个调用点，`updateGroupGeometry` 只 patch 框自己），
  单测也只有取整那一条。现已实现（几何落定后复用 `centerOf`+`groupHitFor` 复判并 `assignGroup(…, null)`）
  并补了两条单测（挤出去的退组 / 放大不误退组），但**真机仍未验**。
- **12 悬空归属**：本轮时间未及，逻辑由单测覆盖（`assignGroup` 那组）。
- **9 tidy 避开框**：T6 尚未实现。
- **10 flag 关闭时不渲染**：需 pgc 侧关 flag 才能验，代价高于收益；由单测（`groups === null` → `buildGroupNodes` 返回空、菜单项不渲染）覆盖。

### 手法上的坑（记给下次，比上一轮又深一层）

1. **合成事件驱动不了 RF 的手势**。上一轮已知「`PointerEvent` 不行、要 `MouseEvent`」；这轮发现**合成 `MouseEvent` 也不行**——橡皮筋框选必须真实鼠标（`page.mouse`）。一度误判成「框破了框选」，是做了**无框区域的对照实验**才发现是手法问题。
2. **拖一张处于选中态的卡，实际拖的是整个选区**。测单卡入框/出框前必须先 `setSelection([])`，否则会带动 4 张一起，结果与预期完全不符。
3. **还原坐标必须走生产路径**。只写 `canvas_x/canvas_y` 不生效——读取口径是 `reference.position` 优先（`map.ts:75`）。第一次收尾就踩了这个，坐标全差 (+134,+96)；改调 `persistAssetPositions`（同时写两套）才精确还原。
4. 标题条在低缩放下只有 28×11 屏幕像素，取命中点必须用**中心**；我用 `left + 30` 点在了它外面，误报了一次「标准 4 回归」。

### 收尾

验收建的框已真删，成员归属清空（服务端 `group_id` 全为 `null`），卡数 33 不变；三张基线卡坐标精确还原（服务端 `reference.position` 与顶层坐标**逐条一致**）。

⚠️ **一处未能还原**：`url-07308e8cb0e6` 在标准 2/3 里被拖动过，而它的**验收前原始坐标已丢失**（存在 `window.__baseline` 里，被中途 reload 清掉）。它现在停在 (1340,1250)，归属已清空。
第二轮起改为「基线直接返回到会话里、不只存页面变量」，收尾核对 **33/33 与基线逐条一致**（`reference.position` 与顶层坐标两套都比）、框已删净、无残留归属。

## 契约核实（2026-08-05 真机，pgc dev，项目 1044，12 项全通）

`{BASE}` = `PGC_BASE_URL` + **`/game/pgcserver`**（env 只存裸域名，前缀由代理拼，
见 `src/lib/backend-routes.ts:4`；直接用 env 打会 404 到网关上）。

| 验证 | 结果 |
|---|---|
| `GET /canvas/groups`（flag 开） | `200 {groups:[], total:0}` |
| `GET /canvas/items` 的 `groups` | **`[]`**（flag 关时才是 `null`） |
| 建框（全字段） | `200`，`grp-*`，带 `created_at`/`updated_at` |
| 建框（只传 `name`） | 坐标 / 尺寸缺省 **0**，`color: null` |
| `name: ""` | `422 VALIDATION_ERROR`（`string_too_short`） |
| 批量 PATCH 悬空 `group_id` | **`200` + `failed[].code=CANVAS_GROUP_NOT_FOUND`**（不抛错） |
| 单条 PATCH 悬空 `group_id` | **`422 CANVAS_GROUP_NOT_FOUND`** |
| 批量入框 | `updated:1`，`group_id` 落地，**坐标不受影响** |
| `PATCH /canvas/groups/{gid}` | 改名 / 移动 / 缩放 / 换色 / 折叠全生效，`updated_at` 变 |
| 显式 `group_id: null` | 回 `null`，坐标不动 |
| 删框 | 只删框：卡数不变、成员 `group_id` 回 `null`、坐标不动；响应回被删的框 |
| 删已删的框 | **`404 CANVAS_GROUP_NOT_FOUND`** |

⚠️ `CANVAS_GROUP_NOT_FOUND` 出现在**三个** HTTP 状态上（批量 200 / 单条 422 / 删框 404），
前端不能按 code 统一分支，必须按「哪条路径 + 状态」分别处理 —— 这是约束 3 的由来。
