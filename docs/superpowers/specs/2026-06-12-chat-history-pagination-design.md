# 历史对话分页加载(events 端点)设计

日期:2026-06-12

## 背景

历史对话改由 Koubou 新 REST 端点获取并支持分页:

```
GET /projects/{project_id}/sessions/{session_id}/events?limit=&before_sequence=
```

实测契约(经本地代理验证):

- `events`:ServerEvent 数组,**升序**(与 WS 帧同构,含 `sequence`/`event_id`/`created_at`);
- `oldest_sequence` / `newest_sequence`:本页边界;`latest_sequence`:会话最新 sequence;
- `has_more`:本页之前是否还有更早事件;
- `limit` 缺省 50;`before_sequence=N` 返回 sequence < N 的最后 limit 条;不传则返回最新一页。

## 目标行为

1. 进入项目(解析出 sessionId 后、建 WS 前)经 REST 拉**最新 50 条**事件重建历史,WS 以 `after_sequence = latest_sequence` 续传,只接增量。
2. 聊天区滚动到顶且 `has_more` 时,以 `before_sequence = 已加载最旧 sequence` 续拉前 50 条,**前插**到消息列表,保持视口锚定(不跳动),重复直到加载完全部。
3. REST 拉取失败时回退现状:沿用 `session.ready.visible_state` 冷启动重建,不劣于现状。

## 方案

### 状态(KoubouState 新增,均为瞬态不持久化)

- `historyEvents: ServerEvent[]`:REST 已加载的历史事件日志(升序,仅内存);
- `historyMsgCount: number`:`messages` 中由 `historyEvents` 重建出的前缀长度;
- `historyOldestSeq: number | null`:翻页游标;
- `historyHasMore: boolean` / `historyLoading: boolean`。

### 纯函数(apply-koubou.ts)

- `seedHistory(state, page)`:用最新一页整体重建 `messages` 并初始化游标;`lastSequence` 对齐 `latest_sequence`(持久化检查点一致性)。
- `prependHistory(state, page)`:`historyEvents = 旧页 ++ 已加载`,**对合并后的完整事件日志重建**历史前缀,再拼接 `messages.slice(historyMsgCount)` 的 live 尾部——这样跨页边界的 tool_use/tool_result 配对(result 在新页、use 在旧页)能正确折叠,不丢结果。
- `session.ready` 的 visible_state 重建路径同步写入 history 游标字段(REST 失败的回退路径也可继续翻页)。

已知取舍:live 期间折叠进「历史前缀」消息的变更会在下一次 prepend 重建时丢失——历史前缀距 live 至少 50 条,实际不可达,接受。

### 数据流

- `src/lib/koubou/client.ts` 新增 `koubouApi.listEvents(pid, sid, { limit, beforeSequence })` → `EventsPage`。
- store 新增 action:
  - `seedKoubouHistory(page)`:调 `seedHistory` + 预填 `importedByProject` 媒体去重(与 visible_state 路径一致);
  - `loadOlderMessages()`:并发/边界守卫(`historyLoading`/`historyHasMore`/游标空),`await` 后校验项目与会话未切换,单次 `set` 内完成前插与 `historyLoading` 复位(避免 UI 中间态)。
- `useKoubouConnection`:resolveSession 后若有 sessionId,先 `listEvents` 种子化,再以 `latest_sequence` 建连;失败回退原 `afterSequence` 逻辑。

### UI(ChatPanel)

- 滚动容器 `onScroll`:`scrollTop < 60 && hasMore && !loading` 时记录 `{scrollHeight, scrollTop}` 锚点并触发 `loadOlderMessages`。
- `useLayoutEffect` 监听 `historyMsgCount` 增长:`scrollTop = 新 scrollHeight - 旧 scrollHeight + 旧 scrollTop` 恢复视口,并抑制该次「自动滚底」effect;非前插的消息变更清除锚点,自动滚底照常。
- `historyLoading` 时列表顶部显示加载提示。
