# 导出 Google Play Bundle（.aab）

## 目的

现有「导出为 APK」链路（spec `2026-07-20-export-apk-menu`）只产侧载 APK。后端 `docs/api/apk.md`
已在**同一套 `apk-builds` 端点**上扩出 `output_format=aab`（Google Play App Bundle），让用户能把
自己的游戏上架到**自己的** Google Play 应用。本需求把这条能力接进前端。

不是新端点，是既有三端点的新参数与新回字段。

## 契约增量（源：rezona-ai/rezonalab-game-server `docs/api/apk.md`@dev）

请求 `POST /api/projects/{public_id}/apk-builds` 新增三个字段：

| 字段 | 类型 | apk | aab | 说明 |
|---|---|---|---|---|
| `output_format` | `'apk' \| 'aab'` | 可选（默认 apk） | 必传 `aab` | **参与幂等身份**：同版本先 apk 后 aab 是两个独立作业 |
| `package_name` | string | 可选（服务端派生 `app.madewith.game{id}`） | **必填** | 小写点分段 ≥2 段；格式非法 422 |
| `version_name` | string | 可选（默认沿用 `v{n}`） | **必填** | 1..50，Play 商店页显示串；参与幂等身份 |
| `version_code` | int | 可选（服务端单调发号） | **必填** | 1..2_100_000_000；参与幂等身份；显式指定后服务端计数器只升不降 |

状态 `GET .../{build_id}` 新增回字段：`output_format` / `package_name` / `version_name`。

下载：`apk` → `.apk` + `application/vnd.android.package-archive`；`aab` → `.aab` + `application/octet-stream`。
`download-link` 端点对两种格式同样可用（本 spec 继续用它做「下载到本地」，理由见「约束与取舍」）。

新错误码：`503 APK_OUTPUT_FORMAT_UNAVAILABLE`（构建侧 AAB 未就绪，受 `APK_EXPORT__AAB_ENABLED` 控制，
受理侧与执行侧各判一次）；`output_format=aab` 缺三个必填字段任一 → `422`。

## 约束与取舍（盘问结论）

1. **入口=两个独立菜单项**（2026-08-24 手验后改定；原方案为模态内 `Segmented` 切格式，已废弃）。
   `FileMenu` 导出分组并列「导出为 APK」与「导出为 Google Play Bundle」，同一个 `ApkExportModal`
   组件接 `format` prop，打开即定格式、模态内不再能切。理由：格式是「要交付到哪里」的分叉，
   在菜单层分流比进模态后再切更直白；表单字段数与结果页形态两格式差异大，切换会让表单跳变。
   组件仍是一份 —— building / failed / 轮询 / 图标上传 / 幂等语义完全共用，拆两个组件必然漂移。
   菜单项文案保持「导出为 APK」原样，新增项为「导出为 Google Play Bundle」。
   随之退役：`Segmented` 格式分段、`switchFormat` 切格式清作业态、i18n 的
   `formatApk` / `formatAab` / `formatLabel` 三键。
2. **`package_name` 不预填**。文档明写派生值是 Rezona 的命名空间，进用户自有 Play 应用后
   **永久不可改、全 Play 唯一**，是本链路唯一不可逆的用户侧错误。预填等于诱导用户把 Rezona
   命名空间烧进自己的应用；且前缀 `app.madewith.` 是服务端配置，前端硬编码会漂移。
   → 空输入框 + placeholder 示例 + 前端格式校验 + 不可逆警示文案。
   `version_name` 预填 `1.0.0`、`version_code` 预填 `1`，均可改。不做跨次记忆（YAGNI；
   用户自有 Play 的号段历史本服务看不见，记忆值一样可能撞号，反而给出虚假的权威感）。
3. **apk 侧维持现状**，不暴露 `version_name` / `version_code`（文档：「侧载场景照旧不传即可」）。
   切到 apk 时请求体不带这三个字段，与今天逐字节一致 —— aab 是纯增量，不改 apk 行为。
4. **done 页按格式分叉**：
   - apk：沿用今天的「下载 + 二维码扫码安装」；
   - aab：**去掉二维码区块**（手机装不了 bundle），换成「上传到 Google Play」区：
     `package_name` 只读回显 + 一键复制（文档明确要求「不要让用户凭记忆填」）+ 不可逆警示 +
     三步引导（Play Console 新建应用时包名须完全一致 → 上传此 .aab → Play 重新签名分发）。
   - 信息卡（图标 / 名称 / 作者 / versionCode / 构建耗时）、`networked` 提示两格式共用；
     aab 的版本行同时显示 `version_name (version_code)`，取**状态端点回的值**而非本地输入
     （服务端可能因单调发号顶高 version_code，回显必须是真正烧进产物的那个）。
5. **不做 AAB 可用性预探测**：没有探测端点。Segmented 两段恒显示，提交后若 `503
   APK_OUTPUT_FORMAT_UNAVAILABLE` 则回 form + Toast「Play Bundle 导出暂未开放」——与既有
   `APK_EXPORT_DISABLED` 不预探测的口径一致（后端是唯一真相源）。
6. **切格式即清作业态**：`output_format` 参与幂等身份，切换后必须新建作业。切段时清
   `buildId` / `downloadUrl` / 失败态，避免轮询 effect 打到上一格式的旧作业（同 submit 现有的
   重试竞态防护）。
7. 文案 11 语全量补齐（`preview.apk.*` 下新增键；不另起命名空间，两格式共用一套模态文案）。
8. 埋点：`game_export_submit.target` 扩出 `'aab'`；`game_apk_download.target` 维持 `'local'`
   （aab 无扫码路径）。

## 纯逻辑（下沉 `src/lib/apk-export.ts`，同目录单测）

- `isValidPackageName(s)`：小写点分段 ≥2 段（`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`），与后端 422 口径对齐；
- `isValidVersionCode(n)`：整数且 `1..2_100_000_000`；
- `isValidVersionName(s)`：清洗后 1..50；
- `buildApkRequest({format, ...})`：按格式装配请求体 —— apk 不带三字段、aab 带全三字段，
  把「哪个格式带哪些字段」这条契约收成一个纯函数，避免散在组件里；
- `mapApkError` 增补 `APK_OUTPUT_FORMAT_UNAVAILABLE`；
- 常量 `AAB_VERSION_NAME_MAX = 50`、`VERSION_CODE_MAX = 2_100_000_000`。

## 成功标准

- 模态内可切 APK / Play Bundle；aab 表单三字段必填校验生效（不合法时 CTA 禁用，不靠后端 422 兜底）；
- aab 全流程（发起 → 轮询 → 签发链接 → 下载 .aab）在真实信封下走通，done 页回显并可复制包名；
- 切格式后重新提交产生**新作业**（幂等身份含格式），不复用上一格式的 build；
- apk 链路行为零变化（请求体不含新增三字段）；
- 纯逻辑单测覆盖三个校验函数 + `buildApkRequest` 两分支 + 新错误码映射；
- `pnpm lint / tsc --noEmit / test / test:tz / build` 全绿。

## 评审处置（2026-08-24，两路独立评审）

`/code-review dev..HEAD high` 与一路契约对照评审（spec + 后端 apk.md）各跑一遍，Critical 均为「无」。

已修（本轮）：
- **包名正则只约束首段**：`com.2048game` / `com.acme.9lives` 前端放行 → 后端 422，而
  `VALIDATION_ERROR` 无专属映射，用户只看到通用「导出失败」，指不到包名字段。改为每段须字母开头，
  并补 255 长度上限（Play 的 applicationId 口径，契约未写）。
- **`mintLink` 只守 `mountedRef`、不守作业身份**：done(apk) 的签发在飞时切格式重导 aab，慢回来的
  旧链接会覆盖新作业的下载链 —— 用户拿着 `.apk` 去 Play Console 传。加自增令牌 `mintSeq`，
  `switchFormat` / `submit` 各自作废在飞签发，配一个复现该竞态的用例。
- **完成页与 Segmented 自相矛盾**：正文按服务端 `output_format` 渲染而分段高亮本地选择，用户点一下
  「纠正」反而清掉已完成作业。改为轮询回执直接同步本地 `format`，`builtFormat` / `doneFormat` 随之退役。
- **剪贴板失败复用 `err.generic`**：在导出**成功**页弹「APK 导出失败，请重试」，还诱导重走付费构建。
  新增 `err.copy`，11 语补齐。
- **`versionName` / `versionCode` 非法时 CTA 静默变灰**：补行内错误文案（`versionNameInvalid` /
  `versionCodeInvalid`，11 语），并把 `packageInvalid` 文案口径对齐新正则（此前没提「每段须字母开头」，
  用户会看到一条自己明明满足的报错）。
- 包名回显为空时整块隐藏（不给空框 + 静默复制空串）；复制按钮 hover 底色改 `--color-surface`
  （原先与容器同为 `--color-fill`，悬停毫无变化）；版本号输入补 `maxLength`。

记录不改（Minor）：
- **轮询无总超时 / 尝试上限**：瞬时错误（5xx / 超时 / 断网）会无限重试，模态一直转圈。契约建议
  「总超时 ≥ 10 分钟」。属 dev 上既有行为，非本次引入，改动会波及 apk 既有链路，另行开需求。
- **轮询 503 不会命中 `APK_OUTPUT_FORMAT_UNAVAILABLE` 映射**：技术性异议 —— 契约里 AAB 未就绪的
  执行侧拒绝表现为作业 `failed`，不是轮询端点 503；该映射服务于发起端点，已生效。
- **`failure_category` 直出后端中文**：11 语 UI 里恒为中文。dev 上既有问题，非本次引入。
- **从 done 页切格式会静默作废已签发的下载链**：spec 第 6 条的明确决策（格式参与幂等身份），
  已有「同段重复点不清态」守护用例。若日后有用户反馈「点了下 Play Bundle，刚构建好的 APK 链就没了」，
  根因在此。
