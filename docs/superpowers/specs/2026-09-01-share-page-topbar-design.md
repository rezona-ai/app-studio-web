# 分享页顶栏设计稿（2026-09-01）

## 目的

分享链接 `/game/share/{code}/v{n}` 现在打开就是**一个光秃秃的游戏**——没有品牌、没有出口。访客玩完即走，这条对外传播链路上没有任何一处把人引回 Rezona Lab。

本轮给分享页加一条与主站同形的顶栏：**左侧 logo + 右侧两个按钮（Remix / Create your game）**，把「玩到别人的游戏」转成「自己去做一个」。顶栏只有这三件东西——不放游戏标题、作者、版本号、分享/全屏等任何工作台功能。

## 现状

| 部件 | 位置 | 现在做什么 |
|---|---|---|
| 分享页路由 | `src/app/share/[code]/[version]/route.ts` | **route handler 直出**：代理取 pgc 的 `/pv/{code}/{version}/dist/index.html`，注入 `<base>` 后原样返回。游戏是顶层文档，无 iframe、无外壳 |
| `<base>` 注入 | `src/server/pgc/inject-base.ts` + 单测 | 让 Vite 产物的相对资源解析回 pgc dist 目录，同时地址栏保持干净短链 |
| 分享链接构造 | `src/lib/pgc/url.ts` `buildSharePageUrl` | `{origin}{basePath}/share/{code}/v{seq}`，**本轮不变** |
| Remix 入口 | `src/lib/studio-prelude.ts` 解析 `?remix=`，`src/store/actions.ts` `applyStudioRemix` | 工作台收到 `?remix={code}` 即 fork；失败已有完整兜底（toast + 剥参 + 落回自己的项目列表，不白屏） |
| Remix 可用性 | pgc `GET {PGC}/game/pgcserver/remix/{code}` | **公开无鉴权**；开放返回 200（含 `remix_url` / `display_title`），未开启 / 非法 code / 源软删统一 404 `REMIX_NOT_AVAILABLE`，不泄露源项目状态 |
| 同类页面先例 | `src/app/full/[pid]/[vid]/page.tsx` + `src/components/preview/FullscreenPreview.tsx` | server page 校参 → client 组件 → iframe 挂游戏。iframe 的 `allow` / `focus()` 坑已踩过并注释在案 |

主站顶栏在 `rezona-lab/src/features/studio/studio-shell.tsx`，品牌字标在 `features/studio/brand-logo.tsx`（`Logo` = R 标、`Wordmark` = REZONA + LAB 贴纸，两个纯内联 SVG）。主站与本应用**同源**（`lab.rezona.ai`，主站 `/studio/*`、本应用 `/game/*`），仓内已有 `window.location.href = '/studio/game'` 的先例（`ChatPanel.tsx:288`），跨站跳转不需要任何新配置。

## 约束（盘问结论）

1. **外壳页 + iframe，不往游戏文档里注入顶栏。** 游戏产物普遍用 `100vh` / `position:fixed` canvas 铺满，注入的 header 会被盖住或把布局挤错位，且两边 CSS 同作用域，各游戏表现不可控。iframe 换来彻底隔离；代价是把当初 `2026-07-20-clean-share-url` 刻意去掉的 iframe 加了回来——**但它去掉的是「落地页 + 脏地址栏」，地址栏在本方案里仍是干净的 `/game/share/{code}/v{n}`**，那份收益不受影响。
2. **iframe 直指 pgc 的 `/pv/…`**，即 `{NEXT_PUBLIC_PGC_BASE_URL}/game/pgcserver/pv/{code}/{version}/dist/index.html`。生产同域，相对资源天然归位，`<base>` 注入随之失去用武之地。
3. **Remix 按钮先查可用性再决定显隐**，走上面那个公开端点，在外壳页 server 侧查（无需 cookie）。~~不可用则置灰 + Tooltip 说明~~ → **2026-09-02 按 Nick 要求改为直接不渲染**：置灰那版的说明只在鼠标 hover 时才有（`<button disabled>` 不可聚焦、气泡 `aria-hidden`、触屏根本没有 hover），窄屏访客看到的就是个没有任何解释的灰按钮；与其留个死按钮，不如对未开放 Remix 的游戏根本不提这回事。随之退役的有 Tooltip 那一层、`pointer-events-none` 变通、`aria-label` 补名与 `share.remixDisabled` 文案键。
4. **按钮落点**：Remix → `{basePath}/?remix={code}`（本仓工作台，未登录由 `useAuthGuard` 自动跳 sign-in 并回跳）；Create your game → `/studio/game`（主站游戏落地页，对匿名访客有完整引导与展示）。
5. **配色（2026-09-02 定）**：Remix 用 `.btn-raised`（恒浅色 = 白面深字），Create your game 用 `.btn-brand-key`（设计稿的品牌橙键帽 CTA，恒浅橙不随主题翻）。两档都是 `globals.css` 里既有的类，只是接进 `Button` 的 variant 表供 `buttonClass` 取用 —— 顶栏不自造第二套按钮样式。
6. **视觉走本仓令牌**（`--color-*` / `--shadow-*` / 既有 `Button`·`IconButton`），只把 `brand-logo.tsx` 的两个 SVG 拷过来。遵守本仓「禁硬编码色值、不新建按钮种类」的铁律，代价是与主站有细微差异且主站改版不会同步——分享页的品牌识别靠 logo，不靠像素级对齐。
7. **适配窄屏。** 分享链接大概率被手机打开，这是本仓「固定桌面布局、无移动端断点」约定的**刻意破例**，仅限这条外壳页。
8. **文案走现有 i18n**，两条键进全部 11 套 locale，语言从主站契约 key `rezonalab-config` 读（挂 `I18nProvider`，与 `/full` 页同一口径），读不到回落 en。

## 方案

```
GET /game/share/{code}/v{n}
  │
  ├─ server page（src/app/share/[code]/[version]/page.tsx）
  │    ├─ 校验 code / version 形态（沿用现有正则，非法 → 404）
  │    ├─ 校验该版本存在：HEAD/GET pgc 的 index.html
  │    │     404 → notFound()；5xx / 不可达 → 带顶栏的错误页（见下「错误口径」）
  │    └─ 查 Remix 可用性：GET {PGC_PREFIX}/remix/{code}
  │          200 → 给 remixHref；404 / 异常 → null（降级，不阻塞出页）
  │
  └─ client 组件 SharePage
       ├─ <ShareTopBar>  logo | Remix（不可用即不渲染）· Create your game
       └─ <iframe src={pgc}/game/pgcserver/pv/{code}/{version}/dist/index.html>
            allow="fullscreen; autoplay; gamepad"，onLoad 后 contentWindow.focus()
            （两条都照抄 FullscreenPreview 的注释所述理由：跨源子文档默认没这些权限；
              键盘事件默认落顶层文档，不给焦点用户得先点一下画面才能按键）
```

- 顶栏**占位**（非悬浮遮挡），iframe 吃掉剩余高度；顶栏与 iframe 共用 `h-dvh` 纵向 flex。
- 首帧即加载态：iframe `onLoad` 前盖 `LoadingScreen`，与 `/full` 页同语汇。
- 窄屏断点：Wordmark 隐藏只留 R 标，两个按钮改短文案，顶栏高度收窄。

### 错误口径

现路由把「未 build / 未知版本」返 **纯文本 404**、「上游 5xx / 不可达」返 **502 + JSON 信封**。改成页面路由后两条都变成**带顶栏的品牌页**：404 走 Next `notFound()` → 本段自带的 `not-found.tsx`；上游不可达 → 错误态页面（顶栏照常，中间一句「游戏暂时打不开」）。

这是相对现状的**行为变化**，且**刻意放弃了对外状态码**：上游故障那条现在返 HTTP 200 而非 502。理由是分享页的受众是匿名访客，给他一段 JSON（或一张无品牌无出口的默认错误页）不如给他一条带 Create your game 出口的页面；页面路由要返 5xx 得绕道 `error.tsx` 或额外一层路由，不值得为此把外壳拆散。**代价是 uptime 探测 / LB 5xx 率看不见这类故障** —— 可观测性改由 `proxyFetch` 已有的结构化日志（`bff_upstream_5xx` / `bff_upstream_error`，带 `upstream=pgc` 与 `request_id`）承担。若日后要按 5xx 率告警，需要改从日志指标取。

### 退役（不留 dead code）

- `src/server/pgc/inject-base.ts` 与 `inject-base.test.ts` —— iframe 直指 pgc 后无调用方。
- `src/app/share/[code]/[version]/route.ts` 与其单测的直出分支 —— 由 page.tsx 取代；参数校验与错误口径的断言迁移到新测试。

## 成功标准

1. 打开任一已开放分享的链接：顶部一条顶栏（左 logo，右两按钮），下方游戏正常运行、可键盘操作、可全屏、可出声。
2. 源项目**开了** Remix：点 Remix → 落到工作台并 fork 成功（未登录先过 sign-in 再回跳）。
3. 源项目**没开** Remix：顶栏只剩 Create your game，没有 Remix 按钮的任何痕迹。
4. 点 Create your game → 主站 `/studio/game`。
5. 手机窄屏打开：顶栏不溢出、两个按钮都可点、游戏区域仍占满剩余高度。
6. 版本不存在 → 404；pgc 不可达 → 带顶栏的错误页，不是白屏也不是裸 JSON。
7. 地址栏自始至终是 `/game/share/{code}/v{n}`。
8. `pnpm lint` / `tsc --noEmit` / `test` / `test:tz` / `build` 全绿。

## 已知代价（评审记录，本轮接受）

- **缓存没了**：旧路由给 HTML 发 `cache-control: public, max-age=300`，新页面是 `force-dynamic`（no-store），且每次访问在 TTFB 前要并发两条上游（整份 index.html 探活 + remix 探活），浏览器随后还要再取一遍同一个 index.html。探活为的是保住「版本不存在 → 404」这条语义；改进方向是给探活加短 `revalidate`，或推动 pgc 给 `/pv` 注册 HEAD（现在不敢用 HEAD，未注册会 405 被误判成版本不存在）。
- **不加 `sandbox`**：生产同源，游戏 JS 能摸 `window.parent`、能 top-navigate。相对旧的「顶层文档直出」不算退化（那时它本就跑在我们的源上），加 `sandbox` 又必须同时给 `allow-scripts allow-same-origin`（二者并存等于没沙箱），故本轮**刻意不加**。
- **社交 unfurl 退化**：旧实现直出游戏 HTML，分享到 IM/社交时卡片吃的是游戏自己的 `<title>`/meta；现在统一成 `Rezona Lab · Play` 且无 `og:*`。对一条对外传播链路这是实打实的损失，但补齐要拿游戏元信息（`/remix/{code}` 的 `display_title` 只在开放 Remix 时才有），留待下一轮。
- **404 页首屏靠 JS，且主题回落浅色**：`notFound()` 的内容在 App Router 下由**客户端错误边界**渲染 —— dev 与生产构建实测皆是如此，SSR 出的 HTML 只有 `__next_error__` 外壳，`not-found.tsx` 的内容要等 hydration；这一过程中 React 重建 `<html>`，把防白闪脚本设好的 `data-theme` 一并抹掉，于是 404 页恒以浅色呈现。**两者都不是本轮引入的** —— 没有 `not-found.tsx` 时 Next 默认 404 走的是同一条路径，只是那张页面既无品牌也无出口。浅色下本页完全可读（顶栏白底、字标走 `--color-ink` 转黑），故接受。

## 一期不做

- **埋点**：主站 Remix 有 `trackEvent`，本仓有 `useAnalytics`。分享页转化漏斗值得测，但不在本轮范围。
- **游戏元信息**：标题 / 作者 / 封面 / 版本号一概不上顶栏（需求明确只要 logo + 两按钮）。公开端点返回的 `display_title` / `display_description` 本轮不用。
- **主站顶栏的其余部件**：导航下拉、语言切换、积分、账户入口都不搬。
- **主题切换入口**：跟随 `rezonalab-config` 的既有防白闪脚本自动生效，页内不加切换器。

## 风险

- **iframe 里的游戏若自带 frame-busting 或 `X-Frame-Options`**：pgc 的 `/pv` 是自家静态产物，现无此头；若日后 pgc 加了 CSP `frame-ancestors`，这条页会白屏。落地时实测一条真链接确认。
- **跨源 iframe 的输入焦点**：`FullscreenPreview` 已验证 `contentWindow.focus()` 可行（跨源可调的少数方法之一），照抄即可。
- **本地开发**：`NEXT_PUBLIC_PGC_BASE_URL` 指 devlab 时 iframe 是跨源的，与生产同源不同。`/pv` 无鉴权，预期可跑，但要在本地实测一次而不是想当然。
