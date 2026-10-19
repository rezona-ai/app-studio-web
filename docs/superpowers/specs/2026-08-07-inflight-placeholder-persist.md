# 在飞占位卡跨刷新存活：别让一次刷新吞掉付了钱的生成

> 状态：设计稿 · 2026-08-07
> 分支：`fix/inflight-placeholder-persist`（P0 回合 C / 共四回合；A、D 已回合 dev，B 经盘问后**整轮取消**，见末节）
> 关联：`2026-08-06-gen-task-deadline-and-placeholder.md`（把 `loadCanvas` 整表替换会抹掉在飞占位卡这条修了，
> 但只覆盖**同一次会话内**；刷新这条它自己在「未验到」一节里点名了）、
> `2026-08-07-retry-path-guards.md`（回合 A，`alivePlaceholders` 保留规则的现有形态出自那两轮）

## 目的

**35 分钟等待窗口内刷新一次页面，那次付了钱的异步生成就彻底消失，连一条 Toast 都没有。**

这是 `2026-08-06` 那轮 4.9K credit 事故的**完整复现路径**，且比原事故更静默——原事故至少还弹了一个 4 秒 Toast。

### 链路（已对着代码核实）

> ⚠️ **只在 agent 路径**（评审 M1 订正）：用户自发起的 `POST .../generate/{video,model3d}` 是
> **服务端建好 generating 占位卡后连 item 一起返回**的（`pgc-server/docs/api/canvas.md:788`、`:814`），
> 对应 `startAsyncGen` 在 `!task.item` 时直接判失败，产生不出 `pending_` 任务。
> `item=null` 只对 agent 委托的 `gtask-*` 成立（`:1168`、`:1365`），全仓唯一造得出
> 「`pending_` 卡 + GenTask」的写点是 `registerAgentGenTask`。

```
agent 在对话里提交 video 或 3D
  → POST 返回,但 pgc 此刻 item 仍为 null(canvas.md 明写:generating 时无 item,前端保留占位卡)
  → 前端落 pending_xxx 占位卡 + commitGenTasks 登记 GenTask(itemId: 'pending_xxx')
     ↑ genTasksByProject 是持久化的,任务本身**不会**丢
  → 用户刷新页面
  → assets **不进 persist** → 占位卡没了;loadCanvas 只带回服务端 item,里面没有它
  → restoreGenTasks 用 `assetsById.get(t.itemId)?.status === 'generating'` 过滤(actions.ts:150)
     → 卡不存在 ⟹ 该任务被当成「已完成/已删的持久化残留」剪掉
  → 轮询再也不会推进它;画布上什么都没有;用户不知道钱花哪去了
```

**关键点是「任务没丢、卡丢了，然后任务因为卡丢了而被剪掉」** —— 修的不是持久化任务（那已经有了），
是让**被任务引用的那张占位卡**一起活过刷新。

### 为什么不能靠别的机制兜住

- `agentTasksByProject`（agent 触发去重表）是**持久**的，所以对话重放**也不会**重新登记这个任务 ——
  它本是防重复登记的，在这里恰好把最后一条退路也堵死了。
- `DISCOVERABLE`（回合 A 那轮的对称发现）只认服务端真实卡的 `vid-`/`m3d-`/`rig-`/`tex-` 前缀；
  `pending_` 卡在服务端**没有对应 item**，画布上无迹可寻。
- 上一轮的 `alivePlaceholders` 保留规则只解决「同一次会话内 `loadCanvas` 整表替换抹掉它」，
  刷新后 `get().assets` 本身就是空的，它无从保留。

## 约束

1. **只救「在飞且有 live GenTask」的占位卡**（2026-08-07 盘问结论）。不含：
   - **失败态占位卡** —— 持久化它会推翻 `2026-08-03-canvas-gen-failure-retry` 约束 3 的刻意决策
     （那轮明确接受「无服务端 item 的失败卡刷新后消失」，理由是失败卡的价值是即时的）；
   - **同步生成（image / audio）的在飞占位卡** —— 它们不登记 GenTask，且服务端此刻已建出 item，
     刷新后 `loadCanvas` 会把真实卡带回来，只是落位退化成兜底网格。不丢东西，不在本轮。
2. **不持久化整个 `assets`**。仓库反模式明列「持久化瞬态」；本轮持久化的是**一小片有明确生命周期的东西**，
   与 `genTasksByProject` / `importQueueByProject` 同性质（后者注释就写着「页面中断后下次进入项目续跑」）。
3. **单一写入口**：沿用 `commitGenTasks` 那套「内存工作切片 + 按项目持久化映射同步更新」的既有形状，
   不新增第二个写点、不在 `partialize` 里现算。
   > 为什么不在 `partialize` 里由 `assets ∩ genTasks` 派生（那样天然自愈、无需清理）：
   > persist 是**节流写**，刷新后 `loadCanvas` 落地前 `assets` 是空的，那期间任何一次写盘都会把
   > 持久化的占位卡清成空 —— 派生式持久化要求源在写的那一刻是权威的，这里不满足。
4. **不得复活用户删掉的卡**：删除生成中的卡会把它的 GenTask 一并摘掉（`removePlaceholderAsset`），
   而快照跟着 `commitGenTasks` 走 ⟹ 任务没了，快照里也就没了。这条不变式必须显式测到。
5. **不改后端契约**。
6. 铁律：先写复现该缺陷的失败测试。

## 方案

### 1. 快照跟着任务走

`ServerState` 增持久化映射（进 `partialize` 白名单，与 `genTasksByProject` 并列）：

```ts
// 在飞占位卡快照:被 genTasks 引用的 pending_ 卡,按项目存。
// assets 整体是瞬态(刷新后以服务端为准),但这一小片不是 —— 它代表一次**已付费、仍在跑**的生成,
// 服务端此刻还没有对应 item(pgc: generating 时无 item),丢了就再也接不回来
inflightCardsByProject: Record<string, Asset[]>;
```

`commitGenTasks` 是唯一写点，顺带算快照：

```ts
const commitGenTasks = (next: GenTask[]) => {
  const pid = get().currentProjectId;
  if (pid == null) { set({ genTasks: next }); return; }
  const referenced = new Set(next.map((t) => t.itemId));
  // 只快照占位卡:真实 item 刷新后由 loadCanvas 带回,不必也不该由前端存一份
  const cards = get().assets.filter((a) => isPlaceholderId(a.id) && referenced.has(a.id));
  set({
    genTasks: next,
    genTasksByProject: { ...get().genTasksByProject, [String(pid)]: next },
    inflightCardsByProject: { ...get().inflightCardsByProject, [String(pid)]: cards },
  });
};
```

清理是**自动的**：任务终结（adopt / 失败 / 用户删卡）都会调 `commitGenTasks` 落一份新任务表，
快照随之重算 —— 不需要第二个清理点，也不会残留。

### 2. 恢复：在 `restoreGenTasks` 剪枝**之前**把卡放回去

`selectProject` 的既有顺序是 `await Promise.all([loadCanvas(), loadVersions()]); restoreGenTasks(id);`。
`loadCanvas` 会把 `assets` 整表替换成服务端结果（其中没有占位卡），所以放回的动作必须在它之后、
`restoreGenTasks` 的剪枝之前 —— 即 `restoreGenTasks` 的**第一步**：

```ts
// 刷新后 assets 是服务端那份,在飞占位卡不在其中,下面的剪枝会把它的任务误当残留剪掉。
// 先按持久化快照把它接回来(只接**仍被持久化任务引用**的,且当前 assets 里没有的)
const savedCards = get().inflightCardsByProject[String(pid)] ?? [];
const wanted = new Set(saved.map((t) => t.itemId));
const have = new Set(get().assets.map((a) => a.id));
const revived = savedCards.filter((c) => wanted.has(c.id) && !have.has(c.id));
if (revived.length) set({ assets: [...get().assets, ...revived] });
```

放回之后，既有的 `restored` 剪枝就能命中（卡在、且 `status === 'generating'`），任务被保住，
`useCanvasPolling` 接着推进；产物回来由 `adoptAgentItem` 原位替换；超过 `DEADLINE_MS` 则就地转失败态。
**回合 A 的 `alivePlaceholders` 保留规则接着生效**，后续后台刷画布不会再抹掉它。

### 3. 已知取舍

- **快照里的坐标与归属可能过时**：坐标见下；`groupId` 同理 —— 拖入/拖出框、删框都不触发
  `commitGenTasks`，刷新后接回的卡带回旧归属，极端情况指向已被删掉的框（终审建议 2）。
  不阻塞：仓库对「悬空 `groupId`」本就是已知且容忍的状态（`actions.ts` 的 `tidyCanvas` 显式放行这类卡）。
- **坐标**：用户在生成期间拖动过那张占位卡，而快照是 `commitGenTasks` 那一刻拍的，
  刷新后卡回到原始落点。代价是一次小位移，不值得为它加第二个写点（拖拽落库路径不认识 genTasks）。
- **快照是整份 `Asset`**（含 `provenance` / `parentId` / `refIds`）：正是为了让溯源与血缘一起活过刷新 ——
  只存 `{id, kind, position}` 的话，恢复出的卡会丢掉「以相同参数再生成」和连线，等于换一种方式丢东西。
- **`localStorage` 体积**：一个项目同时在飞的异步任务是个位数，每张卡是个小对象，
  与已持久化的 `koubouByProject`（对话快照）不是一个量级，不加上限。

## 成功标准

1. agent 提交一个异步生成（占位卡 + GenTask 已登记；用户自发起那条拿得到 item，不在此列）→ **刷新页面** → 占位卡回到画布上、仍转圈，
   且 `genTasks` 里那条任务还在（此前：卡与任务一起消失）。
2. 恢复出的卡带回 `provenance` 与血缘（`parentId` / `refIds`），不是一张裸卡。
3. 恢复后轮询接着推进：产物 ready → 原位替换成真实卡；超时 → 就地转失败态（不是凭空消失）。
4. **用户删掉生成中的卡后刷新 → 不得复活**（GenTask 随删除被摘掉 ⟹ 快照里也没有）。
5. 任务终结（adopt 成功 / 失败）后刷新 → 不残留幽灵占位卡。
6. 切项目再切回 → 只恢复该项目自己的在飞卡，不串项目。
7. 同步生成（image / audio）的在飞占位卡**行为不变**（不持久化、刷新后由 `loadCanvas` 带回真实卡）。
8. 失败态占位卡**行为不变**（刷新后消失，`2026-08-03` 那条决策不被推翻）。
9. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 明确不做

- **持久化失败态占位卡** —— 见约束 1。
- **同步生成在飞卡的持久化** —— 见约束 1。
- **在任务终结且无真实 item 时把 taskId 从 `agentTasksByProject` 摘掉**（评审 f19 的建议）：
  本轮修好后卡与任务都活过刷新，轮询自己会推进到终态，不再需要靠对话重放重新登记。
  留着那条建议只会多一条与本方案重叠的路径。
- **快照随拖拽更新坐标** —— 见「已知取舍」。
- **给恢复出的卡加「已恢复」视觉标记** —— 它和刷新前是同一张卡，标记只会让人以为出过错。

## 附：回合 B 为何整轮取消（2026-08-07，盘问 + 真机核实）

回合 B 原定「让有损字段可见」，核心痛点是 agent 卡的 `transparent` 丢失导致
「照面板参数再生成得到不透明的图且真花钱」。**核实后这个前提不成立**：

1. pgc 的画布图片生成**支持 `transparent` 一等参数**（`app/schemas/canvas_gen.py:68`，PR #262 `ed560a2`），
   与非法的 `background=transparent` 是两个不同字段 —— 我一开始把它们混为一谈了。
2. 更关键：**不传该参数时，pgc 按 prompt 的背景意图关键词自动检测**
   （`app/services/image_transparency.py:64` 的 `resolve_transparent`：显式值覆盖，否则匹配
   「透明背景 / 背景透明 / 无背景 / 去背景 / 抠图」等 CJK 短语与 `transparent background` 等英文短语）。
3. 真机 A/B 坐实（pgc dev，项目 1633）：提示词含「透明背景」且**不传**该参数 → `transparency_applied: true`；
   提示词不含任何短语 → `false`。

而 `provenance.req.prompt` 是**原样保存**的 ⟹ 只要原提示词带了触发短语，「以相同参数再生成」
自动就会重现透明底。agent 溯源那轮的真机案例（提示词「像素风的小飞船图标，透明背景」）正属此列。

残留缺口只在**显式参数与提示词不一致**时出现（显式 `true` 而提示词无短语 → 丢；
显式 `false` 而提示词有短语 → 反而多出透明底，「透明的玻璃杯」被抠成镂空）。
严重度远低于回合 C，**Nick 决定整轮不做**。

⚠️ 顺带发现 pgc 文档自身一处过期残留：`docs/api/canvas.md:749` 写「当前 pgc 没有透明背景生成能力」，
出自 PR #147（`bb79f68`），早于引入该能力的 PR #262；同文件 698/700/857 行才是现状。
**属 pgc 仓库的文档债，本仓不改，已在此记录。**
