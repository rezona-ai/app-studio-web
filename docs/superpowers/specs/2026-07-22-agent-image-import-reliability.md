# Agent 生成资产自动导入可靠性修复

## 背景与问题

agent 生图成功后画布**有概率**不展示。资产落画布的唯一实时通路是:
WS 收到 `check_generation_tasks` 的 tool_result 帧(`media.tasks.status`, `status==='ready'`)
→ `importFromLiveEvent` → `POST /canvas/items/write-from-url`。
`run.finished` 后的 `loadCanvas` 只拉画布 items 表,救不回未导入的生成物。

诊断确认的丢失点(按概率排序):

1. **断连窗口丢帧**(主因):`useKoubouConnection` 每次建连先经 REST `listEvents` 种子化历史,
   再把 `afterSequence` 推到 `latest_sequence`,WS 只续传其后增量;而导入副作用只挂在 `onEvent`。
   生成期间发生刷新 / 切项目再切回 / 休眠唤醒重建连接,ready 帧被 REST 种子路径消化,永不触发导入。
2. **basename 去重误杀**:`importedByProject` 键为纯文件名且持久化只增不减,
   agent 重新生成同名文件或不同目录同名文件被静默跳过。
3. **导入失败无重试**:`write-from-url` 上游取 `preview_url` 字节失败(临时 5xx / 签名过期)后帧不重来。

## 目标与成功标准

- 上述 1、2 修复:断连窗口内就绪的资产在下次建连时补导;同项目内不同 `asset_path` 的同名文件互不误杀。
- 3 由 1 自然覆盖:失败不记去重(现状已如此),下次建连的历史扫描即天然重试,不另加重试机制(YAGNI)。
- 全程幂等:历史页每次建连都会重扫,靠去重表保证不重复落卡;用户已删的卡不复活(删除不清去重表,现状语义)。

## 方案

### 1. 历史帧补导(修丢帧)

建连种子化(`seedKoubouHistory(page)`)后,对 `page.events` 逐帧走**媒体-only** 导入
(复用 `importFromReplayEvent` 的语义:导 media、**不注册 tasks**——历史里的 task 早已终态,
送 `registerAgentGenTask` 会轮询失败弹 Toast,与回放同因,见 2026 回放 spec §3.4)。

实现:把 `importFromReplayEvent` 更名为通用的 `importMediaFromEvent`(回放播放器与种子路径共用),
在 `useKoubouConnection` 种子化成功后循环调用。共用 `liveImportChain` 串行落位,与现状一致。

边界:历史页 `limit: 50`,更早的未导资产不追溯(与现状拉取深度一致,可接受)。

### 2. 去重键换完整 asset_path(修误杀)

- `eventAssets` 的 `ReadyMedia` 增加 `path`(完整 `asset_path`);`filename` 仍为 basename(作展示名)。
- `importGeneratedAsset` 去重与记录改用 `path`;**兼容旧条目**:检查时 `path` 或 `filename`(basename)
  任一命中即视为已导,避免存量项目在历史扫描时重导一遍。

### 备选与取舍

- 备选:后端 run 结束时服务端自动把生成物写进画布表 → 前端 loadCanvas 天然拿到。彻底但涉及后端契约与落位归属(位置归前端所有),不在本次范围。
- 备选:import 失败显式指数重试 → 被「历史扫描天然重试」覆盖,按 YAGNI 裁剪。
