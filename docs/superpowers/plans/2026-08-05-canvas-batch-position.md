# 实现计划：坐标批量落库

> 设计稿：`docs/superpowers/specs/2026-08-05-canvas-batch-position.md`
> 分支：`feat/canvas-batch-position`（worktree `.orca/worktrees/canvas-batch-position`）

顺序：先纯逻辑与协议层（零行为变更、可独立单测），再原子切换 action，最后删旧机制。
每步系统保持可运行、每任务一次提交、每任务提交后派干净上下文子代理按 commit 范围评审。

---

## T1 契约层 + 纯函数（不接线，零行为变更）

**改动**

- `src/lib/pgc/types.ts`
  ```ts
  // 批量更新（PATCH /canvas/items）：字段集与单条 CanvasUpdateRequest 同构 + item_id 定位
  export interface CanvasBatchUpdateItem extends CanvasUpdateRequest { item_id: string; }
  export interface CanvasBatchUpdateRequest { items: CanvasBatchUpdateItem[]; }
  export interface CanvasBatchUpdateFailure { item_id: string; code: string; message: string; }
  export interface CanvasBatchUpdateData { updated: number; failed: CanvasBatchUpdateFailure[]; }
  ```
  顺带给 `CanvasUpdateRequest` 补 `group_id?: string | null`（后端已有该字段；本轮不用，
  但类型对齐契约，避免下轮分组功能又改一次）。
- `src/lib/canvas-batch.ts`（新）
  - `CANVAS_BATCH_MAX = 500` —— 后端单次上限，超出整批 422。
  - `positionBatchItem(a: Asset): CanvasBatchUpdateItem` —— `{ item_id, reference: assetReference(a),
    canvas_x: Math.round(a.position.x), canvas_y: Math.round(a.position.y) }`。
  - `chunk<T>(xs: readonly T[], size: number): T[][]`。
- `src/lib/pgc/client.ts` —— 加
  ```ts
  batchUpdateCanvasItems: (pid: number, items: CanvasBatchUpdateItem[]) =>
    pgc<CanvasBatchUpdateData>('PATCH', `/api/projects/${pid}/canvas/items`, { items } satisfies CanvasBatchUpdateRequest),
  ```

**测试** 新建 `src/lib/canvas-batch.test.ts`；`src/lib/pgc/client.test.ts` 追加一条

- `positionBatchItem`：坐标取整（`{x: 10.7, y: -3.2}` → `11 / -3`）；`reference.position` 为**原始未取整**
  值（读取口径不变，取整只为顶层 int 字段）；`assetReference` 的其余键（parent_id / links / provenance /
  source）原样带上 —— 这条是回归护栏，漏一个就等于每次回写把它从服务端抹掉。
- `chunk`：501 条切成 500 + 1；恰好 500 条切成一片；空数组得空数组；`size` ≥ 长度得一片。
- `client`：`batchUpdateCanvasItems` 打 `PATCH /api/pgc/api/projects/42/canvas/items`，body 为 `{items:[...]}`。

**验证**
```bash
pnpm exec vitest run src/lib/canvas-batch.test.ts src/lib/pgc/client.test.ts
```

**提交** `feat(canvas): 批量更新画布 item 的契约层与分片纯函数`

---

## T2 `persistAssetPositions` 切到批量端点（原子切换）

**改动** `src/store/actions.ts`

- `notePositionFailure(n = 1)` —— 一次加 n 条。
- 重写 `persistAssetPositions(ids)`：
  1. 去 `pending_` 前缀、按 id 查 asset（查不到跳过）。
  2. 同坐标在飞过滤：`positionInFlight.get(id) === coords` 则跳过；其余登记。
  3. 剩余为空 → return（**不发请求**）。
  4. `chunk(items, CANVAS_BATCH_MAX)`，`Promise.all` 每片：
     `retryAsync(() => pgcApi.batchUpdateCanvasItems(pid,片), POSITION_RETRY_DELAYS)`
     - 整批抛错 → `notePositionFailure(片.length)`
     - 成功 → `failed.length > 0` 时 `notePositionFailure(failed.length)`
     - `await` 后 `if (get().currentProjectId !== pid) return;` 再落 Toast（既有不变式）
  5. `finally` 清在飞标记（只清自己登记的那批，坐标已变的不误清 —— 沿用既有
     `if (positionInFlight.get(id) === coords) delete` 判定）。
- 删 `persistAssetPosition`；`tidyCanvas` 已调复数版，无需改。
- `placeAndLink`（`actions.ts:424`）的 `for (const a of placed) void pgcApi.updateCanvasReference(...)`
  换成一次 `void pgcApi.batchUpdateCanvasItems(pid, placed.map(positionBatchItem)).catch(() => {})`
  —— 保持 fire-and-forget 语义（创建落位失败不阻塞 UI，与既有一致；不接 Toast 也是既有行为）。
- `src/store/types.ts` —— `ServerActions` 去掉 `persistAssetPosition`；返回对象里同步删。

**测试** `src/store/actions.test.ts`

改写既有三组（原「失败不再静默」/「批量回写限流」/「去重与共享闸门」），mock 从
`api.updateCanvasReference` 换到 `api.batchUpdateCanvasItems`（默认 `{updated: n, failed: []}`）：

- 32 张卡 → `batchUpdateCanvasItems` 调 **1** 次，body 32 条（成功标准 1）。
- 501 张卡 → 调 **2** 次，条数 500 + 1（标准 3）。
- 整批 `NETWORK` → 调 3 次（初次 + 两次退避）、坐标不回滚、一条 Toast（标准 4）。
- 整批 `PgcError(422)` → 调 **1** 次、一条 Toast（标准 5）。
- 返回 `{updated: 1, failed: [3 条]}` → 一条 Toast、`params.count === 3`（标准 6）。
- 同 id 同坐标并发两次 → 1 次请求且 body 1 条；坐标改了的第二次 → 2 次请求（标准 7）。
- 全部被在飞过滤 → **0** 次请求（标准 8）。
- 占位卡 `pending_x` → 0 次请求（约束 6）。
- body 每项带 `reference.position` + 取整 `canvas_x/canvas_y`（标准 10）。
- 请求返回时 `currentProjectId` 已切走 → 无 Toast（标准 11）。
- `tidyCanvas` 20 张卡 → 1 次请求（原「限流 ≤6」那条的替代）。
- `placeAndLink`：`generateImage` 出 4 张 → `batchUpdateCanvasItems` 1 次、`updateCanvasReference` 0 次（标准 9）。

**验证**
```bash
pnpm exec vitest run src/store/actions.test.ts
```

**提交** `feat(canvas): 坐标回写改走批量端点,一次请求取代逐条 PATCH`

---

## T3 删旧机制（不留 dead code）

**改动**

- 删 `src/lib/concurrency.ts` + `src/lib/concurrency.test.ts`（唯一调用方是刚退役的 `positionGate`）。
- `src/store/actions.ts` 删 `POSITION_WRITE_CONCURRENCY` 常量、`createLimiter` import、`positionGate`。
- 注释同步：`persistAssetPositions` 头部注释重写（旧文讲「后端无批量端点」已过时）；
  `positionInFlight` 注释补「批量化后仍需要：RF 拖停连打两次回调」。

**测试** 全量跑，确认无残留引用。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

**提交** `refactor(canvas): 删除坐标回写限流闸门与 concurrency 模块`

---

## T4 文档口径对齐

**改动**

- `docs/superpowers/specs/2026-08-04-canvas-persist-reliability.md`
  - 约束 4（并发上限 6）与「明确不做 · 批量坐标端点」标注**已被 2026-08-05-canvas-batch-position 取代**。
  - 「明确不做 · 取消生成任务」→ 「后端明确不做（上游无 cancel API）」。
- ~~`docs/superpowers/specs/2026-08-04-canvas-bulk-actions.md:60` 的「取消生成：等后端端点」同上。~~
  条目过期：该文件里已 grep 不到「取消生成」。实际改到的另外三处是
  `2026-08-04-canvas-task-visibility.md`、`-canvas-input-browse.md`、`-canvas-keyboard.md`。
- `src/store/types.ts` 无需改：`ServerActions = ReturnType<typeof createServerActions>`，
  从返回对象里删掉 `persistAssetPosition` 即可，`tsc` 已验证干净。

**提交** `docs(canvas): 标注坐标限流约束被批量端点取代,取消生成改记「后端不做」`

---

## T5 真机验收 ✅ 已完成（2026-08-05）

结果已补进 spec 末尾「真机验收」节：8 条已验、2 条明确列为未验到（附替代覆盖）。
关键数字：33 张卡拖动 → 1 个请求；整理 → 1 个请求（32 条）；断网 → 3 个请求 + 一条 count=33 的
Toast、不回滚；501 条 → 2 个请求（500+1），而直打 501 条真实端点确认为整批 422；
服务端 33/33 两套坐标逐条一致。

踩到的坑（记给下次）：合成 **`PointerEvent` 驱动不了 RF 拖拽**，必须用 `MouseEvent`
（d3-drag 收 `mousedown`）；另外点 `button[aria-label="Tidy up"]` 那次点击被浮层吞了（0 请求），
改直调 `tidyCanvas()` 才走到同一条回写路径。

---

## 不在本计划内（等后续单独立项）

- 生成前估价（`POST /canvas/items/generate/estimate`；请求体已确认为**扁平**形态）
- 分组框（4 个 `/canvas/groups` 端点 + item 顶层 `group_id`；`pgc-canvas-groups` flag 默认关）
- 精灵图生成（`generate/sprite` + 轮询，`item.metadata.sprite` 九宫格播放）
- `created_at` 接入（后端已在 `CanvasItemData` 下发）与其余琐碎注释修正
