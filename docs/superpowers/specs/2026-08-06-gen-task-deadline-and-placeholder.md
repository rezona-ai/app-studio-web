# 慢异步生成:前端别提前放弃，占位卡别凭空消失

> 状态：设计稿 · 2026-08-06
> 关联：`2026-08-04-canvas-task-visibility.md`（「生成中 N」药丸与任务列表）、
> `2026-08-06-agent-asset-provenance.md`（本轮问题是那一轮**真机验收时撞出来的**，见其「未验到」一节）

## 目的

真机实测（2026-08-06，项目 1055）：让 agent 生成一个 3D 宝箱，最终**画布上什么都没留下**，
而这次消耗约 4.9K credit。复盘出的链路是两个独立缺陷叠在一起：

```
agent 提交 3D → registerAgentGenTask 落占位卡,首拉 item:null → GenTask 登记 itemId: pending_bO8LhK8R
     ↓
run.finished → loadCanvas 整表替换 → 占位卡消失（服务端此刻没有对应 item）
     ↓
10 分钟到（DEADLINE_MS）→ failGenTask('pending_bO8LhK8R') → markAssetsFailed 打空，没有卡可标
     ↓
只弹了一个 4 秒 Toast；上游其实到约 20 分钟才转 failed —— 前端早已不看了
```

### 缺陷 A · 前端 10 分钟就放弃，比后端的保证短得多

`DEADLINE_MS = 10 * 60 * 1000`（`actions.ts:104`）。而 pgc 契约（pgc-server `docs/api/agent.md:37`）写明：

> 任务最长存活 `AGENT__TASK_TIMEOUT_SECONDS`（默认 **30 分钟**），超时仍未完成统一置 `failed`
> —— **任何任务最终必达 `ready`/`failed` 终态**

也就是说后端保证会给答案，而前端在答案到来之前就撤了。慢的 3D（Tripo 分钟级、排队时更久）
恰好落在这 20 分钟的盲区里：用户付了钱，前端却当它不存在。

### 缺陷 B · 在飞占位卡被整表替换抹掉，超时时无卡可标

`loadCanvas` 是 `set({ assets: canvasItemsToAssets(data.items, ...) })` —— **整表替换**。
`pending_*` 占位卡在服务端没有对应 item，于是每次后台刷画布（`run.finished` 后必刷）都会抹掉它。
`GenTask.itemId` 仍指向那个已不存在的 id，最终 `markAssetsFailed` 打在空处。

这两条必须一起修：只延长等待，超时时依然没有卡可以变成失败卡；只保住卡，仍会在 10 分钟被放弃。

## 约束

1. **等待上限对齐后端契约**：取 35 分钟 = 契约默认 30 分钟 + 5 分钟余量（网络 / 排队抖动）。
   不取更大值 —— 后端保证 30 分钟必达终态，超出即视为异常，继续等只是让转圈卡永远转下去。
2. **保留占位卡的判据用 `genTasks`，不用 `inflight`**：删除生成中的卡会把它的 GenTask 一并摘掉
   （`actions.ts:941` 的 `keptTasks` 过滤）→ 「GenTask 还在」天然等价于「用户没删它」，
   不会复活用户刚删掉的卡。这条不变式必须在实现里显式测到。
3. **不破坏「占位卡消失 ≠ 用户删除」**：既有代码刻意不用占位卡存活倒推删除意图
   （`doUploadAsset` 的注释），删除意图只经 `markInflightDeleted` 显式登记。本轮只让占位卡活得久些，
   不引入任何「按存活推断」的逻辑。
4. **只保留会真正丢东西的那类**：同步生成的**在飞**占位卡不受影响（仍会被抹）——
   `settleGenPlaceholders` 是 **append**（`set({ assets: [...get().assets, ...placeAndLink(...)] })`），
   占位卡被抹掉也不影响真实卡落地，最多闪一下。
   但它的**失败卡**由 §2 的第 ② 类（`status === 'error'`）一并保住 —— 那类此前同样活不过一次后台刷新。
5. **不加轮询退避**：间隔 10s 且 visibility-gated（`useCanvasPolling`），35 分钟最多约 210 次
   幂等廉价读，且只在标签页可见时打。为此引入退避不值得。
6. 不改后端契约。

## 成功标准

1. `DEADLINE_MS` = 35 分钟，注释引用 pgc 契约（`agent.md` 的 `AGENT__TASK_TIMEOUT_SECONDS` 默认 30 分钟）。
2. `loadCanvas` 整表替换后，**被 `genTasks` 引用的 `pending_*` 占位卡仍在画布上**（继续转圈）。
3. 服务端返回的真实卡与被保留的占位卡**不重复**（两者 id 域不同，不得出现两张卡）。
4. 用户删除生成中的卡（GenTask 随之摘除）→ 后续 `loadCanvas` **不得**把它复活。
5. `adoptAgentItem` 拿到真实 item 时，被保留的占位卡照常被原位替换、不残留。
6. 超时兜底命中时，那张占位卡**就地转失败态**（带失败原因与重试入口），而不是凭空消失。
7. 既有行为不回退：延迟删除的 `doomed` 过滤、坐标 / 血缘 / 溯源 / 归属的「服务端缺失时取本地」、
   `restoreGenTasks` 刷新后重连，全部照旧。
8. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 方案

### 1. 常量对齐契约（缺陷 A）

```ts
// actions.ts
// 后端保证任何任务 ≤ AGENT__TASK_TIMEOUT_SECONDS(默认 30 分钟)必达 ready/failed 终态
// (pgc docs/api/agent.md)。前端取 35 分钟 = 30 + 5 余量:比后端短就会在答案到来前撤走,
// 慢的 3D(Tripo 排队时可达十几分钟)会落进盲区 —— 用户付了钱而画布上什么都没有
const DEADLINE_MS = 35 * 60 * 1000;
```

### 2. 整表替换保住在飞占位卡（缺陷 B）

`loadCanvas` 的 `set` 改成在服务端映射结果之后，把「仍被 `genTasks` 引用的 `pending_*` 卡」接回去：

```ts
// 留两类:① 还被 genTasks 引用的(在飞);② 已转失败态的
const polling = new Set(get().genTasks.map((t) => t.itemId));
const alivePlaceholders = get().assets.filter(
  (a) => isPlaceholderId(a.id) && (polling.has(a.id) || a.status === 'error'),
);
```

判据用 `genTasks` 而非「是不是 `pending_`」：删除生成中的卡会把它的 GenTask 一并摘掉，
故「任务还在」= 用户没删它。两类都只是 `get().assets` 的**子集** ——
只能留住已在表里的卡，结构上不可能复活用户删掉的卡。
落位与身份都不用管：占位卡的坐标归前端所有、id 域（`pending_*`）与服务端 id 天然不撞。

> ⚠️ 第 ② 类是评审补上的（Important 1）：`failGenTask` 标失败的**同时就摘掉了 GenTask**，
> 只看第 ① 类的话，下一次刷画布会把刚转成失败的那张卡又抹掉 —— 「凭空消失」只是被推迟一步。
> 同步生成失败卡（`runGen` 的 `markAssetsFailed`）同属第 ② 类，一并保住。
>
> 已知取舍（终审 M2）：`failGenTask` 摘掉 GenTask 后就没有 adopter 了 —— 若 pgc 在那之后才为
> 该任务建出真实 item，下一次 `loadCanvas` 会把真实失败卡带回，而 `pending_*` 失败卡因第 ② 类
> 永久留着 → **一次生成看到两张失败卡**。改动前是「只剩一张、但在飞时凭空消失」。
> 选后者：多一张可删的卡（走占位卡分支纯本地移除，不会 404）好过什么都不剩。

### 3. 超时时那张卡就地转失败（缺陷 B 的下半）

`failGenTask` 不改 —— 占位卡活着时 `markAssetsFailed([itemId])` 自然命中。
成功标准 6 由第 2 点的**两类**共同满足（第 ① 类保住它活到超时那一刻，第 ② 类保住转失败之后），
并有专测钉住整条链（`loadCanvas → pollGenTasks 超时 → 再 loadCanvas 一次`）。

## 明确不做

- **同步生成 / 上传占位卡在「在飞（generating）态」的保留**：见约束 4，它们不会丢东西，最多闪一下。
  要做得连 `inflight` 一起纳入判据，边界变大，单独一轮。（它们的**失败态**已被 §2 第 ② 类覆盖。）
- **轮询退避**：见约束 5。
- **任务超时后自动重发**：后端置 `failed` 是终态，自动重发等于替用户决定再花一次钱。
  失败卡上已有重试入口。
- **「已等 X 分钟」文案改成 35 分钟口径的进度提示**：`GeneratingPlaceholder` 已显示已等时长
  （`2026-08-04-canvas-task-visibility.md`），本轮不动文案。
- **`AGENT__TASK_TIMEOUT_SECONDS` 若被运维改大**：前端不做自适应（后端不暴露该配置），
  35 分钟是按默认值定的；若后端改配置，这里要跟着改，注释里写明这层耦合。

## 真机验收（2026-08-06，dev :3011 打 pgc dev，项目 1055）

**手法说明（如实交代）**：被测的是 `loadCanvas` 的整表替换分支，占位卡从哪来不影响它。
真跑一次异步生成要花数千 credit（同日那次失败的 3D 就消耗约 4.9K），故按
`2026-08-04-canvas-task-visibility.md` 同款做法：**直接种 store 态（占位卡 + GenTask，
形状与 `registerAgentGenTask` 写入的一致）+ 调真实 action 打真实 pgc dev**，
而不是 mock 掉 `listCanvasItems`。

| 场景 | 结果 | 证据 |
|---|---|---|
| 在飞占位卡（GenTask 引用它）→ 真实 `loadCanvas` | ✅ 仍在 | `{仍在: true, status: 'generating', 坐标: {x:999,y:888}}`，且服务端 7 张真实卡照常带回（总 8 张，不重复）|
| 该卡转失败态且 GenTask 已摘（超时后的真实形态）→ 再刷一次 | ✅ 仍在 | `{仍在: true, status: 'error', failure: 'GEN_FAILED'}` —— 评审 Important 1 修复的确认 |
| 孤立占位卡（无任务、非失败）→ 刷一次 | ✅ 被抹掉 | `{仍在: false}`，保留逻辑不越界（约束 4）|

### 未验到（如实记录）

- **完整的慢任务链路**（真实提交 → 20 分钟 → 35 分钟阈值 → 失败卡）：要复现得有一个恰好慢于
  10 分钟又快于 35 分钟的真实任务，撞不撞上不由前端决定；且每次尝试消耗数千 credit。
  上游那次 3D 实测约 20 分钟才转 `failed`，正落在新旧阈值之间 —— 但那次是在本轮改动**之前**跑的，
  不能算作本轮的验证。阈值本身由单测的上下界夹逼覆盖（11 分钟仍在等 / 36 分钟转失败）。
- **验收期间不要刷新页面**：`restoreGenTasks` 以 assets 为准剪除任务，而 assets 不进 persist ——
  35 分钟窗口内刷新会让占位卡与其 GenTask 一起丢失，容易被误判成「修复无效」。
  ⚠️ **比这更糟**（终审 I1 指出，我原先写的「不丢资产」是错的）：刷新后若 pgc 已建出那张仍
  `generating` 的真实 item，`restoreGenTasks` 的孤儿兜底会把它当失联任务处理 —— 从画布移除
  **并主动 `deleteCanvasItem`**（`actions.ts:157`）。因为 `discovered` 只认 `rig-`/`tex-` 前缀，
  **不认 agent 异步的 `vid-`/`m3d-`**，恢复不出对称的任务。这是既有缺陷、本轮未引入也未加剧
  （暴露窗口取决于 pgc 返回 `item:null` 的时长，与 `DEADLINE_MS` 无关），**留作后续一轮**：
  给 `discovered` 补 `vid-`/`m3d-` 的对称发现规则，或让孤儿兜底跳过创建时间在 `DEADLINE_MS` 内的 item。
