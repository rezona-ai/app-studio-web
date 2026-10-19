# 刷新后补 run 起始时刻(计时器退化修复)

日期:2026-07-31 · 状态:已实现

## 背景与问题

长 run 进行中刷新页面,回合脚注只显示纯 `Running…`(无秒表);run 结束后连 `Ran for …` 也没有,只剩模型名。且该状态会落盘,之后每次刷新都读到它,**不会自愈**。

**实测复现**(dev 项目 629,会话 `session_50676f…`,run `run_2eeb856f…`):冷启动打开该项目 → 脚注 `Running…` 无计时;run 收口后只剩 `Opus 5`;localStorage 快照写成 `startedAt: null`。

### 根因

`turn.startedAt` 只有一个来源:事件日志里的 `run.started.created_at`(live 期另有 `pendingSendAt` 兜底,所以刷新前一直正常)。

刷新时种子化只拉**最新 100 条事件**(后端 `limit` 上限,101 起 422)。长 run 的 `run.started` 早已滑出窗口——实测该会话种子窗口 `23908–24007` 内一条 `run.*` 都没有。于是 `rebuild` 建不出该轮,`session.ready.active_run` 又恒 `null`(见 spec 2026-07-23),REST 跟跑的 `reopenRun` 只能补建 `startedAt: null` 的轮。

已验证的边界:**本地快照里有这一轮时,刷新路径本来就工作**(拿真实种子页 + 带 `startedAt` 的快照跑纯函数管线,值一路保住)。缺口只在「快照里没有这一轮」——换浏览器 / 清存储 / 隐私窗口 / 换设备,或已被旧版本污染成 null。

## 目的

上述情况下也能显示正确的运行计时与收口时长,且**不引入额外请求**。

## 方案:用 `/sessions.updated_at` 兜底

活跃 run 期,会话行最后一次写入就是该 run 开始那一刻。`listSessions` 是 REST 跟跑的第一步,**本来就发**,故零额外请求、零延迟。

### 实测依据(3 个 run)

| run | `/sessions.updated_at` | 真实 `run.started.created_at` | 差 |
|---|---|---|---|
| `run_2eeb856f…` | `08:24:47.064546` | `08:24:47.269508Z` | 205ms |
| `run_0deb718d…` | `09:49:06.014113` | `09:49:06.206103Z` | 192ms |
| `run_46c7f764…` | `11:16:49.796923` | `11:16:50.028431Z`(seq 24572) | 232ms |

关键旁证:第三个 run 的最新事件已到 **11:39:22**,而 `updated_at` 仍钉在 **11:16:49** —— **22 分钟的事件流没有推进它**,说明这行是在 run 开始时写的,不是 per-event 心跳。
(`created_at` 是**会话**创建时刻——该会话为 `2026-07-24T13:08:17`,与 run 无关,不可用。)

### 实现

- **`normalizeIsoUtc`(`src/lib/koubou/timestamp.ts`,纯函数)**:`/sessions` 的时间戳**不带时区标记**,而事件 `created_at` 带 `Z`。JS 把无时区的 date-time 按**本地时间**解析——裸 `Date.parse` 在 UTC+8 机器上偏 **8 小时**(实测 `8.000064`),脚注会显示「已运行 8 小时」。故统一补 `Z` 归一,解析失败回 `null`。
- **`reopenRun(state, runId, startedAtFallback = null)`(纯 reducer)**:补建轮用兜底值当 `startedAt`;复开轮**仅在缺值时**补(live 的 `pendingSendAt` / 真实 `run.started` 恒更准,不覆盖)。幂等收敛的早退条件要把「还差起始时刻」放行,否则被旧版本污染成 `null` 的快照永远补不上。
- **接线(`trackActiveRunViaRest`)**:按 `session_id` 取本会话那条摘要(不串用别的会话),`reopenRun(st, runId, normalizeIsoUtc(session?.updated_at))`。

### 候选对比

1. **`updated_at` 兜底(采纳)**:0 请求、即时、代码最小。
2. 有界二分回溯 `run.started`(`after_sequence=X&limit=1` 探针,已实现过又回退):精确到权威值,但 13–16 次串行探针、dev 上 ≈16s 才补上计时,代码 +190 行。取舍后认为不值。
3. 下界近似(窗口内该 run 最早事件时间):系统性少报(差一整个窗口跨度),弃。
4. 请后端暴露 `active_run_started_at`:最干净,与本方案不冲突,字段到位后优先读它。

## 已知风险(接受)

- **推断契约**:`updated_at` 的写入时机未见文档(仓库反模式列表里「只取文档约定字段」的一次有意例外)。若后端将来在 run 中途触碰会话行(最可疑:**run 期间切模型**——`model` 字段就在这行),`updated_at` 会前移 → 时长**静默少报**。3 次采样未触发。
- **误差 ~0.2s**:比真实 `run.started` 早约 200ms,多报可忽略。
- 兜底只在「轮缺 `startedAt`」时生效,常规刷新路径(快照有值 / `run.started` 在窗口内)完全不受影响。

## 非目标

- **已收口的长 run**:刷新后种子窗口只剩 `run.finished`,连轮都建不出(`patchTurn` 无 running 轮可打),历史脚注(模型 + 时长)缺失。同一根因的另一面,需按消息锚点补建历史轮,本期不做。
- 不改种子窗口大小(后端 `limit` 上限 100)、不动脚注文案/样式、不加 i18n 词条。

## 验证

- 单测:`timestamp.test.ts`(3 条,含 UTC+8 下的 8 小时回归)、`apply-koubou.test.ts` 的 `reopenRun` 兜底 4 条、`run-rest-tracking.test.ts` 的接线 4 条(无 Z 归一 / 不覆盖 live 值 / 非法值维持 null / 不串用别的会话)。
- 全量:`pnpm exec tsc --noEmit` 0 错、`pnpm lint` 0 错、`TZ=Asia/Shanghai pnpm test` 208 文件 / 2138 测试通过。
- 真实 UI 验证(长 run 进行中冷启动刷新)由作者自行确认。
