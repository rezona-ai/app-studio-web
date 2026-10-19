# 实现计划：导出 Google Play Bundle（.aab）

spec：`docs/superpowers/specs/2026-08-24-export-play-bundle.md`
分支：`feat/export-play-bundle`（worktree 隔离）

按「并存加新 → 原子切换」推进：契约与纯逻辑先落且不改变 apk 行为，UI 最后接线。
每个任务独立可测、独立可评审，逐个 commit。

## T1 契约类型对齐（`src/lib/pgc/types.ts`）

- `ApkOutputFormat = 'apk' | 'aab'`；
- `ApkBuildRequest` 增 `output_format?` / `version_name?` / `version_code?`（**全部可选**，
  aab 的必填由前端纯逻辑保证 —— 类型上做成条件必填会让 apk 分支调用点被迫写 undefined）；
- `ApkBuildStatusData` 增 `output_format?: ApkOutputFormat` / `package_name?: string | null` /
  `version_name?: string | null`（老作业/老后端可能不回，故 optional）。
- 验证：`pnpm exec tsc --noEmit`。

## T2 纯逻辑 + 单测（`src/lib/apk-export.ts` / `.test.ts`）— TDD，先写失败测试

新增：
- `isValidPackageName` / `isValidVersionName` / `isValidVersionCode`；
- `buildApkRequest(input): ApkBuildRequest`——apk 分支不带三字段（逐字节等于今天的请求体）、
  aab 分支带全三字段且 trim；
- `mapApkError` 增 `APK_OUTPUT_FORMAT_UNAVAILABLE → preview.apk.err.formatUnavailable`；
- 常量 `AAB_VERSION_NAME_MAX` / `VERSION_CODE_MAX` / `DEFAULT_VERSION_NAME='1.0.0'`。

测试用例（先红后绿）：包名合法/非法各若干（单段、大写、连续点、数字开头、下划线）、
versionCode 边界（0 / 1 / 2100000000 / 2100000001 / 小数 / NaN）、versionName 空白与 51 字、
`buildApkRequest` 两分支字段集合断言（apk 分支断言**不含** output_format 键）。
- 验证：`pnpm exec vitest run src/lib/apk-export.test.ts`。

## T3 i18n 11 语（`src/i18n/locales/*.ts`）

`preview.apk.*` 下新增：`formatApk` / `formatAab` / `formatLabel`、`titleAab`、
`packageLabel` / `packagePlaceholder` / `packageWarn` / `packageInvalid`、
`versionNameLabel` / `versionCodeLabel` / `versionCodeHint`、
`downloadAab`、`playSection` / `playStep1` / `playStep2` / `playStep3`、
`versionMetaAab`、`err.formatUnavailable`、`err.packageInvalid`；
`exportApk` 文案改为「导出为 Android 应用」等价译文。
- 验证：`pnpm exec tsc --noEmit`（locale 类型以 zh 为准会报缺键）。

## T4 埋点枚举（`src/lib/analytics/events.ts`）

`game_export_submit.target` 加 `'aab'`。
- 验证：`tsc --noEmit`。

## T5 模态接线（`src/components/preview/ApkExportModal.tsx`）

1. 新增 `format` state（`'apk' | 'aab'`），表单顶部 `Segmented`；
2. 切段时清 `buildId` / `downloadUrl` / `failureText` / `buildDuration`（格式参与幂等身份）；
3. aab 表单三字段（包名空 + placeholder + 不可逆警示；versionName 预填 1.0.0；versionCode 预填 1）；
   CTA 禁用条件并入三个校验（不合法不发请求）；
4. `submit` 改走 `buildApkRequest`；
5. 轮询里读回 `output_format` / `package_name` / `version_name` 存 state（回显以服务端为准）；
6. done 页按 `format` 分叉：aab 隐藏二维码区，显示「上传到 Google Play」区（包名只读 + 复制 +
   三步引导），下载按钮文案换 `.aab`；
7. 埋点 target 随格式。
- 验证：`pnpm exec vitest run src/components/preview/`（若无该模态测试则补一个覆盖
  「切到 aab → 三字段校验 → 提交请求体含 output_format=aab」的组件测试）。

## T6 菜单文案（`src/components/preview/FileMenu.tsx` + 其测试）

`preview.apk.exportApk` 文案已在 T3 改，若 `FileMenu.test.tsx` 断言旧文案则同步更新。
- 验证：`pnpm exec vitest run src/components/preview/FileMenu.test.tsx`。

## T7 合并前验证

`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build`，
派干净上下文子代理按 commit 范围独立评审（只给 spec + diff）。

## 风险与坑

- **apk 分支必须零行为变化**：`buildApkRequest` 的 apk 分支不得带 `output_format` 键
  （即便值是 'apk'）——它参与幂等身份，凭空加键会让老作业幂等不命中、重复构建重复计费。
  T2 用「断言键不存在」的测试钉死。
- **version_code 回显以状态端点为准**：服务端计数器只升不降，可能顶高用户输入值。
- **`mountedRef` / 轮询竞态**沿用现有范式，不新造。
