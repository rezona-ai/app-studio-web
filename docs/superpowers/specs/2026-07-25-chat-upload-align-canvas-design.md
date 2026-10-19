# 对话栏文件上传对齐画布设计稿

> 日期：2026-07-25  
> 状态：待实现

## 背景

画布上传已支持 image、video、audio、text、3D 五种类型，其中图片上限 5 MB，视频与音频上限 20 MB，文本上限 1 MB，3D 上限 100 MB。对话栏已支持前四种类型及其尺寸映射，但未放行 3D，也没有配置 GLB/glTF 的扩展名兜底。

此外，对话附件上传动作仅按 MIME 推断 `kind`。浏览器为 GLB/glTF 返回空 MIME 或 `application/octet-stream` 时，即使文件通过扩展名校验，也会被错误标记为 image，导致附件缩略图和发给 Koubou 的 `@[model3d]` token 类型错误。

## 目标

- 对话栏支持上传 image、video、audio、text、3D。
- 五种类型与画布使用相同格式白名单及尺寸限制：
  - image：5 MB；
  - video：20 MB；
  - audio：20 MB；
  - text：1 MB；
  - 3D：100 MB。
- GLB/glTF 在 MIME 缺失或为 `application/octet-stream` 时仍可选择、校验、上传并识别为 3D。
- 保留对话栏现有 PDF、Markdown、TXT 附件能力与最多 5 个附件的限制。
- 不改变画布上传行为，不新增后端字段，不改变 Koubou 协议。

## 成功标准

1. `UPLOAD_POLICY.chat` 与 `UPLOAD_POLICY.canvas` 对 image、video、audio、text、3D 使用同一组格式白名单及尺寸限制。
2. 对话栏文件选择器的 `accept` 包含 3D MIME 及 `.glb`、`.gltf`。
3. 对话栏按扩展名兜底接收 GLB/glTF，并按 100 MB 上限校验。
4. 对话附件上传动作把标准 MIME、空 MIME、octet-stream 的 GLB/glTF 都记为 `kind: '3d'`。
5. 3D 附件沿现有发送链路折叠为 `@[model3d]<url>`，气泡和附件栏复用现有 3D 图标。
6. 新增测试先以预期原因失败，再由最小实现转绿；完整本地门通过。

## 约束

- 上传仍走现有 `uploadCanvasItem`，上传后写入 `reference.chat_attachment`，不出现在画布。
- 仅使用后端已支持的 GLB/glTF 契约，不增加推测性格式或字段。
- 对话附件状态仍由 zustand store 统一持有，组件不直连上传接口。
- 未知异常继续抛出，只把既有 `PgcError` 收敛为 Toast。
- 每个 `await` 后继续校验当前项目，避免过期响应写入错误项目。

## 方案比较

### 方案一：只在 chat 策略中复制 3D 配置

直接向 `UPLOAD_POLICY.chat` 加入 `MODEL3D_MIMES`、`MODEL3D_EXTS` 和 100 MB 上限。

优点是改动最小。缺点是 image/video/audio/3D 的白名单与限制仍分散在两个 surface 配置中，后续调整可能再次漂移；上传动作的 GLB 类型误判也需要另行修补。

### 方案二：抽取共享媒体策略，附件类型统一用 `kindFromFile`（推荐）

把五种类型的 MIME、3D 扩展名和按 kind 限额定义为共享基础配置，chat 与 canvas 在此基础上添加各自差异；对话附件上传动作复用画布已有的 `kindFromFile`。

优点是从结构上保证四类媒体和尺寸限制一致，并复用已经覆盖扩展名兜底的纯函数。改动范围小，不改变现有协议或状态模型。

### 方案三：让 chat 直接引用完整 canvas policy

以 canvas policy 为基底整体展开 chat，再追加文档与数量限制。

表面最直接，但会把 canvas 的文本上传能力也隐式耦合进 chat；两个场景的差异不够清晰，未来任一画布专属类型都会自动进入对话栏，不符合 YAGNI。

## 设计

### 上传策略

在 `src/lib/upload-policy.ts` 内保留单一的五类 MIME 列表、3D 扩展名列表及按 kind 限额。构造两个 surface 时：

- `canvas`：共享五种类型；
- `chat`：共享五种类型 + 现有 PDF，同时保留 `maxCount: 5`。

两者都配置 `acceptExtensions: MODEL3D_EXTS`，文件选择器和实际校验保持一致。PDF 的 20 MB MIME 覆盖及文本的 1 MB kind 限制不变。

### 类型推断

`uploadChatAttachment` 从 `mimeToAssetKind(file.type)` 改为 `kindFromFile(file)`：

- `.glb`、`.gltf` 优先判定为 3D；
- 其余文件继续按 MIME 主类型判断；
- 类型拦截仍由上传策略负责，类型推断不承担安全校验。

### 发送与展示

现有链路已经按非 image 附件生成 `@[${MENTION_TYPE[kind]}]<url>`，且 `MENTION_TYPE['3d']`、`MediaThumb(kind='3d')` 已存在，因此不新增分支。正确的 `kind` 会自然得到：

- Koubou 文本中的 `@[model3d]<url>`；
- 对话气泡和附件栏的 3D 图标。

## 测试策略

- `src/lib/upload-policy.test.ts`
  - 先把“chat 拒绝 3D”改为“chat 放行标准 MIME 与扩展名兜底 3D”，确认失败；
  - 断言 chat 3D 上限为 100 MB，超限被拒；
  - 断言 chat/canvas 五种类型的白名单与限额一致；
  - 断言 chat `accept` 属性包含 3D MIME 与扩展名。
- `src/store/chat-attachment-text.test.ts`
  - 添加 octet-stream GLB 上传后 `kind: '3d'` 的用例，确认现状错误为 image；
  - 实现后确认上传、标记和状态链路保持不变。

## 非目标

- 不移除或重做 PDF、Markdown、TXT 支持。
- 不改变附件数量限制。
- 不增加 OBJ、FBX、USDZ 等后端未声明格式。
- 不调整上传进度、取消上传、历史恢复或媒体预览交互。
