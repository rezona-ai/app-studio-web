# 实现计划：画布分组框

> 设计稿：`docs/superpowers/specs/2026-08-05-canvas-groups.md`
> 分支：`feat/canvas-groups`（worktree `.orca/worktrees/canvas-groups`）

自下而上：纯逻辑 → 协议层 → store → UI → tidy 收尾。每步系统保持可运行、每任务一次提交、
提交后派干净上下文子代理按 commit 范围评审（只给 spec 与 diff）。

顺序刻意把「几何判定」放最前：它是容器模型的地基，错了上面全白做，而它 100% 是纯函数、零风险。

---

## T1 几何纯逻辑（`src/lib/canvas-group.ts`）

**改动**（全部无副作用，不 import 任何 store / IO）

- `GROUP_LIMIT = 500`（后端上限）、`GROUP_PADDING = 24`（圈成一组时框比包围盒大出的边距）、
  ~~`GROUP_TITLE_H = 32`（标题条高，参与包围盒上方留白）~~ —— **已废止**：标题条最终渲染在框**外**，这条留白无人使用，常量于 2026-08-20 删除（见 plan `2026-08-20-group-frame-top-padding`）。
- `boundingBoxOf(assets, padding)` → `{ canvas_x, canvas_y, width, height }`：
  用 `cardSize(kind)` 取每张卡真实尺寸算并集，四周加 padding（四边等宽；「顶部再加标题条高」已于 2026-08-20 废止）。空数组 → `null`。
- `centerOf(asset)` → `XY`：卡中心点（`position + cardSize/2`）。
- `groupHitFor(center, groups)` → `groupId | null`：中心点落在哪个框里；
  **多框命中取面积最小**（最内层语义）；一个都不中 → `null`。
- `translateGroup(group, delta)` / `translatePositions(assets, delta)`：纯平移，返回新对象。
- `membersOf(assets, gid)` → `Asset[]`。
- `nextGroupColor(existingGroups)` → 从固定调色板轮取（避开相邻同色）。

**测试** 新建 `src/lib/canvas-group.test.ts`

- `boundingBoxOf`：3 张散落卡 → 框包住全部（逐边核对含 padding 与标题条高）；单张卡也成立；
  空数组得 `null`；不同 kind 的卡尺寸不同时用各自真实尺寸（不是都按 CARD_W/H）。
- `centerOf`：按 kind 真实尺寸取中心，不是 position 本身。
- `groupHitFor`：中心在框内 → 命中；**卡大于框但中心在内 → 仍命中**（这条锁死「不用完全包含」）；
  中心在框外但卡与框相交 → **不命中**（锁死「不用相交」）；两框重叠且都命中 → 取**面积小**的；
  边界正好落在框边上 → 命中（含边）；空 groups → `null`。
- `translateGroup` / `translatePositions`：返回新对象、原对象不被改（不可变更新）。
- `nextGroupColor`：连续取 N 个不与上一个同色；调色板耗尽后回绕。

**验证** `pnpm exec vitest run src/lib/canvas-group.test.ts`

**提交** `feat(canvas): 分组框的几何纯逻辑(包围盒/中心点命中/面积最小仲裁)`

---

## T2 协议层（类型 + client，不接线）

**改动**

- `src/lib/pgc/types.ts`
  ```ts
  export interface CanvasGroupData {
    group_id: string; name: string;
    canvas_x: number; canvas_y: number; width: number; height: number;
    color?: string | null; collapsed: boolean;
    created_at: string; updated_at: string;
  }
  export interface CanvasGroupCreateRequest { name: string; canvas_x?: number; canvas_y?: number; width?: number; height?: number; color?: string | null; collapsed?: boolean; }
  export type CanvasGroupUpdateRequest = Partial<CanvasGroupCreateRequest>;
  export interface CanvasGroupListData { groups: CanvasGroupData[]; total: number; }
  ```
  `CanvasItemListData` 加 `groups?: CanvasGroupData[] | null`（**三态**，注释写明 `null` = flag 关）。
- `src/lib/pgc/client.ts` 加四个方法（路径 `/api/projects/{pid}/canvas/groups[/{gid}]`）。

**测试** `src/lib/pgc/client.test.ts` 追加：四个方法各打对 URL / method / body；
`503 CANVAS_GROUPS_DISABLED` 归一成 `PgcError`（走既有信封拆解，无需特判，写一条把它钉住）。

**验证** `pnpm exec vitest run src/lib/pgc/client.test.ts`

**提交** `feat(canvas): 分组框的契约类型与 client 四个端点`

---

## T3 映射层 + store 状态（仍不接 UI）

**改动**

- `src/store/types.ts`
  - `Asset.groupId?: string`（读顶层 `group_id`；不进 `assetReference`，约束 1）
  - `interface Group { id; name; x; y; w; h; color?; collapsed }`
  - `ServerState.groups: Group[] | null`（`null` = flag 关；`createInitialServerState` 给 `null`）
  - `UndoEntry` 加 `| { type: 'deleteGroup'; pid: number; token: string }`
- `src/lib/pgc/map.ts`
  - `canvasGroupToGroup(g)`；`canvasItemToAsset` 补 `groupId: it.group_id ?? undefined`
  - 整表替换保留前端所有的框几何：`preserveFrontendGroups(mapped, local)` —— 服务端缺几何
    （全 0，即刚建出来还没回写）时取本地（与 `preserveFrontendOwned` 同构，约束 4）
- `src/store/actions.ts` 的 `loadCanvas` 一并吃 `data.groups`（`undefined` 也当 `null` 处理）

**测试** `src/lib/pgc/map.test.ts` + `src/store/actions.test.ts`

- `canvasItemToAsset`：顶层 `group_id` → `Asset.groupId`；缺失 → `undefined`。
- `assetReference` **不含** group 键（回归护栏：约束 1，混进 reference 就等于拖一下卡归属就没了）。
- `loadCanvas`：`groups: null` → store `null`；`groups: []` → `[]`；非空 → 映射；
  **字段缺失** → `null`（老后端 / flag 关）。
- 整表替换：服务端框几何全 0 而本地有值 → 保留本地。

**验证** `pnpm exec vitest run src/lib/pgc/map.test.ts src/store/actions.test.ts`

**提交** `feat(canvas): 分组框的状态切片与映射,坐标口径保留前端所有`

---

## T4 store actions（六个动作，逐个单测）

**改动** `src/store/actions.ts`

- `createGroupFromSelection()`：取 `selectedIds` 的真实卡（跳 `pending_`）→ `boundingBoxOf` →
  `POST /canvas/groups` → 拿 `grp-*` → `assignGroup(ids, gid)`。**卡坐标一张不改**（成功标准 1）。
  超 `GROUP_LIMIT` 由后端 422 兜，`guard` 转 Toast。
- `assignGroup(ids, gid | null)`：**独立路径**（约束 3）。本地即时改 `groupId` → 一次
  `batchUpdateCanvasItems` 只带 `group_id` → `failed[]` 里 `CANVAS_GROUP_NOT_FOUND` ⇒
  **回滚本地 groupId** + Toast `GROUP_ASSIGN_FAILED`（与坐标失败**不同** code / 文案）。
- `renameGroup(gid, name)` / `updateGroupGeometry(gid, geom)`：本地即时 + fire-and-forget PATCH。
- `moveGroup(gid, delta)`：框与全体成员同时平移（`translateGroup` / `translatePositions`），
  一次 `set`；成员坐标走 `persistAssetPositions`（一次批量），框自己一个 PATCH。
- `deleteGroup(gid)`：沿用现有 `pendingDeletes` 延迟删除手法 —— 本地即时移除框 + 成员 `groupId`
  清空，登记 `{ type: 'deleteGroup', token }` 进撤销栈，窗口到点才真打 `DELETE`；
  撤销 = 取消待删 + 还原框与成员归属（服务端全程没动过，无需回写）。

**测试** `src/store/actions.test.ts` 新增一组

- 圈成一组：3 张卡 → `createCanvasGroup` 收到的框几何等于 `boundingBoxOf` 输出；
  **三张卡 position 一字未变**；随后一次 `batchUpdateCanvasItems` 只带 `group_id`（**不带坐标**）。
- `assignGroup` 悬空框：mock `failed[{code:'CANVAS_GROUP_NOT_FOUND'}]` → 本地 `groupId` **回滚**、
  Toast code 为 `GROUP_ASSIGN_FAILED`（**不是** `POSITION_SAVE_FAILED` —— 约束 3 的回归护栏）。
- `moveGroup`：框与 3 个成员坐标同步平移；`batchUpdateCanvasItems` **1 次**、含 3 条；
  `updateCanvasGroup` 1 次。
- `deleteGroup` + 撤销：删后框消失 / 成员卡数不变 / `groupId` 清空；撤销后三者全回来，
  且**全程未打 `deleteCanvasGroup`**（延迟窗口内撤销）。
- 延迟窗口到点未撤销 → 真打一次 `deleteCanvasGroup`。
- flag 关（`groups === null`）时调 `createGroupFromSelection` → **不发请求**（守卫）。

**验证** `pnpm exec vitest run src/store/actions.test.ts`

**提交** `feat(canvas): 分组框的六个 store action,归属失败独立回滚不混进坐标`

---

## T5 UI：`GroupNode` + 画布接线

**改动**

- `src/components/canvas/GroupNode.tsx`（新）
  - 框体：`rounded-[16px]`、`border` 用框色、内填 `--color-teal-soft` 同款柔光（低透明度框色），
    **`pointer-events: none`**（决策 2 的落点）。
  - 标题条：`pointer-events: auto`，显示名字 + 成员数；双击进 inline 改名；
    右侧 `IconButton variant="ghost"` 删框（配 `Tooltip` + `aria-label`）。
  - 四边四角 resize handle：`pointer-events: auto`、`w-2`/`h-2` 命中区，拖动改几何。
  - 动效复用 `.anim-media-in` 入场；`motion-safe:` 前缀护住位移反馈。
- `src/components/canvas/AssetCanvas.tsx`
  - `nodeTypes` 注册 `group`；节点数组 = 框（`zIndex: -1`、`selectable: false`、`draggable: false`）
    + 卡（现状不变）。**不使用 RF `parentId`**（spec 已说明理由）。
  - `onNodeDragStop` / `onSelectionDragStop`：落位后按 `groupHitFor(centerOf(卡), groups)` 判归属，
    与坐标**合并成一条 item** 回写（约束 2）。
  - 选中 ≥1 张卡时，选区浮动工具条 / 右键菜单出「圈成一组」（`groups !== null` 才出，标准 10）。
- i18n：`GROUP_ASSIGN_FAILED` / 「圈成一组」/「删除框」/「重命名」等键补 en + zh。

**测试** 新建 `src/components/canvas/GroupNode.test.tsx`

- 框体 DOM 带 `pointer-events: none`、标题条不带（决策 2 的回归护栏 —— 这条一破，框选就废）。
- 标题条显示名字与成员数；双击进编辑态，回车提交调 `renameGroup`，Esc 取消。
- 删框按钮调 `deleteGroup`，配了 `aria-label`。
- `prefers-reduced-motion` 下无位移动画。

**验证** `pnpm exec vitest run src/components/canvas/`

**提交** `feat(canvas): 分组框 UI —— 标题条可拖、框体穿透保住框选手势`

---

## T6 tidy 避开框

**改动** `src/lib/card-layout.ts`

- `tidyLayout(nodes, kindOrder, obstacles?)`：`obstacles` 为框矩形数组。
  - 入参前由调用方剔除**已入框的成员**（`groupId != null`）——它们不参与重排（决策 3）。
  - 排布时把框矩形当已占区域避让（复用既有 `avoidOverlap` 的 Box 语义）。
- `src/store/actions.ts` 的 `tidyCanvas`：传 `obstacles`、过滤成员，撤销栈只记参与重排的那批。

**测试** `src/lib/card-layout.test.ts` + `src/store/actions.test.ts`

- 有框时：框内成员坐标**不在**返回的 Map 里；框外卡的结果**不与框矩形相交**。
- `tidyCanvas`：框内成员不进 `moved`（不回写）、框几何不变、撤销只还原框外那批。

**验证** `pnpm exec vitest run src/lib/card-layout.test.ts src/store/actions.test.ts`

**提交** `feat(canvas): 一键整理跳过框内成员并避开框的占位`

---

## T7 全量验证 + 真机验收

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

真机按 spec 的 12 条成功标准逐条跑（dev :3011 打 pgc dev，项目 1044）。手法沿用
`2026-08-05-canvas-batch-position` 那份的记录，注意两个已知坑：
**合成 `MouseEvent` 而非 `PointerEvent`**（d3-drag 收 mousedown）；
`onlyRenderVisibleElements` 下要先 fitView 才能让全部节点进 DOM。

收尾：验收创建的框全部删净、成员归属与坐标还原到验收前基线，结果补回 spec。

---

## 风险与预案

- **框体 `pointer-events:none` 与 RF 命中体系打架**：RF 自己给 node 容器加了样式，
  可能需要在 `.react-flow__node-group` 上覆盖。真机第一件事就验成功标准 6（框内框选），
  破了就立刻改方案（退到「框只画在 `Background` 之上的自绘层、完全不做 RF node」）。
- **`onlyRenderVisibleElements` 下框可能被卸载**：框比卡大得多，部分可见时 RF 是否挂载要实测。
  若框会闪，给框 node 加 `hidden: false` 或把框移出 RF node 体系（同上退路）。
- **移动框时成员坐标与框几何两条回写不同步**：先本地一次 `set` 落定，两条请求各自 fire-and-forget；
  失败只提示、不回滚（与坐标现状一致），刷新以服务端为准。
