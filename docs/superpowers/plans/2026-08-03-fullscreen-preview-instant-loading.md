# 全屏预览秒出加载态实现计划

设计稿：`docs/superpowers/specs/2026-08-03-fullscreen-preview-instant-loading.md`

按「并存加新 → 原子切换 → 删旧」推进：先落可独立测试的纯逻辑与新页面，最后一步切换入口行为。每个任务一次提交。

## 任务 1：抽出预览地址解析纯逻辑

- 新增 `src/lib/pgc/preview-url.ts`：`resolvePreviewUrl({ pid, vid, seq })` —— dev local-preview 分流 + PGC REST，失败抛出（不吞、不落 Toast）。
- 新增 `src/lib/pgc/preview-url.test.ts`：dev 分流命中 `/api/local-preview/{pid}/v{seq}/dist/index.html`（含 basePath）；无 `seq` 时回落 REST；REST 返回 `preview_url`。
- 改 `src/store/actions.ts#previewVersionById` 委托该函数，保留 `PgcError → Toast` 与返回 `null` 的既有语义（`actions.test.ts` 现有用例须仍绿）。
- 验证：`pnpm exec vitest run src/lib/pgc/preview-url.test.ts src/store/actions.test.ts`

## 任务 2：全屏预览页面组件

- 新增 `src/components/preview/FullscreenPreview.tsx`（'use client'）：`I18nProvider` 包裹；`fixed inset-0` 黑底；挂载即解析 url；`iframe` 铺满视口、`onLoad` 淡入；未就绪显示 `LoadingScreen variant="soft"`（文案 `preview.loadingNamed` + `preview.loadingHints`）；失败显示 `ScreenNotice(preview.unavailable)`。
- 新增 `src/components/preview/FullscreenPreview.test.tsx`：解析中显示加载态；成功后 `iframe src` 正确且 `onLoad` 后加载层撤走；解析失败显示不可用提示。
- 验证：`pnpm exec vitest run src/components/preview/FullscreenPreview.test.tsx`

## 任务 3：`/full/{pid}/{vid}` 路由 + URL 构造器

- 新增 `src/app/full/[pid]/[vid]/page.tsx`：server component 校验 `pid` 为数字、`vid` 非空（否则 `notFound()`），读 `?seq=` 传下去，渲染 `FullscreenPreview`；`metadata.title = 'Taluna · Preview'`。
- 新增 `src/lib/fullscreen-url.ts`（落点较原计划改为扁平 lib 文件，不为单文件新开 `lib/preview/` 目录）：`buildFullscreenUrl(pid, version)` → `{basePath}/full/{pid}/{vid}?seq={n}`，缺料返回 `null`；配套 `*.test.ts`（含 basePath 前缀与 vid 编码）。
- 验证：`pnpm exec vitest run src/lib/fullscreen-url.test.ts`

补充落地项（实现期发现）：

- `ScreenNotice` 从 `GameFrame.tsx` 提到独立文件 `src/components/preview/ScreenNotice.tsx`，避免全屏页为一个提示层把 store 拖进首屏 chunk（`CompareView` 的 import 同步更新）。
- 全屏 `iframe` 显式 `allow="fullscreen; autoplay; gamepad"`：旧行为是顶层文档直出，改内嵌后跨源子文档默认没有这些权限，不放行即为回归。

## 任务 4：切换入口（原子切换 + 删旧）

- 改 `src/components/preview/PreviewPanel.tsx`：全屏按钮 `onClick` 改为同步 `window.open(buildFullscreenUrl(...), '_blank')`，删掉「开空白页 → await → 导航 / 关页」旧逻辑与其注释。
- 改 `src/components/preview/PreviewPanel.test.tsx`：替换两条旧全屏用例为「点击同步 open 到 `/full/...`」；断言未调用 `previewVersionById`。
- 验证：`pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`

## 任务 5：整体验证

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
- 本地起 dev，实际点全屏按钮：新页签首帧即见加载动画（用 devtools 慢网络放大观察），游戏就绪淡入。
