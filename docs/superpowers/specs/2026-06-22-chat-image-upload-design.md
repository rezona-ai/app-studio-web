# 对话窗文件上传(走画布上传端点 + URL 传 koubou + 消息内缩略图显示)设计稿

> 日期:2026-06-22 · 状态:已与用户确认设计(含 Koubou WS 协议核对),待 spec 评审

## 背景与目标

当前对话窗(`Composer.tsx`)的图片附件走**本地 base64** 链路:`FileReader` 读出 dataUrl 存进 `composer.attachments`,发送时以 `{type:'image', source:{type:'base64',...}}` 内容块发给 koubou;且**用户气泡里不显示附件**(`pushUserMessage` 只推 text part);chip 仅显示文件名 + 文档图标。

目标改为:

1. 对话窗文件附件**复用画布上传端点** `POST .../canvas/items/upload`(即 `uploadCanvasItem`),拿到资产 URL。
2. 把该 **URL 传给 koubou 后端**(图片走 URL 内容块,不再传 base64;视频/音频 URL 折进文本)。
3. 上传的附件在**用户消息气泡里以缩略图显示**:**图片**→缩略图、**视频**→首帧、**音频/3D**→类型图标。

### Koubou WS 协议核对结论(`koubou-agent-py/docs/websocket-events.md`)

`user.message` 帧:`{ type:'user.message', payload:{ message:{ role:'user', content: string | block[] }, parent_tool_use_id }, event_id? }`。要点:

- **content 块用"raw Anthropic API form",仅 `text` 与 `image` 两种块**;无 `video`/`audio`/`3d` 块类型,也无独立 `assets` 字段。
- `image` 块 source 支持 `base64` 或 `{type:'url', url}`;**URL source 必须是公网可达链接**。
- `user.steer` 仅 `{ content: string }`(纯文本)。

> 注:apifox 里 `game-coding-agent-py` 的 `POST /v1/agent/generate` 有 `assets:[{type,url,usage}]`,那是**另一条 HTTP 生成路径**,非本前端所用的 Koubou WS 通道,本设计不采用其格式。

因此编码方案(用户已确认):**图片 → image url 内容块**(LLM 可见、可重建缩略图);**视频/音频 → URL 折进文本**(协议下唯一可达方式,agent 以文本拿到 URL,与现有 @提及引用同机制)。

### 已确认的产品决策

| 决策点 | 选择 | 含义 |
|---|---|---|
| 画布可见性 | **仅对话内显示** | 上传产生的画布 item 不出现在画布上(含刷新重载后) |
| 上传时机 | **选择时后台上传** | 选好文件即在后台上传,发送时 URL 已就绪 |
| 上传类型 | **全部可上传类型** | image/video/audio 都放行(3D 不可上传,只能 @提及引用),全部返回 URL 传 koubou;koubou 是否解析非图片不在前端范围 |
| koubou 编码 | **图片走块,视频/音频进文本** | 协议仅支持 image 块;视频/音频 URL 折进文本。**重载保真度**:图片重载重建缩略图;视频/音频重载仅显 URL 文本(无缩略图) |
| 缩略图渲染 | **按 kind** | 图片缩略 / 视频首帧 / 音频·3D 图标 —— 复用现有 `AssetThumb` 规则 |

## 关键约束:为什么"仅对话内显示"需要服务端标记 + 加载过滤

上传端点本质是**画布**上传端点,multipart 仅收 `file`(见 `2026-06-08-pgc-server-api-integration-design.md`,支持 image/video/audio)。它创建的 item 会被 `listCanvasItems` 返回,而 `canvasItemsToAssets`(`src/lib/pgc/map.ts`,`loadCanvas` 唯一所用映射器)会把**每个** item 都落成画布卡片(无坐标则兜底级联落位)。因此:

- **纯前端「本地不加入 assets」不够** —— 下次 `loadCanvas` 仍会把该 item 显示到画布上。
- 要让它**跨刷新**隐身,必须有**持久**信号让加载侧过滤掉。
- 该 item **不能删**(已发送的):它的 URL 已随用户消息进了 koubou 历史,删了会让消息缩略图(及 koubou 取用)失效。

方案:上传后给该 item 的 `reference` 写标记 `{ chat_attachment: true }`,加载侧据此过滤。`reference` 是后端**原样回显**的元数据(`source_filename` / `parent_id` 已是同款用法),故自定义键在契约内,且跨设备/会话一致。

## 架构与数据流

```
选文件 ─validateUpload(UPLOAD_POLICY.chat)─▶ uploadChatAttachment(action)
                          │ 1. 占位 {status:'uploading', kind} 进 composer.attachments
                          │ 2. uploadCanvasItem(file) ─▶ CanvasItemData(url, item_id)
                          │ 3. updateCanvasReference(item_id, {chat_attachment:true})   // 标记
                          │ 4. set {status:'ready', url: resolveAssetUrl(it.url), itemId}
                          ▼(失败→{status:'error'}+Toast)
发送 ─Composer.send─▶ pushUserMessage(parts:[...media(全类型缩略图), text=bubbleText])      // 气泡
                  └─▶ koubou content:图片→image url 块;视频/音频→URL 折进 koubouText
                          content = imageBlocks.length ? [{type:'text',text:koubouText}, ...imageBlocks] : koubouText

loadCanvas ─listCanvasItems─▶ canvasItemsToAssets(过滤 chat_attachment) ─▶ assets   // 画布不显示
冷启动 ─session.ready.visible_state─▶ blocksToParts(仅 image 块→media part) ─▶ 气泡:图片缩略图;视频/音频显 URL 文本
```

## 详细设计

### 1. 附件数据模型(`ComposerState.attachments`)

`src/store/index.ts` 的 `ComposerState.attachments` 由 `{ name; mime; dataUrl }[]` 改为带上传态与 kind 的条目:

```ts
export interface ChatAttachment {
  id: string;            // 本地 id(newId),用于 keying / 移除 / 状态更新定位
  name: string;
  mime: string;
  kind: AssetKind;       // mimeToAssetKind(mime):image | video | audio(上传不产生 3d/doc)
  status: 'uploading' | 'ready' | 'error';
  url?: string;          // 就绪后:resolveAssetUrl(it.url) 的绝对 URL —— 气泡缩略图 + koubou
  itemId?: string;       // 画布 item_id —— 用于移除时删除孤儿
}
```

- **不再持有 base64/dataUrl**。上传中暂无远程 url,chip 缩略位显 spinner;就绪后用远程 url 渲染缩略图(图片/视频首帧)。本地即时预览(objectURL)留作可选增强,v1 不做。
- 持久化不变:`partialize` 中 `attachments` 恒重置为 `[]`(见 `index.ts` 现状),附件是会话内瞬态。
- 新增小工具 `mimeToAssetKind(mime)`(放 `src/lib/media-import.ts`,与既有 `mediaKindToAssetKind`/`kindToImportType` 同处):按 MIME 主类型(`image/` `video/` `audio/`)映射;其余回退 `image`。

### 2. 上传策略扩展(`src/lib/upload-policy.ts`)

- 新增 `VIDEO_MIMES` / `AUDIO_MIMES`;`UPLOAD_POLICY.chat.accept = [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES]`。
- `chat.maxBytes` 上调以容纳视频(如 100MB);后端有自身上限时由上传端点拒绝 → `PgcError` → Toast 兜底(客户端校验仅前置体验)。**`canvas` 策略不动**(AddAssetMenu 仍仅图片,非本次范围)。
- `rejectMessage` 文案泛化:不再假定 "images",`type` 拒绝改为 "Unsupported file type (...). Allowed: <formats>.";`MIME_LABELS` 补常见视频/音频条目(缺失走子类型大写回退)。

### 3. ServerActions:上传与移除(`src/store/actions.ts`,紧邻 `uploadAsset`)

`uploadAsset`(画布上传)不动。新增:

```ts
// 对话窗附件上传:走画布上传端点拿 URL,标记 chat_attachment、不落画布 assets
const uploadChatAttachment = async (file: File) => {
  const id = newId('att');
  const pid = get().currentProjectId; if (pid == null) return;
  const kind = mimeToAssetKind(file.type);
  composerSetAttachments([...get().composer.attachments, { id, name: file.name, mime: file.type, kind, status: 'uploading' }]);
  try {
    const item = await uploadCanvasItem(pid, file);
    await pgcApi.updateCanvasReference(pid, item.item_id, { chat_attachment: true });  // loadCanvas 据此过滤
    if (get().currentProjectId !== pid) return;                                        // await 后校验上下文
    patchAttachment(id, { status: 'ready', url: resolveAssetUrl(item.url), itemId: item.item_id });
  } catch (e) {
    if (get().currentProjectId !== pid) return;
    patchAttachment(id, { status: 'error' });
    if (e instanceof PgcError) setError({ code: e.code, message: e.message });          // 仅已知错误转 Toast,未知照抛
    else throw e;
  }
};

// 移除附件:已上传则删除孤儿(未发送过,删之无害);未就绪/无 itemId 仅本地移除
const removeChatAttachment = (id: string) => {
  const att = get().composer.attachments.find((a) => a.id === id);
  const pid = get().currentProjectId;
  if (att?.itemId && pid != null) void pgcApi.deleteCanvasItem(pid, att.itemId).catch(() => {});  // fire-and-forget
  composerSetAttachments(get().composer.attachments.filter((a) => a.id !== id));
};
```

- `patchAttachment(id, patch)` / `composerSetAttachments(next)` 为内部小工具(读最新 `get()` 快照后 `composerSet`),避免渲染期闭包过期。
- **错误分层**:因要在失败时标 `error` 态,这里手写 try/catch 而非整体 `guard`;`catch` 内仅 `PgcError` 转 Toast,未知错误照抛(沿用反模式约束:不吞未知错误)。
- **并发/上下文**:每文件独立 `id` 的 promise,互不干扰;`await` 后均校验 `currentProjectId`,过期响应丢弃。

### 4. 加载侧过滤(`src/lib/pgc/map.ts`)

- `CanvasReference` 增 `chat_attachment?: boolean`。
- `canvasItemsToAssets` 先 `filter((it) => !((it.reference ?? {}) as CanvasReference).chat_attachment)` 再映射;仅改列表映射器(`loadCanvas` 用),单项 `canvasItemToAsset`(生成 settle 路径)不动。

### 5. 发送流程(`src/components/chat/Composer.tsx`)

- `canSend`:在原条件上,**任一附件 `status==='uploading'` 时禁用发送**(URL 未就绪);`error` 附件不阻塞,发送时跳过。
- `onFiles`:`validateUpload(files, UPLOAD_POLICY.chat)` 后,对每个 accepted 调 `uploadChatAttachment(f)`(替换原 `FileReader`)。
- `send()`(**气泡文本与 koubou 文本分离**,使气泡保持干净而 koubou 仍拿到全部 URL):
  ```ts
  const ready = attachments.filter((a) => a.status === 'ready' && a.url);
  const images = ready.filter((a) => a.kind === 'image');
  const nonImages = ready.filter((a) => a.kind !== 'image');
  const mediaParts = ready.map((a) => ({ type: 'media' as const, kind: a.kind, url: a.url!, name: a.name }));

  // bubbleText = 现状逻辑:draft + @提及引用 token(refs.map(key => '@' + (asset ? refToken(asset) : key)))
  const bubbleText = [draft.trim(), ...refTokens].filter(Boolean).join(' ');
  if (!bubbleText && ready.length === 0) return;                                            // 空内容拦截
  pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [...mediaParts, { type: 'text', text: bubbleText }] });

  // koubou 文本 = 气泡文本 + 视频/音频 URL 折成 @token(与 @提及引用同形,agent 统一当资产 URL 处理)
  const koubouText = [bubbleText, ...nonImages.map((a) => '@' + a.url)].filter(Boolean).join(' ');
  if (runStatus === 'running') {
    client.current?.steer(koubouText);                                                      // steer 仅文本:图片此轮无法带(既有局限)
  } else {
    const imageBlocks = images.map((a) => ({ type: 'image', source: { type: 'url', url: a.url } }));
    const content = imageBlocks.length ? ([{ type: 'text', text: koubouText }, ...imageBlocks] as ContentBlock[]) : koubouText;
    client.current?.sendUserMessage({ role: 'user', content });
  }
  resetComposer();
  ```
- 要点:气泡 parts 用 `bubbleText`(不含折叠的视频/音频 URL,避免气泡里出现裸 URL);koubou 用 `koubouText`(含折叠 URL)。图片始终走 image url 内容块。

### 6. 消息渲染(`src/components/chat/MessageItem.tsx` + `AssetChip.tsx`)

- `Part` 增变体:`{ type: 'media'; kind: AssetKind; url: string; name?: string }`(`src/store/types.ts`)。
- **缩略图组件复用/泛化**:把 `AssetChip.tsx` 里 `AssetThumb` 的按 kind 渲染逻辑提取成基元 `MediaThumb({ kind, src })`(图片 `<img>`、视频 `#t=0.001` 首帧、音频/3D/doc 图标);`AssetThumb({asset})` 改为委托 `MediaThumb`,行为不变。composer chip 与消息 media part 均用 `MediaThumb`。
- **用户气泡**:渲染顺序自上而下为 **media parts → ref chips → 文本**。media 缩略图为圆角有界容器(尺寸略大于 composer chip 贴片,如圆角方形 ~72px,`object-cover`),内用 `MediaThumb`,带 `aria-label={name}`。`hasContent` 判断纳入 media parts。
- **助手 switch 穷尽性**:助手分支 `switch(p.type)` 增 `case 'media'`(助手消息一般无媒体块,渲染同款缩略图或 null)。
- v1 不接 MediaLightbox(其按 `assetId` 取 `assets`,chat 附件不在 assets);点击放大留作后续。

### 7. 冷启动历史重建(`src/koubou/apply-koubou.ts`)

- `blocksToParts` 增 **image 块** 处理:
  - `b.type === 'image'` 且 `source.type === 'url'` → `{ type: 'media', kind: 'image', url: source.url }`。
  - 兼容历史 `source.type === 'base64'` → `{ type: 'media', kind: 'image', url: 'data:'+media_type+';base64,'+data }`。
- 视频/音频无对应块(其 URL 折在文本里),重载时随文本展示为 URL 文本(无缩略图)—— 见决策表「重载保真度」,已知取舍。

### 8. 附件 chip 状态(`src/components/chat/AttachmentBar.tsx`)

- 上传文件 chip:`Chip` 的图标位改用 `MediaThumb({ kind, src: url })`;`uploading` 时贴片显 spinner,`error` 时显错误态(可点移除)。
- 移除按钮调 `removeChatAttachment(id)`(替换原 `composerSet` 过滤);refs 的 `AssetChip` 渲染不变。
- 沿用现有 `Chip` 基础件与令牌,不造新组件。

## 错误处理与边界

- **上传失败**:附件标 `error` + Toast(已知 `PgcError`);用户可移除或重选;发送时跳过 error 附件。
- **发送时仍在上传**:发送按钮禁用,直到所有附件 `ready`/`error`(后台上传通常很快)。
- **移除孤儿**:已上传未发送的附件被移除时尽力 `deleteCanvasItem`(fire-and-forget,失败忽略);仍 `uploading`(无 itemId)时仅本地移除,极小概率留下一个已标记、已过滤的孤儿 item(可接受)。
- **切项目**:上传 action 每个 `await` 后校验 `currentProjectId`,过期响应丢弃。
- **运行中(steering)**:发 `koubouText`(含视频/音频折叠 URL);图片此轮无法带(steer 仅文本,既有局限)。附件在 `resetComposer` 后清空。
- **标记不被回显的兜底**:若后端未回显 `chat_attachment`(契约外),该 item 会重新出现在画布 —— 与今天行为一致,不报错;列入风险假设。

## 关键假设(风险)

1. **uploaded 资产 URL 是公网可达**:协议要求 image url source 为 publicly accessible(供 Anthropic/koubou 取图)。若 PGC 上传 URL 非公开(需 cookie),image-by-URL 不成立,需对图片回退 base64(本设计的应急路径)。**待与后端确认**。
2. **`reference.chat_attachment` 原样回显**(同 `source_filename`/`parent_id`)。
3. **agent 能消化文本里的 `@<url>`**:视频/音频 URL 以 @token 折进文本,沿用 @提及引用同机制,假定 agent 已按资产 URL 处理(用户:不用考虑 koubou 对非图片的解析)。

## 测试计划(同目录 `*.test.ts(x)`,纯逻辑 TDD 优先)

- `src/lib/upload-policy.test.ts`:chat 策略放行 image/video/audio、拒绝其它;`rejectMessage` 文案泛化(非图片场景不再写死 "images")。
- `src/lib/media-import.test.ts`:`mimeToAssetKind` 按主类型映射 + 回退。
- `src/lib/pgc/map.test.ts`:`canvasItemsToAssets` 过滤 `chat_attachment` item;非标记 item 正常落地。
- `src/store/actions.test.ts`:`uploadChatAttachment` 成功 → 附件转 `ready` 带 url/itemId/kind,**不**入 `assets`,且调了 `updateCanvasReference` 标记;失败 → `error` + setError;`removeChatAttachment` 有 itemId → 调 `deleteCanvasItem` 并移除,无 itemId → 仅移除;`await` 后切项目丢弃。
- `src/koubou/apply-koubou.test.ts`:`blocksToParts` 把 image url 块、base64 image 块转成 image media part;视频/音频块不出现(无此类块)。
- `src/components/chat/Composer.test.tsx`:`uploading` 中发送禁用;就绪后发送 → 气泡 parts 含全类型 media + bubbleText;koubou content:有图片时为 `[text(含视频/音频@url), ...image url 块]`,仅非图片时为含 @url 的纯文本;空文本+无就绪媒体不发送。
- `src/components/chat/MessageItem.test.tsx`:用户消息含 media part 按 kind 渲染(图片 `<img>`、视频 `<video>` 首帧、音频/3D 图标)。
- `src/components/chat/AttachmentBar.test.tsx`:上传中显 spinner、错误态、缩略图、移除调 `removeChatAttachment`。

## 不在本次范围(YAGNI)

- composer 内上传中的本地即时预览(objectURL);v1 上传中显 spinner、就绪显远程缩略图。
- 视频/音频在冷启动重载后的缩略图(协议无对应块,只能显 URL 文本)。
- 点击气泡媒体放大(lightbox 泛化)。
- 运行中(steering)携带图片。

---

## 追加:画布双击菜单上传扩展(2026-06-23)

> 背景:`AddAssetMenu`(画布双击/卡片「+」)的「Add source → Upload」原本仅放行图片。本次让它对齐最新上传逻辑,支持上传**图片/视频/音频**;并把上传体积限制按 kind 对齐后端。

### 后端契约核对(PGC `Upload Canvas Item`,apifox 2026-06-23)
- 上传端点按 content-type 主类型推断,**仅支持 image/video/audio**;不支持类型(含 **3D/glb**)→ 422。
- 体积按类型设上限:**图片 5MB、视频/音频 20MB**(可经 `CANVAS_UPLOAD__*` 配置),超限 → 413。
- 故 **3D 不可上传**,仍只在 Generate 区生成;Upload 入口不列 3D。

### 改动
1. **`src/lib/upload-policy.ts` 按 kind 限额**:`UploadPolicy` 增可选 `maxBytesByKind?: Partial<Record<AssetKind, number>>`(`maxBytes` 作兜底)。`validateUpload` 单文件上限取 `maxBytesByKind[mimeToAssetKind(file.type)] ?? maxBytes`(复用 `media-import` 的 `mimeToAssetKind`,纯函数、仅类型依赖,无环)。`rejectMessage` 的 size 分支改为逐文件列出适用上限(如 `big.png (max 5 MB)`),不再用单一全局值。
   - 限额对齐后端:`image 5MB`、`video/audio 20MB`(兜底 `maxBytes` 20MB)。
   - `UPLOAD_POLICY.canvas`:accept 由「仅图片」改为 **image+video+audio**;启用上述 per-kind 限额。
   - `UPLOAD_POLICY.chat`:同 accept;**单一 100MB 改为同一 per-kind 限额**(修正先前过宽,使客户端校验对齐后端 413)。两 surface 现限额一致。
2. **`src/components/canvas/AddAssetMenu.tsx`**:「Upload」副标 `Image` → `Image · Video · Audio`;`<input accept>` 经 `acceptAttr(UPLOAD_POLICY.canvas)` 自动放宽。**无逻辑改动**——`uploadAsset` 本就 kind 无关(`canvasItemToAsset` 按 `type` 映射 kind),上传的视频/音频会作为**画布卡片**落位(与 chat 的「仅对话内显示」不同)。3D 不进 Upload。

### 测试
- `upload-policy.test.ts`:canvas 放行 image/video/audio、拒绝 glb(reason=type);per-kind 限额(图片 >5MB / 视频 >20MB → size);`maxBytesByKind` 值对齐后端;size 文案逐文件列上限;`acceptAttr`/type 文案用小型 ad-hoc 策略(避免随 canvas 放宽而脆裂)。
- 既有用例随 canvas 放宽更新(原断言 canvas 仅图片/10MB 的几处改为 ad-hoc 策略或新值)。

### 仍不在范围
- 文件名/体积更细粒度策略(如按具体 MIME)。
- 画布上传 3D(待后端支持 glb 上传)。
