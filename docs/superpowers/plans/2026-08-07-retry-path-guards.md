# 实现计划：重发路径的四道护栏

> 设计稿：`docs/superpowers/specs/2026-08-07-retry-path-guards.md`
> 分支：`fix/retry-path-guards`（worktree：`.orca/worktrees/fix+retry-path-guards`）
> 铁律：每个任务**先写复现该缺陷的失败测试**，看到它红，再写生产代码。

## 任务顺序的理由

T1 先做：它是一行判据，却同时改变三条重发路径与拖放的落位，后面几个任务的断言都建立在它的新语义上。
T2 紧随：`discardFailedCard` 的返回值是 T3 孤儿分支的挂载点。
T3 最大（新 action + i18n + 组件分流），放在两条地基之后。
T4/T5 互不相干、可并行评审，放最后。

---

## T1 · 新增 `nearAt` 锚点口径（起点 + 避让）

> 初版「让 `spawnAt` 一律避让」的方案已被否 —— 那会推翻 `4bdd54a4` 的刻意决策，理由见 spec 方案 1 的警示框。

**先写的失败测试**（`src/store/actions.test.ts`）
- `nearAt:落点已被占用 → 以它为起点避让,不与已有卡重合`（现状红：`nearAt` 还不存在）
- `nearAt 优先级高于派生树形:带 sourceItemId 时仍以 nearAt 为起点`（现状红；防 C1 同款回归）
- `pinAt 仍精确落点、不避让`（现状绿，防改过头）
- `双击空白处(spawnAt)落点已被占用仍精确落在点击处`（**既有测试 `actions.test.ts:858`**，现状绿，回归护栏）

**改动**
- `src/store/types.ts` / `src/store/actions.ts`：`GenPlacement` 增 `nearAt?: XY`（左上角口径），
  注释写清与 `pinAt`（原卡已丢弃→精确回填）、`spawnAt`（用户点哪落哪，`4bdd54a4`）的三方区别
- `src/store/actions.ts` `placeTarget`：`pinAt` 之后、派生树形之前加 `nearAt` 分支
- `addGenPlaceholders` **不改**（`nearAt` 调用方不传 `spawnAt`/`pinAt`，既有判据自然走避让分支）

**独立可评审**：是。本任务只加能力、不改任何既有路径的行为，测试应全绿通过。

---

## T2 · `discardFailedCard` 回报是否真丢弃，落位判据改用它

**先写的失败测试**（`src/store/provenance.test.ts`）
- `成功卡再生成 → 新卡不与原卡重合`（现状：不传锚点 → 落视口中心；断言改为「以原卡为锚且不重合」）
- `失败卡重试 → 仍丢弃原卡并精确落回原位`（现状绿，防改坏——这条正是评审 C1 抓到的回归点）

**改动**
- `src/store/actions.ts` `discardFailedCard` 返回 `boolean`（占位卡/普通失败卡 `true`）
- `src/store/types.ts` `ServerActions.discardFailedCard` 签名同步
- `src/store/index.ts` `retryGeneration`：两条分支合并为
  `const discarded = discardFailedCard(...); runRetry(prov, discarded ? topLeft : undefined, lineage)`
  —— 成功卡此处改为**传原卡中心作 spawnAt**（T1 后它参与避让 → 落旁边）
- `src/store/index.ts:682-683` 的化石注释（仍只讲「丢弃失败卡 → 落回当前坐标」并引「成功标准 7」）改写

**独立可评审**：是。

---

## T3 · 孤儿卡：专属 code + 不删不丢 + 「重新检查」

**先写的失败测试**
- `src/store/actions.test.ts`：`孤儿兜底挂 GEN_STATE_LOST 而非 null`
- `src/store/actions.test.ts`：`对 GEN_STATE_LOST 卡 discardFailedCard → 不发 DELETE、卡仍在、返回 false`（核心断言）
- `src/store/actions.test.ts`：`recheckAsset → 清本地失败态后 loadCanvas;服务端已 ready 则卡变 ready`
- `src/store/actions.test.ts`：`recheckAsset 后服务端仍 generating → 不永久转圈`（走 stuckFailed 之外的路径）
- `src/components/canvas/nodes/GenErrorBody.test.tsx`：`GEN_STATE_LOST 卡按钮文案是「重新检查」且不调 retryGeneration`

**改动**
- `src/store/actions.ts`：导出常量 `GEN_STATE_LOST`；`restoreGenTasks` 孤儿分支改挂结构化 failure；
  `discardFailedCard` 增孤儿分支（不移除、不 DELETE、返回 `false`）；新增 `recheckAsset(assetId)`
- `src/store/types.ts`：`ServerActions` 增 `recheckAsset`
- `src/components/canvas/nodes/GenErrorBody.tsx`：按 code 分流文案与按钮
- `src/i18n/errors.ts` + 11 语言词条：`canvas.genStateLost` / `canvas.recheck`

⚠️ 实现要点：`recheckAsset` **必须先清本地失败态再 `loadCanvas`**，否则 `loadCanvas` 的 `stuckFailed`
会把刚清的按回去，按钮变成假入口（spec 约束 4）。这条要有专测。

**独立可评审**：是（最大的一个，diff 预计过半）。

---

## T4 · 生成中的卡不给点「再生成」

**先写的失败测试**（`src/components/canvas/AssetInspector.test.tsx`）
- `generating 卡:按钮 disabled 且点击不调 retryGeneration`（现状红：可点且会发请求）
- `pending_ 占位卡同上`
- `ready 卡与 error 卡:按钮照常可点`（回归）

**改动**：`src/components/canvas/AssetInspector.tsx` 加 `busy` 门控 + `Tooltip`；i18n 增
`canvas.inspector.regenerateBusy` × 11 语言。

**独立可评审**：是。

---

## T5 · 批量重试排除不可重试

**先写的失败测试**（`src/lib/bulk-actions.test.ts`）
- `failure.retryable === false 的失败卡不计入 bulkRetryable.usable`（现状红）
- `retryable 缺失(undefined) 仍计入`（边界：缺 failure 时按可重试处理，与 GenErrorBody 的 editFirst 同口径）

**改动**：`src/lib/bulk-actions.ts` 的 `bulkRetryable` 增一条判据 + 注释说明「批量下没有开预填表单这个降级」。

**独立可评审**：是。

---

## T6 · 更新被本轮改变的既有断言与文档

- `src/store/provenance.test.ts:187/:205` 把「表单重试对 error 卡传原卡中心」钉住了 —— T1/T2 后行为变成
  「落旁边」，断言要一并改（评审 f21 明确点名此处）。
- `src/lib/card-layout.ts:55` 的化石注释（说 `spawnAtForTopLeft` 调用方是 `runRetry`/`openRetryForm`，
  而 `runRetry` 早改走 `pinAt`）订正为实际调用方。
- 在 `2026-08-06-retry-lineage-and-no-discard.md` 与 `2026-08-06-orphan-gen-task-no-delete.md` 就地补一行
  「本条已由 2026-08-07-retry-path-guards 收口」，免得后人照读过期结论。

---

## T7 · 补一条本轮暴露的测试缺口

评审核实：`retryLineage` 的 **kind 白名单全仓无测试**——改成 `return true` 套件仍全绿。
补一条 `3D 父卡 → 不带 source_item_id` 的用例（`src/lib/gen-retry.test.ts`），并在
`2026-08-06-retry-lineage-and-no-discard.md` 的规则表那格标注「防御性收窄，两个入口都够不到」。

不属本轮四条缺陷，但同一文件、同一次评审暴露，顺手补掉比另起一轮便宜。

---

## 验收

每个任务提交后派干净上下文的子代理按 commit 范围独立评审（只给 spec 与 diff）。
全部完成后在分支上跑四道闸门（`lint` / `tsc` / `test` / `build`），再按 spec 的 11 条成功标准逐条真机验收
（dev :3011 打 pgc dev），**真机验不到的如实记为「未验到」，不当作通过**。
合并前终审全分支。

---

## 实跑记录（2026-08-07，分支 `fix/retry-path-guards`）

### 与计划的偏差（如实记）

1. **T1 换了机制**。初版「让 `spawnAt` 一律参与避让」在动工前被否：`4bdd54a4` 专门做过
   「双击空白处直接落在点击点、不避让」，且有专测钉住（`actions.test.ts:858`）。改为新增
   `nearAt` 口径，`addGenPlaceholders` 一行没动，双击 / 拖放 / 粘贴 / 空态 chips 的落位语义零变更。
   代价：初版顺带能修的「多文件拖放全部重叠」不再免费，已记入后续（属拖放那条线，不在 P0）。
2. **表单路不是「自动解决」**。计划 T2 写着 openRetryForm 的压卡「由 T1 自动解决」——那是初版方案
   的推论；换 `nearAt` 后必须显式把锚点透过 `GenFormState` → `GenerateForm` 带到提交处，已补。
   用户拖过弹窗时仍以拖后位置为准（显式意图优先于 `nearAt`）。
3. **多收口一处 + 删掉一个函数**。`retryGeneration` 无 provenance 那条分支（开空表单）同样不丢原卡，
   却也传精确落点，属同一类缺陷，一并改走 `nearAt`。改完 `spawnAtForTopLeft` 再无调用方，
   按「不留 dead code」整个删除。
4. **一处假绿被抓住**：`GEN_STATE_LOST` 那条测试最初断言导入的常量，而常量尚不存在（`undefined`），
   与 `failure` 为 `null` 时的 `undefined` 恰好相等 → 假通过。改断言字面量后才真红。
5. **计划里列的几处改动实际不需要**（计划未订正，补记）：`src/store/types.ts` 三处任务都列了它，
   但 `GenPlacement` 在 `actions.ts`、`ServerActions` 由 `ReturnType<typeof createServerActions>` 自动派生，
   全程没动；T3 列的 `src/i18n/errors.ts` 也没改（走 `t()` 键，不经 `ERROR_KEYS`）；
   T4 的「ready 卡照常可点」复用了既有用例、未新增。
6. **T7 的文档标注漏做**：计划要求在 `2026-08-06-retry-lineage-and-no-discard.md` 的规则表那格标注
   kind 白名单是「防御性收窄」。⚠️ 我第一次声称「已补上」是**假的** —— 那次字符串替换因标点不匹配
   （原文是 `—— 评审 I1）` 而我匹配的是 `（评审 I1）`）静默成了空操作，终审 grep 出来才发现。
   **教训**：脚本化改文档必须断言替换真的发生，否则「改完了」只是一句自述。现已真补上并复验。

### 终审（第二个干净上下文子代理，只看采纳后的增量）

结论「**可以合并**」，无阻塞项；6 条 Minor 处理如下：

- **Minor 1（已修）**：上面偏差 6 那处「说补了实际没补」。
- **Minor 2 / 3（已修）**：本 spec 两处描述与实现不符 —— 「计入跳过数」实际没有结束 Toast、
  方案 3 仍写「由 `restoreGenTasks` 重新标回」而采纳 I2 后已是单卡复判。均已就地订正。
- **Minor 4（已修）**：`guard` 只吞 `PgcError`、未知错误照抛（约定不改），但抛出去时卡仍停在
  刚清成的 `generating` —— 与 I1 同一失效形态。复判已挪进 `finally`，并补一条「非 PgcError 照抛
  但卡仍被标回失败态」的测试（改前红：`expected 'generating' to be 'error'`）。
- **Minor 5（不做）**：`bulk-actions.test.ts` 缺 `GEN_STATE_LOST` 的纯函数用例；该类已由
  `ContextMenu.test.tsx` 端到端覆盖（更强），属对称性问题。
- **Minor 6（不做）**：并发 `loadCanvas` 与 `recheckAsset` 清失败态之间的良性竞态 —— 非本轮引入、
  用户再点一次即可，动它要碰整块并发口径。

### 独立评审（干净上下文子代理，只给 spec + diff）与采纳

评审判「修完 Critical + Important 再合并」，逐条对着代码复核后**全部采纳**：

- **C1（Critical，我漏掉的）**：缺陷 3 只改了计数、执行侧没改。`ContextMenu.tsx` 的
  `targets = selected.filter((a) => a.status === 'error' && a.provenance)` 是改动前就有的另一行判据 ——
  它连 agent 卡都没排除。于是菜单显示「Retry 1」却真发 N 张，`retryable:false` 与孤儿卡都会被花钱重发。
  → 判定收敛成单一谓词 `isBulkRetryable`，计数与执行共用；孤儿卡一并排除；补 **ContextMenu 层**测试
  （纯函数测试挡不住这个洞）。
- **I1**：`recheckAsset` 裸调 `loadCanvas`（全仓唯一未 guard 的调用点），抛错则卡停在刚清空的
  `generating` 且再没人标回失败 → 永远转圈。→ 包 `guard`，并在失败路径复判、标回孤儿失败态，补专测。
- **I2**：`recheckAsset` 调整表 `restoreGenTasks` 会把全项目在飞任务的 `fails` 清零、退避清空
  （`MAX_FAILS` 兜底与指数退避被抹掉）。→ 改成只复判眼前这一张卡。
- **I3**：`recheckAsset` 的两条测试**区分不出核心不变式** —— 变异验证证实：删掉「先清本地失败态」那行，
  两条照样绿。→ 改成在 `listCanvasItems` 被调用的那一刻断言卡是 `generating/failure:null`，
  重做变异验证：现在删掉那行立刻变红。
- **M1**：`GEN_STATE_LOST` 从 `@/store/actions` 被组件 import 是全仓唯一一处组件直接依赖 store action 模块。
  → 下沉到 `src/lib/gen-retry.ts`（store / 卡面 / 批量菜单三处共用的领域常量）。
- **M2**：`nearAt` 的 Host → Form → placement 透传链一条测试都没有（删掉全套仍绿，行为静默退化成
  「落到视口中心」）。→ 补成对用例（未拖 → 下发 `nearAt`；拖过 → `spawnAt` 胜出），变异验证通过。
- **M4 / M5**：非 busy 时不再包冗余 Tooltip；`GEN_STATE_LOST` 文案断言从宽正则收窄成完整串。
- **M3（记录不做）**：孤儿卡在属性面板仍显示可点的「以相同参数再生成」（真花钱），与卡面的
  「重新检查」语义相反。不是数据丢失、且 spec 决策 2 只要求「不删」，**留给回合 B**（那轮本就要动面板与词条）。

### 四道闸门（本轮实跑，分支 HEAD）

```
pnpm exec tsc --noEmit → 无输出                                   退出码=0
pnpm test              → Test Files 252 passed / Tests 2911 passed 退出码=0
pnpm lint              → ✖ 8 problems (0 errors, 8 warnings) = 基线,未新增
pnpm build             → Compiled successfully                        退出码=0
```

### 变异验证

- `retryLineage` 的 kind 白名单：去掉 `if (p.kind !== 'image' && p.kind !== 'text') return false;`
  → **只有新增那条用例变红**（其余 15 条仍绿），还原后全绿。说明它真挡得住而非重言式。

### 真机验收（2026-08-07，worktree dev :3011 打 pgc dev，专用项目 1633「P0-A 验收 2026-08-07」）

手法：Playwright + 仓库自带 dev 句柄 `window.__store` 读写状态；包一层 `window.fetch` 只统计
`/canvas/items/generate`、`DELETE /canvas/items/*`、`GET /canvas/items` 三类。
真实生成一律用最便宜档（`gpt-image-2`, n=1，4 credits/次）。**全程消耗 24 credits**（859325 → 859301）。

| 标准 | 结果 | 证据 |
|---|---|---|
| 1 生成中不给点 | ✅ | 占位卡带 provenance 时按钮 `disabled=true`、点击后生成请求 **0**；**A/B 对照**：同一张卡改 `ready` 后 `disabled=false`（证明不是恒禁用）|
| 2 孤儿卡按钮与行为 | ✅ | 文案 `Check again`；点击后生成 **0**、DELETE **0**、画布重拉 **1** 次 |
| 3 重新检查（服务端已落终态） | ✅ | 上传造真卡 → 本地置 generating → 真实 `restoreGenTasks` 判成孤儿（`GEN_STATE_LOST`、不弹 Toast）→ 点重新检查 → 卡变 `ready` |
| 3 重新检查（接不回来） | ✅（等价路径） | 掐断 `GET /canvas/items` 后点击 → 卡**回到 error + GEN_STATE_LOST 并留在画布**、弹 NETWORK Toast。这正是评审 I1 的修复；「服务端仍 generating」那条原样未验，见下 |
| 4 孤儿卡再生成 | ✅ | **DELETE 请求为空**（本轮 P0 第一位的核心断言）、原卡仍在 (310,225)、新卡落旁边 (310,465) |
| 5 失败卡重试 | ✅ | 原卡被丢弃、`DELETE img-ad573c7025d9` 真发出、新占位卡落 **(810,225) 精确原位** |
| 6 成功卡再生成 | ✅ | 原卡留在 (810,225)、DELETE **0**、新卡落 **(810,465)** = 原卡 y + image 真实高 200 + GAP_Y 40 |
| 7 表单重试 | ✅ | `genForm.nearAt = {810,465}` 且**不带 spawnAt**；提交后原卡仍在、新卡落 **(810,705)** 旁边（修复前会零偏移压住原卡）|
| 8 批量重试 | ✅ | 3 张失败卡（孤儿 / retryable:false / 普通）→ 菜单 `Retry 1 failed`，点击后生成 **1** 次、只 DELETE 那一张，另两张原封不动（评审 C1 的修复）|
| 9 双击落点不回归 | ✅ | `spawnAt` 落在已有卡上：新卡精确落在 `spawnAtPoint` 计算值 (310,490) 且**与既有卡重叠** → 避让确实没被触发，`4bdd54a4` 的刻意决策保住了 |
| 10 拖放 / 粘贴 / 空态不回归 | 部分 | 拖放与上传走**同一条 `spawnAt` 路径**，已由标准 9 覆盖；**粘贴与空态 chips 未单独验** |
| 11 四道闸门 | ✅ | 见上 |

**5 / 6 构成一组干净的 A/B**：同一张卡的同一个位置，失败态（原卡被丢弃）走 `pinAt` 精确回填 (810,225)，
成功态（原卡还在）走 `nearAt` 落旁边 (810,465)。「原卡是否被丢弃」这个判据在真机上成立。

### 未验到（如实记录，不当作通过）

- **「服务端仍 generating」那条原样路径**：要一张真的在飞的服务端卡（视频 / 3D，数千 credits 且需在窗口内操作）。
  等价语义已由断网路径验到（接不回来 → 回到失败态），但不是同一个触发源。
- **标准 1 的 Tooltip**：只验了 `disabled`，气泡文案未验。
- **粘贴 / 空态 chips 的落位**：未单独验（与拖放同属 `spawnAt` 路径，但调用点不同）。
- **收尾**：验收在**专用项目 1633** 上跑，未触碰任何既有项目，故不需要基线还原。项目内留下 6 张卡
  （4 张生成 + 2 张上传），是否删除待定。

### 未做（留给后续）
- 成功卡按钮文案仍是「以相同参数再生成」（行为已是「再来一张」）—— spec 明确留给回合 B。
- 多文件拖放重叠（见偏差 1）。
