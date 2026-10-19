# 刷新后恢复：回合模型名与子代理卡片

## 目的

运行中刷新页面后，对话栏有两处状态回不来：

1. **回合脚注丢模型名** —— `TurnFooter` 只剩「已运行 X」，模型名要等下一条 assistant 消息到达才补上；
2. **子代理卡片只剩最新一批** —— 刷新前已开的卡片大部分消失。

两者都发生在「运行中刷新」这个高频路径上：用户刚发出一轮、页面一刷新，正在跑的这一轮看起来就像
丢了半张脸。本需求把这两处的恢复口径补齐。

## 根因（已用探针测试实证，2026-08-24）

### 问题 1：`rebuild()` 不把 `SystemMessage` 的 model 回填当前轮

`TurnFooter` 读 `turn.model`。刷新后当前轮由 `rebuild()`（`src/koubou/apply-koubou.ts:294`）从 REST
最新一页事件重建，而 `SystemMessage` 命中时只更新重建期的**局部变量** `model` 后 `continue`
（`:414`），**不回填已经建好的那一轮**。事件顺序恒是 `run.started` → `SystemMessage(init)`，
所以建轮那一刻（`:349`）局部 `model` 还是 null，只能靠 `existing`（快照里同 `runId` 的轮）兜底。

探针实证的分界：

| 场景 | 结果 |
|---|---|
| A 快照有同 runId 轮，`run.started` 在页内 | ✅ 保住 |
| B 同上，`run.started` 在页外走 `reopenRun` | ✅ 保住 |
| C 无快照轮 + `run.started` 在页外 | ❌ null |
| D 无快照轮 + `run.started` 在页内 | ❌ null |
| E 快照停在上一轮、当前是新 run | ❌ null |

**E 是日常场景**：持久化是 1s 节流的（`persist-storage.ts`），新一轮刚开跑就刷新时快照里还只有
上一轮，兜底扑空。直到下一条 `AssistantMessage` 带 model 到达才由 `reconcileAssistant`（`:777`）
回填 —— 这正是「过一会儿自己好了」的由来。

C 还叠了同源的第二层：`reopenRun`（`:691`）补建轮时取会话级 `state.model`，而 `rebuild` /
`historyFields` **不回写** `state.model`，会话级 model 又不在持久化白名单里 → 刷新后恒 null。

### 问题 2：`subagents` 切片刻意不落盘

`subagents` 是 `KoubouState` 里唯一被排除出会话快照的切片（`store/types.ts:151` 的注释与
`store/subagent-view.test.ts` 的断言共同守着），理由是「落盘只会在刷新后复活一批无从推进的僵尸卡」。

于是刷新后卡片只能靠 REST 最新一页（`useKoubouConnection.ts:100`，`limit=100` 是后端上限，
101 起 422）重放重建，且 `rebuild` 一遇到页内 `run.started` 就 `createSubagentState()` 清空重来。
长回合里开卡事件被挤出这 100 条窗口，卡片就再也建不回来 —— 表现为「只剩最新几个」。

## 约束与取舍（盘问结论）

1. **`subagents` 纳入 `PersistedSession`**，与 `messages` / `turns` / `tasks` 同范式：快照先出做即时
   回显，REST 最新一页以它为底重放做校正。这**推翻** `types.ts:151` 的「不落盘」决策及
   `subagent-view.test.ts` 里对应的守护断言 —— 当初拒绝落盘时，僵尸卡确实无解；现在收口通道是
   齐的（`backfillSessionGap` 补回终态帧 → `sealRun`，再加约束 3 的权威校正），前提变了，结论随之变。
   断言不是删掉了事：改成断言「落盘且非终态卡会被校正收口」，守护点从「不落盘」平移到「不留僵尸卡」。

2. **校正时机取 REST 权威 `active_run_id`，不用 `session.ready.active_run`**。后者对新连接恒为 null
   （`apply-koubou.ts:186` 的注释已写明，`reopenRun` 整套机制就是为它兜底而存在的），在它上面一刀切
   会把仍在跑的卡误收。而卡片**没有 turns 那样的复开通道** —— `sealRun` 的合成态
   `ended_without_terminal` 只能被真实终态覆盖，**不能改回 `running`**（`subagent-tasks.ts` 的
   `cardPatch` 明确：迟到的非终态绝不把卡改回 running）。误收即不可逆，故宁可多等一个 REST 往返。

3. **校正规则**：`trackActiveRunViaRest` 拿到 `session.active_run_id` 后，
   - 有活跃 run：属于该 run 的非终态卡保持 `running`，继续由 WS / REST 缺口回填推进；
     **归属不明（`runId` 为 null）的卡也保持**——它多半就属于这个活跃 run，会在 `run.finished`
     上由 `sealRun` 正确收口（那里的 `belongs` 判据本来就认 null）；
   - 其余非终态卡（含无活跃 run 时的全部，包括归属不明的）收成 `ended_without_terminal` +
     `sealReason:'unknown'`（措辞「结局未知」，与 `sealRun` 在 run 成功而任务终态未到时的口径一致，
     不谎报失败）。
   - **REST 答案落后于本地时整体跳过**：`runId` 是请求发出那一刻的服务端快照，而卡片是响应到达
     那一刻的当下值。窗口内本地新开一轮时，拿落后的答案去收会误伤正在跑的新卡，且合成态不可逆。
     故 `await` 后的上下文校验除了 `pid` / `sid`，还要带上 run 这一维（本地 `activeRunId` 与 REST
     答案不一致就跳过，下次 ready 重新校正）。

4. **会话级 `model` 由重建产出并写回 `state.model`，但不进持久化白名单**。`rebuild` 已经在扫
   `SystemMessage`，把它扫出的 model 一并返回、由 `seedHistory` 写回状态即可，`reopenRun` 的补建轮
   随之有值。为一个可从事件重建的派生值扩持久化面不划算，也违背「只在可重放检查点持久化」的既有取向。

5. **`rebuild` 中 `run.started` 清空 `subagents` 的行为保持不变**。同一会话事件按 `sequence` 连续、
   页取的是尾部，故 `run.started` 在页内 ⟹ 该 run 的全部事件都在页内 ⟹ 重建能完整还原，清空无害；
   快照只在 `run.started` 出页外时才是唯一来源，而那时根本不会触发清空。这条不是「先不管」，
   是这两条路径互斥、天然自洽。

6. **落盘体积设上限**：`cards` 按 `PERSIST_MAX_TURNS` 同范式切尾，只留最近 N 张。
   `knownToolUseIds` 落盘（归属校验的来源），`deferred` 也落（它可能攥着唯一的终态补丁），
   `sealedRunIds` 落（收尾幂等）。`taskToolUse` 一并落只是因为它是 `SubagentState` 的一员 ——
   **它目前只写不读**，全仓无消费者（归属校验读的是 `knownToolUseIds`，`consumeDeferred` 读的是
   `card.toolUseId`）；真要压体积，它是第一个该剥的。

7. **快照的形状收敛成一处**：`sessionSnapshot()` / `restoreSnapshot()`（`src/store/session-snapshot.ts`）
   是会话快照的唯一造型处，五个读写点全部走它，并有单测断言字段清单。起因是本轮实发的教训 ——
   加 `subagents` 字段时按「三处写入点」改，漏掉了 `actions.ts` 里回放收尾与断点续播的两处，
   回放链路上刚落盘的卡片被缺字段的快照整体覆盖，症状与本次要修的 bug 一模一样。
   形状散在五处字面量里，加字段就必须五处同步改，而没有任何东西守着这件事。

8. **live-only 字段在写快照时剥，不在 `partialize` 里剥**：`partialize` 每次 `set()` 都跑
   （流式期每 token 一次），在那里剥 `lastToolName` 会让 `capPersistedSessions`
   「未超限即同引用」的零拷贝承诺在整个活跃回合里静默失效。`capPersistedSessions` 只管切尾。

7. **`lastToolName` 落盘时剥掉**。它是「此刻正在调什么工具」的活体指示，且 `TaskProgressMessage`
   本身不落库（`subagent-tasks.ts` 已注明「重连后会丢」）。持久化它只会在刷新后显示一个陈旧的
   动作名，比空着更误导。

## 成功标准

- 运行中刷新：回合脚注**立刻**显示「模型名 · 已运行 X」，不经历只剩时间的窗口；
- 清空 localStorage 冷启动：重建出的历史轮模型名来自页内 `SystemMessage`（C / D / E 三场景转绿）；
- 运行中刷新：刷新前已开的子代理卡片全部回来且保持 `running`，随后由 WS / REST 推进到真实终态；
- 回合早已结束时刷新：恢复出的非终态卡在 REST 校正后收成「结局未知」，不永久转圈；
- 老快照（无 `subagents` 字段）能正常载入，不抛错、不影响其余切片。

## 坑：`SystemMessage` 的模型名不在 `payload.model`（2026-08-24 真机实测修正）

初版实现按 `cm.payload.model` 读 init 帧的模型名，**单测全绿但真链路上完全空转**。对 dev 后端
实测的真实帧是：

```
{ sdk_type: 'SystemMessage', payload: { subtype: 'init', data: { …SDK init 原样透传, model } } }
```

`payload` 顶层只有 `subtype` / `data`，没有 `model`。之所以没被测试挡住：既有测试构造
`cmsg('SystemMessage', { model })` 本身就是凭空推测的形状，新写的用例照抄了它，于是测试与实现
**一起错**，绿得毫无意义。

连带发现：`apply-koubou.ts` 里 live 路径那行 `p.payload.model ? { ...state, model } : state`
一直是死代码 —— 会话级 `state.model` 因此长期恒为 `null`，`reopenRun` 补建轮的模型名兜底
从来没生效过。两处一并改用 `systemMessageModel()`：顶层 `model` 照读（对 `AssistantMessage`
有效，实测 35/35 都带；不同 backend 形状未必一致），取不到再按 `subtype === 'init'` 读 `data.model`。

**教训**：协议层的字段路径必须对着真实帧写，不能照抄既有测试的构造 —— 测试数据本身可能就是
上一次的推测。改完用反证确认测试真的敏感（屏蔽 `data` 分支 → 4 条用例转红）。

初版修正只改了新用例，把三条旧用例（`apply-koubou.test.ts` 的「SystemMessage 记录 model」等）
留在推测形状上，于是顶层 `payload.model` 那条读法靠这三份伪造数据继续「有测试守护」。
评审指出后一并处理：旧用例改成真机形状，顶层读法随之无人守护 → 按「不留 dead code」删掉。
`codex` backend 不受影响，它的帧走 `codex.message` → `applyCodexMessage`，到不了这个函数。

## 已知取舍（复核记录，2026-08-24）

- **陈旧 running 轮会被抢走模型名**：`rebuild` 里回填 model 用的是 `patchTurn(patch, runIdOf(ev))`，
  事件不带 `run_id` 时按既有口径回退到「最后一条 running 轮」。若快照里留着一条**异常的**陈旧
  running 轮（上一轮的终态帧丢失所致），而本轮的 `run.started` 又在页外，那条陈旧轮的模型名会被
  改写成本轮的。**不修**：触发前提本身是异常态，且 `onKoubouReady` / `reopenRun` 随后就会把它闭掉；
  为它加一层「只打非陈旧轮」的判据，等于在重建期复刻一份 run 状态机，代价远大于收益。
- **`knownToolUseIds` / `taskToolUse` 随快照无界增长**：卡片切尾到 40 张时这两个集合不跟着裁
  （它们是归属校验与 id 反查的来源，裁了会让迟到事件配不上卡）。长会话里是纯字符串数组的缓慢累积，
  与 `messages` 的百条上限相比可忽略；真成问题时再按 run 归属裁，而不是按卡片数裁。

## 不做

- 不扩大事件种子窗口（后端 `limit` 上限 100，已用满）；
- 不向前补页重建卡片（`prependHistory` 明确不重建 `subagents`，改它的语义会让旧页的 `start` 复活已收的卡）；
- 不把会话级 `model` 加进持久化白名单（见约束 4）。
