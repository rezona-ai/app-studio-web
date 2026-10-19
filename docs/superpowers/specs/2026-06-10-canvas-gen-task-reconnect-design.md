# 画布生成任务刷新重连设计

## 背景与问题

- 视频 / 3D 是异步生成:`generateVideo` / `generateModel3d` 返回 `task_id` + `generating` 占位 item,前端登记到内存 `genTasks`,`useCanvasPolling` 每 2.5s 调 `pollVideo` / `pollModel3d` 推进,直到 `item.status` 变 `ready` / `error` 才移除任务。
- 后端是**惰性拉取模型**。Poll 端点 OpenAPI 描述:「转发视频任务状态;完成则落画布桶并置 ready(幂等)」。即 canvas item 的 `generating → ready` 只在命中 poll 端点时推进;`List Canvas Items` 只原样返回 `generating` 占位,不会自行推进。
- `genTasks` 不在 zustand persist 白名单内(白名单仅 `currentProjectId` / `koubouByProject` / `importedByProject` / `composer` / `theme` / `visibleKinds`),刷新即丢失。刷新后 `loadCanvas` 会重新拉回带 `generating` 状态的 assets,但 `genTasks` 为空 → 轮询不启动;且 `taskId` 已丢失、无从重建(`CanvasItemData` 不含 `task_id`)。
- **结论**:刷新后任务永远停在「生成中」。必须持久化 `taskId` 才能重连;单靠重新 `loadCanvas` 无法推进任务。

## 目标 / 非目标

**目标**

- 手动刷新 / 重新进入页面后,自动恢复 video / model3d 生成任务的轮询,直到完成。
- 对「永远完不成」的任务兜底:超时或连续失败则把资产标 `error` 并停止轮询,避免无限轮询 / 永久 spinner —— 注意持久化 `taskId` 会**放大并固化**该风险(失效 taskId 会在此后每次刷新都重试)。

**非目标**

- 版本构建(`pendingVersionId`)的刷新恢复 —— 本次不做。
- 任何后端改动。
- 音频 / 图片(同步生成,无 task,不涉及)。

## 设计

### 数据模型(`src/store/types.ts`)

- `GenTask` 增加两字段:
  - `startedAt: number`(必填)—— 任务创建时的 epoch ms,用于超时判定。**持久化**,跨刷新生效。
  - `fails?: number`(可选,读取按 `?? 0`)—— 连续 poll 失败计数。语义为「会话内」有效,恢复时重置为 0(持久化的旧值被忽略)。设为可选可避免污染存量测试 fixture。
- `ServerState` 增加 `genTasksByProject: Record<string, GenTask[]>`,初始 `{}`,与 `koubouByProject` / `importedByProject` 同构。`createInitialServerState` 同步初始化。

### 持久化(`src/store/index.ts`)

- `partialize` 白名单增加 `genTasksByProject`。
- 内存 `genTasks` 仍是「当前项目工作切片」,不直接持久化。

### 写入集中:`commitGenTasks` helper(`actions.ts`)

```
commitGenTasks(next):
  pid = currentProjectId
  set({ genTasks: next, ...(pid != null ? { genTasksByProject: {...map, [pid]: next} } : {}) })
```

所有 `genTasks` 增删改统一经此,保证内存切片与持久化映射一致。涉及调用点:`startAsyncGen`(增)、`pollGenTasks`(完成 / 超时 / 失败移除、失败计数更新)、`deleteCanvasItem`(按 itemId 移除)、`restoreGenTasks`(对账写回)。

### 生成登记:`startAsyncGen`

- 新任务带 `startedAt: Date.now(), fails: 0`,经 `commitGenTasks` 落库。

### 轮询兜底:`pollGenTasks`(状态机)

每轮对每个任务(`now = Date.now()`):

1. poll 成功且 `item.status` 为 `ready` / `error` → 写回 asset + `commitGenTasks` 移除(现状逻辑不变)。
2. poll 成功但仍 `generating` → 写回进度;若 `now - startedAt > DEADLINE_MS` → 标 asset `error` + 移除任务。
   - **先轮询后判超时**:保证「关闭标签页期间已实际完成」的任务,在重开后首次 poll 即被认领走成功分支,不会因超时被误杀。
3. poll 抛错(含 taskId 上游过期导致的 404 / 报错)→ `fails + 1`;达 `MAX_FAILS` → 标 asset `error` + 移除;否则仅更新 `fails`(下一轮再试)。

- 切项目竞态:沿用 `if (get().currentProjectId !== pid) return`。
- 常量集中定义、可调:`DEADLINE_MS = 10 * 60 * 1000`(10 分钟)、`MAX_FAILS = 5`。

### 重连:`restoreGenTasks(pid)` + 调用点

```
restoreGenTasks(pid):
  if currentProjectId !== pid: return            # 切项目竞态
  saved = genTasksByProject[pid] ?? []
  live = saved
    .filter(t => asset(t.itemId) 存在 且 status === 'generating')   # 已删 / 已完成 → 丢弃
    .map(t => ({ ...t, fails: 0 }))                                  # startedAt 保留,fails 重置
  commitGenTasks(live)                            # 顺带剪除已完成 / 已删的持久化残留
```

- **不在 restore 阶段判超时**(理由同上,先轮询后判,避免误杀)。
- 调用点(仅项目载入路径):
  - `selectProject`:`await Promise.all([loadCanvas(), loadVersions()])` 之后调用。
  - `loadProjects` 的直载分支(`pick === cur` 且 `assets` 为空,即**刷新主路径**):`loadCanvas` 之后调用。
- **不**改 `loadCanvas` 本身。因 `useKoubouConnection` 会在会话事件里调 `loadCanvas` 做中途刷新,若把 restore 嵌进 `loadCanvas`,该路径会被意外触发并重置 `fails`。

### 项目删除清理:`deleteProject`

- 删除项目时剪除 `genTasksByProject` 中该 pid 条目(无论是否当前项目),避免持久化残留。

## 数据流(刷新重连)

1. 刷新 → persist 恢复 `currentProjectId` 与 `genTasksByProject`;`genTasks` / `assets` 为空。
2. 应用挂载 → `loadProjects` → 命中「`pick === cur` 且 `assets` 为空」分支 → `loadCanvas` 拉回 assets(video 仍 `generating`)+ `loadVersions`。
3. `restoreGenTasks(pid)`:对账 → 把仍 `generating` 的任务恢复进 `genTasks`。
4. `useCanvasPolling` 检测 `genTasks.length > 0` → 启动 `setInterval`(无需改动该 hook)。
5. 首次 poll 命中后端惰性端点:上游已完成 → 后端落桶置 `ready` 返回 → 成功分支认领、移除任务;仍处理中 → 继续轮询;超时 / 连续失败 → 标 `error` 停止。

## 错误处理与边界

- **关闭标签页期间任务实际已完成**:后端仍是 `generating`(无人 poll),重开后首次 poll 触发拉取 → `ready`,被正常认领,不误杀。
- **taskId 上游过期**:poll 持续报错 → `MAX_FAILS` 后标 `error`(≈ 5 × 2.5s ≈ 12s 内收敛)。
- **超长但真实进行中的任务(> DEADLINE_MS)**:超时后标 `error` 停止;`DEADLINE_MS` 为可调常量,若后端真实生成时长更长需上调。
- **多标签页**:poll 幂等,`genTasksByProject` 经 localStorage 共享,重复 poll 安全。
- **切项目竞态**:`loadCanvas` 与 `restoreGenTasks` 均校验 `currentProjectId`。

## 测试(`src/store/actions.test.ts`)

**新增用例**

- 重连对账:预置 `genTasksByProject` + `listCanvasItems` 返回对应 `generating` item → `loadProjects` / `selectProject` 后 `genTasks` 恢复;item 已 `ready` 或已删则不恢复(且从映射剪除)。
- 超时兜底:`startedAt` 早于 `now - DEADLINE_MS`,`pollVideo` 返回仍 `generating` → asset 变 `error` + 任务移除(`vi.useFakeTimers` / `vi.setSystemTime` 控时)。
- 失败兜底:`pollVideo` 连续 reject 达 `MAX_FAILS` → asset 变 `error` + 移除;未达上限仅累加 `fails`。
- 持久化:`genTasksByProject` 在 `partialize` 中(序列化往返断言)。
- `deleteProject` 剪除对应 pid 条目。

**存量影响**

- 现有 4 处 `genTasks: [{ itemId, kind, taskId }]` fixture 需补 `startedAt`(必填字段);设为新近值以免触发超时。
- 这些测试直接 `setState` + 调 `pollGenTasks`、不经 `loadCanvas`,故 restore 改动不影响其断言。

## 改动清单

- `src/store/types.ts`:`GenTask` 增 `startedAt` / `fails`;`ServerState` 增 `genTasksByProject`;`createInitialServerState` 初始化。
- `src/store/index.ts`:`partialize` 增 `genTasksByProject`。
- `src/store/actions.ts`:新增 `commitGenTasks` / `restoreGenTasks` / `failAsset` helper 与常量 `DEADLINE_MS` / `MAX_FAILS`;`startAsyncGen` 带 `startedAt`;`pollGenTasks` 兜底状态机;`selectProject` 与 `loadProjects` 直载分支调用 `restoreGenTasks`;`deleteProject` 清理映射;`deleteCanvasItem` 改经 `commitGenTasks`。
- `src/store/actions.test.ts`:补 fixture + 新增用例。
- `src/client/useCanvasPolling.ts`:无需改动。
