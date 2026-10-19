# 流式渲染性能优化 + 导入去重表上限（2026-07-07）

## 背景（性能排查结论）

对全仓做了一轮内存泄漏 / 高 CPU 隐患排查。定时器 / 监听器 / WS 清理纪律良好，无确认级泄漏；确认级隐患集中在长会话流式输出场景：

1. **每 token 全列表重渲**：`ChatPanel` 订阅整个 `messages`，每个流式 delta 都重渲全部消息；`MessageItem` / `ToolCard` / `ToolGroupCard` 未 memo，历史消息的 Markdown 每 token 重新解析。
2. **`patchDraft` 每 token O(N)**：每个 `content_block_delta` 对全量 `messages` 跑 `map` 谓词。
3. **`importedByProject` 无界持久化**：导入去重表只增不减且随 persist 落 localStorage（~5MB 配额），是唯一没有裁剪机制却落盘的集合（对比 `koubouByProject` 有 `capPersistedSessions`、`seenSequences` 有 500 上限）。

## 变更

### 1. Chat 渲染 memo 化
- `MessageItem` / `ToolCard` / `ToolGroupCard` 包 `React.memo`。消息 / part 走不可变更新（reducer 恒返回新对象），引用比较即可精确跳过未变消息——流式期只有尾部草稿消息重渲。
- `ChatPanel` 内 `selectTurnAnchors` / `groupToolRuns` 派生计算包 `useMemo`（依赖 `messages` / `turns`），非消息类重渲（弹窗 / 滚动按钮 / pendingInteractions）不再重复付 O(N)，且产物引用稳定供子组件 memo 生效。

### 2. `patchDraft` 尾部定位
- 草稿恒在消息尾部附近：从尾部反向找到目标后单点替换（`slice` + 赋值），替代对全量 `messages` 的 `map`，省去每 token 的 O(N) 闭包谓词。语义不变（找不到返回原 state）。

### 3. `importedByProject` 上限
- `importGeneratedAsset` 记去重时 `slice(-500)`（`IMPORTED_CAP`），只保留最近 500 条文件名。被裁掉的极旧文件名理论上可能重复导入（多一张卡），权衡后可接受。
- 单测：超 500 条时裁掉最旧、保留最新。

## 明确不做（本次排查中的可疑项，留待需要时处理）
- Koubou `pending` 命令队列容量上限（受用户手动操作频率天然限制）。
- 后台标签页轮询 / 打字机 interval 随 `visibilitychange` 暂停（均有终止条件，非泄漏）。
- `historyEvents` 翻页累积、内存 `messages` 裁剪（有服务端真相兜底，属设计取舍）。
