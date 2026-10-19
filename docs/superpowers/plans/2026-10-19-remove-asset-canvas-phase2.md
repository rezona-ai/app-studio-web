# 移除资产画布 · 第二阶段（store / Bridge / i18n 清理）—— 实现计划

spec：`docs/superpowers/specs/2026-10-19-remove-asset-canvas-design.md` §8（第一阶段计划：`2026-10-19-remove-asset-canvas.md`）

第一阶段拆掉了画布界面，store 层刻意原样保留。本阶段把只服务画布界面的 state / action / 模块删干净，
**资产数据层、对话附件、Toast、版本、计费、回放、导入压缩包的行为一律不变**。纯减法，外加一处回归修复（T1）。

## T0 盘点结论（逐个 grep 过 `src/` 非 store、非测试的消费方）

### 删除

| 层 | 内容 |
|---|---|
| `store/index.ts` UIState | `visibleKinds` `selectedIds` `contextMenu` `groupMenu` `groupRenameId` `selectedGroupIds` `groupMorphGid` `renameTarget` `textEditor` `addMenu` `lightbox` `genForm` `derived3dForm` `libraryOpen` `canvasTool` `alignEnabled` `alignGuides` `canvasQuery` `listOpen` `listWidth` `listSort` `hoverAssetId` `libraryListCache` `bridge` |
| `store/index.ts` Actions | `setAssetPositions` `toggleKind` `toggleAlign` `setAlignGuides` `setCanvasTool` `setCanvasQuery` `toggleList` `setListWidth` `setListSort` `setHoverAsset` `selectAsset` `setSelection` `setCanvasSelection` `clearSelection` `openContextMenu` `openGroupMenu` `startGroupRename` `selectGroup` `clearGroupMorph` `openRenameModal` `closeRenameModal` `openTextEditor` `closeTextEditor` `saveTextAsset` `deleteSelected` `openAddMenu` `closeAddMenu` `openLightbox` `setLibraryOpen` `cacheLibraryList` `openGenForm` `closeGenForm` `openDerived3dForm` `closeDerived3dForm` `renameAsset` `pushUndo` `undo` `retryGeneration` `openRetryForm` `takeGenFormReplacement` `removeAsset` `addAsset` `clearAgentNewAssets`，以及 `BridgeActions` 全部 |
| `store/types.ts` | `CanvasTool` `Group` `UndoEntry` `undoToken` `BridgeState` 及其子类型；`ServerState` 的 `groups` `canvasLoading` `agentNewAssetIds` `viewportByProject` `undoStack`；`ToastMessage.action`（撤销 / 打开 Bridge 面板两种动作都已无来源） |
| `store/actions.ts` | 用户发起的生成（`generate*` / `precheckRig3d` / `runGen` / 在飞注册表 / 进度节流）、上传到画布（`uploadAsset`）、失败卡重试（`runRetry` / `discardFailedCard` / `recheckAsset`）、延迟删除、分组框全套、拖拽 `moveDragged`、坐标批量回写 `persistAssetPositions` 及失败聚合 Toast、一键整理 `tidyCanvas`、视口 `setProjectViewport`、素材库导入 `importLibraryAsset`、文本卡 `saveTextAsset`、`guardRethrow`（只剩文本卡在用） |
| 模块 | `store/bridge.ts` `store/undo-stack.ts` `store/pending-delete.ts`、`lib/engine-bridge/**`、`lib/viewport.ts`（注册方 AssetCanvas 已删，`getViewportCenter()` 恒为 null）及 T5 闭包扫出的其余孤儿；各自同目录测试一并删 |

### 保留（行为不变）

- 资产数据层：`loadCanvas`（去掉待删 / 分组过滤分支——两者的来源已删，恒为空）、`importFromLiveEvent` / `importMediaFromEvent` / `importGeneratedAsset`、
  `registerAgentGenTask` + `pollGenTasks` + `restoreGenTasks` + `genTasks*` / `inflightCardsByProject` / `agentTasksByProject` / `importedByProject`、
  `uploadChatAttachment`、`importProjectArchive` / `resumeImportQueue`、`card-layout` 落位与坐标随 reference 回写。
- 落位里的「视口中心」原本就因 AssetCanvas 已卸载而恒取 `{0,0}`：改为显式常量，行为不变。`origin:'user'` 分支（`ensureVisible`）与
  「N 个新资产」角标（`agentNewAssetIds`）只服务画布，随之删除；`GenPlacement` 收窄为 `{ sourceItemId, refItemIds }`。
- `Asset.groupId` 保留：它是服务端顶层字段的透传，删掉会让坐标回写把它当缺省值处理，属后端契约范围。
- 压缩包导入落库后原本会 `tidyCanvas()` 自动整理一次坐标——无人展示坐标，删掉这一步（只少一次批量 PATCH，契约不变）。
- `Toast` 的「撤销」与「打开 Bridge」按钮随 `ToastMessage.action` 一并删；`setError/setSuccess/setWarning` 通道不动。

### 不在本阶段

- `lib/card-layout.ts` 简化（spec §8 末条）：需先确认后端是否依赖坐标，另起任务。
- `saveVersion` / `setProjects` / `setCurrentProject` 等**非画布**的无人调用 action：不属本 spec 范围，列为后续。

## T1 回归修复：恢复版本构建轮询与 agent 生成任务轮询

第一阶段 §5.2 认定 `useCanvasPolling`「只推进画布发起的任务」而删除了它，但它实际还驱动两条非画布链路：

1. **版本构建轮询**：`loadVersions` 会拿到 `status:'building'` 的版本行，此后只有这个 hook 会再拉（spec 2026-08-31）。删掉后新版本停在 building，预览不自动就绪。
2. **agent 异步生成任务**：`importFromLiveEvent` → `registerAgentGenTask` 登记的 video / 3D 任务只靠它推进；不推进则产物要等下一次 `loadCanvas` 才能被 `@`，
   且终态的余额刷新（`refreshBalance({ terminal })`）、`CREDIT_INSUFFICIENT` 充值引导与失败 Toast 全部丢失——属计费链路。

处置：新建 `src/client/useAssetPolling.ts`，内容即原 hook（生成任务基础 / 派生两档 + 版本封顶轮询，逻辑逐字沿用），挂回 `Workspace`；
补回原同目录测试。`pollGenTasks` 的派生分支（rig3d / retexture / audio）保留：`restoreGenTasks` 的 `DISCOVERABLE` 仍会按前缀从服务端接回这几类在飞 item。
同时删掉只为「用户画布生成」埋点存在的 `GenTask.gaModality / gaModel` 与相应 `track` 分支（来源 `startAsyncGen` 已删，字段恒空）。

## T2 store 三文件

按 T0 表删除，`tsc` 驱动收尾。`actions.ts` 的 `StoreSlice` 不再需要 `Pick<UIState, …>` 选区窄口，去掉对 `./index` 的类型反向引用。
`selectProject` / `switchProjectSession` / `deleteProject` 里对已删字段的清理同步去掉。

## T3 persist 白名单与 key 版本

- 白名单去掉 `visibleKinds` `alignEnabled` `listOpen` `listWidth` `viewportByProject`。
- **key 名 `rezonalab-v4` 不改**：换 key 等于清空用户的模型选择 / 项目模型记忆、composer 草稿、低余额弹窗锁（会重弹）、回放断点进度（回放从头播）、
  压缩包导入续跑队列与在飞生成任务——换来的只是少几个残留字段，不值。spec §5.2 担心的「同源残留在飞任务无人推进」已由 T1 恢复轮询消解。
- **`version` 2 → 3**：`migrate` 删掉上述五个已废弃键。不迁移也不会出错（下一次写盘时 partialize 自然丢弃），但 persist 的浅合并会先把它们
  灌进内存态，留着就是一份没人读的脏字段；迁移一次性收干净。原 v0→v1 的 `visibleKinds` 补 `text` 迁移随字段一起退役，`persist-migrate.test.ts` 改写为 v3 断言。
- 顺手修正 `name` 上一行的错误注释（防白闪脚本读的是 `rezonalab-config`，不是本 key）。

## T4 Engine Bridge 收尾

- 删 `store/bridge.ts`、`lib/engine-bridge/**`、`scripts/engine-bridge-e2e/`、依赖 `@rezonalab/engine-bridge-web`（`package.json` / lockfile / `pnpm-workspace.yaml` allowBuilds）、`.gitignore` 里对应条目。
- 构建参数：`deploy/dockerfile` 的 `ARG/ENV NEXT_PUBLIC_ENGINE_BRIDGE`；`_deploy.yml` 的 `engine_bridge` input 与 build-arg；
  四个调用方工作流（`deploy.yml` / `deploy_dev.yml` / `deploy_dev_pr.yml` / `deploy_stage.yml`）里的 `engine_bridge: "1"` 必须同步删——
  `workflow_call` 传了被调方未声明的 input 会直接报错。`tests/deploy/deploy-for-testing-contract.test.ts` 的 input 清单同步去掉 `engine_bridge`。
- 删 `tests/deploy/engine-bridge-flag-contract.test.ts`（只钉 flag 逐环境取值）与 `bridge-origin-coverage.test.ts`（只钉插件来源白名单）。
- `i18n/errors.ts` 的 `BRIDGE_*` 映射、`figma.tsx` 里只给 Bridge 面板用的引擎字标（若闭包扫描判孤儿）。

## T5 i18n 与孤儿闭包

- 用脚本列出 `en.ts` 全部叶子键，逐条在 `src/`（排除 locales）里找完整键名或动态前缀（`` `canvas.assetKind.${k}` `` 这类）引用；
  无引用的 `canvas.*` / `library.*` / `bridge.*` / `workspace.*` / `errors` 映射目标从 11 种语言同步删除。删后 `i18n.test.ts` 的跨语言键集一致性用例兜底。
- 从入口（`src/app/**` 的 page / layout / route、`server.ts`、`vitest.setup.ts`）做 import 图可达性分析，删不可达的源文件及其测试；
  反复跑直到集合不再变化。同步检查 `package.json` 依赖是否因此不再被引用。

## T6 验收

1. `pnpm lint` 无 error；`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿。
2. `grep -rn "bridge\|genForm\|undoStack" src` 逐条说明残留。
3. `CLAUDE.md`「第二阶段待清」一条改为已完成，并记下 T1 的轮询 hook 与 persist v3。

## 实施记录（与上文的偏差）

- **T2 追加**：`Asset.groupId` 一并删除——分组框界面退役后它没有读方，`positionBatchItem` 也从不写 `group_id`，不涉及后端契约；
  `loadCanvas` 不再读服务端 `groups` 字段，`map.ts` 的 `canvasGroupToGroup` / `preserveFrontendGroups` 随之删除。
  `lib/viewport.ts` 删除后，落位起点改为显式常量 `PLACEMENT_ORIGIN`（行为与「注册表为空回落原点」逐字等价）。
- **T5 闭包结果**：一轮模块级扫描即收敛，删除 `lib/` 下 13 个孤儿（`align-guides` `asset-list` `canvas-group` `canvas-search` `canvas-selection`
  `gen-failure-map` `gen-models` `gen-params` `list-drawer` `retry` `tidy-canvas` `tidy-input` `viewport-clamp`）及其测试。
  另按「存活模块里只剩测试在用的导出」再扫一轮，删掉画布专属的死导出：`gen-retry`（只留 `GEN_STATE_LOST`）、`download`（只留 `versionArchiveName`）、
  `card-layout` 的 `tidyLayout` / `spawnAtPoint`、`canvas-batch` 的分片、`selectors` 的 React Flow 节点 / 边、`ids` 的临时框 id、`popover-position` 的 `clampPopover`、
  `asset-kind` 的过滤图例、`clipboard-assets` 的 `isEditableTarget`、`agent-provenance` 的读侧别名归一、`gen-lineage` 的首帧取值。
  扫描残留三项均非本次产生：`chat/ActionPill.tsx`、`ui/Badge.tsx` 在原仓就无引用方；`types/model-viewer.d.ts` 是环境类型声明（`FilesView` 仍在用 `<model-viewer>`）。
- **依赖**：删除 `@rezonalab/engine-bridge-web` `@xyflow/react` `client-zip` `@types/three`。`three` **保留**——它是 `@google/model-viewer` 的 peer，
  删掉直接依赖会让 pnpm 把 peer 解析到另一个版本（0.183.2），等于悄悄换了 Files 面板 3D 预览的渲染内核。
- **i18n**：11 种语言各删 274 个叶子键（`canvas.*` 213、`bridge.*` 42、`library.*` 11、`workspace` 3、`errors` 3、`common.undo/generating`）。
  原仓就无引用的 `preview.current`、`preview.rezona.accountNotice/noRemixNotice`、`insufficient.examples.p0-2` 不在本次范围，保留。
- **图标**：只删 Bridge 专属的 `engineCocos` / `engineUnity`（含 SVG）；其余十余个只服务画布工具条的 `figAsset` 图标列为后续。
