# 分享页顶栏 实现计划（2026-09-01）

设计稿：`docs/superpowers/specs/2026-09-01-share-page-topbar-design.md`

## 推进节奏

`/share/{code}/v{n}` 这条路由上 **`route.ts` 与 `page.tsx` 不能并存**（Next 同段路由二选一），所以「并存加新 → 原子切换 → 删旧」的切换点被压到 T6 一次完成：T1–T5 全是新增件（各自可独立测试、独立评审，不接线故不影响现网行为），T6 一次性换掉入口，T7 清理退役件。

## T1 · i18n 文案

新增顶层 `share` 块，进全部 11 套 locale（en 为类型源，其余 `typeof en` 会逼着补齐）：

| 键 | en |
|---|---|
| `share.remix` | Remix |
| `share.createGame` | Create your game |
| `share.createGameShort` | Create |
| `share.remixDisabled` | This game isn't open for remixing |
| `share.loading` | Loading game… |
| `share.unavailable` | This game can't be opened right now |

**验证**：`pnpm exec vitest run src/i18n` —— 既有「11 套 key 集合与 en 完全一致」那条测试即是守护，缺一套就红。

## T2 · 纯逻辑（`src/lib/share-page.ts` + 同目录单测）

先写失败测试再实现：

- `isShareCode(s)` / `isShareVersion(s)` —— 从 `route.ts` 原样搬出 `/^[A-Za-z0-9]{6,}$/` 与 `/^v\d+$/`，附带原注释（先校验再拼接，挡住越界/畸形参数）。
- `buildGamePvUrl(code, version)` —— `{NEXT_PUBLIC_PGC_BASE_URL}{PGC_PREFIX}/pv/{code}/{version}/dist/index.html`，供 iframe `src`。前缀从 `lib/backend-routes.ts` 的 `PGC_PREFIX` 取，**不再手写**。
- `buildRemixHref(code)` —— `{basePath}/?remix={code}`，basePath 经 `lib/basePath.ts`（自身绝对路径必经，否则部署到 `/game` 下会被 LB 路由到别的后端）。
- `STUDIO_GAME_HREF` —— `/studio/game`，主站同源，**刻意不经 basePath**（主站不在 `/game` 前缀下，与 `buildSignInUrl` 同理）。

**验证**：`pnpm exec vitest run src/lib/share-page.test.ts`，含「设了 `NEXT_PUBLIC_BASE_PATH` 与没设」两种断言。

## T3 · server 侧取数（`src/server/pgc/share-page.ts` + 单测）

mock `proxyFetch`（照 `src/server/pgc/proxy.test.ts` 的既有写法）：

- `fetchRemixAvailable(code): Promise<boolean>` —— `GET /remix/{code}`（**不在 `/api` 下**，`root_prefix` 直挂）。200 → true；404 → false；其余状态或抛错 → false，**降级不阻塞出页**：顶栏能不能点是次要的，把游戏挡在门外才是事故。
- `fetchVersionStatus(code, version): 'ok' | 'notFound' | 'upstream'` —— `GET /pv/{code}/{version}/dist/index.html`（只判状态码，不读正文）。200 → ok；4xx → notFound；5xx 或抛错 → upstream。这一步保住现路由「未 build / 未知版本 → 404」的既有语义。

**验证**：`pnpm exec vitest run src/server/pgc/share-page.test.ts` —— 六条状态映射逐条断言，含 `proxyFetch` 抛错的降级路径。

## T4 · 顶栏 UI（`src/components/share/`）

- `BrandLogo.tsx` —— 从主站 `rezona-lab/src/features/studio/brand-logo.tsx` 拷 `Logo`（R 标）与 `Wordmark`（REZONA + LAB 贴纸）两个内联 SVG，`fill` 改吃本仓令牌（R 标与字标用 `currentColor`，LAB 贴纸的白底/橙芯保原样——它是贴纸不是语义色）。注释注明来源文件与 Figma lockup 号，便于日后与主站对照。
- `ShareTopBar.tsx` —— props `{ canRemix, remixHref }`。左 logo（`<a href={STUDIO_GAME_HREF}>`），右两按钮走既有 `Button`；Remix 不可用时 `disabled` + 包 `Tooltip` 显示 `share.remixDisabled`。窄屏（`sm:` 断点）隐藏 `Wordmark`、切短文案、收窄高度。颜色一律 `var(--color-*)`，阴影取既有 `--shadow-*` 预设。

**验证**：`pnpm exec vitest run src/components/share/ShareTopBar.test.tsx` —— canRemix 两态下按钮的 href / disabled / aria-label，以及 logo 指向主站。

## T5 · 外壳组件（`src/components/share/SharePage.tsx` + 测试）

形态照抄 `src/components/preview/FullscreenPreview.tsx`：外层 `I18nProvider`，内层纯展示。

- 布局：`h-dvh` 纵向 flex —— 顶栏**占位**（非悬浮），iframe `flex-1`。
- iframe：`allow="fullscreen; autoplay; gamepad"`，`onLoad` 后 `contentWindow?.focus()`。**两条都要连注释一起搬**（跨源子文档默认无这些权限；键盘事件默认落顶层文档，不给焦点用户得先点一下画面才能按键）。
- 加载态：`onLoad` 前盖 `LoadingScreen variant="soft"`，文案 `share.loading`。
- 错误态：`status==='upstream'` 时不渲染 iframe，中间一句 `share.unavailable`，**顶栏照常渲染** —— 打不开也得给访客留 Create your game 这个出口（设计稿约定的行为变化）。

**验证**：`pnpm exec vitest run src/components/share/SharePage.test.tsx` —— iframe src / allow 属性、loading 遮罩在 onLoad 后撤除、upstream 态不渲染 iframe 但顶栏仍在。

## T6 · 原子切换（入口换血）

一次提交内完成，中间不留半可用状态：

1. 删 `src/app/share/[code]/[version]/route.ts` 与 `route.test.ts`。
2. 加 `src/app/share/[code]/[version]/page.tsx`（server component，`export const dynamic = 'force-dynamic'`）：校参（非法 → `notFound()`）→ 并发取 `fetchVersionStatus` 与 `fetchRemixAvailable` → `notFound` 则 `notFound()`，否则渲染 `<SharePage>`。
3. `metadata` 给个 `Rezona Lab · Play` 之类的标题（现直出用的是游戏自己的 `<title>`，改外壳后页签标题由本页决定 —— 这也是行为变化，一并在此定死）。

**验证**：`pnpm exec vitest run src/app/share`（新页面的参数校验测试）+ `pnpm build` 确认路由树无冲突。

## T7 · 删旧

- 删 `src/server/pgc/inject-base.ts` 与 `inject-base.test.ts`。
- `grep -rn "injectBaseHref" src docs` 确认零引用（docs 里的历史提及保留，只清代码）。

**验证**：`pnpm exec tsc --noEmit` + 全量 `pnpm test`。

## T8 · 合并前收口

1. 完整验证链：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm test:tz` → `pnpm build`，逐条留输出与退出码。
2. **真机实测一条链接**（设计稿风险项，不可想当然）：
   - iframe 里游戏能跑、键盘可操作、可全屏 —— 顺带确认 pgc `/pv` 没有 `frame-ancestors` 挡 iframe。
   - 源开了 Remix → 按钮可点并 fork 成功；没开 → 置灰 + Tooltip。
   - 窄屏（devtools 手机尺寸）顶栏不溢出。
   - 本地开发下 `NEXT_PUBLIC_PGC_BASE_URL` 指 devlab 时 iframe 是**跨源**的（生产同源），这一路要单独走一遍。
3. 派干净上下文子代理按 commit 范围独立评审（只给 spec + diff）；Critical / Important 修完再合，Minor 记回 spec。

## 提交划分

一个任务一条提交，`docs:` 与 `feat:` 成对；T6 与 T7 各自独立（切换与清理分开，回滚粒度更细）。合并回 dev 用 `--no-ff`。

---

## 落地记录

- **T1**（2026-09-01）：`share` 块进 11 套 locale。实现时去掉了计划里的 `share.remixShort` —— Remix 一词在十一种语言下都够短（最长的 `Ремикс`/`リミックス` 也不挤），留一个恒等于长文案的键只会成为将来的噪声。`remix` 文案取主站 `studio_remix` 的既有译法（zh=二创 / zh-TW=重混 / ja=リミックス / ko=리믹스 / pt=Remixar / ru=Ремикс / 其余 Remix），同一动作跨站不打架。
- **T2–T7**（2026-09-01）：按计划落地，无偏离。`buildRemixHref` 直接读 env 而非用 `basePath.ts` 的模块级 `BASE_PATH` 常量 —— 后者在测试里 `stubEnv` 改不动（与 `lib/pgc/url.ts` 的 `buildSharePageUrl` 同一写法与同一理由）。T4 顺带把 `Button` 的类串抽成导出的 `buttonClass`：顶栏两项是导航、语义上必须是 `<a>`，而 `<a>` 套 `<button>` 不合法，共用一份类串好过在那边照抄。
- **T8 真机实测踩到四处，都已修并各自补了测试或注释**：
  1. **注释里的 Tailwind 假类名炸掉整个 CSS**。`BrandLogo.tsx` 注释里写了 `text-[var(--color-*)]` 举例，Tailwind v4 全文扫描连注释一起扫，生成 `color: var(--color-*)` 让 `globals.css` 解析失败、整页 500。注释里不要写带通配符的任意值字面量。
  2. **`onLoad` 在缓存命中时收不到**，加载层永久盖住已经跑起来的游戏。iframe 的 `src` 是 SSR 就有的，资源命中缓存时它在 hydration **之前**就加载完，而 load 事件不冒泡、React 是直接绑定 —— 那一发彻底丢失。首次访问因资源慢才碰巧正常，第二次起必现。改成**层序方案**：加载层放 iframe 下面一层，游戏画上自己的底色就自然盖住，可见性不再依赖任何事件；`onLoad` 保留只做清理。焦点同理改为**挂载即抢**（`useEffect` + ref），否则 `onLoad` 丢失时键盘要先点一下画面才能用 —— 那是相对旧的顶层文档直出的功能回归。
  3. **`Tooltip` 包 `<button disabled>` 气泡永不弹**。disabled 控件吞掉指针事件、连祖先都收不到 `mouseenter`，而 Tooltip 的 hover 挂在外包 span 上 —— 置灰了却没有任何说明，最糟的组合。按钮加 `pointer-events-none`、由中间一层 span 接指针。jsdom 不模拟这条浏览器行为，只能在结构上钉住（`ShareTopBar.test.tsx` 有一条专门守它）。
  4. **`Wordmark` 缺 `width` 被压扁**。SVG 规范下缺省 width 即 100%，作为 flex item 会被压缩、字标右端 LAB 贴纸被裁；显式按 viewBox 比例算宽 + `shrink-0`。另把高度从 18 抬到 22 —— 贴纸上三个小字母在 18px 下糊成一个橙点。
- **配色按 Nick 现场指正调了两次**：先是整块跟 `--color-ink` 变成全白，改成整块品牌橙，最后对齐主站 lockup —— **R 标恒品牌橙 + REZONA 走 `--color-ink`**（深色下即主站那身白，浅色下自动翻黑；恒白会在浅色主题里直接消失，而组件不写主题分支）。
- **实测结论**：pgc `/pv` 没有 `frame-ancestors` 挡 iframe；跨源 iframe 下相对资源确实从 pgc dist 解析（`<base>` 注入的确不再需要）；焦点落在 iframe 上、键盘可直接操作；窄屏 390px 下顶栏 52px、字标隐藏、短文案生效、右缘 374 无溢出；版本不存在与非法参数两路均 404。

## 评审处置（干净上下文子代理，只给 spec + diff）

结论 Critical 0 / Important 4 / Minor 10。逐条核过代码后的处置：

**采纳并修（Important）**
1. **未消费的响应体扣住 undici 连接**。两条探活只读 `res.status`，body 从不 consume，连接被扣在 in-flight 直到 GC；这是全站扇出最高的公开路由，旧直出实现 `await res.text()` 顺手消费了，属本轮引入的退化。加 `discard()`（`body.cancel()`，失败吞掉）并补两条测试。
2. **spec 与实现打架**。设计稿「错误口径」写着「上游不可达仍收敛成 502」，实现返 200，且删掉 `route.test.ts` 后没有任何一条测试覆盖对外状态码。**选择接受 200 并改写 spec**：页面路由要返 5xx 得绕 `error.tsx` 或多一层路由，不值得为此拆散外壳；代价（uptime 探测 / LB 5xx 率看不见）与替代观测手段（`proxyFetch` 已有的结构化日志）都已写进 spec 与 `page.tsx` 注释。
3. **置灰说明只有 hover 一条通路**。`<button disabled>` 不可聚焦（`onFocus` 永不触发）+ 气泡 `aria-hidden` + 触屏无 hover ⟹ 读屏与手机访客看到的是零解释的死按钮，而窄屏正是本功能的目标场景。补 `aria-label="Remix — <原因>"` 让原因进无障碍名。**触屏那一路仍只有置灰没有可见说明** —— 补一行可见文案会突破「顶栏只放 logo + 两个按钮」这条需求边界，留给 Nick 定。
4. **`onLoad` 丢失时加载层永久驻留**。层序保证了它盖不住游戏，但撤不掉仍会把 `role="status"` 节点与无限 spinner 整场留在无障碍树里。判据用 `document.readyState === 'complete'` 而非任意计时器（complete 即含 iframe 在内子资源都已完成，正好覆盖「iframe 早于 hydration 加载完」），未完成则等顶层 `load`。注意 React Compiler 的 lint 禁止 effect 内同步 `setState`，故排到下一帧（`requestAnimationFrame`）。

**采纳并修（Minor）**：`buildGamePvUrl` 那句「未配置基址本地仍可寻址」是错的（本服务不服务 `/game/pgcserver/*`，代理只挂 `/api/pgc/*`），注释与测试名都改成诚实措辞；补 `not-found.tsx` + `ShareNotFound`（404 才是分享链接最常见的失败，却落在无品牌无出口的默认页上，而罕见的 5xx 反倒有品牌页）；`title="game"` 走 i18n；`Wordmark` 的 filter id 改 `useId`；测试两处脆弱点（`el.type` 断言、加载层选择器换成从文案反查）。

**记录不改**：主题闪烁（`submitVariant` 全仓固有行为）、置灰对比度（`Button` 组件既有的 `disabled:opacity-30`，要改是改公共组件）、缓存与双探活开销、不加 `sandbox`、社交 unfurl 退化 —— 五条连同理由都进了 spec 的「已知代价」。

**评审未提但复验时发现**：`not-found.tsx` 的内容在 dev 与生产构建下都由客户端错误边界渲染（SSR 只有 `__next_error__` 外壳），hydration 重建 `<html>` 会抹掉 `data-theme`，故 404 页恒浅色。非本轮引入（Next 默认 404 同路径），浅色下可读，已记入 spec。
