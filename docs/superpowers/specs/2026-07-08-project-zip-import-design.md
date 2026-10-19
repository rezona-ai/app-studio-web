# 项目压缩包导入（Import Project）设计

- 日期：2026-07-08
- 关联需求：Meegle Story 13370489「增加项目 zip 上传能力」
- 后端契约：`POST /game/pgcserver/api/projects/import`（Apifox 项目 8405123，entityId 481643140，已发布）

## 目标

用户可在 ProjectMenu 中选择「导入项目」，上传一个外部代码压缩包（`.zip` / `.tar` / `.tar.gz` / `.tgz`），后端将其落为一个新项目的 `v1` 版本；前端导入成功后自动切换到新项目，并把后端识别出的包内素材自动登记到画布。

## 后端契约要点（只取文档字段，不臆测）

- 请求：`multipart/form-data`，`file`（压缩包）+ `name`（新项目名，必填，缺失 422）。
- 支持格式：`.zip` / `.tar` / `.tar.gz` / `.tgz`；其余 422 `ARCHIVE_UNSUPPORTED_FORMAT`。
- 后端不做内容校验：有 `dist/index.html` → `version_status=ready`，无 → `needs_build`；越界路径 422 `ARCHIVE_UNSAFE_PATH`、超限 413 `ARCHIVE_TOO_LARGE`、损坏 422 `ARCHIVE_INVALID`。
- 成功信封 `{ success, code, message, data, request_id }`，`data` 为 `ImportProjectData`：项目基础信息（`id` / `public_id` / `name` / `cover_url` / `current_version_id` / `status` / 时间戳）+ `version_id` / `version_status` / `play_url` / `preview_url` / `file_count` + `assets[]`。
- `assets[]`（`ImportAssetData`）：`type` / `rel_path` / `name` / `source_url` / `thumbnail_url` / `meta_url`。导入本身**不写** canvas_items，由前端逐条调 `POST /canvas/items/import` 登记并自行赋坐标。

## 交互决策（已与 Nick 确认）

| 决策点 | 结论 |
|---|---|
| 入口 | ProjectMenu 新增「导入项目」菜单项，与新建项目并列 |
| 导入后行为 | 全自动：切到新项目 + `assets` 全部自动落画布 |
| 前端文件校验 | 四种格式都放行（`<input accept>` 限定扩展名），**不做**前端大小预校验，413/422 由 Toast 展示后端 message |
| `needs_build` | 不特殊提示，预览面板按版本状态自然展示 |
| 实现形态 | 独立 `ImportProjectModal`（文件选择 + 项目名输入 + 上传中态），复用 CreateGameModal 范式 |

## 设计

### 1. 数据层（`src/lib/pgc/`）

- `types.ts`：新增 `ImportProjectData` / `ImportAssetData`，字段与契约一一对应（snake_case，不加兜底别名）。
- `client.ts`：新增 `importProject(file: File, name: string): Promise<ImportProjectData>` —— `POST /api/pgc/projects/import`，FormData 携带 `file` + `name`，经现有 pgc catch-all 代理（multipart 透传已被 Upload Canvas Item 验证）。错误沿用现有 `PgcError` 归一。

### 2. store action（`src/store/actions.ts`）

新增 `importProject(file: File, name: string)`：

1. 置导入中状态（`importingProject: boolean`，UIState，非持久化瞬态），供模态展示 loading / 禁用；
2. 调 client 上传；失败走 `guard()` → `setError` → 全局 Toast，不切项目；
3. 成功后刷新项目列表（`loadProjects`）并 `switchProject` 到新项目；
4. 对 `data.assets` 逐条调现有 `/canvas/items/import` 端点登记画布项，落位复用 `card-layout` 级联逻辑；**每个 `await` 后校验 `currentProjectId` 仍为新项目**，过期立即丢弃（沿用仓库既有竞态约定）；
5. 落画布失败不阻断导入结果（项目已存在），逐条失败仅 Toast 一次。

### 3. UI

- `ProjectMenu`：新增「导入项目」菜单项（FigIcon 复用既有图标，遵守 tone 约定）。
- 新组件 `src/components/chat/ImportProjectModal.tsx`：
  - 文件选择：`<input type="file" accept=".zip,.tar,.tar.gz,.tgz">`；
  - 项目名输入：默认取文件名去扩展名，可编辑，必填（空值禁用提交）；
  - 提交用 `Button`（`.btn-raised`），上传中禁用 + spinner；
  - 动效 `modal-pop` + 遮罩 `modal-backdrop`，退场走 `useRequestClose`；
  - 全部色值 / 圆角 / 阴影走既有令牌，无硬编码。
- i18n：六语（en 真相源）补菜单项、模态标题、字段 label、提交按钮、失败提示等文案，含 `aria-label`。

### 4. 错误处理

- 422 / 413：后端信封 `message` 经 `PgcError` → `setError` → Toast；模态保持打开，用户可换文件重试。
- 网络中断等未知错误：不吞，照 `guard` 约定抛出暴露。

### 5. 测试（与源码同目录）

- `client.ts`：FormData 组装、成功信封解析、错误信封转 `PgcError`；
- `actions.ts`：成功 → 切项目 + 逐条落画布；失败 → 不切 + `lastError`；落画布中途切走项目 → 丢弃过期写入；
- `ImportProjectModal`：默认名派生、必填校验、上传中禁用、成功关闭；
- `ProjectMenu`：菜单项渲染与点击打开模态。

## 不在本期范围

- 前端大小预校验 / 分片上传；
- `needs_build` 的引导构建文案；
- 导入历史 / 进度条（非确定性 multipart 无进度事件，仅 spinner）。
