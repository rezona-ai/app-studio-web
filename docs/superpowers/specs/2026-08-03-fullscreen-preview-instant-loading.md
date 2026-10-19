# 全屏预览秒出加载态设计稿

日期：2026-08-03
相关代码：`src/components/preview/PreviewPanel.tsx`、`src/components/preview/GameFrame.tsx`、`src/store/actions.ts#previewVersionById`

## 目的

「全屏展示」点开新页签后当前会**白屏一段时间**才出现游戏，用户不知道是否点中、是否卡死。目标是**点击即有反馈**：新页签立刻显示品牌加载动画，游戏就绪后淡入，全程无白屏。

## 现状（白屏由三段叠加）

1. `PreviewPanel.tsx:153` 先 `window.open('', '_blank')` 开**空白页签**（为规避弹窗拦截），再 `await previewVersionById(active.id)` 走 PGC REST `GET /api/projects/{pid}/versions/{vid}/preview` —— 这段页签内是彻底空白，无任何内容；
2. 拿到 `preview_url` 后 `win.location.href = url` 导航到 pgc/CDN 的 `index.html`，首字节返回前浏览器仍停在空白文档；
3. 游戏文档自身加载资源期间没有我们的兜底加载态（右栏 `GameFrame` 有 `LoadingScreen`，全屏页签没有）。

即：右栏预览有完整的加载动画与假进度，全屏页签**完全没有**——同一个等待，两种体验。

## 约束

- **不得为规避弹窗拦截而牺牲反馈**：打开动作必须在点击的同步栈内完成（不能 await 后再 open）。
- 复用既有加载语汇：`LoadingScreen variant="soft"` + `preview.loadingNamed` / `preview.loadingHints` / `preview.unavailable`，不新增 keyframes、不新增 10 份 locale 文案。
- 新页签是**独立文档**，拿不到工作台 store（无 versions / 无 currentProjectId），所需上下文只能由 URL 携带。
- 自身绝对路径必经 `basePath`（`assetPath()`），否则部署在 `/game/*` 下会被 LB 路由到别的后端。
- 本地 Koubou 调试（`NEXT_PUBLIC_KOUBOU_BASE_URL`）下预览走 `/api/local-preview/{pid}/v{seq}/dist/index.html`，全屏页必须同样可用。
- 页面**纯净铺满**：加载期显示加载动画，就绪后只剩铺满视口的游戏，无顶栏 / 无浮层（退出=关页签）。

## 方案

新增同源全屏路由，点击时**同步导航**过去，等待被我们自己的加载态盖住。

```
点击全屏 ──同步──▶ window.open(assetPath('/full/{pid}/{vid}?seq={n}'), '_blank')
                      │
                      ├─ 首屏即渲染 LoadingScreen(soft) + 版本名 + hints 假进度   ← 白屏段 1 消失
                      ├─ 客户端解析 preview_url（REST 或 dev local-preview 直链）  ← 被加载态覆盖
                      └─ <iframe> 铺满视口加载游戏，onLoad 后淡入、加载层撤走      ← 白屏段 2/3 消失
```

对比另两个候选：

| 方案 | 白屏覆盖 | 取舍 |
|---|---|---|
| **本地全屏页 + iframe（采用）** | 三段全覆盖 | 多一层 iframe；地址栏是我们的 URL |
| 保持直出 + 预取 url + `document.write` 占位 | 只覆盖段 1 | 改动最小，但导航后到游戏首帧仍白 |
| 同步打开分享短链 `/share/{code}/v{n}` | 只覆盖段 1 | 依赖 `public_id` 且须已 build，按钮更常置灰 |

### 路由与参数

`GET /full/{pid}/{vid}?seq={n}`

- `pid`：项目 id（数字，非数字 → 404）；`vid`：`version_id`，preview REST 需要它。
- `seq`：`Version.index`。两个用途——① 本地 Koubou 调试拼 `/api/local-preview/{pid}/v{seq}/dist/index.html`；② 加载文案显示 `Version {seq}`（缺省则退化为通用文案）。
- 不把版本自定义标题塞进 URL：加载文案是**瞬时**的，`Version {seq}` 已足够准确，避免链接噪音与转义问题。

### 预览地址解析下沉为共享逻辑

`previewVersionById`（store action）与全屏页需要**同一套** dev 分流 + REST 逻辑，抽到 `src/lib/pgc/preview-url.ts`：

```ts
resolvePreviewUrl({ pid, vid, seq }): Promise<string | null>
```

- `NEXT_PUBLIC_KOUBOU_BASE_URL` 且 `seq != null` → 返回 `apiPath('/api/local-preview/{pid}/v{seq}/dist/index.html')`；
- 否则 `pgcApi.previewVersion(pid, vid).preview_url`。

`PgcError` 的 Toast 收敛仍留在 store action 内（`lib/` 保持无副作用）；全屏页自己把失败转成 `ScreenNotice`。

## 成功标准

1. 点击「全屏展示」后新页签**首帧**即出现品牌加载动画（不再出现空白文档）。
2. 游戏 `iframe` `onLoad` 后淡入并撤掉加载层；解析失败显示 `preview.unavailable` 提示而非白屏。
3. 打开动作在点击同步栈内完成 —— 不被浏览器弹窗拦截。
4. `/full/...` 链接可直接刷新 / 复制访问；部署在 `/game` basePath 下路径正确。
5. 本地 Koubou 调试下全屏页与右栏预览走同一个 local-preview 直链。
6. 非法 `pid` → 404；`pnpm lint` / `tsc` / `test` / `build` 全绿。
