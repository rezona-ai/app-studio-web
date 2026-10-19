# 对话连接韧性(实现计划)

对应设计稿:`docs/superpowers/specs/2026-07-22-chat-conn-resilience.md`。每任务独立提交,TDD。

## T1 发送门控(P1)

- `src/components/chat/Composer.tsx`:`send()` 首行门控——`connStatus !== 'open' || !client.current` → `setWarning(chat.conn.notReady)` 后 return(草稿/附件原样保留)。
- i18n:`chat.conn.notReady` 补 11 语(`src/i18n/locales/*.ts`)。
- 测试:`Composer.test.tsx`——connecting 态点发送:不插气泡、draft 保留、出 warning;open 态照常发送。
- 验证:`pnpm exec vitest run src/components/chat/Composer.test.tsx`

## T2 重连缺口回填(P1,含 run 收尾补偿)

- `src/store/index.ts`:新 action `backfillSessionGap()`——分页 `koubouApi.listEvents(pid, sid, { afterSequence: lastSequence, limit: 100 })` 直至无新事件(上限 10 页兜底);逐条:`user.message` → 尾部同文本 user 气泡去重后 `applyUserMessage`,其余 → `ingestKoubou`;每条 `importMediaFromEvent`;`await` 后校验 pid/sid 未变。缺口含 `run.finished(succeeded)` → `loadCanvas()`+`loadVersions()`。
- `src/client/useKoubouConnection.ts`:onEvent 里对**非首个** `session.ready` 触发(client 实例内计数)。
- 测试:store 级——mock `koubouApi.listEvents`,断言缺口消息进 messages、seenSequences 幂等、user.message 文本去重、succeeded 触发画布/版本刷新。
- 验证:`pnpm exec vitest run src/store/backfill.test.ts`

## T3 superseded 恢复入口(P2)

- `src/components/chat/ReconnectBanner.tsx`:superseded 分支——提示 + 「在此标签页继续」按钮(`client.reconnect()`)。
- i18n:`chat.conn.superseded` / `chat.conn.takeOver` 补 11 语。
- 测试:`ReconnectBanner.test.tsx`——superseded 渲染横幅、点按钮调 reconnect。

## T4 终态帧按 runId 回填已闭合轮(P3)

- `src/koubou/apply-koubou.ts`:`finishRun`/`interruptRun` 接收 runId;`patchActiveTurn` 无 running 轮时回退按 runId 匹配 `finishedAt == null` 的轮补终态与时长。
- 测试:`apply-koubou.test.ts`——ResultMessage 先闭轮 → 真 run.finished 补 finishedAt/状态;ready 闭轮同理。

## T5 乐观计时超时(P3)

- `src/store/index.ts`:`markPendingSend` 置位后 45s 定时器,到期 `pendingSendAt` 未变且 `runStatus !== 'running'` → 清计时 + `setError`。
- i18n:超时错误文案 11 语。
- 测试:fake timers——超时清理+报错;run.started 及时到达则不触发。

## T6 种子/翻页窗口 50 → 100(P3)

- `useKoubouConnection.ts` 种子 limit、`store/index.ts` loadOlderMessages limit 改 100(实测后端上限,101 起 422)。
- 既有测试回归即可。

## 收尾

- 全量 `tsc --noEmit` + `lint` + `test`;Playwright 连真后端目视验证 T1/T3 主路径。
