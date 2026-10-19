# 分享到 Rezona 面板：封面上传接入项目封面接口（设计稿）

- 日期：2026-07-06
- Story：Meegle 13354191「分享到 Rezona 面板增加封面上传能力」
- 设计稿：Figma `TALUNA-DEVELOPER-SITE` 节点 `1174:33832`
- 后端契约：pgc-server PR #272 `POST /api/projects/{project_id}/cover`（截至本稿 **OPEN 未合并**，联调前需合并部署 dev）

## 背景与问题

Rezona 发布模态（`RezonaPublishModal`）已有「上传自定义封面」入口，但现链路对着后端契约是**坏的**：

- 前端把封面走 `uploadCanvasItem` 上传成画布资产，再把 asset item id 作为 `cover_ref` 提交发布；
- 后端 `rezona.py::_resolve_cover` **只接受 `cover_ref === "version_cover"`**，其余（含 asset id）一律 `422 REZONA_COVER_INVALID` —— 自定义封面实际发不出去，还在画布资产里留下带 `rezona_cover` 标记的孤儿上传。

后端新出 PR #272 提供了**项目级封面上传**接口。产品确认的语义（Nick 拍板）：

> 面板里上传封面 = 替换 **Taluna 项目封面**（`cover_source='user'`，优先于自动解析、不被覆盖）。
> 发布到 Rezona 携带的封面仍是 `version_cover`（版本目录 cover.png），Rezona 侧封面由后端后续迭代。**这是预期行为，不是缺口。**

## 后端契约（PR #272）

`POST /api/projects/{project_id}/cover`

- 请求：`multipart/form-data`，字段 `file`；**仅接受 `image/png`**；鉴权 + 属主校验。
- 成功 200：标准 PGC 信封，`data` 为更新后的 `ProjectData`（`cover_url` 带 `?v=<内容hash>` cache-bust、`cover_source: "user"`）。
- 错误码：`422 UNSUPPORTED_COVER_TYPE`（非 PNG）/ `422 EMPTY_COVER_UPLOAD`（空文件）/ `413 CANVAS_UPLOAD_TOO_LARGE`（>5MB 默认）/ `404 PROJECT_NOT_FOUND` / `403 FORBIDDEN` / `401 UNAUTHORIZED`。

## 方案

### 1. 协议层：`src/lib/pgc/client.ts`

新增 `pgcApi.uploadProjectCover(projectId, file): Promise<ProjectData>`：

- `POST` 经现有 `/api/pgc` 代理（`apiPath()` 包路径），body 为 `FormData`（字段 `file`），沿用现有信封解析 / `PgcError` 抛错。
- 不在客户端复述后端校验逻辑：类型限制靠文件选择器 `accept="image/png"` 收口，其余（空文件/超限）交给后端错误码。

### 2. 模态编排：`RezonaPublishModal.tsx`

- `uploadCover` 改调 `uploadProjectCover`；成功后用返回 `ProjectData.cover_url`（经 `resolveAssetUrl` 归一）更新面板缩略图局部状态。
- **删除旧链路**：`uploadCanvasItem` 调用、`updateCanvasReference(..., { rezona_cover: true })` 标记、`cover.itemId` 状态。
- 发布请求 `cover_ref` 恒 `'version_cover'`（对齐契约；不再有其它取值）。
- 错误映射（`setError` → 全局 Toast）：
  - `UNSUPPORTED_COVER_TYPE` → 新 i18n key（仅支持 PNG）
  - `EMPTY_COVER_UPLOAD` → 新 i18n key（文件为空）
  - `CANVAS_UPLOAD_TOO_LARGE` → 新 i18n key（超过大小上限）
  - 其余 `PgcError` 透传 code+message；非 `PgcError` 回落现有 `preview.rezona.err.coverUpload` 通用文案。
- `await` 后沿用 `mountedRef` 存活校验；上传中 `coverUploading` 语义不变。

### 3. 表单 UI：`PublishForm.tsx`（对齐 Figma 1174:33832）

- 126px 缩略图整体变为可点击上传入口：`<button type="button">`，点击触发既有隐藏 `<input type="file">`；`aria-label` 复用 `preview.rezona.uploadCover`；`coverUploading` 期间 disabled。
- 视觉（全部走令牌，禁止字面色值）：
  - 容器：圆角 `rounded-[8px]`（原 12px），`bg-[var(--color-fill)]`，`border border-[var(--color-line-2)]`；
  - 封面图恒 `opacity-30` 压暗；
  - 中央 40px 圆形托底 `rounded-[20px] bg-[var(--color-pop)]` + 16px lucide `Upload` 图标；
  - 上传中 spinner 遮罩保持现状。
- 文件选择器 `accept` 从 `image/*` 收紧为 `image/png`。
- Upload 按钮、提示文案（`preview.rezona.coverHint`）不动。
- 设计稿中 hidden 的「AI Cover」按钮不做。

### 4. i18n

新增 3 个错误文案 key（如 `preview.rezona.err.coverType` / `coverEmpty` / `coverTooLarge`），en 为单一真相源，**补齐六语**（en/zh/fr/ru/ja/vi）。

### 5. 测试

- `client.ts` 侧：`uploadProjectCover` 发出 multipart、路径正确、信封解析、错误码转 `PgcError`。
- `RezonaPublishModal.test.tsx`：上传成功更新缩略图 URL；三个已知错误码映射到对应文案；失败不改变 `cover` 状态；发布请求 `cover_ref` 恒为 `'version_cover'`；断言不再调用画布上传端点。
- `PublishForm.test.tsx`：点击缩略图触发文件选择（同一 input）；`coverUploading` 时缩略图按钮 disabled；`accept="image/png"`。

## 范围外

- AI Cover 生成按钮（设计稿中 hidden）。
- Open Preview 截图取封面。
- Rezona 发布侧封面来源变更（`version_cover` 语义由后端后续迭代）。
- 移除已上传封面 / 回落自动封面（后端也未提供）。
- store 全局项目封面同步：面板内局部展示即可；若 plan 阶段发现 store 有消费 `cover_url` 的路径再最小化处理。

## 风险与前置

- **PR #272 未合并**：联调依赖后端先合并部署 dev；前端可先按契约文档实现 + 测试桩验证。
- PNG-only 对用户是收紧（原 `accept="image/*"`）：靠选择器 accept + 后端 422 双层收口，文案要说清仅支持 PNG。
