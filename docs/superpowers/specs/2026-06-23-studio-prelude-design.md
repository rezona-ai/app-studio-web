# 外部页面传参进入工作台(Studio Prelude:模型 / 提示词 / 资产预填)设计稿

> 日期:2026-06-23 · 状态:已与用户确认设计,待 spec 评审

## 背景与目标

外部页面(host 主站的某入口页)让用户先选好 **模型 + 提示词 + 多个资产**,再跳进工作台 `/studio`。进入后工作台要把这三者**分别预填**到对应位置:模型选择器、对话输入框、输入框上方的资产引用区。当前 `/studio` 没有任何"从外部带参预填"的通道——landing 的 `PromptBox` 只把 `composer.draft` 写进**持久化 store** 后跳转(同源同子应用才成立),外部页面是**另一个应用**,不能耦合子站内部的 persist schema。

目标:定义一条**解耦的传参通道**,把外部选择落到工作台的现有 store 字段,不新增机制、不改发送链路。

### 已确认的产品决策

| 决策点 | 选择 | 含义 |
|---|---|---|
| 进入方式 | **新标签 / 整页跳转,URL 携带参数** | 与现有 `window.open(pagePath('/studio'))` + `?project=` 约定一致;不走 postMessage(那条留给 iframe 内嵌的 `taluna-config`)。 |
| 资产来源 | **已在 PGC 入库,传 URL** | 资产不进画布,仅作为被引用内容显示在输入框上方,随提示词一起发送。 |
| 项目归属 | **进入时新建项目(不传 project)** | 外部页不带 `?project=`;进入时强制新建一个项目承载本次会话。 |
| 资产落点 | **复用 `composer.attachments`** | 而非新造概念,也非 `composer.refs`。 |
| 是否自动发送 | **否** | 预填后停在 composer,用户检查/编辑后手动发送。 |
| 刷新语义 | **接受刷新丢资产 chip** | `attachments` 不持久化;提示词(`draft`)持久化故仍在。 |

## 落点:三个槽位 → 现有 store 字段(零新增机制)

| 外部参数 | 落点 | 写入 action |
|---|---|---|
| 模型 | `selectedModel` | `setSelectedModel(id)` |
| 提示词 | `composer.draft` | `composerSet({ draft })` |
| 资产(多个) | `composer.attachments` | `composerSet({ attachments })`,每条预置 `{ id, name, mime, kind, status:'ready', url }` |

**为什么资产用 `attachments` 而不是 `refs`**:`refs` / `AssetChip`(`AttachmentBar.tsx`)要求资产已在 `store.assets`(画布)里按 `key` 取;本场景资产不进画布、只有 URL,refs 取不到对象。`attachments` 用 `url` 直接渲染缩略图(`MediaThumb`),`AttachmentBar` 正好渲染在 `<textarea>` 上方,`Composer.send()` 已有现成路径随消息发送。且我们预置的项**不带 `itemId`**,`removeChatAttachment` 对无 `itemId` 的项只做本地丢弃、**不会误删 PGC**(见 `src/store/index.ts` 的 orphan 删除守护)。完全契合"显示在输入框上方 / 随提示词发送 / 不进画布"。

**发送链路无需改动**(`Composer.send()` 现有逻辑):`status:'ready'` 且有 `url` 的附件被纳入发送;`image` kind → image url 内容块,其余 kind → `@url` 折进文本(符合 koubou WS `user.message` 契约:仅 text/image 块,图片 URL 须公网可达)。

## URL 参数 schema

```
/studio?model=<id>&prompt=<encoded>&assets=<encoded-json>
```

- `model`:模型 id 字符串,原样(如 `claude-...`)。缺省则不预设模型,走默认解析。
- `prompt`:`encodeURIComponent(文本)`。缺省则空输入框。
- `assets`:**单个**参数,值为 `encodeURIComponent(JSON.stringify(AssetSeed[]))`,`AssetSeed = { url, kind, name? }`。
  - `url`:**公网可达**的资产 URL —— koubou 后端要能直接取(见 koubou WS `user.message` 契约);**不要**传 `/api/pgc/asset` 这类同源代理地址(koubou 后端取不到)。
  - `kind`:`image | video | audio | 3d | doc`(`AssetKind`)。决定缩略图渲染与发送路由(image→image block;其余→`@url` 文本)。
  - `name`:chip 标签,可选;缺省由 `url` 文件名兜底。
  - 非法/缺 `url`/`kind` 不在枚举的条目 → 跳过该条(沿用"非法帧 try/catch 跳过"哲学),不整体失败。

三个参数**全部可选且互相独立**:只要 `parseStudioPrelude` 解析出至少一个非空字段,即视为有 prelude,走新建项目分支;全空/全缺则视为无 prelude。

### 编码备选(本期不实现,记录于此)

内联 JSON 经验上把整个 URL 控制在 ~8KB 内即安全(同源 GET,需穿过共享 LB)。若后续资产多 / prompt 长撑大 URL:① `assets` 改 `base64url(JSON)` 抗中间层 mangle;② 再大改服务端 handoff token(外部页先 POST 存,带 `?prelude=<token>` 进来取)。**本期用内联 URL-encoded JSON**,够用且可调试。

## 架构:纯解析 + 副作用分层(镜像 host-config)

新增两文件,严格沿用现有 `src/lib/host-config.ts`(纯)+ `src/client/useHostConfig.ts`(副作用)的分层:

### `src/lib/studio-prelude.ts`(纯函数,可单测)

```ts
export interface AssetSeed { url: string; kind: AssetKind; name?: string }
export interface StudioPrelude { model?: string; prompt?: string; assets: AssetSeed[] }

// 解析 location.search;无任何有效字段返回 null
export function parseStudioPrelude(search: string): StudioPrelude | null

// AssetSeed → 预置的 ready ChatAttachment(id 用 newId('att');mime 由 kind 兜底或空;无 itemId)
export function seedToAttachment(seed: AssetSeed): ChatAttachment
```

- `model`/`prompt`:取 query 同名参数,`prompt` 已由 URLSearchParams 解码。
- `assets`:`JSON.parse` 后逐条归一(校验 `url` 非空、`kind` 在 `AssetKind` 枚举内),非法条目丢弃;`JSON.parse` 抛错 → `assets: []`。
- 返回 null 的条件:`model`/`prompt` 皆空 **且** `assets` 为空。

### `src/client/useProjectBootstrap.ts`(改造为二选一)

把 prelude 判定并进现有 bootstrap,**避免双建竞态**(prelude 又 createProject、`loadProjects` 又复用/建默认项目):

```
挂载时(once):
  const prelude = parseStudioPrelude(location.search)
  if (prelude) applyStudioPrelude(prelude)   // 新建项目分支
  else loadProjects()                          // 原路径,保持现状
```

`applyStudioPrelude`(新增 store action,走 guard;bootstrap hook 仅在挂载时调一次):

1. `await createProject(DEFAULT_PROJECT_NAME)` —— **强制新建**(现有 `loadProjects` 是"复用最近",不符合需求)。
2. await 落地后校验 `currentProjectId` 非空(创建失败则 guard 已转 Toast,提前返回不预填)。
3. `setSelectedModel(prelude.model)`(有才设)+ `composerSet({ draft: prelude.prompt ?? '', attachments: prelude.assets.map(seedToAttachment) })`。
   - 注:`selectProject`(由 createProject 内部调用)**不重置 composer**,故在其后写 composer 安全;为稳妥仍在创建**之后**写。
4. `history.replaceState` 把 URL 收敛成**只剩 `?project=<新 public_id>`**,剥掉 `model/prompt/assets`(`createProject` 内 `syncProjectToUrl` 用 `withProjectParam` 会保留旧参数,故须显式剥离)。

## 关键语义点

### 模型时序(异步列表)

`availableModels` 由 `useModelList` 异步拉取。先 `setSelectedModel(urlModel)` 落地;列表到达后 `setAvailableModels` → `resolveSelectedModel(models, current)` 规则为"current 在列表里则保留,否则取首项"。即:**传入模型在列表里就生效;陈旧/非法则静默回退默认**。无需额外 pending 态。

### 消费一次 + 刷新

- 参数消费后即从 URL 剥离 → 刷新**不会**重复建项目 / 重复预填。
- 剥离后 URL = `/studio?project=X`:刷新走原 bootstrap 复用项目 X。`composer.draft` 有持久化(提示词仍在);**`attachments` 不持久化(`partialize` 显式置空)→ 刷新丢资产 chip**(已确认接受;prelude 是"进来即用"的一次性预填)。
- 再次从外部页进入是全新 `/studio?prompt=...&assets=...`(无 project)→ 再建一个新项目,符合"进入时新建项目"语义。

### 不自动发送

预填后停在 composer,由用户检查/编辑后手动发送(贴合"分别设置模型 / 输入框 / 资产")。

### 生产侧契约(外部页负责)

外部页用 `pagePath('/studio')` 拼 basePath 前缀 + 上述 schema 拼 URL;`assets` 的 `url` 须公网可达。我方只读 `location.search`,无 basePath 顾虑。

## 测试

- `src/lib/studio-prelude.test.ts`:
  - 解析:三字段齐全 / 各自缺省 / 全缺(返回 null)/ `assets` 非法 JSON(回退空)/ `assets` 含非法条目(丢弃该条保留其余)。
  - `seedToAttachment`:形状(`status:'ready'`、有 `url`、无 `itemId`、mime 兜底)。
- bootstrap/action 层:有 prelude → 新建项目 + set 模型/composer + URL 剥离;无 prelude → 走原 `loadProjects`。复用现有 fake/guard + 微任务 flush 模式。

## 不做(YAGNI)

- 不做 postMessage / iframe 传参通道(本期只新标签/跳转)。
- 不做 `assets` 的 base64 / 服务端 handoff token(URL 偏大再说)。
- 不持久化预置 attachments、不做自动发送、不依据 prompt 命名项目(默认名)。
- 不改 `Composer.send()` 与 koubou 发送链路。
