# 入口页（Landing / StudioPage）设计稿

> Figma：StudioPage 暗色 `357:657`、亮色 `357:2208`（https://www.figma.com/design/1hXQCCqd9SCo7mPmzensym/Taluna_game?node-id=357-657）
> 目标：1:1 还原设计稿（**支持亮/暗主题切换**），作为平台入口；从入口页进入已实现的工作台（Workspace）。

## 1. 目标与范围

实现一个**纯深色**的入口着陆页，作为应用根路径 `/`。页面三段式：顶栏（TopBar）、Hero（标题 + 主 CTA + Prompt 输入框）、Popular Games（2×3 游戏卡网格）。

工作台（现有 `Workspace`）从根路径迁移到 `/studio`。入口页的各 CTA 通过 Next 路由跳转进工作台，或在原地弹出预览窗。

**主题切换**：入口页**支持亮/暗主题**（暗稿 `357:657`、亮稿 `357:2208`），复用项目现有主题系统（`store.theme` + `useTheme()` + `globals.css` 的 `[data-theme]` 变量），主题切换按钮调现有 `toggleTheme`。

**不做**（YAGNI）：真实积分/项目列表接口、账户菜单下拉、帮助弹层。这些按钮渲染到位但行为为静态/占位。

## 2. 路由与数据流

项目当前是纯单页（`src/app/page.tsx` 直接渲染 `Workspace`，全仓无 `next/navigation` 用法）。`next.config.ts` 已配 `basePath`（部署在 `/game/*`），故用 Next router 跳转会自动带前缀，无需手动拼 `apiPath`。

### 路由结构（App Router）
- `src/app/page.tsx` → 渲染新的 `LandingPage`（`'use client'`）
- `src/app/studio/page.tsx` → 渲染 `Workspace`（`'use client'`，内容与原 `page.tsx` 等价）

### CTA 行为
| 入口 | 行为 |
|---|---|
| Open creation tool（Hero 主 CTA `357:711`） | `router.push('/studio')` |
| Generate my game（PromptBox `357:719`） | `composerSet({ draft })` 后 `router.push('/studio')`；草稿为空时按钮 disabled（`opacity-30`，与设计一致） |
| Surprise me（PromptBox `357:718`） | 从本地随机点子数组取一条填入输入框（`composerSet({ draft })` 同步到 store） |
| Remix（卡片 hover CTA / footer `357:725`、`357:752`…） | `router.push('/studio?project=<projectId>')`，带游戏 projectId 进工作台 |
| Play（卡片 footer `357:730`…） | **不跳转**，原地弹出 `GamePreviewModal`，iframe 加载该游戏的 `previewUrl` |

### prompt 传参：走 store `composer.draft`
store 已有 `composer.draft` 字段且已持久化到 localStorage（key `taluna-v4`，见 `src/store/index.ts`），并被工作台 Composer 消费。入口页写 `composerSet({ draft })` → 跳 `/studio` → Composer 自动读到草稿。无需 URL query 或新管线。

### Remix 携带 projectId：复用现有「URL ?project 最高优先级」
项目已有 `src/lib/project-url.ts`（`withProjectParam` / `readProjectIdFromSearch`），且 `src/store/actions.ts:127` 明确：本页签 URL `?project=<id>` 是项目选定的**最高优先级**。Remix 用 `withProjectParam('', game.projectId)` 拼出 query，`router.push('/studio' + query)`，工作台 `useProjectBootstrap` 自动加载该项目。**零侵入工作台**。

mock 卡片若无 `projectId`，Remix 退化为 `router.push('/studio')`（不带参数），不报错。

## 3. 视觉基调

入口页**支持亮/暗主题，随 `data-theme` 翻转**，复用项目现有 `globals.css` 主题变量体系——颜色尽量映射到现有语义变量，不新增局部硬编码常量（避免与工作台主题割裂）。亮稿 token 与现有变量已高度吻合：

| 用途 | 亮稿 | 暗稿 | globals.css 变量 |
|---|---|---|---|
| 页面背景 | `#fcfcfc` | `#141718` 级 | `--color-canvas` / `--color-surface` |
| 卡片底（第一行） | `#e6e6e6` 级 | `#2c2c2c` | 新增语义变量或就地 `[data-theme]` 双值 |
| 卡片底（第二行） | 略浅 | `#1e1e1e` | 同上 |
| 描边 | `#e2e2e2` | `#323232` | `--color-line-2` |
| 主标题文字 | `#121212` | `#fafafa` | `--color-ink`（已随主题翻转） |
| 副标题 / 占位 | `#5a5a5a` 级 | `#929292` | `--color-muted` 系 |

**跨主题恒定的品牌色**（亮暗稿一致，直接写常量，不进主题变量）：
- 主 CTA / Remix 青渐变 `#1fd4cf → #033744`，边框 `#01f1ff`（主 CTA）/`#40c4aa`（Remix），外发光 `rgba(12,136,122,0.3)`
- Play 按钮（浅灰 raised）：复用现有 `.btn-raised`（`globals.css` 已定义，深浅主题恒为浅色 CTA）
- 积分数字色 `#14b8a6`（teal）
- 余额/账户 chip：暗稿 `#494949`；亮稿对应浅灰 chip，映射主题变量

> 卡片两行底色（`#2c2c2c`/`#1e1e1e` 暗、亮稿对应浅灰二级）在现有变量中无完全对应项，作为入口页新增的 `[data-theme]` 双值语义变量登记进 `globals.css`（如 `--color-card-1`/`--color-card-2`），供 GameCard 使用——保持「靠变量翻转」而非组件内写死。

- 内容列宽 **920px** 居中（Figma `357:701` Container），TopBar 高 **56px**（`357:658`），左右 padding 24/20。
- Hero：标题 42px / 行高 47px / 字间距 -1.05px；副标题 15px / 行高 25.5px；段间距 24px；顶部 padding 36px。
- PromptBox（`357:712`）：边框 `#01f1ff`，圆角 24px，外发光 `rgba(12,136,122,0.3)`；底色随主题（暗 `#222`、亮 surface）；内部上 padding 16px，行间距 31px；占位文案「Describe your game ideas, we make it a reality…」。
- 卡片缩略图 324×215，圆角 16px；卡片内 padding 上 4 / 下 8 / 左右 4；网格列间距 16px、行间距 24px（实际 50px gap 由 `357:722`/`357:745` 容器决定，按节点值还原）。

### 背景青色光晕（装饰层 `357:703`）
两张截图中 prompt 框下方至 Popular Games 之间有一道**青色环境光晕**，由设计装饰层提供（spec 初版遗漏，按截图补回）：
- `357:704` Background Image：1240×327 图，`opacity: 50%`，居中铺在 PromptBox 与 Popular Games 衔接处。
- `357:706` Footer：1440×192 图，垫在更下方。

实现为 `LandingPage` 内一个绝对定位、`pointer-events-none`、`z-0` 的装饰层（内容在其上 `z-10`），亮/暗主题共用同一图（青光在两稿中一致）。资产见 §6。

## 4. 组件拆分（对应 Figma 节点，便于 1:1 核对）

```
src/components/landing/
├── LandingPage.tsx       # 壳:TopBar + 居中 920px 列;持有 preview modal 本地 state   357:657
├── LandingTopBar.tsx     # 字标 Wordmark + 主题/帮助/余额 2,847/账户 EN▾             357:658
├── HeroSection.tsx       # 大标题 + 副标题 + Open creation tool(青渐变 pill)          357:707
├── PromptBox.tsx         # 输入框 + ⊕ + Surprise me + Generate my game               357:712
├── PopularGames.tsx      # "Popular games" 标题 + 2×3 卡片网格                        357:720
├── GameCard.tsx          # 缩略图/标题/作者/Play｜hover 压暗 + 浮现青色 Remix          357:723
├── GamePreviewModal.tsx  # Play 原地全屏遮罩 + iframe 预览(本地 state 驱动,非 store)
└── games.ts              # 硬编码 6 条 mock 数据
```

### mock 数据结构（`games.ts`）
```ts
interface PopularGame {
  id: string;
  title: string;        // 如 'BULLET BALLET'
  author: string;       // 如 '@talunagame team'
  thumb: string;        // assetPath('/games/xxx.png')
  previewUrl: string;   // Play 弹窗 iframe src(mock)
  projectId?: number;   // Remix 跳工作台带的 ?project=<id>;无则不带参
  ctaLabel: 'Play' | 'Remix';  // footer 按钮文案(设计中两行卡片不同)
}
```
6 条：第一行 3 张 ctaLabel 'Play'，第二行 3 张 'Remix'（与设计 `357:730`=Play、`357:752`=Remix 对齐）。

### GameCard hover 交互
缺省态：缩略图原图 + footer（标题/作者 + Play/Remix 按钮）。hover 态（设计第一张展示）：缩略图叠 `rgba(0,0,0,0.5)` 压暗遮罩 + 居中浮现青渐变「Remix」CTA（`357:725`）。用纯 CSS `group-hover` 实现，无需 JS state。

### GamePreviewModal
全屏遮罩，沿用 `MediaLightbox`（`src/components/canvas/MediaLightbox.tsx`）的交互约定：`bg-black/75` 遮罩、右上角圆形关闭按钮、Esc 关闭、点击遮罩关闭、内容区 `stopPropagation`。中央 iframe 加载 `previewUrl`，带 `sandbox` 限制 + loading 态。由 `LandingPage` 本地 `useState<PopularGame | null>` 驱动（独立于工作台 store）。

## 5. 字体

设计稿用到两款仓库目前没有的字体：
- **Sekuya**（字标 Wordmark、Hero 大标题、"Popular games" 标题）——展示性字体，**商业字体，需用户提供文件**。
- **IBM Plex Mono**（余额数字「2,847」、账户「EN」）——等宽字体，可走 `next/font/google` 或本地 woff2。

实现：新建 `src/app/fonts.ts` 用 `next/font/local`（Sekuya）+ `next/font/google`（IBM Plex Mono）加载，暴露 CSS 变量 `--font-sekuya` / `--font-plex-mono`，在 `layout.tsx` 的 `<html className>` 上挂载。

**Sekuya 文件未到位前的过渡**：组件统一用 `font-[var(--font-sekuya)]`，该变量在 `fonts.ts` 里以 fallback 链兜底（`Inter, 700, letter-spacing` 近似展示感）。字体文件 `Sekuya-Regular.woff2` 放 `public/fonts/` 后零改组件即生效——交付时提示用户放置。

## 6. 图标 / 图片资产（满足需求 #1：组合 + 按节点名重命名）

Figma `get_design_context` 已把资产下载到 `public/figma/icons/`（哈希名）。实现时逐个比对节点，**按设计语义重命名**后登记进 `src/components/ui/figma.tsx` 的 `figAsset`：

| 节点 | 语义 | 目标文件名 |
|---|---|---|
| `357:664` Wordmark | taluna 字标 | `wordmark.svg` |
| `357:674` Icon | 主题切换 | `theme.svg` |
| `357:678` Icon | 帮助 | `help.svg` |
| `357:684` Icon | 积分硬币 | `coin.svg` |
| `357:696` Icon | 账户下拉箭头 | 复用现有 `chevron-down.svg` |
| `357:717` Plus | 输入框 ⊕ | 复用现有 `plus.svg` |
| `357:718` repeat | Surprise me | 复用现有 `repeat.svg` |

游戏缩略图 PNG（design_context 已下载的哈希名图）重命名为 `game-thumb-1.png` 等放 `public/games/`，供 mock 卡片使用。卡片 hover 的压暗遮罩与 Remix CTA 由 §4 纯 CSS 实现，**不依赖**设计稿里的叠加层图片。背景青色光晕两张图（`357:704`/`357:706`）重命名为 `landing-glow.png` / `landing-footer-glow.png` 放 `public/games/` 或 `public/figma/`。

入口页支持主题切换，TopBar 单色图标（主题/帮助/积分硬币/下拉箭头）**走现有 `FigIcon` 的主题翻转**（`tone: 'primary'/'secondary'`，用 CSS mask + `currentColor`/`--color-muted`，浅稿深、暗稿浅自动翻转）——与工作台一致，不写死颜色。

**字标 taluna**（Wordmark `357:664`）：截图中亮/暗稿均为**青色品牌色**，走 `tone: 'original'`（保留原色，不翻转）。游戏缩略图、背景光晕同样直接 `<img>`，不参与主题着色。

## 7. 验证

- **1:1 核对**：每实现一个组件，用 Figma `get_screenshot` 取对应节点截图，与本地渲染逐块比对（尺寸/间距/颜色/字重），偏差就地修正。**亮/暗两种主题各核对一遍**（暗稿 `357:657`、亮稿 `357:2208`）。
- **类型 / lint**：`pnpm exec tsc --noEmit` + `pnpm lint`。
- **测试**（同目录 `*.test.tsx`，Vitest + jsdom）：
  - `games.ts`：mock 数据结构断言（6 条、行 CTA 文案、必填字段）。
  - `LandingPage` / CTA：mock `next/navigation` 的 `useRouter`，断言
    - Open creation tool → `push('/studio')`
    - Generate my game → 先 `composerSet({ draft })` 再 `push('/studio')`；空草稿 disabled
    - Remix → `push` 带 `?project=<id>`
    - Play → 打开 modal（不调 `push`）
- **构建**：`pnpm build` 确认 App Router 双路由（`/`、`/studio`）正常产出。

## 8. 风险与约定

- **复用而非污染主题**：入口页颜色尽量映射现有 `globals.css` 主题变量随 `data-theme` 翻转；仅卡片两行底色无对应项时，新增 `[data-theme]` 双值语义变量（如 `--color-card-1`/`--color-card-2`），不在组件内写死。品牌色（青渐变、raised Play、teal 积分）跨主题恒定，作常量。
- **basePath**：跳转一律用 Next router（自动带 `/game`）；缩略图 `<img src>` 经 `assetPath()` 包裹（部署前缀约定，见 `src/lib/basePath.ts`）。
- **localStorage 防白闪脚本**：`layout.tsx` 内联脚本硬编码 `taluna-v4`/`theme`，本次不改 persist 配置，故无需同步改该脚本。
- **Workspace 迁移**：仅把渲染入口从 `/` 移到 `/studio`，Workspace 内部零改动；原 `src/app/page.tsx` 改为渲染 `LandingPage`。
