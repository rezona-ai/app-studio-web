# 重发路径的四道护栏：别在用户点一下时花掉他的钱

> 状态：设计稿 · 2026-08-07
> 分支：`fix/retry-path-guards`（P0 回合 A / 共四回合）
> 来源：2026-08-07 对 179 个未推送提交做的 21 功能全量评审（22 个子代理 + 逐条代码核实）
> 关联：`2026-08-03-canvas-gen-failure-retry.md`（引入重试入口）、`2026-08-03-canvas-provenance.md`（重发读落库溯源）、
> `2026-08-06-retry-lineage-and-no-discard.md`（修了 Bug A/B，本轮修它没覆盖到的同一条链路）、
> `2026-08-06-orphan-gen-task-no-delete.md`（孤儿改标失败，本轮补上它留下的重试出口缺口）

## 目的

评审在**重发这一条链路**上查出四个缺陷，全部已对着代码核实。它们共用 `retryGeneration → discardFailedCard → runRetry`
这一条路，分开修要互相打桩，故合成一个回合。

其中两条是「用户点一下就是钱」：

### 缺陷 1 · 生成中的卡也显示「以相同参数再生成」，点一下再扣一次费

`AssetInspector` 的按钮门控只有 `prov &&`（`AssetInspector.tsx:163`），**该文件全文零处 `status` 判断**。
而 `runGen` 在落占位卡的同时就把溯源挂上去了（`actions.ts:654`，为的是失败时留给重试读，本身正确）。
两者相乘：一张**正在生成**的卡，选中后面板就有那枚按钮。点下去 `asset.status !== 'error'` 成立
→ 走成功卡分支 → `runRetry` 再发一次生成，**无确认、无提示**。

`2026-08-06-retry-lineage-and-no-discard.md` 修 Bug B 时只区分了「成功卡 / 失败卡」，漏了「生成中」——
修复前这一点是「静默删掉在飞卡」，修复后变成「再扣一次费」。

### 缺陷 2 · 孤儿卡上写着「重试」的按钮，会删掉一张仍在飞的付费产物

`2026-08-06-orphan-gen-task-no-delete.md` 的正当性建立在「不删服务端数据、改标失败**并留重试入口**」上。
但那个入口本身会删：`discardFailedCard`（`actions.ts:889-895`）对真实 id **无条件**
`void pgcApi.deleteCanvasItem(pid, assetId)`，不看服务端状态；而孤儿卡的服务端那份**仍是 `generating`**（上一轮刻意不删）。

于是用户按下写着「重试」的按钮 = 删掉一张可能几分钟后就落 ready 的付费产物 + 再付一次积分。
这个可点状态正是上一轮放大出来的：改动前孤儿已被删，不存在「本地 error / 服务端 generating」的可点卡。

### 缺陷 3 · 批量重试对「不可重试」的失败卡照样原样重发

单卡路径刻意分流（`GenErrorBody.tsx:41` 的 `editFirst` → 开预填表单，理由是内容审核类原样重发必然再失败、
不该白等一次甚至再扣一次费），而 `bulk-actions.ts:25` 的 `bulkRetryable` 只排除了 agent 卡与无溯源卡，
**没排除 `failure.retryable === false`** → 批量重试会把单卡路径刻意拦下的那类照样发出去。

### 缺陷 4 · 「落回原位」的判据用错了，于是新卡精确压住旧卡

三条重发路径现在各落各的：

| 路径 | 现状 | 问题 |
|---|---|---|
| 失败卡重试（`retryGeneration` error 分支） | `discardFailedCard` + `pinAt` 精确原位 | 对——原卡真被丢弃，位置刚空出来 |
| 成功卡再生成（`retryGeneration` 非 error 分支） | 不传锚点 | 纯文生卡落到 `getViewportCenter()`，视口还被 `ensureVisible` 拽走 → 用户以为没生效、再点一次、再扣一次费 |
| 表单重试（`openRetryForm`） | 对 error 卡传原卡中心，**却从不丢卡** | 没还原出源卡时 `spawnAt` 生效且首张跳过避让 → 新占位卡**零偏移精确压住**仍在画布上的旧失败卡 |

两条路都拿 `status === 'error'` 当「该占原位」的条件，而正确判据是**「原卡是否被丢弃」**。
`retryGeneration` 修 Bug B 后已隐含用对（成功卡不丢卡 ⟹ 不占位），`openRetryForm` 明明从不丢卡却仍传锚点，
等于把 Bug B 的落位面留在了表单路上。

## 约束

1. **不改后端契约**。四条全在前端。
2. **不新增删除路径、不新增落位算法**：沿用 `requestDeleteAssets` / `placeTarget` / `avoidOverlap`。
3. **本地化留 UI 层**：孤儿失败的原因文案按 code 查 i18n，store 只传 code（沿用 `resolveErrorMessage` 的既有分工）。
4. **不给假入口**：孤儿卡的按钮点下去必须真做事且**不花钱**；做不到就不放那个按钮。
5. **`failure` 不进 `assetReference`**（已核实：它不在 `assetReference` 重建的字段里），故前端自造的失败原因
   不会被回写污染服务端。
6. 铁律：每条缺陷先写复现它的失败测试，红了再改。

## 三个已定的决策（2026-08-07 盘问结论）

1. **P0 七条切成四个回合，按机制切**。本稿是回合 A（缺陷 1/2/3/4）；B = 有损字段可见；
   C = 在飞占位卡跨刷新存活；D = 测试假时钟兜底（chore，无 spec）。
2. **孤儿卡走双保险**：主按钮改「重新检查」（不花钱），**且** `discardFailedCard` 对这类卡一律不发 DELETE。
   只改按钮不够——属性面板那枚「以相同参数再生成」不看 failure code，会绕过卡面入口走到同一个删除。
3. **落位统一成「原卡为锚 + 避让」，判据改成「原卡是否被丢弃」**，不再用 `status === 'error'`。

## 方案

### 1. 新增 `nearAt` 锚点口径（缺陷 4）

> ⚠️ **一处被否掉的初版方案，记下来免得后人重走。**
> 初版打算把 `addGenPlaceholders`（`actions.ts:522`）的 `(opts?.spawnAt || opts?.pinAt) && i === 0`
> 改成只认 `pinAt`，让 `spawnAt` 一律参与避让 —— 一行改动，还顺带修掉多文件拖放重叠。
> **但 `spawnAt` 不避让是刻意的产品决策**：`4bdd54a4 feat: 双击空白处生成资产直接落在点击点,不再避让其他卡片`，
> 并有专测钉住（`actions.test.ts:858`「点击点已被占用也不避让,原位生成」）。那一行会把它悄悄推翻。
> 故改用下面这个不碰既有语义的做法。

`GenPlacement` 增第三个锚点口径，`placeTarget` 里排在 `pinAt` 之后、派生树形之前：

```ts
// nearAt:**左上角**口径,只作落位起点、**恒参与避让**。
// 与 pinAt 的区别是「原卡还在不在」——
//   pinAt  = 原卡已被丢弃,位置刚空出来,精确落回去(视觉上「原地变回 generating」)
//   nearAt = 原卡还在画布上,新卡该出现在它**旁边**,压住它就是骗人
// 与 spawnAt 的区别是避不避让:spawnAt 是「用户点哪就落哪」的精确落点(4bdd54a4),不能改。
nearAt?: XY;
```

```ts
const placeTarget = (opts, placed) => {
  if (opts?.pinAt) return opts.pinAt;     // 精确、不避让
  if (opts?.nearAt) return opts.nearAt;   // 起点、参与避让;同样要高于派生树形,否则又被挪到父卡右侧(C1 同款)
  ...派生树形 / spawnAt / 视口中心级联
};
```

**`addGenPlaceholders` 一行都不用改**：`nearAt` 的调用方不传 `spawnAt`/`pinAt`，
既有判据 `(spawnAt || pinAt) && i === 0` 自然为假 → 走 `avoidOverlap(target)` → 正是「以 `nearAt` 为起点 + 避让」。
双击、拖放、粘贴、空态 chips 的落位语义**完全不动**。

三条重发路径的落点就此由「原卡是否被丢弃」单一判据决定：

| 路径 | 原卡 | 锚点 |
|---|---|---|
| 失败卡重试（`retryGeneration` 走 `discardFailedCard` 且真丢弃） | 已丢弃 | `pinAt` = 原卡左上角 |
| 成功卡再生成 | 还在 | `nearAt` = 原卡左上角 |
| 孤儿卡再生成（决策 2 下不丢弃） | 还在 | `nearAt` = 原卡左上角 |
| 表单重试（`openRetryForm`，从不丢卡） | 还在 | `nearAt` = 原卡左上角 |

表单那条要把锚点透过 `GenFormState` 带到提交处（`genForm.nearAt`，`GenerateForm` 多一个 prop）。
⚠️ **用户拖过弹窗时以拖后位置为准**：`GenerateForm.tsx:302` 既有的「落点跟随弹窗」是显式用户意图，
优先级高于 `nearAt`（实现上：拖过则只传 `spawnAt`，未拖才传 `nearAt`）。

**不在本轮修的**：多文件拖放 N 个文件共用同一 `spawnAt` 导致坐标完全相同（评审已核实，
`AssetCanvas.tsx:146` 那句「由 uploadAsset 内的 avoidOverlap 级联避让」是错的）。初版方案能顺带修掉它，
改用 `nearAt` 后不再免费 —— 它需要把拖放改成按 index 级联，**属拖放那条线的缺陷，不在 P0**，记入后续。

### 2. `discardFailedCard` 回报「有没有真丢弃」（缺陷 2 + 4）

```ts
// 返回值 = 原卡是否真的被丢弃。调用方据此决定新卡占不占原位 ——
// 判据是「原卡是否被丢弃」而不是「原卡是不是失败态」(spec 2026-08-07-retry-path-guards 缺陷 4)
const discardFailedCard = (pid: number, assetId: string): boolean => { ... }
```

三种分支：

| 卡 | 行为 | 返回 |
|---|---|---|
| `pending_` 占位卡 | 本地移除（沿用 `removePlaceholderAsset`） | `true` |
| 孤儿卡（`failure.code === GEN_STATE_LOST`） | **不移除、不 DELETE** | `false` |
| 其余失败卡 | 本地移除 + DELETE 远端（沿用现状：不删的话刷新后 failed item 会被 `loadCanvas` 拉回、和新卡并排杵着） | `true` |

`retryGeneration` 随之改成：

```ts
const discarded = get().discardFailedCard(pid, assetId);
get().runRetry(prov, discarded ? topLeft : undefined, lineage);
```

成功卡分支与失败卡分支就此合并成同一条语句——**决策 2 与决策 3 在这里天然合流**：
孤儿卡「不丢弃」⟹「不占原位」⟹ 新卡落它旁边，一致且不需要额外分支。

### 3. 孤儿失败挂专属 code + 卡面换「重新检查」（缺陷 2）

`restoreGenTasks` 的孤儿兜底从 `markAssetsFailed(orphanIds, null)` 改为挂一个**前端自造**的失败原因：

```ts
// 前端自造(非后端下发):孤儿的真实情况不是「生成失败」,而是「我们接不回这个任务的状态」——
// 两者的正确应对完全不同(后者换回原设备、或过一会儿再看可能就好了)。
// code 域与后端不冲突(后端是 PROVIDER_CONTENT_POLICY_VIOLATION 这类);message 留空由 UI 按 code 查 i18n
export const GEN_STATE_LOST = 'GEN_STATE_LOST';
markAssetsFailed(orphanIds, { code: GEN_STATE_LOST, category: 'client_state', message: '', retryable: true });
```

`GenErrorBody` 按 code 分流：

- 文案：`canvas.genStateLost`（「暂时读不到这次生成的状态」），而非通用的 `canvas.genError`；
- 按钮：`canvas.recheck`（「重新检查」），点击走新 action `recheckAsset(assetId)` —— **不花钱**：
  清掉本地失败态 → `loadCanvas()` 让服务端状态说话。服务端已落终态就跟着变（ready 出图 / failed 显示真实原因）；
  仍 `generating` 则**就地只复判这一张卡**（仍接不回任务即标回孤儿失败态）。
⚠️ 初稿写的是「由 `restoreGenTasks` 的同一套判据重新标回」，采纳评审 I2 后已改 —— 整表跑那个函数会把全项目在飞任务的 `fails` 清零、退避清空。行为等价，但读 spec 的人会去找一个不存在的调用（终审 Minor 3）。

⚠️ **`loadCanvas` 的 `stuckFailed` 规则要让路**：它的语义是「服务端仍 generating 而本地已判失败 → 保住本地失败态」，
正是为了防孤儿卡被翻回转圈。`recheckAsset` 必须先把本地失败态清掉再拉，否则 `stuckFailed` 会把刚清的又按回去，
按钮就成了假入口（违反约束 4）。

**为什么不做「重新挂轮询」**：四类异步生成（`vid-`/`m3d-`/`rig-`/`tex-`）现在都能被 `DISCOVERABLE` 接回，
所以剩下的真孤儿是 `img-`/`aud-` 这类**没有可反推 task_id** 的卡，无任务可挂。重拉画布是这类卡唯一能做且有意义的事。

### 4. 生成中不给点（缺陷 1）

`AssetInspector` 的按钮加前置门控，与 `GenErrorBody` 的 `canRetry` 同款写法：

```ts
const busy = asset.status === 'generating';   // 覆盖 pending_ 占位卡与服务端 generating 卡
```

`busy` 时 `disabled` + `Tooltip`（`canvas.inspector.regenerateBusy`：「生成完成后才能再生成」）。
**不隐藏按钮** —— 隐藏会让面板在生成前后跳一下，且用户看不出「等会儿就能点」。

### 5. 批量重试排除不可重试（缺陷 3）

```ts
export const bulkRetryable = (assets: Asset[]): BulkCapability =>
  summarize(assets, (a) => a.status === 'error' && !!a.provenance
    && a.provenance.agent !== true
    // retryable === false(内容审核类)单卡路径是「开预填表单让用户先改」,
    // 批量下没有这个降级(N 张只能开出一个表单),故只能跳过 —— 照发必然再失败且再扣一次费
    && a.failure?.retryable !== false);
```

被排除的卡**只体现在菜单标签的计数上**（`Retry N failed` 里的 N 已扣掉它们），不额外做 UI。
⚠️ 订正：批量重试这条路径**没有**结束 Toast（`doneMessage` 只有批量下载在用），所以不存在「跳过 M 个」的汇报口径 —— 初稿那句是照搬下载那条写的，不成立（终审 Minor 2）。

## 成功标准

1. 选中一张**生成中**的卡（占位卡与服务端 generating 卡各一），属性面板的「以相同参数再生成」为
   `disabled` 且有 Tooltip；点击不发任何生成请求。
2. 孤儿卡（本地 error + `failure.code === GEN_STATE_LOST`）上按钮文案是「重新检查」，点击**不发生成请求**、
   **不发 DELETE**，只重拉画布。
3. 服务端在此期间落了 ready → 「重新检查」后卡变成正常资产；仍 generating → 卡回到同一失败态（不永久转圈）。
4. ~~对孤儿卡从属性面板点「以相同参数再生成」→ **不发 DELETE**、原卡仍在画布上，新卡落在它**旁边**（不重合）。~~
   ⚠️ **本条已于 2026-08-11 被推翻**，见 `2026-08-11-retry-single-routing.md` C3（Nick 拍板）：
   属性面板对孤儿卡改走**免费的「重新检查」**，不再发付费重发。
   推翻理由不是这条行为本身有错（它当初验收过，且确实不删远端），而是**同一张卡卡面写
   「重新检查」、面板写「以相同参数再生成」，两个入口给相反的答案**；孤儿的定义就是
   「服务端那份仍在飞」，此时该做的是再问一次状态而不是再买一份。
5. 普通失败卡重试 → 行为不回退：原卡丢弃 + 发 DELETE + 新占位卡**精确落回原位**。
6. 成功卡点「以相同参数再生成」→ 原卡还在、不发 DELETE、新卡落在原卡**旁边**（不再跑到视口中心）。
7. 表单重试（`openRetryForm`）对失败卡 → 新卡落在旧失败卡**旁边**，不再零偏移压住它。
   > ⚠️ 2026-08-14 起改为**占原位**：失败卡的表单重试在提交时丢弃原卡（`takeGenFormReplacement`），
   > 新卡精确占回它的位置。本条当初要解决的是「两张卡零偏移重合」，而原卡既已消失就不存在重合；
   > 成功卡走这条路时仍落**旁边**、原卡不丢（成功标准 6 不变）。见
   > `2026-08-14-retry-form-replace-card.md`。
8. 批量重试的计数与执行都排除 `failure.retryable === false` 的卡，它们计入跳过数。
   > ⚠️ 判据已于 2026-08-13 改为 `failure.category === 'content_policy'` —— 按 `retryable` 排除在真机上等于没排除
   > （内容审核类恒 `retryable: true`），见 `2026-08-13-retry-route-content-policy.md`。
9. 双击空白处新增仍**精确落在点击处**，即使该处已有卡（回归 —— `4bdd54a4` 的既有决策不得被本轮推翻）。
10. 拖放落点、粘贴、空态 chips 的落位行为一字不变（回归）。
11. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 取舍与明确不做

- **不做「再生成」的二次确认**：付费动作的护栏本轮走「不可点 / 不删数据 / 落位不骗人」三条，
  加确认框会把成功卡的「再来一张」也拖慢。若真实使用中仍有误点，再单独立项。
- **不改成功卡的按钮文案**（评审建议「再生成一张 / Generate another」）：那是 11 语言词条 + UI 打磨，
  与本轮的行为修复不同性质，留给回合 B 一起做（那轮本来就要动面板与词条）。
  ⚠️ 本轮修完后「行为已变、文案未变」的窗口仍在，是**有意保留的已知缺口**，不是遗漏。
- **不重构落位口径的类型**：评审指出 `pinAt`/`spawnAt`/`sourceItemId` 同居一个 `GenPlacement`、
  单位不同只靠注释区分，建议做成判别联合或给 XY 加 `TopLeft`/`Center` 品牌类型。本轮把口径从三个收敛回两个
  且写清注释，类型级重构另开一轮（它会碰到全部生成入口，与本轮的护栏性质不同）。
- **不给孤儿卡自动轮询**：见方案 3 的说明，那类卡没有可反推的 task_id。
- **不动 `stuckFailed` / `alivePlaceholders` 的保留规则**：本轮只让 `recheckAsset` 显式绕过 `stuckFailed`，
  规则本身不改（它们归回合 C 与后续的 `reconcileCanvas` 抽取）。
