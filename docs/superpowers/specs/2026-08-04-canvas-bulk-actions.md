# 画布多选批量操作

> 状态：设计稿 · 2026-08-04
> 关联：P1 第三项（末项）。已完成：列表视图（`2026-08-04-canvas-list-view.md`）。
> 同期未做：P1 的「框 / 分组」（后端将增字段，届时另立项）、「拖拽吸附 + 对齐辅助线」。

## 目的

**选中多张卡后，唯一能做的事是删掉它们。**

`ContextMenu.tsx:30` 的多选分支只有一项「删除 N 个」，而单选有四项（@ 引用 / 重命名 / 下载 / 删除）。于是：

- 想把 5 张参考图一起 @ 进对话 → 右键五次。而**画布 → 对话正是产品的核心回路**。
- 想导出一组资产 → 右键 N 次、落 N 个文件。
- 一批生成里挂了三张 → 逐张点重试。

多选本身早就支持（框选、⌘ 点、列表面板多选），能力却停在删除。

## 约束

1. **镜像单选能镜像的**：@ 引用、下载、删除三项批量化。**重命名不做** —— 批量改名需要命名规则 / 序号模板，那是另一个需求。
2. **部分可用即可点**：选区里只要有一张支持该操作，菜单项就可点；执行时跳过不支持的，结束报「已处理 N 个，跳过 M 个」。不因一张卡不支持就整项置灰 —— 那会让用户以为整个选区都不行。
3. **批量下载打包成单个 zip**，用 **`client-zip`**（~3KB，专为此场景而生）。
   **输入侧流式**：把 `fetch` 的 Response 本身交给它，逐个资产的字节流过 zip 流，不整体读进内存。
   ⚠️ **输出侧仍会累积**：最终得 `await res.blob()` 才能交给浏览器下载，峰值内存 ≈ zip 体积。
   真正的流式落盘需要 File System Access API（`showSaveFilePicker`，仅 Chromium），本期不做。
   即便如此仍显著优于 fflate / jszip —— 那两者输入与输出都堆在内存里（约两倍峰值），且体积大 10~30 倍。
4. **不新增删除路径**：批量删除沿用既有 `requestDeleteAssets`（延迟删除 + 可撤销），只是入口从「删除 N 个」变得与其他项并列。
5. **纯逻辑下沉可单测**：选区能力判定（哪些可下载 / 可引用）、zip 内文件名去重是纯函数，进 `lib/`；IO 与 DOM 留在 action / 组件。
6. UI 复用既有令牌与 `ContextMenu` 现有行款，不新增菜单种类、不新增按钮。

## 成功标准

1. 多选右键菜单含四项：**批量 @ 引用 · 批量下载 · 批量重试（仅当选区含可重试失败卡时出现）· 删除 N 个**。
2. 批量 @ 引用：一次把选区里**可引用**的资产按当前列表顺序插入 composer 草稿，跳过不可引用的（`canMention` 已有口径）。
3. 批量下载：落**一个 zip**，文件名 `<项目名>-assets.zip`（沿用 `versionArchiveName` 的净化口径；**实现时去掉了 `-<N>` 后缀** —— 名字要在打包前定，那时只知道选区大小、不知道实际入包几个，带跳过时 N 会说谎）；zip 内文件名沿用 `assetFileName`，**同名自动加 `-2` / `-3` 后缀**（画布允许重名，zip 内不允许）。
4. 传给 `client-zip` 的是 **Response 本身**而非已读出的 buffer（输入侧流式；输出侧累积见约束 3）。
5. 任一批量操作结束给一条 Toast：`已处理 N 个`，有跳过时补 `，跳过 M 个`。
6. 部分可用时菜单项仍可点（约束 2）；全不可用才置灰。
7. 批量删除行为与现状一致（延迟删除窗口 + ⌘Z 可撤销），不回退。
8. 单选菜单四项行为**一字不变**。
9. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 现状要点（实现前必读）

- `ContextMenu.tsx` 的 `items` 是 `{ icon, label, onClick, disabled? }[]`，多选/单选各构造一份 —— 加项即往多选分支加。
- `canMention(asset)` / `canDownloadAsset(asset)` / `downloadAsset(asset)` / `assetFileName(asset)` 全是单资产口径，可直接复用。
- `addRef(key)` 每次把一个 mention 插进 `composer.draft`（`store/index.ts:823`）。批量插入**不要循环调 N 次 action** —— 每次都会触发一轮 set + 重渲；应一次算好整段再落库。
- `requestDeleteAssets(ids)` 已是批量签名，无需改动。
- `retryGeneration(assetId)` 单卡口径，批量重试循环调用即可；失败卡的判定是 `status === 'error'`。

## 方案

### 1. 纯逻辑（`src/lib/bulk-actions.ts`，新建）

```ts
// 选区能力摘要:菜单据此决定可点与否、执行时据此跳过
export interface BulkCapability { total: number; usable: number }
export function bulkMentionable(assets: Asset[]): BulkCapability
export function bulkDownloadable(assets: Asset[]): BulkCapability
export function bulkRetryable(assets: Asset[]): BulkCapability

```

`dedupeFileNames` **放 `download.ts` 而非本文件** —— 本文件已依赖 download 的 `canDownloadAsset`，
反向再依赖就成环；且文件名本就是 download 的主题（`assetFileName` / `sanitizeFileName` 都在那）。

### 2. 批量下载（流式）

`src/lib/download.ts` 增 `downloadAssetsZip(assets, zipName)`：

- 用 `client-zip` 的 `downloadZip()`，喂一个惰性 async iterable：逐个 `fetch(assetProxyUrl(src))`，把 **Response 本身**交给 client-zip（它读 body 流，不缓冲输入）。
- text 卡无 URL，用 `Blob` 直接入包。
- 单个失败不中断整包：跳过并计入 skipped。
- 返回 `{ ok, skipped }` 供 Toast 报数。

### 3. 批量 @ 引用

store 增 `addRefs(keys: string[])`：**一次 set** 内把 N 个 mention 依次插进草稿（内部复用 `insertMentionRef` 折叠计算），避免 N 次 set。

### 4. 菜单

`ContextMenu` 多选分支从一项扩到四项，图标沿用单选那套（`at` / `download` / `refresh` / `trash`）。「批量重试」仅当 `bulkRetryable().usable > 0` 才出现 —— 常态下选区里没有失败卡，恒显一个灰项是噪音。

## 取舍与明确不做

- **不做批量重命名** —— 见约束 1。
- **不做批量收藏 / 打标** —— 收藏本身还没做（P1 待办）。
- **不做下载进度条** —— 只在结束报一条 Toast。
- **不做 File System Access API 落盘** —— 能让输出侧也流式（免去 zip 整体入内存），但仅 Chromium 支持、需要额外的能力分支与用户手势处理；等真有人反馈大批量导出卡顿再说。
- **不改单选菜单** —— 见成功标准 8。

## 真机验收（2026-08-04，dev :3010，项目 Star Whisper-v82）

已验：

1. 框选 3 张音频卡 → 右键菜单出现 **Use 3 as reference · Download 3 as ZIP · Delete 3 items**，行款与单选菜单一致。
2. 批量下载落一个真 zip：`Star Whisper-v82-assets.zip`，102,846 字节。导出后用 Python `zipfile` 校验 —— **CRC OK**，三条目录项 `sfx_puzzle.mp3` / `sfx_step.mp3` / `sfx_thruster.mp3`，解出的字节头均为 `49443304`（ID3v2.4，真 mp3 而非空壳）。
3. Toast 报 `Processed 3 items`（无跳过时不带后缀）。
4. 批量 @ 引用：一次点击写入三个 `@key`，格式与逐个 `addRef` 一致，菜单随即关闭。
5. 换一组选区复验文件名取自项目名，打包期 JS 堆增量 0.3MB。

**未在真机验到的**（不是通过，是没验）：

- **批量重试**：需要选区里有失败卡，造它得跑一次真实生成失败（消耗积分），本轮按计划不做真实生成。仅单测覆盖。
- **全不可用置灰**：需要生成中的占位卡同时在选区里，同上。仅单测覆盖。
- **大文件内存曲线**：该项目只有图片与音频（单个 ≤ 68KB），量级不足以显出流式与缓冲的差别。选 `client-zip` 的依据仍是「输入侧传 Response」这条已被单测锁死的契约，而非实测曲线。

**一处噪声**：验收中途注入畸形合成指针事件（带 metaKey 的 pointerdown 未配对 pointerup）曾把 React Flow 逼进 `Maximum update depth exceeded`。重载即消失，随后整轮正常交互（框选 / 右键 / 下载 / 点击）未再复现 —— 是注入手法的产物，非本功能缺陷。
