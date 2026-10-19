# Plan：agent 错误改在对话列表内联展示(撤下 Koubou WS toast)

## 背景

当前 Koubou WS 的两类错误**只**通过 toast 展示,对话列表里看不到:

- `error` 事件 → store 写 `lastError={code:'AGENT'}`;reducer `onError` 仅清理过期弹窗,**不入对话**。
- 工具失败(`tool_result.is_error`)→ store 用 `extractToolErrors` 抽取后写 `lastError={code:'TOOL'}`;reducer `foldResults` 把该 tool part 标 `ready` 并**丢弃错误内容**,`ToolCard` 不内联展示。

目标:把这两类错误改为**直接渲染进对话流**,撤下对应 toast(PGC / 上传 / 生成等其它 toast 不动)。

## 方案

### 协议层(纯函数 reducer,TDD)

1. `store/types.ts`:`Part` 新增 `{ type: 'error'; text: string }`(agent 级错误气泡)。
2. `apply-koubou.ts` `foldResults`:`is_error` 时改为 `status:'error'` 并保留错误文本到 `result`(不再丢弃)。
3. `apply-koubou.ts` `onError`:
   - 命中某个未决交互(stale 弹窗失效)→ 仅清弹窗,**不冒泡**(避免 housekeeping 噪声,保持既有语义)。
   - 其余(agent/run 级错误)→ 追加一条 `{role:'assistant', status:'error', parts:[{type:'error', text}]}` 进对话。
4. 删除已无引用的 `extractToolErrors`(连同其测试)——属 dead code。

### store

5. `store/index.ts` `ingestKoubou`:删除 `error` 事件写 `AGENT` toast、工具失败写 `TOOL` toast 两段;清理 `isFresh`/`extractToolErrors`/`ClaudeMessagePayload` 相关引用。

### UI(复用 danger token,不新增一次性样式)

6. `MessageItem.tsx`:助手分支 switch 新增 `case 'error'`,渲染 danger 气泡(`--color-danger` / `--color-danger-soft`,`role="alert"`)。
7. `ToolCard.tsx`:`status==='error'` 时——状态把 prevRunning 机改 prevStatus(失败保持展开)、状态标签转 danger、Output 块转 "Error" + danger 配色。

### 测试

- `apply-koubou.test.ts`:改写 is_error 用例(期望 `status:'error'` + `result`);新增「error 事件(无匹配弹窗)冒泡为 error 气泡」;保留 stale 用例并断言不冒泡;删 `extractToolErrors` 测试。
- `koubou-seed.test.ts`:删除已废的「工具失败 → toast」block。
- 跑 `vitest run` + `tsc --noEmit` + `lint`。
