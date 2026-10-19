# pgc-server REST API 集成 — 设计文档

> 日期：2026-06-08
> 目标：把 pgc-server 的 REST API 接入 game-create-platform 前端，覆盖**项目 / 画布 / 版本**三个域。
> 后端契约权威来源：服务端 OpenAPI（apifox），以及历史文档 `docs/pgc-server-api.md`（commit 79e4fea）。

---

## 1. 背景与现状

**后端（pgc-server）** 围绕「项目 → 版本 → 画布」三层模型：

- **项目（project）**：一个游戏作品，`project.id`（int）同时是 agent 侧 `game_id`。
- **版本（version）**：agent 构建产物（`v1`/`v2`…），pgc **只读不写**——从存储发现 `v{n}`、读 `manifest.json`，只认 `status=ready` 的版本。
- **画布（canvas）**：用户素材工作区，经 pgc 生成图片/视频/3D 并维护资产关系。画布资产与版本产物是**两个物理隔离的池子**。

统一约定：

- base 默认 `http://8.233.87.67`（开发环境，需可配置）。
- JWT Bearer 鉴权（HS256，默认 7 天），`Authorization: Bearer $T`。
- 统一响应信封 `{ success, code, message, data, request_id }`；`code` 为字符串业务码（成功恒 `"OK"`）。
- 例外：`GET /preview/...`（媒体字节）、版本 `download`（ZIP）返回原始字节流；二者出错时仍回 JSON 信封。

**前端现状** 是纯本地 mock：

- Zustand + localStorage 持久化（`taluna-v3`）+ 首屏种子数据（`SEED`）。
- 一条独立 WebSocket agent 协议（`/api/agent/ws`）做 AI 对话流，与 REST 后端无关。
- **完全没有 HTTP / token / projectId 概念**（grep 零命中）。
- UI 外壳已存在但未接后端：`ProjectMenu`（聊天头部，新建/复制/重命名/删除，`onAction` 未传）、`AddAssetMenu`（画布右键增删，全本地）、`PreviewPanel`/`VersionTimeline`（Publish 走本地 `saveVersion`，下载/分享/重生成按钮未接线）。

**部署形态**：`next.config.ts` 为空（非静态导出）；自定义 `server.ts` 把所有非-WS 的 HTTP 交给 Next request handler。因此 **Next Route Handler 可用**，proxy 用 catch-all route handler 实现即可，无需改 `server.ts`。

---

## 2. 已确认的关键决策

1. **数据源**：服务端 REST 为 projects/canvas/versions 的**唯一真实源**，替换本地 mock；WS agent 仍只负责 AI 对话流。
2. **鉴权**：`.env` 预置账号，应用层**自动登录**换 token，token 在**服务端**缓存（凭据不下发前端）。
3. **画布生成触发**：**画布内表单直连 REST** 与 **agent 间接触发** 两条路都要，统一通过重拉画布列表对齐。
4. **复制项目**：后端无对应端点，**隐藏/禁用 Duplicate**。
5. **项目切换**：在 `ProjectMenu` 内增加项目列表用于切换当前项目。
6. **请求通道**：**Next 服务端代理**（`/api/pgc/*`），服务端注入 Bearer，规避 CORS、凭据不外泄。
7. **媒体加载**：`img/video/iframe` 直连 pgc 绝对地址（跨域媒体展示无需 CORS）；**仅 GLB / ZIP 下载经代理**（fetch 类需同源）。
8. **版本对比**：任务未列入，**保留 UI 但置灰不接线**。
9. **状态编排选型**：**扩展现有 Zustand store + 手写 typed fetch client**（零新依赖，贴合代码库手写风格与 vitest 习惯）。

---

## 3. 架构：三层

```
浏览器                          Next 服务端(server.ts → route handler)        pgc-server
─────────                       ────────────────────────────────────         ──────────
组件 / Zustand
  └─ src/lib/pgc/client.ts ──▶  /api/pgc/[...path]  ──注入 Bearer──▶  /api/auth, /api/projects ...
        (同源,拆信封)              src/server/pgc/{auth,proxy}.ts            (.env 账号登录换的 token,
                                                                            服务端内存缓存,401 自动重登)
  媒体(img/video/iframe) ──────────────── 直连 pgc 绝对地址(跨域媒体展示) ──────────────▶ /preview/...
  GLB / ZIP 下载 ──▶ /api/pgc/asset?url=...(经代理)
```

### 3.1 服务端 proxy + 鉴权（`src/server/pgc/`）

**`auth.ts` — token 缓存与自动登录**
- 模块级单例缓存 `{ access_token, expiresAt }`。
- `getToken()`：无缓存或将过期 → 用 `.env` 的 `PGC_EMAIL/PGC_PASSWORD` POST `${PGC_BASE_URL}/api/auth/login` 换 token，按返回（或默认 7 天）记过期时间后缓存。
- `invalidateToken()`：清缓存，供 401 重登使用。
- 并发去重：登录进行中复用同一 in-flight Promise，避免并发请求触发多次登录。

**`proxy.ts` + `src/app/api/pgc/[...path]/route.ts` — 转发**
- catch-all route handler，转发 method / path / query / body 到 `${PGC_BASE_URL}/<path>`，注入 `Authorization: Bearer <token>`。
- JSON 响应原样回传信封；ZIP/二进制流式透传（保留 `Content-Type`/`Content-Disposition`）。
- pgc 返 401 → `invalidateToken()` 后**重登一次并重试**；仍失败则把 401 透传前端。
- `src/app/api/pgc/asset/route.ts`（GLB 媒体代理）：按 `?url=` 取 pgc 媒体字节流式透传（仅用于 fetch 类加载，如 three.js GLTFLoader）。

### 3.2 浏览器 client 层（`src/lib/pgc/`）

- **`types.ts`**：镜像 OpenAPI 的 TS 类型——`ProjectData`、`ProjectListData`、`CanvasItemData`、`CanvasItemListData`、`CanvasGenTask`、`VersionData`、`VersionListData`、`CreateVersionData`、`UserData`、各请求体；以及信封 `APIResponse<T> = { success; code; message; data: T|null; request_id }`。
- **`client.ts`**：同源调 `/api/pgc/*`。
  - `pgc<T>(method, path, body?)`：发请求 → 拆信封 → 返回 `data`。
  - 失败映射：非 2xx 或 `success=false` → 抛 `PgcError{ code, message, status }`。
  - 各域便捷方法：`listProjects/createProject/getProject/updateProject/deleteProject`；`listCanvasItems/updateCanvasItem/deleteCanvasItem/uploadCanvasItem/genImage/genVideo/pollVideo/genModel3d/pollModel3d`；`listVersions/createVersion/getVersion/previewVersion/downloadVersion`。
- **`map.ts`**：`CanvasItemData → Asset`、`Asset → reference patch`、`VersionData → Version` 适配器（见 §4），让现有画布/时间线组件基本不动。
- **`url.ts`**：`resolveAssetUrl(url)`——相对 `/preview/...` 补 `PGC_BASE_URL` 前缀（base 通过 `NEXT_PUBLIC_PGC_BASE_URL` 暴露给前端用于媒体直连）。

### 3.3 Zustand 改造（`src/store/`）

- 新增字段：`currentProjectId: number | null`、`projects: ProjectData[]`、各域 `loading/error` 标志。
- `assets` / `versions` 改为从服务端拉取后填充：
  - **移除 `SEED` 注入**（`useAgentConnection` 内首屏种子逻辑删除）。
  - **移除 `assets` / `versions` 的 localStorage 持久化**（`partialize` 内剔除）；否则与服务端真实源冲突。
- `messages`（WS 对话）保持本地不变。
- localStorage 仅保留：UI 偏好（`visibleKinds`、composer 草稿/refs）+ `lastProjectId`。
- 异步 actions（见 §5 各域流程）：内部调 `src/lib/pgc/client.ts`，更新 store，捕获 `PgcError` 写入 `lastError` 供 toast 展示。

---

## 4. 数据模型映射

| 后端 `CanvasItemData` | 前端 `Asset` | 说明 |
|---|---|---|
| `item_id` (str) | `id` / `key` | 项目内稳定 id（`img-*`/`vid-*`/`m3d-*`） |
| `type` `image`/`video`/`model3d` | `kind` `image`/`video`/`3d` | `model3d → 3d` |
| `name` | `label` | 生成时默认取 prompt 前 120 字 |
| `url` (可空) | `preview.src` | 经 `resolveAssetUrl` 解析；生成中为 null |
| `status` `ready`/`generating`/`failed` | `status` | **一律以 `item.status` 为准** |
| `reference` (自由 JSON) | `position` + 关系 | **坐标存入 `reference.position = {x,y}`**（后端本期不开放写 `canvas_x/y`，但 `reference` 可 PATCH） |

- 坐标读取：优先 `reference.position`，缺失则交给现有 force-layout 计算初始位。
- 坐标写回：节点拖拽 pin 后 best-effort `PATCH .../canvas/items/{item_id}` 带 `{reference:{...prev, position}}`（失败不阻塞 UI）。

**版本映射**：`VersionData{version_id, seq, title, status, preview_url, is_current, created_at}` → 前端 `Version{id=version_id, index=seq, label=title 或 "V{seq}", current=is_current, createdAt}`。

**类型缺口**：
- 后端画布无 `doc/text` → 从 `AddAssetMenu` 移除 Text 项。
- `audio` 仅支持上传（无生成端点）。
- `3d` 仅支持生成（upload 仅 image/video/audio，不收 glb）。

---

## 5. 三个域的流程

### 5.1 项目（`ProjectMenu` 接线 + 列表）

- **列表**：`GET /api/projects?page=1&page_size=100` → `projects[]`。`ProjectMenu` 顶部新增可滚动项目列表区。
- **切换**：点击列表项 → `selectProject(id)`：置 `currentProjectId`、写 `lastProjectId`、重新 `loadCanvas` + `loadVersions`。
- **新建**：`POST /api/projects {name}` → 插入列表并自动切到新项目。
- **重命名**：`PATCH /api/projects/{id} {name}` → 更新列表与头部名。
- **删除**：`DELETE /api/projects/{id}`（软删）→ 从列表移除，切到下一个项目或空态。
- **复制**：隐藏 Duplicate 项。
- 聊天头部 "Project name" 改为绑定当前项目名。

### 5.2 画布（`AddAssetMenu` + 画布 + 轮询）

- **加载**：`GET .../canvas/items`（含 `generating` 占位）→ `map.ts` 映射进 `assets`。
- **生成（两条路）**：
  - *画布内表单*：Add 菜单选 image/video/3d → 弹小表单（图片：prompt + size/quality/n；视频/3D：prompt）→ 调对应 generate。
    - 图片**同步**：`POST .../generate/image` → 返回资产列表，直接入 store。
    - 视频/3D **异步**：`POST .../generate/video`（或 `model3d`）→ 得 `task_id` + `generating` 占位项入 store → 启动 `pollTask`（`GET .../generate/{video|model3d}/{task_id}`）轮询，至 `item.status ∈ {ready, failed}` 更新该项；`failed` 展示失败态。
  - *agent 触发*：WS agent run 结束（`result` 消息）或检测到存在 `generating` 项时调 `refreshCanvas`（重拉列表统一对齐）。
- **上传**：`POST .../canvas/items/upload`（multipart `file`，image/video/audio）→ 返回 ready 项入 store。
- **删除**：`DELETE .../canvas/items/{item_id}`（软删）→ 从 store 移除。
- **坐标**：拖拽 pin 后 best-effort `PATCH` `reference.position`。

### 5.3 版本（`PreviewPanel` / `VersionTimeline` 接线）

- **列表**：`GET .../versions` → 时间线（按 `seq` 升序）。
- **Publish = 发布即创建版本**：`POST .../versions` → 得 `{version_id, status:"building"}` 占位 → 乐观展示 building 项 → 刷新时间线。building→ready 由 agent 写盘驱动；前端在存在 building 项时**轮询/刷新** `listVersions` 直至其转 ready。
- **版本信息**：`GET .../versions/{version_id}` → `VersionData`。
- **预览**：`GET .../versions/{version_id}/preview` → `{preview_url}` 设为 `GameFrame` 的 iframe `src`（直连 pgc）。
- **下载**：`GET .../versions/{version_id}/download` → **经代理** 取 ZIP blob → 触发浏览器下载（接线 Download ZIP 按钮）。
- **对比**：保留 `Compare` UI 但置灰不接线（超出本次范围）。

---

## 6. 错误处理

- 服务端 proxy：pgc 401 → 重登一次重试；其余状态码 + 信封原样透传。
- 浏览器 client：非 2xx 或 `success=false` → 抛 `PgcError{code, message, status}`。
- store actions 捕获 `PgcError` → 写 `lastError`，由**新增的轻量 toast / 错误条**展示（项目当前无通知 UI，需补一个极简组件）。
- 业务码分支文案：
  - `ARTGEN_DISABLED` / `TRIPO_DISABLED`（503，未配 key）→「生成服务未配置」。
  - `ARTGEN_FAILED` / `TRIPO_FAILED`（502）→「生成失败，请重试」。
  - `401`（服务端已自动重登，前端通常无感）。
  - `403 FORBIDDEN` / `404 PROJECT_NOT_FOUND` → 刷新项目列表（资源可能已失效）。
  - `404 CANVAS_ITEM_NOT_FOUND` / `VERSION_NOT_FOUND` → 刷新对应列表。

---

## 7. 范围边界（YAGNI）

**做**：项目 CRUD（除复制）+ 列表切换；画布 列表/生成（图/视频/3D）/上传/删除 + 轮询；版本 列表/发布创建/详情/预览/下载；服务端代理 + 自动登录；轻量错误提示。

**不做**：
- 登录/注册 UI（自动登录替代）。
- 复制项目（无端点）。
- 版本对比（任务未列，UI 置灰）。
- 直写 `canvas_x/y`（用 `reference.position` 替代）。
- 移除 `doc/text` 画布类型；audio 仅上传。
- 不重写 WS agent 与 project_id 的绑定（agent↔pgc 工具链属后端范畴；前端仅在 agent 事件后重拉画布对齐）。

---

## 8. 文件布局

```
src/lib/pgc/
  types.ts        # OpenAPI 镜像类型 + APIResponse 信封
  client.ts       # 浏览器 client → /api/pgc/*,拆信封,PgcError
  map.ts          # CanvasItemData⇄Asset、VersionData→Version
  url.ts          # resolveAssetUrl
  client.test.ts / map.test.ts
src/server/pgc/
  auth.ts         # token 缓存 + .env 自动登录 + 401 失效
  proxy.ts        # 通用转发(注入 Bearer,JSON/二进制)
  auth.test.ts / proxy.test.ts
src/app/api/pgc/
  [...path]/route.ts   # JSON + ZIP 代理
  asset/route.ts       # GLB 媒体代理(fetch 类)
src/store/
  (扩展) currentProjectId / projects / 各域异步 actions;去 SEED;去 assets&versions 持久化
src/client/
  useProjectBootstrap.ts   # 挂载时:loadProjects → 选 lastProjectId/首个 → loadCanvas+loadVersions
  useCanvasPolling.ts      # 轮询 generating 画布项 + building 版本
src/components/
  (新增) 轻量 Toast / 错误条;画布生成表单;ProjectMenu 项目列表区
.env / .env.example:
  PGC_BASE_URL / PGC_EMAIL / PGC_PASSWORD          # 服务端
  NEXT_PUBLIC_PGC_BASE_URL                          # 前端媒体直连用
```

---

## 9. 测试（vitest，沿用现有风格）

- `client.test.ts`：信封拆解、`success=false`/非 2xx → `PgcError` 映射、各便捷方法的 path/body 拼装。
- `map.test.ts`：`CanvasItemData⇄Asset`（含 `model3d→3d`、`reference.position` 往返）、`VersionData→Version`。
- `auth.test.ts`：首次登录、缓存命中、过期重登、401 失效后重登、并发去重（mock fetch）。
- `proxy.test.ts`：注入 Bearer、JSON 透传、401 重试一次、二进制流转发（mock fetch）。
- `useCanvasPolling` / `pollTask`：状态机 `generating → ready/failed` 转换（mock client）。

---

## 10. 配置

`.env`（服务端，已 gitignore）：

```
PGC_BASE_URL=http://8.233.87.67
PGC_EMAIL=<dev 账号邮箱>
PGC_PASSWORD=<dev 账号密码>
NEXT_PUBLIC_PGC_BASE_URL=http://8.233.87.67
```

`.env.example` 同步补充上述键（密码留空占位）。
