# 文本卡落库切换到专用 text 接口 — 设计稿

日期：2026-07-06

## 背景

后端新增文本画布节点专用接口，替代此前「文本内容封 `.md` 文件走统一 `upload`」的方案：

- `POST /api/projects/{project_id}/canvas/items/text`（Apifox #482701278）：body `CanvasTextCreateRequest { content(1..200k 必填), text_format('markdown'|'plain', 默认 markdown), name?, reference?, canvas_x?, canvas_y? }`。content 原样落 DB、不落桶、不计费，同步返回 ready 项，`url` 恒空。业务上限默认 50k 字符，超限 422 `CANVAS_TEXT_TOO_LONG`。
- `PATCH /api/projects/{project_id}/canvas/items/{item_id}` 同步扩展：`CanvasUpdateRequest` 新增 `content?` / `text_format?`，文本节点可原地改正文。
- `CanvasItemData` 响应（含列表）新增内联 `content?` / `text_format?` 字段。

前提：**当前线上不存在存量 file 形态文本卡**，无需兼容旧数据。

## 决策

1. **所有文本卡统一为 content 内联形态**。编辑器新建/保存与画布拖拽/选择 `.md`/`.txt` 文件上传，一律走新接口（文件路径前端 `file.text()` 读内容后转 POST），不再产生 file 形态文本卡。
2. **删除而非兼容**：`loadTextContent`（按需回读 fetch）、`seedText`（新建防骨架）、编辑「上传新 item + 继承前端态 + 删旧 item」替换 hack 全部删除，不留兼容分支（对齐项目「不堆废弃机制」约定）。

## 改动明细

### 协议层 `src/lib/pgc/types.ts` + `client.ts`

- `CanvasItemData` 增加 `content?: string | null`、`text_format?: string | null`（snake_case，忠实契约）。
- `CanvasUpdateRequest` 增加 `content?`、`text_format?`。
- 新增 `CanvasTextCreateRequest` 类型与 `pgcApi.createTextItem(pid, body)`（普通 JSON POST，走既有 `pgc()` helper）。

### 映射层 `src/lib/pgc/map.ts`

- `canvasItemToAsset`：`content` 非空时写入 `preview.text`。列表加载即带正文，文本卡零回读。

### 动作层 `src/store/actions.ts`

- `saveTextAsset` 新建分支：占位卡链路保留（落 `pending_` 占位 → 成功原位替换），内部改调 `createTextItem`（`canvas_x/y` 取整传落位坐标，`name: 'Text'`），删除 `mdFile` 封装与 `seedText`。
- `saveTextAsset` 编辑分支：单次 `PATCH { content }` 原地改，响应合并进现有 Asset（保留前端 `position`）；删除替换 hack 及其 rename/reference 回写补偿。
- `uploadAsset`/`doUploadAsset` 入口分流：text mime（`text/markdown`/`text/plain`）→ `file.text()` 读内容后走 `createTextItem`（复用占位卡替换链路，无字节进度）；其余 mime 走原 multipart upload 不变。
- `loadTextContent` 整体删除；`resolveTextRef` 去掉回读 await，直接同步读 `preview.text`。
- 错误处理不变：新建/编辑走 `guardRethrow`（Modal 感知失败保留弹窗）；422 `CANVAS_TEXT_TOO_LONG` 经 envelope → `PgcError` → Toast 自然透出。

### 组件层

- `TextNode.tsx` / `TextEditorModal.tsx`：删除 `loadTextContent` 调用、`needsLoad`/`failed` 加载错误态与重试逻辑，直接渲染/编辑 `preview.text`。

### 不变项

- `upload-policy.ts`：canvas 面 text mime 白名单与 1MB 本地限额保持（仅后续消费方式变化）。
- `resolveTextRef` 的 prompt 注入语义（截前 2000 字前置）不变。
- agent 侧 `/api/agent/canvas/text` 与本改动无关，不触碰。
- 版本/生成/导入链路不变。

## 测试

- `map.test`：`content` → `preview.text` 映射（有值/空/非 text 类型）。
- `actions.test`：新建走 `createTextItem` 且占位替换、编辑走 PATCH 且保留 position、text 文件上传分流走新接口、超限 422 透出 Toast；删除旧 upload-hack 与 `loadTextContent` 相关用例。
- 组件测试：`TextNode` 直接渲染 `preview.text`，无加载态。
