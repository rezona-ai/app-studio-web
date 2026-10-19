# 实现计划：刷新后恢复回合模型名与子代理卡片

spec：`docs/superpowers/specs/2026-08-24-refresh-restore-turn-model-and-subagents.md`
分支：`fix/refresh-restore-turn-model-and-subagents`（worktree 隔离）

两个问题根因独立，实现上也互不依赖：T1 单独可交付（问题 1 全解），T2–T4 是问题 2 的
「并存加新 → 原子切换」三步。每个任务先写失败测试再改生产代码，逐个 commit。

## T1 重建期回填当前轮 model（`src/koubou/apply-koubou.ts`）— TDD

先写失败测试（`apply-koubou.test.ts` 新增 describe「刷新后重建的回合模型名」），
即 spec 根因表里的 C / D / E 三场景 + 已绿的 A / B 作为回归护栏：

- C：无快照轮 + `run.started` 在页外 → `seedHistory` 后 `state.model` 已由页内 `SystemMessage`
  写回，`reopenRun` 补建的轮带模型名；
- D：无快照轮 + `run.started` 在页内 → 该轮 model 来自其后的 `SystemMessage`；
- E：快照停在上一轮、页内是新 run 的 `run.started` → 新轮带模型名，**旧轮的 model 不被改写**；
- 回归：`prependHistory`（向上翻旧页）**不得**用旧页的 model 覆盖 `state.model`。

生产改动：
1. `rebuild()` 遇 `SystemMessage` 时，除更新局部 `model` 外，一并 `patchTurn({ model })` 回填当前轮
   （口径与 `reconcileAssistant` 一致：存在即覆盖，`run.started` 后的 init 帧是该轮权威）；
2. `rebuild()` / `historyFields()` 把扫出的会话级 `model` 一并返回；
3. `seedHistory()` 把它写回 `state.model`（**只补/覆盖非空值**，页内无 `SystemMessage` 时不清空现值）；
4. `prependHistory()` 显式**不**接收该字段（同 `tasks` / `subagents` 的既有取舍：旧页不覆盖现值）。

验证：`pnpm exec vitest run src/koubou/apply-koubou.test.ts`。

## T2 卡片落盘的纯逻辑（`src/store/persist-storage.ts` + `src/lib/subagent-tasks.ts`）— TDD

先写失败测试：
- `capPersistedSessions`：`cards` 超 `PERSIST_MAX_SUBAGENT_CARDS` 时切尾留最近 N 张；未超限原样透传；
  落盘投影**剥掉 `lastToolName`**（spec 约束 7）；老快照缺 `subagents` 字段不抛错、按原样透传。
- 新增纯函数 `sealStaleCards(st: SubagentState, activeRunId: string | null): SubagentState`
  （`src/lib/subagent-tasks.ts` + 同目录测试）：把**不属于** `activeRunId` 的非终态卡收成
  `ended_without_terminal` + `sealReason:'unknown'`；`activeRunId` 为 null 时收全部非终态卡；
  `runId == null` 的卡一律收（沿用 `sealRun` 的既有取向：留一张永久转圈的卡比多收一张更糟）；
  已是终态的卡不动（幂等）；无变化时返回原引用（避免无谓重渲）。

此步只加纯函数与裁剪逻辑，**尚未接线**，行为不变。
验证：`pnpm exec vitest run src/store/persist-storage.test.ts src/lib/subagent-tasks.test.ts`。

## T3 接进会话快照（`src/store/types.ts` / `index.ts` / `client/*`）— 原子切换

- `PersistedSession` 增 `subagents?: SubagentState`（**可选**，老快照兼容）；
- 三处写快照点补字段：`store/index.ts:585`、`client/useKoubouConnection.ts:158`、
  `client/useReplayPlayer.ts:79`（三处都写才不会互相回退成缺字段的旧快照）；
- `switchProjectSession` 载入 `saved?.subagents ?? createSubagentState()`；
- `partializeAppState` 走 T2 的裁剪 + 剥离投影；
- 改写 `store/subagent-view.test.ts` 的守护断言：从「不进持久化切片」改为「进切片、且落盘投影
  不含 `lastToolName`、cards 有上限」；`planView` 不落盘的断言保持不变。
- `types.ts:151` 的注释同步改写，写清新口径与它依赖的收口通道（否则下一个人照旧注释又把它删了）。

验证：`pnpm exec vitest run src/store src/lib/subagent-tasks.test.ts` + `pnpm exec tsc --noEmit`。

## T4 REST 权威校正接线（`src/store/index.ts` `trackActiveRunViaRest`）— TDD

先写失败测试（`store` 层，注入假 `koubouApi.listSessions`）：
- 快照恢复出 2 张 running 卡（run A）+ REST 回 `active_run_id = A` → 两张卡保持 running；
- 同上但 REST 回 `active_run_id = null` → 两张卡收成 `ended_without_terminal`；
- 同上但 REST 回 `active_run_id = B` → A 的卡收口，B 的卡不受影响。

生产改动：在 `trackActiveRunViaRest` 里，**拿到 `session` 之后、任何 `return` 之前**调用
`sealStaleCards(activeRunId)`。位置是关键 —— 现有代码在 `!runId || isWsOwned(runId)` 处早退
（`index.ts:614`），把校正写在早退之后，「无活跃 run」和「WS 已接管」这两种最需要收口的情形
恰好一次都不会执行。

验证：`pnpm exec vitest run src/store`。

## T5 合并后全量验证

`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`，
输出与退出码贴回本文件末尾。合并前派干净上下文子代理按 commit 范围独立评审（只给 spec 与 diff）。

### 验证输出（2026-08-24，分支 `fix/refresh-restore-turn-model-and-subagents`，T1–T4 全部落地后）

| 命令 | 结果 |
|---|---|
| `pnpm lint` | exit 0 —— 12 warnings 全部是既有的，本次改动的文件（`apply-koubou.ts` / `subagent-tasks.ts` / `persist-storage.ts` / `store/index.ts`）零警告 |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm test` | 301 files / **4045 passed**, 4 skipped（评审处置后复跑：302 files / **4056 passed**） |
| `pnpm test:tz` | 1 file / 4 passed, 1 skipped（TZ=America/New_York 下生效） |
| `pnpm build` | 成功，11 条路由全部产出 |

新增测试 16 条：`apply-koubou.test.ts` 5（回合模型名 4 + 翻页不覆盖 1）、
`subagent-tasks.test.ts` 6（`sealStaleCards`）、`persist-storage.test.ts` 4（落盘投影）、
`subagent-view.test.ts` 3（快照往返，另改写 1 条守护断言）、`run-rest-tracking.test.ts` 3（校正接线）。

### 独立评审处置（2026-08-25，两个干净上下文子代理，按 commit 范围只给 spec + diff）

两份报告分别从「正确性与竞态」「不变式与反模式」入手，都做了变异反证。逐条对照代码验证后的处置：

| 编号 | 结论 | 处置 |
|---|---|---|
| 竞态 I1 | `listSessions` 的 `await` 后只校验了 `pid`/`sid`/`replay`，没校验 run 身份；窗口内本地新开一轮时会拿落后的 REST 答案误收正在跑的新卡，且合成态不可逆 | **采纳**，`await` 后的上下文校验加上 run 维度，补用例 |
| 竞态 I2 | `runId == null` 的卡在活跃 run 期也被收——`sealRun` 的「宁可多收」理由不能平移（那是在 `run.finished` 上收，这里可能 run 正跑到一半） | **采纳**，判据改成「无活跃 run 时才收归属不明的卡」，原用例拆成两条 |
| 竞态 I3 / 不变式 I-1 | 会话快照有 5 处读写，只改了 3 处；`actions.ts` 的回放收尾与断点续播仍写旧形状，回放链路上卡片被整体覆盖 | **采纳**，且按建议收敛成 `sessionSnapshot()`/`restoreSnapshot()` 单一造型处 + 形状单测 |
| 不变式 I-2 | live 路径的 `patchActiveTurn({model})` 零测试覆盖（变异反证：删掉它全量测试仍绿）——违反铁律 1 | **采纳**，补两条 live 用例，并自行反证确认转红 |
| 不变式 I-3 | 三条旧用例仍用推测的 wire 形状，且它们是顶层 `payload.model` 读法存活的唯一理由 | **采纳**，旧用例改真机形状 + 删掉顶层读法 |
| 正确性 M1 | `systemMessageModel` 的注释理由（「对 AssistantMessage 有效」）无效——该函数只在 SystemMessage 分支被调用 | **采纳**，随 I-3 一并解决 |
| 正确性 M2 | spec 说 `taskToolUse` 落盘是因为「归属校验要它」，实际它全仓只写不读 | **采纳**，改 spec 措辞（字段仍落，理由改对） |
| 正确性 M3 | 恢复点只兜「整字段缺失」，兜不住「内部键残缺」 | **采纳**，`restoreSnapshot` 统一做形状归一 |
| 不变式 M-2 | 在 `partialize` 里剥 `lastToolName` 会让零拷贝承诺在活跃回合里静默失效 | **采纳**，剥离挪到写快照处，`capPersistedSessions` 只管切尾 |
| 不变式 M-3 | `sealStaleCards` 实际作用域比注释宽（收的是全部非终态卡，不只快照恢复的） | **部分采纳**：不改行为（I1 修完后落后答案已被挡在外面，live 卡与快照卡无区别对待的理由），改注释说清作用域 |
| 不变式 M-5 | spec 说「校正期卡片照常显示」不成立（`PlanCard` 的 `runStatus==='running'` 门控使该窗口里卡片根本不渲染）；而这个门控本身是「不留僵尸卡」的第三条、也是最硬的一条保障，spec 与注释都漏了 | **采纳**，改 spec 措辞 + `types.ts` 注释补第三条 |

一处**技术性异议**：评审 M1 还建议把顶层 `model` 读法收进 `subtype === 'init'` 门内。初次照做后
三条既有用例转红——它们守的是「模型热切换」行为。在没有热切换真实帧的情况下收紧既有行为是拿
假设换假设，故当时改回。随后按 I-3 的判断（那三条用例本身就是伪造数据，不构成依据）才删掉整条
读法——**删的依据是「实测证明它不存在」，不是「它可能有问题」**，两者的证据强度不同。

### 实现期的两处修正（与计划的偏差）

1. **`historyFields` 的 model 用条件键而非固定字段**：`...(model ? { model } : {})`。展开进状态时
   天然是「有则覆盖、无则保留现值」，窗口里恰好没有 init 帧的页不会把已知模型名清成 null；
   否则每个 spread 点都要各写一次判空。
2. **T2 顺带加了 `PersistedSession.subagents?` 类型**（原计划放在 T3）：T2 的测试要构造带卡片的
   快照，类型不先加就编译不过。T3 因此只剩纯接线。
