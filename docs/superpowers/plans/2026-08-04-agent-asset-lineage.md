# 实现计划：agent 产物的血缘归因

> 设计稿：`docs/superpowers/specs/2026-08-04-agent-asset-lineage.md`
> 分支：`feat/agent-asset-lineage`

先纯函数（归因规则），再把 taskId 打通到导入侧，最后分别接同步产物与异步任务两条路。每任务一次提交，TDD。

---

## T1 归因纯函数

**改动** 新建 `src/lib/gen-lineage.ts`
- `sourceUrlsFromInput(input: unknown): string[]`：按**字段名白名单**抽 url，保序去重 ——
  `source_urls[]`（图生图）、`source_url`（图生 3D / 视频首帧）、`last_frame_url`（视频尾帧）、
  `ref_image_urls[]` / `ref_video_urls[]`（视频参考）。非字符串项跳过；未知字段一律不取
  （不臆测后端字段，反模式条目）。
- `matchAssetsByUrl(urls, assets)`：归一后全等 match `preview.src`；不中再按 basename **唯一命中**兜底
  （同名多卡 = 歧义，不连）；返回命中的 item_id 列表（保序去重）。
- `lineageForTask(messages, taskId, assets)`：扫 tool parts，按 `part.result` 里
  `media.task_submitted.task_id === taskId` 定位 part → `sourceUrlsFromInput(part.input)` →
  `matchAssetsByUrl` → `{ sourceItemId?: string; refItemIds?: string[] }`（首个作 sourceItemId，其余进 refItemIds）。

**测试** 新建 `src/lib/gen-lineage.test.ts`
- `sourceUrlsFromInput`：五种字段各自命中；混合字段保序；空/缺字段 → `[]`；非字符串项被跳过；
  未知字段（如 `prompt`、`image_url`）不取。
- `matchAssetsByUrl`：全等命中；相对 vs 绝对 url 归一后命中；basename 唯一命中；
  basename 撞名（两张同名卡）→ 不连；一个都不中 → `[]`。
- `lineageForTask`：单源 → `{sourceItemId}` 无 refItemIds；三源 → 首个 sourceItemId + 其余 refItemIds；
  taskId 找不到对应 part → `{}`；part 有 input 但无源字段（纯文生图）→ `{}`；
  `part.result` 非 JSON / 不是 media.task_submitted → 跳过不崩。

**验证**
```bash
pnpm exec vitest run src/lib/gen-lineage.test.ts
```

---

## T2 taskId 打通到导入侧

**改动**
- `src/koubou/protocol.ts`：`MediaItem` 加 `taskId?: string`（`media.tasks.status` 项的 `task_id`，
  现在被 `parseMediaPayload` 丢掉）；新增 `parseSubmittedTaskId(text): string | null` —— 取任意 kind 的
  task_id（`parseSubmittedTaskPayload` 仍只放行 video/3D，那是 GenTask 登记门槛，不动）。
- `src/lib/media-import.ts`：`ReadyMedia` 加 `taskId?`，`collectMedia` 透传。

**测试**
- `src/koubou/protocol.test.ts`（追加）：`parseMediaPayload` 带出 `taskId`；缺 `task_id` 时为 undefined；
  `parseSubmittedTaskId` 对 image/audio/video 结果都取到 id，非提交回执 → null。
- `src/lib/media-import.test.ts`（追加）：`eventAssets` 的 media 项带 `taskId`。
- **回归**：既有 `parseSubmittedTaskPayload` 只认 video/3D 的用例不变。

**验证**
```bash
pnpm exec vitest run src/koubou/protocol.test.ts src/lib/media-import.test.ts
```

---

## T3 同步产物（image / audio / text）接上归因

**改动** `src/store/actions.ts` 的 `importGeneratedAsset`
- 有 `taskId` → `lineageForTask(get().messages, taskId, get().assets)`。
- 落位：命中源 → `placeTarget({ sourceItemId, origin: 'agent' }, [])` 再过 `avoidOverlap`；
  未命中 → 保持现状（视口中心 + 避让）。
- `reference` 带上 `parent_id` / `ref_item_ids`（与 `source_filename` 并存），
  并入 store 的 asset 也带 `parentId` / `refIds` / `source:'derived'`。
- `await` 后照旧校验 `currentProjectId`。

**测试** `src/store/actions.test.ts`（追加，沿用既有 pgcApi mock 范式）
- 消息里有 `source_urls` 命中画布卡 → import body 的 `reference.parent_id` = 源卡 id，
  落位在源卡右侧（断言坐标关系而非硬编码值），store 里 asset 的 `parentId` 正确。
- 多源 → `ref_item_ids` 含其余 id。
- 无源（纯文生图）→ body 不含 `parent_id`，落位与现状一致。
- 源 url match 不到 → 同上不连线，导入照常成功。
- 项目在 `await` 期间切换 → 不写入。

**验证**
```bash
pnpm exec vitest run src/store/actions.test.ts
```

---

## T4 异步任务（video / 3D）：占位卡即连线

**改动** `src/store/actions.ts` 的 `registerAgentGenTask`
- 登记前先 `lineageForTask(get().messages, taskId, get().assets)`，把结果并进
  `addGenPlaceholders(assetKind, 1, { origin: 'agent', sourceItemId, refItemIds })`
  —— 占位卡出现时就落在父卡右侧并带连线（成功标准 7），产物回来时 `adoptAgentItem` 原位替换不跳位。
- 删掉 `actions.ts:1210` 那句「无 source_item_id 不连线」的注释，改写为归因口径说明。

**测试** `src/store/actions.test.ts`（追加）
- 视频任务的 `source_url` 命中画布卡 → 占位卡的 `parentId` 已是源卡、坐标在源卡右侧。
- 产物回来后 adopt → `parentId` 保留（不被服务端旧 reference 冲掉）。
- 无源 → 占位卡落视口中心、无 `parentId`（现状回归）。

**验证**
```bash
pnpm exec vitest run src/store/actions.test.ts
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

---

## 实现与计划的差异（2026-08-04 落地）

- `parseSubmittedTaskId` **提前到 T1** 落地（计划里在 T2）：`lineageForTask` 直接要用它，
  留到 T2 会让 T1 无法独立转绿。协议层解析仍放在 `koubou/protocol.ts`（分层不破）。
- **`apply-koubou.ts` 完全没改**：原以为要另记 task_id，实际 `apply-koubou.ts:487` 折叠结果时
  已把结果原文存进 `part.result`，归因直接从它认 `media.task_submitted.task_id` 即可。
- **`adoptAgentItem` 多改了一处**（计划未列）：它此前只保留占位卡的**坐标**，
  产物回来时 `{...asset}` 会把前端归因出的 `parentId` 用服务端的 `undefined` 冲掉。
  agent 异步任务的 canvas item 由 pgc 自建（`vid-/m3d-{task_id}`），服务端那份 reference 里
  本来就没有血缘 —— 所以血缘与坐标同理归前端所有，两个分支都改为保留占位卡上的血缘，
  由既有的 `assetReference(placed)` 回写落库。**这是「产物回来后连线消失」的真因**，
  T4 第二条测试正是它的回归守护。
- 顺手抽出 `lineageFields(opts)`（`actions.ts`）：占位卡 / 真实卡 / agent 自动导入三处
  原本各写一遍同样的 `parentId + source:'derived' + refIds` 展开，现在共用一份。
- `importGeneratedAsset` 并入 store 的 asset 显式带上本地算出的 `position`：
  此前取 mapper 结果（服务端对我们下发坐标的回显，值相同），现在与「位置归前端所有」口径一致。

## T5 真机验收

dev 环境跑一遍，记录进 spec 末尾：

1. @一张图 → 「照这张风格再画一张」→ 新卡在源卡右侧 + 连线；刷新后连线仍在（`reference.parent_id` 已落库）。
2. @一张图 → 「做成 3D 模型」→ 占位卡即刻落在源卡右侧带连线，产物回来原位替换。
3. 「随便画一张森林背景」（无引用）→ 落视口中心、无连线（不回归）。
4. 连续两轮派生（A → B → C）→ 链式连线。
