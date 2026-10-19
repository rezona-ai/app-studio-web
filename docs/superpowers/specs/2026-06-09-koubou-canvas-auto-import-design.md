# Koubou 对话生成资产自动导入画布 — 设计

- 日期：2026-06-09
- 状态：待评审
- 关联：[[2026-06-09-koubou-websocket-conversation-design]]、[[2026-06-08-pgc-server-api-integration-design]]

## 1. 背景与目标

Koubou 对话里 agent 生成资产后，工具结果会携带 `media.generated`，目前只在对话的 `ToolCard` 里**内联预览**，从未进入画布。需要让这些生成资产自动落到画布上，成为可编辑、可成版本的一等资产。

pgc 新增了 `POST /api/projects/{project_id}/canvas/items/import` 接口（2026-06-09 上线，OAS 已确认），用于把 agent 产物 `assets/` 下的一个文件拷进画布桶并登记一条 ready 项。本设计把「对话生成 → 自动导入画布」打通。

## 2. 现状

- **生成事件**：agent 工具结果以 text block 下发 JSON，`parseMediaGenerated` 解析出 `MediaGenerated { type:'media.generated', kind, path, preview_url, human_size }`，由 `applyKoubou` reducer 存到 `tool` part 的 `media` 字段（`src/koubou/apply-koubou.ts`、`src/koubou/protocol.ts`）。
- **画布**：`listCanvasItems` 拉取，`canvasItemToAsset` 映射成 `Asset`，位置取 `reference.position`（无则 (0,0)、`pinned=false`）。现有 genImage/genVideo 生成即追加进 `assets`（`src/store/actions.ts`、`src/lib/pgc/map.ts`）。
- **布局**：`AssetCanvas` 对新出现的未 `pinned` 资产跑 `runForceLayout`，按 kind 排进横向泳道（zones）。这是**客户端临时计算，不回写服务端**；只有用户拖拽才经 `persistAssetPosition` 把 `reference.position` PATCH 回去（`src/components/canvas/AssetCanvas.tsx`、`src/lib/force-layout.ts`、`src/lib/zones.ts`）。
- **代理**：`src/app/api/pgc/[...path]/route.ts` 导出 `handle as POST`，import 的 POST 会被转发。
- **缺口**：对话 media 与画布之间无任何连接。

## 3. 接口契约（来自 OAS）

`POST /api/projects/{project_id}/canvas/items/import`，body `CanvasImportRequest`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_filename` | string，必填，1–256 | agent `assets/` 目录下的**纯文件名**（如 `hero.png`），经 agent 事件下发给前端 |
| `type` | `image\|video\|audio\|model3d`，可选 | 不传则后端按扩展名推断 |
| `name` | string，可选 | 不传后端自行命名 |
| `reference` | JsonValue，可选 | 与其他资产的关系；**原样回显** |
| `canvas_x` / `canvas_y` | int，可选 | 落到画布上的初始坐标 |

成功返回 `APIResponse<CanvasItemData>`（一条 ready 项）。源不存在 → 404，文件名非法/类型无法判定 → 422。

`CanvasItemData` 已含顶层 `canvas_x`/`canvas_y` 与 `reference`（`reference` 原样回显）。

## 4. 已确认的设计决策

1. **触发方式**：自动导入。每当对话出现一条 ready 的 `media.generated`，前端自动调 import 落画布（与 genImage/genVideo「生成即落画布」心智一致）。
2. **坐标**：客户端算好坐标 + 通过 import 的 `canvas_x/canvas_y` 持久化到服务端；资产 `pinned` 落在该位，刷新后稳定不漂移。
3. **去重**：持久化 `importedByProject` 文件名集 + 内存 in-flight 集；重连重放、同设备刷新均不重复导入。
4. **历史预填**：换设备/清缓存后从服务器 `visible_state` 重建历史时，把其中出现过的 media 文件名全部预填进 `importedByProject`（视为已处理），只对 ready 之后**新到达的 live media** 导入——避免把旧资产重复刷上画布。

## 5. 数据流

```
agent 生成资产
  → tool_result 含 media.generated { path, kind, preview_url }
  → applyKoubou 解析存为 part.media（不改）
  → useCanvasAutoImport 发现「ready 且未导入」的 media（顺序处理）
  → store.importGeneratedAsset(filename, kind)
      ├─ 按 kind 泳道算落点 (canvas_x, canvas_y)
      ├─ pgcApi.importCanvasItem(pid, { source_filename, type, canvas_x, canvas_y, reference:{ source_filename } })
      └─ 成功:把返回的 CanvasItemData 映射追加进 assets（pinned 落在该位）+ 记入 importedByProject
```

## 6. 详细设计

### 6.1 坐标算法（泳道级联）

导入前在该 kind 的泳道里算落点：

```
zone = zoneFor(kind)                                  // image/video/audio/3d/doc 各一条横向带
sameKind = 当前 assets 中 kind 相同的
x = sameKind 为空 ? zone.x + MARGIN : max(sameKind.x) + STEP   // 向右级联，STEP ≈ 200，MARGIN ≈ 100
y = round(zoneCenter(zone).y)
```

- 新导入是 `pinned` 固定点；现有未 `pinned` 资产由 `runForceLayout` 的碰撞力自动让开，两套机制天然共存。
- **顺序处理**保证级联正确：await 一条落库并追加进 `assets` 后再处理下一条，否则同批多条会算出相同 x 而重叠。

### 6.2 kind 映射

- `media.kind` → `AssetKind`（画布）：`image→image, video→video, audio→audio, model3d/'3d'→'3d'`，未知回退 `image`。
- `media.kind` → import `type`：`image/video/audio→同名, '3d'/model3d→model3d`，无法映射则省略（由后端按扩展名推断）。

### 6.3 接口封装与类型

- `src/lib/pgc/types.ts`：
  - 新增 `CanvasImportRequest { source_filename: string; type?: 'image'|'video'|'audio'|'model3d'|null; name?: string|null; reference?: unknown|null; canvas_x?: number|null; canvas_y?: number|null; }`
  - `CanvasItemData` 已有 `canvas_x?`/`canvas_y?`（无需改）。
- `src/lib/pgc/client.ts`：新增 `importCanvasItem(pid, body) → pgc<CanvasItemData>('POST', '/api/projects/${pid}/canvas/items/import', body)`。

### 6.4 mapper 改动（位置优先级）

`src/lib/pgc/map.ts` `canvasItemToAsset`：

- 位置优先级：`reference.position`（拖拽权威）`?? (canvas_x/canvas_y 同时非空 ? {x,y})` `?? {0,0}`。
- `pinned`：`!!(reference.position || (canvas_x != null && canvas_y != null))`。
- 新增读出 `sourceFilename = reference.source_filename`（若有），写到 `Asset.sourceFilename`。

> 优先级必须以 `reference.position` 优先：拖拽只更新 `reference.position`，而 `canvas_x/canvas_y` 停留在导入初值；若反过来优先会导致拖完刷新跳回导入位。

### 6.5 store 状态与 action

- `src/store/types.ts`：
  - `Asset` 增 `sourceFilename?: string`。
  - `ServerState` 增 `importedByProject: Record<string, string[]>`，`createInitialServerState` 初始化为 `{}`。
- `src/store/actions.ts` 新增 `importGeneratedAsset(filename: string, kind: AssetKind)`，包在 `guard` 内：
  1. `pid = currentProjectId`，空则返回。
  2. 已在 `importedByProject[pid]` → 跳过（双保险，hook 也会过滤）。
  3. 算 `(canvas_x, canvas_y)`（见 6.1）。
  4. `type = kindToImportType(kind)`。
  5. `item = await pgcApi.importCanvasItem(pid, { source_filename: filename, type, canvas_x, canvas_y, reference: { source_filename: filename } })`。
  6. `set({ assets: [...assets, canvasItemToAsset(item)], importedByProject: { ...map, [pid]: [...(map[pid]??[]), filename] } })`。
- `src/store/index.ts`：
  - `partialize` 增 `importedByProject`（持久化）。
  - `ingestKoubou` 在处理 `session.ready` 且**从空重建历史**（处理前 `s.messages.length === 0` 且结果 `messages.length > 0`）时，扫描重建出的 messages 收集全部 media 文件名（`basename(part.media.path)`），union 进 `importedByProject[currentProjectId]`（历史预填，幂等）。

### 6.6 自动导入 hook

`src/client/useCanvasAutoImport.ts`（挂在 `Workspace`，类比 `useCanvasPolling`）：

- 订阅 `messages`、`currentProjectId`、`importedByProject`、`importGeneratedAsset`。
- 计算待导入：遍历 messages 的 tool parts，取 `status==='ready'` 且有 `media` 的，`filename = basename(media.path)`，过滤掉 `importedByProject[pid]` 中的与内存 in-flight 集中的。
- **顺序**处理待导入队列：用一个 `useRef` 的 in-flight `Set<string>` 防并发；`for ... await importGeneratedAsset(...)`，处理完从 in-flight 移除。
- 仅当 `pid != null` 且 `runStatus` 允许时推进（媒体出现在 ready 工具结果即可导入，不必等整轮结束）。

### 6.7 错误处理

沿用现有 `guard → lastError → Toast`。import 失败（404 源不存在 / 422 文件名非法）只写 `lastError` 弹 Toast，不阻塞对话。该文件名**不**记入 `importedByProject`（保留重试资格），但**本会话内保留在内存 in-flight 集**（本会话不再自动重试，避免对同一坏文件名的紧循环）；下次刷新/重连时因未记入 `importedByProject` 而可重新尝试。单条失败不影响其余资产导入。

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/pgc/types.ts` | 加 `CanvasImportRequest` |
| `src/lib/pgc/client.ts` | 加 `importCanvasItem` |
| `src/lib/pgc/map.ts` | mapper 位置优先级 + 读 `sourceFilename` |
| `src/store/types.ts` | `Asset.sourceFilename?`、`ServerState.importedByProject` |
| `src/store/actions.ts` | 加 `importGeneratedAsset` + kind/坐标 helper |
| `src/store/index.ts` | `partialize` 加 `importedByProject`；`ingestKoubou` 历史预填 |
| `src/client/useCanvasAutoImport.ts` | 新 hook |
| `src/components/workspace/Workspace.tsx` | 挂载 hook |
| `src/lib/pgc/*`（小工具） | `basename`、`kindToImportType`、`mediaKindToAssetKind` |

## 8. 测试计划

- `pgc/client`：`importCanvasItem` 命中 `POST /api/projects/{pid}/canvas/items/import` 且 body 正确。
- `pgc/map`：位置优先级三态（reference.position 优先 / 退 canvas_x,y / 退 (0,0)）、`pinned` 推导、`sourceFilename` 读出。
- 坐标算法：空泳道用 MARGIN、非空向右级联 STEP、y 取泳道中心。
- kind 映射：双向各分支 + 未知回退。
- 去重：`importGeneratedAsset` 跳过已导入；in-flight 防并发；`ingestKoubou` 历史重建预填、live 新 media 不被预填。
- hook：顺序处理（同批多条不重叠）、失败不记 importedByProject、pid 切换隔离。

## 9. 已知限制 / YAGNI

- **同名重生成**：agent 覆盖 `assets/hero.png` 后再次下发同名 media，会因去重被跳过，画布保留首次导入的字节。MVP 接受（文件名通常唯一）。
- 暂不做：画布放置的避让优化（超出泳道宽度后换行）、手动「移出画布 / 撤销导入」入口、导入进度指示（import 为同步、通常很快）。
