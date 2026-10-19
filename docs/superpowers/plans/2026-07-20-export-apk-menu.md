# 实现计划：导出菜单 + 导出为 APK

对应 spec：`docs/superpowers/specs/2026-07-20-export-apk-menu.md`

## 任务 1：协议类型 + PGC client

- `src/lib/pgc/types.ts`：新增 `ApkBuildRequest` / `ApkBuildData` / `ApkBuildStatusData`（snake_case 对齐 OAS，不加别名兜底）。
- `src/lib/pgc/client.ts`：`pgcApi.apk = { create, status }` + 导出 `apkBuildDownloadUrl(pid, buildId)`（拼 PREFIX，供 `<a>` 直下）。
- 验证：`pnpm exec tsc --noEmit`。

## 任务 2：纯逻辑 lib + 单测（TDD）

- `src/lib/apk-export.ts`：
  - `mapApkError(code): string` —— 已知错误码 → i18n key，未知回落通用 key；
  - `isApkTerminal(status)` —— succeeded/failed 为终态；
  - `APK_POLL_INTERVAL_MS = 3500`。
- 同目录 `apk-export.test.ts` 先红后绿。
- 验证：`pnpm exec vitest run src/lib/apk-export.test.ts`。

## 任务 3：ExportMenu + ApkExportModal + PreviewPanel 接线

- `src/components/preview/ExportMenu.tsx`：FileMenu 同构下拉，两项（下载 ZIP / 导出为 APK）。
- `src/components/preview/ApkExportModal.tsx`：`form → building → done | failed` 状态机；轮询 3.5s；卸载即停；`mountedRef` 遵守 StrictMode setup 重置范式。
- `PreviewPanel.tsx`：下载按钮改为开合 ExportMenu；aria-label 换 `preview.export`。
- 验证：`pnpm exec tsc --noEmit && pnpm test`。

## 任务 4：i18n 11 语

- `preview.export` / `preview.exportMenu.{downloadZip,exportApk}` / `preview.apk.*` 全量补 11 套 locale。
- 验证：`pnpm exec tsc --noEmit`（Messages 类型强校验缺 key）。

## 任务 5：全量验证 + 提交

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`。
- `docs:` 与 `feat:` 提交成对。
