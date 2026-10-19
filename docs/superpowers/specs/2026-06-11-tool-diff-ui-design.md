# 工具消息文件修改 diff UI 设计

> 日期:2026-06-11
> 背景:ws 最新文档为工具消息新增了文件修改的 diff(`payload.tool_use_result.structuredPatch`),需要把对应的 UI 加上,在聊天里直接看到 Edit/Write 改了哪些行。

## 目标

- Edit/Write 等改文件的工具,在其 `ToolCard` 里展示**紧凑彩色 diff**,而不是原始参数 JSON / 结果文本。
- diff 随消息持久化,刷新后可复原(走本地缓存)。
- 严格限定在"diff 展示",不改动审批 / 提问 / 媒体等其它路径。

## 数据来源(ws 协议)

文件修改通过 `UserMessage` 的 `payload.tool_use_result` 下发(与 `tool_result` 同一条消息),不是单独事件。字段:

| 字段 | 类型 | 含义 |
|------|------|------|
| `type` | `"create"` \| `"update"` | 新建 / 修改 |
| `filePath` | string | 目标文件路径 |
| `content` | string | 新建文件的完整文本 |
| `oldString` / `newString` | string | 编辑前后文本(仅 update) |
| `structuredPatch` | array | 真正的 diff hunk 数组 |
| `originalFile` | string | 原始整文件(上下文展开用,本期不用) |
| `userModified` | boolean | Claude 上次读取后用户是否又改过该文件 |

每个 hunk:`{ oldStart, oldLines, newStart, newLines, lines[] }`;`lines` 前缀 `" "`=上下文、`"-"`=删除、`"+"`=新增、`"\"`=无换行标记。

> 字段大小写:envelope key 用 snake(`tool_use_result`),内部 SDK 字段用 camel(`filePath`、`structuredPatch`、`oldStart`…)。解析时对两种写法做防御(同时认 `tool_use_result`/`toolUseResult`)。

## 架构与改动点

### 1. 类型(`src/koubou/protocol.ts`)

新增原始类型与归一类型:

```ts
// 原始(ws 下发形状)
export interface StructuredPatchHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
export interface ToolUseResultRaw {
  type?: 'create' | 'update';
  filePath?: string;
  content?: string;
  oldString?: string; newString?: string;
  structuredPatch?: StructuredPatchHunk[];
  userModified?: boolean;
  [k: string]: unknown;
}

// 归一(UI 直接消费)
export type DiffLineKind = 'context' | 'add' | 'del';
export interface DiffLine { kind: DiffLineKind; text: string }
export interface DiffHunk { lines: DiffLine[] }
export interface FileDiff {
  type: 'create' | 'update';
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  userModified?: boolean;
}
```

- `ClaudeMessagePayload.payload` 加可选 `tool_use_result?: ToolUseResultRaw`(同时兼容 `toolUseResult`)。
- 新 helper `parseFileDiff(raw): FileDiff | null`:
  - 取 `structuredPatch` → 每个 hunk 的 `lines` 归一成 `DiffLine[]`;`\` 开头(无换行标记)丢弃;`+`→add、`-`→del、其余→context(去掉前缀字符)。
  - `additions`/`deletions` 由 add/del 行计数。
  - 无 `structuredPatch` 但 `type==='create'` 且有 `content` → 整文件按全 `add` 构造单 hunk,`deletions=0`。
  - 缺 `filePath` 或既无 patch 又无 content → 返回 `null`。

### 2. store 类型(`src/store/types.ts`)

`Part` 的 `tool` 分支加可选字段:`diff?: FileDiff`(从 protocol re-use,沿用 `MediaGenerated` 的引入方式)。

### 3. reducer(`src/koubou/apply-koubou.ts`)

- `onClaudeMessage` 的 `UserMessage` 分支:读取 `payload.tool_use_result`,`parseFileDiff` 得 `FileDiff`,连同 `results` 传入 `foldResults`。
- `foldResults(messages, results, diff?)`:折叠 `tool_result` 到对应 tool part 时,若 `diff` 存在:
  - **匹配规则**:优先按 `filePath` 匹配 tool part 的 `input.file_path`(兼容 `filePath`/`path`);匹配不到时,若本批只有一个 `tool_result` 则挂到它;否则不挂(避免并行工具挂错)。
  - 命中后 `part.diff = diff`。
- 冷启动从 `visible_state` 重建(`rebuildHistory`):history view 若带 `tool_use_result` 则同样解析折叠(best-effort);拿不到则降级为无 diff,刷新后走本地持久化缓存复原。

### 4. 渲染

**新组件 `src/components/chat/DiffView.tsx`**

- 入参 `{ diff: FileDiff }`。等宽字体逐行着色:
  - context:灰(`--color-muted`),前缀两空格对齐。
  - del:红底,行首 `-`。
  - add:绿底,行首 `+`。
- 多 hunk 之间一条淡分隔线(`--color-line`)。
- `max-h` 限高 + `overflow-auto`,`whitespace-pre` 不换行、横向可滚动;沿用 ToolCard 现有色板变量,不引新依赖。

**改 `src/components/chat/ToolCard.tsx`**

- 头部:`part.diff` 存在时,在工具名后追加文件 basename(如 `Edit  player.ts`)+ `+{additions} −{deletions}` 统计(绿/红);`userModified` 为真加小号角标 "用户已改"。
- 折叠体:`part.diff` 存在时**用 `<DiffView>` 取代**原始 args JSON 与结果文本(两者已被 diff 表达,避免重复);media 渲染保持不变。
- 折叠行为不变:运行中展开、完成折叠,头部统计常驻,用户可手动切换。`hasBody` 计算把"有 diff"纳入。

## 测试

- `apply-koubou.test.ts`:
  - update:`tool_use_result.structuredPatch` 解析,按 `filePath` 挂到正确 tool part;add/del 计数正确。
  - create:无 patch 有 content → 全新增、`deletions===0`。
  - 并行多 tool_result + 单 diff:只挂到 filePath 命中的那个。
- `DiffView.test.tsx`:三类行着色/前缀正确;多 hunk 出分隔。
- `ToolCard.test.tsx`:有 diff 时渲染 DiffView、显示 `+N −M`,且不再渲染原始结果文本。

## 非目标(YAGNI)

- 不做行号槽 / `@@` hunk 头 / 语法高亮 / 行级展开更多上下文(`originalFile` 暂不用)。
- 不做 diff 折行换行模式切换。
- 不改审批、AskUserQuestion、media.generated 等既有路径。
