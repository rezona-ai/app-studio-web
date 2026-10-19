# 进行中 run 的 REST 跟跑(刷新/重连恢复)

日期:2026-07-23 · 状态:已实现

## 背景与问题

Koubou 后端的 **run 事件按连接投递**:`run.*` 与 `claude.message` 帧只发给**发起该命令的那条 WS 连接**。页面刷新(或任何原因重建连接)后,新连接:

1. **收不到进行中 run 的任何帧**(实测 20s 零帧,同期原连接正常收流);
2. **`session.ready.active_run` 报 `null`**,与 REST `/sessions` 的 `active_run_id`(非空、准确)直接矛盾——ready 的 run 态只对「本连接发起的 run」有效。

注:后端 ws 文档(koubou-agent-py `docs/websocket-events.md`)的**设计**并非如此——文档明确「WS 断开时 run 仍在执行,后端保留 live actor,刷新后 attach 可继续接收结果」,且同一会话新控制连接会以 4000 顶替旧连接。实测四处矛盾(新连接零帧/无顶替/ready 报 null/孤儿 run 未被 reconcile)与文档「部署约束:假设单进程运行」相互印证——dev 环境疑似多副本(或 LB 无会话亲和)违反了该约束,不同副本各持内存态。无论后端部署形态如何修正,前端跟跑作为与部署无关的兜底仍然成立(REST 读库恒权威),并在 WS 真接管时自动退位。由此产生两种破坏体验的表现:

- 刷新落回 run 属主上下文:UI 永挂计时、消息永不到达;
- ready 报 `active_run: null`:前端(2026-07-22 刷新恢复三修的闭轮逻辑)把本地 running 轮**误闭为 succeeded**,UI 静止在 idle,run 的后续输出与终态永远丢失。

实测锚点(dev 项目 609):run 活跃期间新开裸 WS,ready `active_run=null` + 20s 零帧;同一时刻 REST `/sessions` 返回 `active_run_id: run_018e…`,`/events` 日志持续增长且完整含 `run.started` / `run.finished` / `error` 帧。

## 目的

刷新/重连后,若会话存在进行中的 run(REST 权威),前端通过 REST `/events` 轮询把该 run 的消息流与终态**完整追回**,直到 run 结束——用户视角:刷新后对话继续流动,计时正确,终态正常收口。

## 约束

- 不改协议层语义:REST 事件与 WS 帧同构,复用既有 `ingestKoubou` / `backfillSessionGap` 消化路径(幂等靠 `seenSequences`)。
- 本连接自己发起的 run 事件由 WS 正常投递,**不得**对其重复开启轮询(浪费且与流式路径竞争)。
- 轮询必须有明确终止条件与上下文守卫(切项目/换会话/回放期即停),不引入常驻定时器。
- 遵循「源头分流胜过簿记」:入口只有一个——`session.ready` 之后按 REST 权威判定,不在各处散布补偿逻辑。

## 方案

### 候选对比

1. **ready 后 REST 权威跟跑(采纳)**:每个 `session.ready` 后查 `/sessions` 的 `active_run_id`;非空且非本连接发起 → 复开误闭轮 + 循环 `backfillSessionGap` 直到终态帧落地。
   - 优点:单一入口、复用既有回填/幂等/画布刷新机制、无常驻轮询;
   - 缺点:REST 轮询期 UI 非逐 token 流式(按批到达),可接受。
2. WS 静默看门狗(runStatus=running 且 N 秒无帧则轮询):无法覆盖「ready 误闭轮后 runStatus=idle」的盲区,且引入常驻计时器,弃。
3. 等后端改「会话级扇出」:根治但不受本仓库控制,前端仍需兜底,不冲突。

### 数据流

```
session.ready(新连接)
  └─ trackActiveRunViaRest()
       ├─ listSessions → active_run_id
       ├─ null 或 ∈ wsRunIds(本连接发起) → 直接返回
       └─ 否则:
            ├─ ingest 合成帧 run.rest_reopen(reducer reopenRun:复开误闭轮/补建轮,runStatus=running)
            └─ loop:backfillSessionGap() → 终态?(runStatus≠running)→ 停
                     ↳ 未终 → sleep 2.5s → 重查上下文守卫 → 继续
```

### 关键设计点

- **`reopenRun(state, runId)`(纯函数,apply-koubou.ts)**:
  - 找 `runId` 匹配且 `finishedAt == null` 的轮(ready 误闭的轮恰是 `succeeded + finishedAt=null`)→ 复置 `status: 'running'`;
  - 找不到(run.started 在种子窗口之外)→ 末尾补建 running 轮(`startedAt: null`,footer 退化为纯 running 文案,不谎报时长);
  - 已是 running / 已落 `finishedAt` 的轮不动(幂等);同步 `runStatus: 'running'`、`activeRunId`。
- **豁免集 `wsRunIds`**:`useKoubouConnection` 连接闭包内记录本连接经 WS 收到帧的 `run_id`(信封 `run_id` 字段,任何帧都算;`run.started` 另从 payload 兜底)。跟跑前与 REST `active_run_id` 比对,命中即返回;**轮询循环内每轮复查**——后端 ws 文档明确「刷新后 attach 可继续接收结果」(单进程部署),WS 真接管时轮询自动退位,避免双路重复拉取。连接重建 → 闭包新生 → 天然清零(旧连接的 run 正应跟跑)。
- **终止条件**:`backfillSessionGap` 消化到 `run.finished` / `run.interrupted` 后 `runStatus` 离开 `'running'` → 停;循环上限兜底(默认 240 次 ≈ 10 分钟)防病态,命中上限时最后回填一次后放弃(后续 ready 会重新进入)。
- **上下文守卫**:每次 await 后校验 `currentProjectId` / `sessionId` / `replay == null` 未变,变则弃(与 actions.ts 既有 10+ 处同范式);模块级 in-flight 标记防重入(StrictMode / 密集 ready)。
- **副作用沿用回填路径**:`backfillSessionGap` 已处理媒体补导、成功收尾的画布/版本刷新、快照持久化,跟跑不再另起炉灶。

## 成功标准

- run 活跃期间刷新页面:消息按批继续到达,计时/骨架恢复 running 展示,`run.finished` 到达后正常收口(成功时画布/版本刷新)。
- 本连接自己发起的 run:不触发任何 REST 轮询。
- 切项目/进回放期间:轮询立即停止,无跨项目污染。
- 全量单测/类型检查通过;新增 reducer 与 action 各有独立单测。
