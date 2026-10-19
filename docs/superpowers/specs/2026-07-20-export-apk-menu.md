# 导出菜单 + 导出为 APK

## 目的

预览工具条现有单一「下载 ZIP」图标按钮。本需求将其升级为**导出菜单**（下拉），并新增「导出为 APK」，接入 PGC 的 APK 构建三端点（Apifox 8405123）：

- `POST /api/projects/{project_id}/apk-builds` —— 发起构建，返回 `{build_id, status}`（异步，幂等：同版本同配置返回同一作业）
- `GET  /api/projects/{project_id}/apk-builds/{build_id}` —— 轮询状态 `queued → building → succeeded/failed`（建议 3–5s 间隔；冷启动 3–5 分钟属正常）
- `GET  /api/projects/{project_id}/apk-builds/{build_id}/download` —— 二进制流直下（`<a>` 触发即可，带 Content-Disposition）

功能受后端 flag `pgc-export-apk` 门控，未开放 → 404 `APK_EXPORT_DISABLED`。

## 约束与取舍

- 请求体：`version_id`（必填，稳定版 `v{n}`，`current` 422）、`name`（必填 1..64，桌面显示名）、`package_name` / `icon_item_id` 选填。**YAGNI：不做包名与图标自定义 UI**，服务端按缺省派生 / 用默认图标；后续有需求再加。
- `version_id` 取当前选中版本 `v${version.index}`（与 Rezona 发布一致）。
- 前端不做 flag 预探测：菜单项恒显示，点击后由 404 `APK_EXPORT_DISABLED` 报错兜底（与后端唯一真相源一致，避免多余端点）。
- 轮询固定 3.5s；模态关闭即停止轮询（构建服务端继续；重开重新提交，幂等命中同一作业等价于恢复）。
- `failure_category` 为服务端用户可读文案，直接展示；为空回落通用失败文案。
- `networked=true` 时成功页提示「游戏含在线调用，需联网游玩」。

## UI 方案（对齐 Figma 4857:45122 表单 / 4857:45104 打包中 / 4857:45176 完成）

- 表单：badge `> EXPORT` + 标题「Export your game as APK」+ GAME TITLE 输入（带 pencil 图标）+ APP ICON（96px 圆形预览 + Upload 白色胶囊钮，上传走画布 item → `icon_item_id`）+ 青色 Export 胶囊 CTA + 「Packing takes about 2-5 minutes.」提示。
- 打包中：64px 青色 spinner + 「Packing up your game…」。
- 完成：「Your file is ready!」+ 青色 Download 胶囊 + 文件卡（图标 / 标题 / 用户名 / Version(version_code) / Build time(客户端计量)）。
- 手机扫码下载区块已实现：合入上游 #65 的 `download-link` 端点（owner 签发免登录能力链，7 天有效，每次签发轮换 token），本地下载与二维码共用同一条链接；「Download QR code」把 QR 打包成 SVG 下载。
- Size 行未实现：状态端点不回包体大小。

## 旧 UI 方案（首版,已被上节替代）

- **ExportMenu**：复用 FileMenu 范式（遮罩 + `anim-pop-in` + pop 面 + Esc 关闭），锚定原下载按钮。两项：「下载 ZIP」（原逻辑）与「导出为 APK」（开模态）。
- **ApkExportModal**：复用 modal-backdrop/modal-pop 范式（对齐 RezonaPublishModal 外壳，portal 到 body）。状态机 `form → building → done | failed`：
  - form：应用名输入（预填项目名，截 64），确认发起构建；
  - building：spinner + 「构建中，约需 3–5 分钟」，轮询推进；
  - done：下载 APK 按钮（`<a download>` 指向下载端点）+ networked 提示；
  - failed：failure_category / 映射文案 + 重试回 form。
- 已知错误码映射 i18n：`APK_EXPORT_DISABLED` / `APK_VERSION_NOT_BUILDABLE` / `APK_PACKAGE_TOO_LARGE` / `APK_BUILD_WORKER_UNAVAILABLE`（可重试）/ `APK_BUILD_NOT_READY`；其余走通用失败。
- 文案 11 语全量补齐（`preview.exportMenu.*` / `preview.apk.*`）。

## 成功标准

- 菜单两项可用；APK 全流程（发起→轮询→下载）在真实/模拟信封下走通；
- `lint / tsc / test / build` 全绿；纯逻辑（错误映射、终态判定）有单测。
