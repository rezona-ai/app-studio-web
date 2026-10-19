# 对话连接韧性:发送门控 + 重连缺口回填 + 顶替恢复(设计)

## 背景与问题

排查「刷新后计时永转/历史不完整/不会重连」(2026-07-22,Beyond Dome 会话实证)后,对话/历史/重连链路仍存在一组体验缺陷,按严重度:

1. **未连接时发送静默丢失**:`Composer` 的 `canSend` 不看连接态。client 未创建时 `client.current?.sendUserMessage` 直接 no-op,乐观气泡照插、计时照开——用户以为发出去了,实际永无回应;`stalled`/`superseded` 态命令进积压队列但不再有自动冲刷,刷新后队列与气泡一并丢失。
2. **重连后事件缺口无回填**:REST 种子化只在进项目时跑一次;断线重连仅靠 WS `after_sequence` 续传,而实测后端建连**不重放历史事件**(手动 WS 探测 `after_sequence=0` 只回 ready)。断线窗口内的消息与 `run.finished` 永久缺失,直到手动刷新。
3. **断线窗口内 run 完成 → 画布/版本不刷新**:成功收尾的副作用只挂在 live `onEvent`。
4. **种子化竞态冲掉乐观气泡**:`seedHistory` 整体替换 messages,种子在途期间抢发的气泡会被冲掉。
5. **superseded 是死胡同**:被新 tab 顶替后只有 4s toast,无常驻提示与恢复入口,唤醒重连也刻意排除它。
6. **种子窗口小**:limit=50 事件(SystemMessage 噪声占 ~60%),实测后端 limit 上限 100。
7. **真实时长丢失**:ResultMessage/ready 兜底闭轮后,真 `run.finished` 重放因无 running 轮而 no-op,footer 丢时长。
8. **乐观计时无超时**:`run.started` 永不到达时骨架+计时永挂(瞬态,刷新才清)。

## 方案

- **发送门控(修 1,顺带消灭 4)**:`send()` 入口处 `connStatus !== 'open' || !client.current` 时阻发——保留草稿、不插气泡、不开计时,toast 提示「连接中/已断开」。种子化恒先于建连完成(`useKoubouConnection` 时序),门控生效后种子在途期间不可能产生乐观气泡,竞态自然消失。不选「禁用按钮」:connecting 是常态短暂过程,置灰闪烁更扰;阻发+提示保输入。
- **重连缺口回填(修 2、3)**:client 实例的**非首个** `session.ready`(即重连)触发 `backfillSessionGap`——REST `listEvents({ afterSequence: lastSequence })` 分页拉缺口,逐条 ingest(`user.message` 走 `applyUserMessage`,其余走 `ingestKoubou`;`seenSequences` 幂等,后端将来支持 WS 重放也不重复)。缺口内含 `run.finished(succeeded)` → 补 `loadCanvas`/`loadVersions`。媒体帧补 `importMediaFromEvent`。首个 ready 不回填(种子刚对齐,省一次空查)。
  - own-tab 冲刷竞态:重连 open 时积压命令冲刷,其 user.message 可能同时落进回填页而本地已有乐观气泡 → 回填的 user.message 若与**尾部既有 user 气泡文本相同**则跳过(窄窗口启发式,注释说明)。
- **superseded 恢复入口(修 5)**:`ReconnectBanner` 增加 superseded 分支——常驻提示「已在其他标签页打开」+「在此标签页继续」按钮(`client.reconnect()`,语义即抢回属主)。自动唤醒重连仍排除 superseded(避免两 tab 互抢)。
- **终态帧按 runId 回填(修 7)**:`finishRun` 找不到 running 轮时,回退按 `runId` 匹配**未落 finishedAt** 的已闭合轮,补 `finishedAt`/终态(ready/ResultMessage 先闭轮、真终态帧后到的场景恢复真实时长)。
- **乐观计时超时(修 8)**:`markPendingSend` 内置 45s 定时器,到期若 `pendingSendAt` 仍是本次时间戳且 run 未开 → 清计时 + error toast。
- **种子窗口开满(修 6)**:seed 与翻页 limit 50 → 100(实测后端上限)。

## 成功标准

- 断网/未连接时点发送:草稿保留、无假气泡、有提示;恢复后可重发。
- 断线期间 agent 继续跑:重连后缺口消息补齐、run 收尾后画布/版本刷新,无需手动刷新页面。
- 被顶替的 tab 有常驻提示,可一键抢回继续。
- 兜底闭轮后真终态帧到达,footer 恢复真实时长。

## 非目标

- 后端 WS 重放契约、被顶替时的多 tab 协同编辑;`pending_interactions.cancelled` 等未识别帧的语义化。
