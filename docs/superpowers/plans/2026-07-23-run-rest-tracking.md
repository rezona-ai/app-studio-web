# 实现计划:进行中 run 的 REST 跟跑

对应设计稿:`docs/superpowers/specs/2026-07-23-run-rest-tracking.md`

## 任务拆分(每项独立可测,完成即提交)

### T1 reducer:`reopenRun` 纯函数

- 文件:`src/koubou/apply-koubou.ts` + `apply-koubou.test.ts`
- 先写失败测试:
  1. ready 误闭轮(`succeeded + finishedAt=null`,runId 匹配)被复开为 `running`,`runStatus/activeRunId` 同步;
  2. 无匹配轮时末尾补建 running 轮(`startedAt: null`);
  3. 已落 `finishedAt` 的轮不动(幂等,重复调用状态不变);
  4. 目标轮本就 running → 仅同步 `runStatus/activeRunId`。
- 实现:导出 `reopenRun(state, runId): KoubouState`,不接入 `applyKoubou` 的 switch(非服务端事件,由 store action 直调)。
- 验证:`pnpm exec vitest run src/koubou/apply-koubou.test.ts`

### T2 store:`trackActiveRunViaRest` action

- 文件:`src/store/index.ts`(Actions 接口 + 实现)+ `src/store/koubou-actions.test.ts`(或就近既有测试文件)
- 先写失败测试(mock `koubouApi.listSessions/listEvents`):
  1. `active_run_id=null` → 不轮询、状态不变;
  2. `active_run_id ∈ 豁免集` → 不轮询;
  3. 活跃 run → 复开轮 + 循环回填,mock 事件页含 `run.finished` 后停止,消息落地;
  4. 轮询中切项目(`currentProjectId` 变)→ 立即停止,不再发请求;
  5. 重入守卫:并发二次调用直接返回。
- 实现要点:签名 `trackActiveRunViaRest(isWsOwned: (runId: string) => boolean)`;轮询间隔 2.5s(测试注入可控 sleep 或用 fake timers);循环上限 240;每次 await 后上下文守卫;`replay != null` 早退。
- 验证:`pnpm exec vitest run src/store`

### T3 接线:`useKoubouConnection`

- 文件:`src/client/useKoubouConnection.ts`
- 连接闭包内 `const wsRunIds = new Set<string>()`;`onEvent` 中 `run.started` 记入;`session.ready` 后(不分首次/重连)`void trackActiveRunViaRest((id) => wsRunIds.has(id))`。
- 既有 `readyCount>0 → backfillSessionGap` 保留(覆盖无 active run 的断线消息缺口)。
- 验证:`pnpm exec tsc --noEmit` + 全量 `pnpm test`

### T4 端到端验证(真实后端)

- 主仓 dev server(端口 3000,项目 tuszAoKA):发消息起 run → run 活跃期间刷新 → 断言:
  - store `lastSequence` 持续增长、消息数增加;
  - `runStatus` 恢复 `running`,turn 复开(计时/骨架在场);
  - `run.finished` 后 `runStatus` 收口。
- 留存采样输出作为验证证据。

## 提交序列

1. `docs: REST 跟跑设计稿与实现计划`(spec + plan)
2. `feat: reopenRun reducer——按 REST 权威复开误闭轮`(T1)
3. `feat: trackActiveRunViaRest——进行中 run 的 REST 轮询跟跑`(T2)
4. `feat: 连接层接线 ready 后触发 REST 跟跑(本连接 run 豁免)`(T3)

完成后回合 `dev`(`--no-ff`,message 含分支名),删分支。
