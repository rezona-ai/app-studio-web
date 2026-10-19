# Agent 对话消息复制与编辑设计稿

> 日期：2026-07-25
> 状态：待实现

## 背景

当前 Agent 对话只负责渲染用户输入与助手输出，没有消息级快捷操作。用户想复用历史 prompt 时只能手动选择文本；想复制助手的 Markdown 输出时也需要从渲染后的内容中拖选，代码块、列表和链接等原始语法容易丢失。

Koubou 当前没有“改写历史消息并从该点重跑”的前端契约。用户消息由 Composer 乐观插入，历史真相来自可重放事件；直接修改本地 `messages` 会造成前端快照与服务端事件日志不一致。

## 目标

- 用户消息提供“复制”和“编辑”操作。
- 每轮助手回复结束后提供一个“复制”操作，不插入同一轮的 text/tool 中间。
- 复制使用消息的原始文本：
  - 用户输入保留原始 `@key` / `@[type]<url>` 引用串；
  - 助手输出聚合该轮全部文本 part，以空行连接并保留原始 Markdown。
- 编辑把用户原始输入回填到 Composer，并把光标聚焦到文本末尾，供用户修改后再次发送。
- 复制成功有短暂的勾选反馈；失败复用全局 Warning Toast。
- 操作按钮支持键盘聚焦与本地化无障碍标签。

## 成功标准

1. 用户文本消息悬浮或键盘聚焦时显示复制、编辑按钮。
2. 点击用户消息复制按钮，剪贴板收到未经过引用剥离和 Markdown 渲染的原始文本。
3. 点击编辑按钮，Composer 草稿替换为原始文本，现有附件不被静默删除，输入框获得焦点且光标位于末尾。
4. 助手回合结束后只显示一个复制按钮，复制该轮全部文本 part 的原始 Markdown；纯工具回合不显示无意义的复制按钮。
5. 同一回合的“工具 → 正文 → 工具”内部不插入操作栏，也不为透明按钮预留额外高度。
6. 复制成功时复制图标短暂切换为勾选；剪贴板拒绝时写入既有全局 Warning Toast。
7. 不修改 Koubou 消息历史、协议或持久化快照；完整本地门通过。

## 约束

- 状态协调继续走唯一 zustand store；`MessageItem` 不直接查询或操纵 Composer DOM。
- UI 复用 `IconButton`、`Tooltip`、`FigIcon`、现有 copy/check/pencil 资源及 CSS 变量。
- 不新增硬编码颜色、按钮种类、Toast 或一次性动画。
- 消息复制只处理文本，不把附件转换成 URL 文本。
- 编辑只替换草稿文本，不改写已发送消息，不回滚后续对话。
- 编辑不复原历史媒体附件：消息模型不保存可安全重发所需的完整 `ChatAttachment` 元数据，部分文本附件也没有 URL 或正文。

## 方案比较

### 方案一：组件内直接写剪贴板并调用 `composerSet`

在 `MessageItem` 内添加按钮；编辑时直接 `composerSet({ draft })`，不处理聚焦。

优点是改动最少。缺点是 Composer 不会主动聚焦，跨组件行为不完整；后续若通过 DOM 查询补聚焦，会违反组件间只经 store 协调的约束。

### 方案二：消息操作子组件 + store 编辑请求（推荐）

新增消息操作子组件承载剪贴板反馈；store 新增原子 action，在同一次更新中替换草稿并递增瞬态聚焦请求；Composer 订阅请求并自行聚焦。

优点是职责清晰，消息组件不直连 Composer，草稿与聚焦请求原子更新，符合单向数据流。新增状态仅为一个不持久化的递增值，范围可控。

### 方案三：真正修改历史消息并从该点重跑

点击编辑后修改历史气泡、截断后续消息并请求 Koubou 重跑。

这最接近部分聊天产品的“原地编辑”，但当前后端没有对应契约；前端单方面实现会破坏事件重放和 `lastSequence ↔ messages` 一致性，也会引入后续消息、资产和版本如何回滚的问题。本需求不采用。

## 设计

### 文本提取

文本提取分两层：

- 用户文本：过滤 `type === 'text'`，以换行连接，沿用当前用户气泡的 `raw`；
- 助手文本：`selectTurnAnchors` 以已结束回合的 `lastMessageId` 为边界，从上一条用户消息或上一回合边界开始，聚合该轮所有 assistant 消息的非空 text part，以空行连接。

用户气泡展示仍使用 `extractRefs(raw)` 生成 chips 和剥离引用后的正文；复制与编辑始终使用剥离前的 `raw`。纯工具、thinking、error 或 notice 不混进助手回合复制文本。运行中回合尚无稳定结束边界，不显示输出复制按钮。

### 消息操作栏

抽出共享的 `MessageActions.tsx`：

- 复制按钮：`IconButton(ghost)` + `FigIcon(copy/check)` + `Tooltip`；
- 用户消息额外提供编辑按钮：`FigIcon(pencil)`；
- 用户操作栏绝对定位在气泡下方，默认透明，消息 hover 或操作区 focus-within 时显示；消息使用固定底部间距，不因 hover 改变布局；
- 助手操作栏由 `ChatPanel` 在已结束回合的锚点后按普通文档流渲染，始终可见且左对齐；
- 复制成功后 2 秒恢复 copy 图标，卸载时清理 timer；
- `navigator.clipboard.writeText` 失败时调用 `setWarning({ code: 'CLIPBOARD', ... })`。

按钮只在有对应文本时出现。用户媒体-only 消息没有可复制或编辑的文本，不渲染空操作栏；助手纯工具回合同理。

### 编辑与聚焦

store 增加：

- 瞬态 `composerFocusRequest: number`，初始为 0，不进入 `partializeAppState`；
- action `editComposerDraft(draft)`，在同一次 `set` 中：
  - 只替换 `composer.draft`；
  - 保留 `composer.attachments` 与 `baseLines`；
  - `composerFocusRequest + 1`。

Composer 订阅 `composerFocusRequest`。值变化后由 Composer 自己聚焦 textarea，并把 selection 移到当前草稿末尾。这样 MessageItem 不持有 Composer ref，也不需要 DOM 查询或跨组件回调。

### 国际化

在所有 locale 的 `chat.message` 下增加：

- `copy`：复制消息；
- `copied`：已复制；
- `edit`：编辑消息。

Tooltip 与 `aria-label` 共用这些词条。

## 测试策略

- `src/components/chat/MessageItem.test.tsx`
  - 用户消息复制原始引用文本；
  - 用户消息编辑后替换草稿但保留现有附件；
  - 剪贴板拒绝后写入 Warning Toast。
- `src/store/selectors.test.ts`
  - 已结束回合按锚点聚合全部 assistant 文本；
  - 多回合不串文本，运行中回合不生成复制文本。
- `src/components/chat/ChatPanel.test.tsx`
  - 同一回合的中间正文不显示操作栏；
  - 回合末尾只显示一个复制按钮并复制聚合后的 Markdown；
  - 纯工具回合不显示复制按钮。
- `src/components/chat/Composer.test.tsx`
  - `editComposerDraft` 触发后 textarea 获得焦点，光标位于新草稿末尾。

先添加失败测试并确认失败原因，再实现最小代码转绿。

## 非目标

- 不修改、删除或截断 Koubou 历史事件。
- 不在编辑后自动发送。
- 不复原历史附件或重新上传媒体。
- 不复制 thinking、工具输入输出、错误气泡或系统 notice。
- 不新增复制埋点；当前埋点只覆盖游戏链接复制，没有消息复制事件契约。
