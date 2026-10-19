# 资产 @提及内联 token(`@[type]<url>`)设计稿

- 日期:2026-07-09
- 关联工作项:Meegle #13319506「画布内的资产 agent 能够通过@调用到游戏里」
- 后端契约:koubou-agent-py `docs/frontend/mention-resource-interface.md`

## 背景与目标

后端新增 mention 资源接口:前端在用户消息**正文内**插入字面 token `@[type]<url>`,后端按出现顺序展开,使引用与就近文本绑定。`type` 严格限定 `image | video | model3d | audio | document`(区分大小写);`url` 必须是 preview_base 同 host 的项目预览地址,非法类型或 host 不匹配会被后端直接拒绝。

现状:`@` 提及选中后进 `composer.refs` 数组,发送时统一以 `@<preview.src|key>` 追加在消息**末尾**,丢失位置语义;无 preview 的资产回退发 `@key`(后端无法使用)。

目标:引用 token 内联在用户光标位置、按新格式发送;用户可见的胶囊展示(输入框 chip / 消息气泡 chip)**保持现状不变**,仅在正文中新增一个 skill 风格的 `@key` 内联标记。

## 设计

### 1. 草稿内联表示:`@key`

输入框是「透明 textarea + 镜像层」结构,两层必须逐字符对齐,镜像层不能把长 URL 渲染成短胶囊。因此草稿中不存完整 token,存 **`@key`**(资产 key 唯一、无空白):

- **插入**:MentionPopover 选中 → 光标处把正在输入的 `@query` 替换为 `@key `(尾随空格终结 mention 态),光标落在其后;画布右键「引用到对话」→ 追加 `@key ` 到草稿末尾。
- **镜像层着色**:与 skill pill 同构——新增 `splitMentionTokens`(或扩展现有分段逻辑)把命中**现有资产 key**的 `@key` 段包成 `--color-teal-soft` 背景胶囊 span,不加水平 padding、文本原样,不破坏光标对齐。
- **发送时替换**:`send()` 内把草稿中的 `@key` **原位**替换为 `@[type]<url>`,`url = asset.preview.src`;steer 路径(运行中发送)走同一替换。气泡展示用的本地消息(`pushUserMessage`)存替换后的文本,与实际发给 Koubou 的内容一致。

kind → type 映射(独立纯函数,单测覆盖):

| AssetKind | mention type |
|---|---|
| image | image |
| video | video |
| audio | audio |
| 3d | model3d |
| text | document |

### 2. refs 派生化:chip 与正文标记单一真相

`composer.refs` 不再是独立数组,改为**从草稿派生**(扫描命中资产的 `@key`,去重保序):

- AttachmentBar 的资产 chip 展示照旧(同款 AssetChip),数据源换成派生值;
- chip 上点删除 = 从草稿中删除对应的所有 `@key`(及紧邻空格);
- 用户手动删改正文 `@key` = chip 自动消失;
- `addRef(key)` action 语义改为「向草稿插入 `@key `」;`canSend` 去掉 `refs.length` 条件(有 `@key` 则草稿必非空);`resetComposer` 行为不变(清草稿即清引用)。

### 3. 消息气泡:展示方式不变,识别新格式

`extractRefs` 扩展:除现有 `@url` / `@key` 历史格式外,识别 `@[type]<url>` 新格式(按 url 反查资产 key),命中则剥离并回填 key,气泡沿用现有「正文 + 末尾资产 chip」展示。反查不到的 token(如资产已删除)原样保留为文本,不误伤。

### 4. 候选过滤:源头保证 token 有效

- MentionPopover 候选仅列 `status === 'ready'` 且有 `preview?.src` 的资产;画布右键入口对不满足条件的资产禁用「引用到对话」项。
- 无 preview 的资产不可提及——不再有 `@key` 回退发送路径,`refToken` 的 key 回退逻辑随之删除。
- 前端不做 preview_base host 校验:`preview.src` 即后端下发的预览地址,天然同源。

### 5. 明确不做

- 聊天上传附件(视频/音频)的 `@url` 纯文本折叠格式**本次不动**——附件 URL 是上传存储地址,不保证与 preview_base 同 host,待后端明确支持后单独处理。
- 不引入 contentEditable;镜像层胶囊只做背景着色,输入框内显示 key 文本(hover Tooltip 可显示资产名,作为可选增强)。

## 数据流

```
MentionPopover / 画布右键
        │ 插入 "@key "
        ▼
composer.draft ──派生──▶ refs(chip 展示,双向:删 chip 即删文本)
        │ send():@key → @[type]<url> 原位替换
        ├──▶ pushUserMessage(本地气泡,存替换后文本)
        └──▶ Koubou WS(sendUserMessage / steer)
                              │
MessageItem.extractRefs ◀── 气泡渲染:剥离 token → 末尾资产 chip
```

## 错误处理

- 资产在草稿存续期间被删除:`@key` 不再命中 → 镜像层胶囊消失、chip 消失、发送时不替换(作为普通文本发出,与现状一致,不额外拦截)。
- 发送时资产存在但 `preview.src` 缺失(理论不可达,候选已过滤):不替换、原样发文本,不阻塞发送。

## 测试

- `refs.ts` 纯函数 TDD:kind→type 映射、`@key` 原位替换(多引用、句中/句首/句尾、重复 key)、草稿派生 refs、气泡侧新旧格式识别与反查、资产缺失降级。
- 组件测试更新:Composer(插入位置、镜像胶囊分段、发送替换、steer 路径、chip 删除同步草稿)、MentionPopover(候选过滤)、MessageItem(新格式剥离)、ContextMenu(禁用态)。
