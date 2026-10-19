# 流式正文逐字渐显输出 — 设计

## 背景与问题

对话框里助手正文来自 koubou WebSocket 的流式事件。`src/koubou/apply-koubou.ts` 的 `applyStreamEvent`
在收到 `content_block_delta`(text_delta) 时直接做 `text: p.text + delta.text` 累加进 store，
`MessageItem → RichText` 监听 store 变化后整段重渲染。

上游 SDK 的 delta 是**成块**到达的(一次多个 token、节奏不均),导致正文一阵一阵"跳"出来,不够顺滑。

## 目标

在**渲染层**加一道缓冲,把"成块跳现"变为"逐字平滑吐出 + 新字渐显":
store 保持不变(仍是完整累加文本的唯一数据源),定时器把"已到达但未显示"的文本逐字揭示,
每个定时器周期吐出的小段带渐显过渡。

## 非目标

- 不改 store / reducer / koubou 协议。
- 不对 thinking 思考块生效(已有独立的流式折叠指示)。
- 不对用户消息、历史消息、非流式消息做逐字回放。

## 关键决策(已与用户确认)

| 决策点 | 选择 |
| --- | --- |
| 作用范围 | 仅 assistant 的 `text` part |
| 节奏策略 | 自适应追赶 + 结束打完 |
| 渐显粒度 | 按 tick 分块渐显(每个定时器周期的小段包一层 fade-in) |
| 逻辑位置 | 组件级 hook,store 不动 |

## 架构与数据流

```
store(完整累加文本 · 唯一数据源)
 → MessageItem(判定 streaming)
   → StreamingText(target, streaming)
       useTypewriter(target, active) → { head, tail[] }
       渲染: head 段落(复用内联解析) + tail 各 chunk 的 .tw-fade span
```

各单元职责清晰、可独立测试:

- `useTypewriter` 只管"目标文本 + 是否流式" → "已揭示文本拆成 head/tail",纯时序逻辑,不碰 DOM 结构。
- `StreamingText` 只管把 head/tail 渲染成带渐显的 DOM,复用既有 markdown 解析。
- store / reducer 不变。

## 组件设计

### 1. `useTypewriter` hook(`src/client/useTypewriter.ts`)

入参 `(target: string, active: boolean)`。内部状态:`shown`(已揭示字数)、`chunks`(近期尾段队列)。

每 tick(`TICK_MS ≈ 24ms`):

1. `backlog = target.length - shown`
2. 自适应步长 `step = clamp(ceil(backlog / CATCHUP), MIN_STEP, MAX_STEP)`
   - **常态**(backlog < `MAX_STEP × CATCHUP`):`step ≈ backlog/8`,backlog 指数收敛,约 40 字/秒起、逐字平滑
   - **突发大块 delta**:步长封顶 `MAX_STEP`,以约 500 字/秒稳定追平;封顶限制单次渐显块大小,
     避免一大段同时跳现 —— 始终略滞后但不会落后太多
   - 实际中模型吐字速率(中文常态约百余字/秒)低于追赶上限,backlog 多数时间处于常态区,保持平滑
3. 新揭示的 `step` 个字符作为一个新 chunk 入队(递增 id),推进 `shown`
   - 步进 **snap 到 `\n\n` 段界**:若本次步进会跨越段落空行,则截断到空行前,保证尾段恒为单段落
4. 超过 `FADE_MS` 的旧 chunk 折叠进 `head`(控制 tail 长度,span 数恒为个位~十几个)

边界处理:

- `active` 转 false(消息 ready)但 `shown < target.length` → 继续 tick **把剩余打完即停**(结束打完)
- 首次挂载即 `active = false`(历史 / 非流式消息) → 直接 `shown = target.length`,无动画(历史不回放)
- `prefers-reduced-motion: reduce` → 直接 snap 全量、无渐显

返回 `{ head: string, tail: { id: number; text: string }[] }`,满足 `head + tail 各段拼接 = target.slice(0, shown)`。

### 2. `StreamingText` 组件(`src/components/chat/StreamingText.tsx`)

入参 `(text: string, streaming: boolean, className?: string)`,内部调用 `useTypewriter(text, streaming)`。

渲染规则:

- head 的完整段落用复用的内联解析正常渲染(`**加粗**` / 软换行 `\n` / 空行 `\n\n` 分段)
- **最后一个进行中段落**末尾,在同一个 `<p>` 内,紧跟 tail 各 chunk 的 `<span class="tw-fade" key={chunk.id}>`,保证文字内联接续(不另起块、不掉到下一行)
- tail 为纯文本(不解析加粗)——仅末尾几字、约 280ms 内的过渡,肉眼无感;chunk 毕业进 head 后即按完整 markdown 重渲染
- `key = chunk.id`:仅新 chunk 挂载触发一次 CSS 渐显,旧 chunk 不重放

### 3. 复用内联解析

把 `RichText` 的 `renderInline` + 段落拆分逻辑抽到共享模块(`src/components/chat/richText.tsx` 内导出,
或新建轻量模块),`RichText` 与 `StreamingText` 共用同一份 markdown 解析,避免两套实现漂移。
`RichText` 改成基于共享解析的薄封装,行为不变。

### 4. CSS(`src/app/globals.css`)

沿用项目既有约定(普通 `@keyframes` + 类名 + reduced-motion 降级块):

- `@keyframes tw-fade`:`opacity 0 → 1` + 轻微 `translateY(1px) → 0`,约 280ms ease-out
- `.tw-fade` 类挂上述动画
- `@media (prefers-reduced-motion: reduce)` 下 `.tw-fade { animation: none }`

### 5. MessageItem 接线(`src/components/chat/MessageItem.tsx`)

assistant 的 `text` part 改用:

```tsx
<StreamingText
  text={p.text}
  streaming={message.status === 'generating' && i === lastTextPartIndex}
/>
```

其中 `lastTextPartIndex` 为该消息中最后一个 `text` part 的下标(只有尾部 text part 在持续增长)。
用户消息及其它 part 保持 `RichText`。

### 6. 可调常量(hook 顶部)

| 常量 | 默认值 | 含义 |
| --- | --- | --- |
| `TICK_MS` | 24 | 定时器周期 |
| `MIN_STEP` | 1 | 每 tick 最少揭示字数 |
| `MAX_STEP` | 12 | 每 tick 最多揭示字数(封顶单次渐显块,约 500 字/秒追赶上限) |
| `CATCHUP` | 8 | 自适应追赶除数(越小追得越快) |
| `FADE_MS` | 280 | 渐显时长 / chunk 毕业阈值 |

## 测试策略(vitest + fake timers + React Testing Library)

`useTypewriter`:

- 逐字推进:fake timers 推进后 `head + tail` 长度随时间增长
- 自适应步长:大 backlog 时单 tick 揭示字数更大(追赶)
- 结束打完:`active` 转 false 后继续打完剩余并停止(定时器清理)
- 首挂终态即 snap:初始 `active = false` 时一次性全量、无逐字
- reduced-motion:模拟 `matchMedia` reduce → 直接全量

`StreamingText`:

- head 的 `**加粗**`、空行分段渲染正确
- tail chunk 渲染为带 `tw-fade` class 的 span
- 随 fake timers 推进,tail 的 span 数收敛(旧 chunk 毕业)

## 风险与取舍

- **段界落入尾段**:用步进 snap 到 `\n\n` 段界规避,保证尾段恒为单段落。
- **tail span 数量**:受 `FADE_MS` 上限约束(个位~十几个),无性能隐患。
- **加粗跨 head/tail 边界**:tail 不解析加粗,仅影响末尾几字 ~280ms 的过渡,毕业后即恢复完整 markdown,肉眼无感。
- **节奏手感**:常量集中在 hook 顶部,便于后续按真机体验微调。
