# document 资产统一与纯文本内联发送 设计稿

日期:2026-07-10

## 背景

1. Landing page 现支持上传五种资产(image/video/audio/3d/document)后带参跳转工作台,其中 **document 涵盖纯文本(txt/md)与 PDF**,线格式 `kind: 'document'`。当前 `parseStudioPrelude` 严格校验 kind 须在 `KIND_ORDER` 内,`document` 会被**静默丢弃**。
2. 资产引用已实现 `@[type]<url>` 新格式(`refs.ts` 的 `applyMentionTokens`/`MENTION_TYPE`),但对话栏附件发送仍在用旧 `@url` 裸串(`Composer.tsx` 的 textFolded);且纯文本文件走 URL 引用后 agent 需要额外工具取内容,上传与 @引用两条路对纯文本都不可用。

## 目标

- landing 传入的 `document` 资产可正常进入对话栏附件并发送。
- 非图片附件发送统一升级 `@[type]<url>` 格式;PDF 不再走原生 Anthropic document 内容块。
- **纯文本内容直接内联进正文发送**(附件与 @引用画布 text 节点两条路),agent 无需再取。

## 设计决策

### ① 边界归一:`document` → 内部 `text`(不新增枚举成员)

`document` 只是两处边界上的线格式名(landing 入参 kind、mention token `@[document]`)。内部 `AssetKind` 的 `'text'` 是既有一等类型(TextNode/筛选/令牌/PGC `type: 'text'`/persist 迁移/埋点),与 PGC 契约同名。故:

- `studio-prelude.ts` 的 `parseAssets`:kind 校验在 `KIND_ORDER` 之外额外接受 `'document'`,归一为 `'text'`。
- `MENTION_TYPE`(`text → 'document'`)维持不变,构成对称的出边界映射。

### ② `ChatAttachment` 增加 `text?: string`(纯文本内容缓存)

- **本地上传**(`uploadChatAttachment`):mime 命中 `TEXT_MIMES`(`text/plain`/`text/markdown`)时,在上传 PGC 的同时 `file.text()` 读内容存入附件。
- **prelude 种子**(`applyStudioPrelude`):按 url/name 扩展名判定纯文本(`.txt`/`.md`/`.markdown`);命中者经同源媒体代理 `/api/pgc/asset` fetch 内容。**fetch 完成后才置 ready 并 arm 自动发送**(保证自动发送时内容已就位);拉取失败降级为无 `text`(发送走 `@[document]<url>` 兜底),不阻塞流程。
- `.pdf` 及其他扩展不内联。

### ③ 发送三分路(`Composer.tsx` send)

| 附件 | 发送形态 |
|---|---|
| image | 原生 image 内容块(不变) |
| 带 `text` 的纯文本附件 | 内联 `<attachment name="文件名">内容</attachment>` 拼在正文后 |
| 其余(video/audio/3d/pdf/拉取失败的纯文本) | `@[MENTION_TYPE[kind]]<url>` token |

- PDF 的原生 document 内容块分支删除。
- steer 路径(run 进行中)同样适用文本折叠;image 维持现状丢弃,本次不动。
- 气泡文本(bubbleText)与 Koubou 侧文本天然分离:内联标签只出现在发给后端的文本,气泡仍显示干净草稿 + chip。

### ④ @引用画布 text 节点:发送时内联内容

- `applyMentionTokens`:`kind === 'text'` 且有 `preview.text`(PGC `content` 内联,见 `pgc/map.ts`)的资产,替换为 `<attachment name="节点label">内容</attachment>`;无 `preview.text` 仅有 `src` 的降级 `@[document]<url>`。签名需能取到 label 与 preview.text(扩展 `MentionAsset` 形状)。
- `canMention` 对 text 资产放宽为:ready 且(有 `preview.text` **或** `preview.src`)。
- 输入框引用 pill **维持现状显示 `@key`**,不改为节点名称。

### ⑤ 回显兼容

`extractRefs` 已识别 `@[type]<url>` 反查资产,不需改动。内联 attachment 标签不会出现在气泡文本中(见③),无回显问题。

## 错误处理

- prelude 纯文本 fetch 失败:降级 URL token,附件仍 ready 可发送;不弹 Toast(agent 侧仍可经工具取 url)。
- prelude JSON 非法/条目非法:沿用现有"非法条目丢弃、整体回退空"哲学。

## 测试

- `studio-prelude.test.ts`:`document` kind 通过校验并归一 `text`;非法 kind 仍丢弃。
- `refs.test.ts`:text 节点带 `preview.text` → 内联标签;仅 src → `@[document]<url>`;`canMention` 放宽逻辑。
- `Composer.test.tsx`:纯文本附件内联发送;PDF 走 `@[document]<url>` 且无 document 块;video/audio/3d 走新格式 token;气泡不含内联标签。
- store 侧:`uploadChatAttachment` 读文本入 attachment;`applyStudioPrelude` fetch 成功/失败两态。
