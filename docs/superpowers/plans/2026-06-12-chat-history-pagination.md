# 历史对话分页加载实现计划

对应设计:`docs/superpowers/specs/2026-06-12-chat-history-pagination-design.md`

1. **lib 客户端**:`src/lib/koubou/client.ts` 加 `EventsPage` 类型与 `koubouApi.listEvents`(`limit`/`before_sequence` 查询参数);同目录测试覆盖 URL 构造与信封拆解。
2. **状态与纯函数**:`src/store/types.ts` 给 KoubouState 加 `historyEvents/historyMsgCount/historyOldestSeq/historyHasMore/historyLoading`;`src/koubou/apply-koubou.ts` 导出 `rebuildHistory`,新增 `seedHistory`/`prependHistory`,`onReady` 重建路径同步写游标;`apply-koubou.test.ts` 覆盖种子化、前插、跨页 tool_result 折叠、空页。
3. **store action**:`src/store/index.ts` 加 `seedKoubouHistory`/`loadOlderMessages`(守卫 + await 后校验 + 单次 set);新增 store 级测试(mock `@/lib/koubou/client`)。
4. **连接流程**:`src/client/useKoubouConnection.ts` 在建连前 REST 种子化,`afterSequence = latest_sequence`,失败回退现状。
5. **UI**:`src/components/chat/ChatPanel.tsx` 滚顶触发加载、滚动锚定、抑制自动滚底、顶部 loading 提示。
6. **验证**:`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test`;浏览器手动验证向上滚动连续翻页与不跳动。
