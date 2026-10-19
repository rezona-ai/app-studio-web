# 深色主题 + 主题切换 设计

- 日期:2026-06-09
- 分支:`feat/dark-theme`
- 设计稿:Figma `Taluna_game` node `164-4350`(暗色态)

## 目标

1. 实现与 Figma 暗色稿一致的深色主题。
2. 在 project 工具栏(`ChatPanel` 的 Project Header 行)增加亮/暗主题切换按钮。
3. 默认沿用现有亮色;用户切换后持久化,刷新不闪白。

非目标(YAGNI):跟随系统(`prefers-color-scheme`)、多套主题、服务端渲染主题。仅亮/暗两态、客户端持久化。

## 架构思路:CSS 变量覆盖

项目是 Tailwind v4 `@theme` + `var(--color-*)` 取色范式,组件几乎全部通过 `bg-[var(--color-surface)]` 等方式引用变量。因此:

- 保留 `@theme` 亮色 token 作为默认值。
- 在 `globals.css` 新增 `[data-theme="dark"] { ... }`,**覆盖**同名变量。
- 组件零改动自动跟随(除少量写死 hex,见下)。

> 弃用方案:Tailwind `.dark:` variant 重写每个组件 class——本项目不用该范式,改动面巨大。

## 暗色 token 覆盖(来源:Figma 变量)

`[data-theme="dark"]` 覆盖以下变量:

| 变量 | 亮色(默认) | 暗色 | Figma 来源 |
|---|---|---|---|
| `--color-ink` | `#121212` | `#fcfcfc` | Text/Primary |
| `--color-muted` | `#7b7b7b` | `#7b7b7b` | Text/Secondary(不变) |
| `--color-surface` | `#fcfcfc` | `#232627` | Surface/02(面板:Chat/Preview) |
| `--color-surface-2` | `#f8f7f7` | `#2c2c2e` | Surface/03 |
| `--color-fill` | `#f1f1f1` | `#2c2c2e` | Surface/03(hover/填充,比 surface 浅 → 悬停可见) |
| `--color-canvas` | `#f8f7f7` | `#141718` | Surface/01(画布中心 / 页面底) |
| `--color-line` | `#ececec` | `#222222` | Stroke/02 |
| `--color-line-2` | `#e2e2e2` | `#323232` | Stroke/01 |
| `--color-live` | `#49ba61` | `#4ccc67` | Colors/Green |

**保持不变**(不在 dark 块覆盖):

- 资产类型色 `--color-image/video/audio/3d/doc`:鲜艳强调色,深底上仍清晰。
- `--color-preview-bg: #14121c`:本就深色。
- **raised 按钮体系**:`--grad-btn`、`--shadow-btn`、`.btn-raised`。Figma 暗色稿中 Publish / 缩放 pill / 发送按钮等 **仍为浅色 CTA**,故保留浅灰渐变 + 深色文字,不反转。

**需覆盖的阴影**(仅含白色高光、深底露馅的):

- `--shadow-prompt`:亮色含 `inset 0 2px 0 0 #fff`(实心白高光,Composer 顶边)。暗色改为低透明度白:`inset 0 1px 0 0 rgba(255,255,255,0.06)`。
- 其余 `--shadow-toolbar/popover/card`:纯黑 alpha 落影,深底上成立,保留。
- `--shadow-shortcut` 及 ProjectMenu 内联 shortcut 阴影:含白高光,实现时对照截图微调(优先级低,影响小)。

## 硬编码 hex 清理(必须)

以下写死的 hex 在深色下露馅,改为引用变量:

| 文件 | 现状 | 改为 |
|---|---|---|
| `chat/ChatPanel.tsx` 空态文字 | `text-[#757575]` | `text-[var(--color-muted)]` |
| `chat/Composer.tsx` placeholder | `placeholder:text-[#7b7b7b]` | `placeholder:text-[var(--color-muted)]` |
| `canvas/AssetCanvas.tsx` 搜索 placeholder | `placeholder:text-[#7b7b7b]` | `placeholder:text-[var(--color-muted)]` |
| `canvas/AssetCanvas.tsx` 空态文字 | `text-[#757575]` | `text-[var(--color-muted)]` |
| `canvas/AddAssetMenu.tsx` ×2 | `text-[#7b7b7b]` | `text-[var(--color-muted)]` |
| `preview/VersionTimeline.tsx` ×2 | `text-[#7b7b7b]` | `text-[var(--color-muted)]` |
| `chat/ToolCard.tsx` ×2 / `chat/ToolApprovalCard.tsx` | `text-[#555]` | `text-[var(--color-muted)]` |
| `preview/PreviewPanel.tsx` 空预览占位 | `bg-[#e6e6e6] ... text-black` | `bg-[var(--color-fill)] ... text-[var(--color-ink)]` |
| `canvas/AssetCanvas.tsx` React Flow 网点 | `<Background color="#e2e2e2">` | `color="var(--color-line-2)"`(SVG fill 支持 CSS 变量) |

**不改**:`VersionTimeline.tsx` 版本缩略图 `palette === 'neon' ? '#2a1f3d' : '#3a2a22'`——按游戏 palette 取色,与主题无关。
`canvas/AssetCanvas.tsx` raised 空态 span 的 `text-[#1e1e1e]`——在浅色 raised 底上,保留深色文字。

## 切换机制

### 状态:Zustand store(复用现有 `persist`)

`src/store/index.ts` 的 `UIState` 增加 `theme: 'light' | 'dark'`(默认 `'light'`),并加 action `toggleTheme()`(在 light/dark 间翻转)。

`persist` 的 `partialize` 增加 `theme` 字段,使其随现有持久化机制写入 localStorage(主题是全局偏好,与项目无关,但复用同一 store key 最省事)。

### 应用到 DOM:`useTheme` hook

新增 `src/client/useTheme.ts`:订阅 store 的 `theme`,在 `useEffect` 中 `document.documentElement.dataset.theme = theme`(`light` 时移除属性或设为 `light`)。在 `Workspace` 顶层调用一次。

### 防闪白(FOUC):`layout.tsx` 内联脚本

在 `<html>` 内、`<body>` 前注入一段同步内联 `<script>`,在水合前读取 localStorage 中持久化的 theme 并设置 `document.documentElement.dataset.theme`。读取失败或无值则默认 light。

> 注意:store 用 `persist` 时,localStorage value 是 `{ state: {...}, version }` 的 JSON。内联脚本需按该结构解析出 `state.theme`。脚本要做 try/catch 容错。

## 切换按钮

`src/components/chat/ChatPanel.tsx` 的 Project Header 行(`PermissionModeMenu` / 「新对话」旁)增加一个 `IconButton`:

- 图标:`lucide-react` 的 `Sun`(暗色态显示,点击切回亮)/ `Moon`(亮色态显示,点击切到暗)。
- `aria-label`:`切换深色模式` / `切换浅色模式`(随状态变化)。
- `onClick`:调用 store 的 `toggleTheme()`。
- 样式:复用 `IconButton variant="ghost"`,与该行其它控件一致。

## 测试(TDD)

- **store**(`src/store/*.test.ts`):`theme` 默认 `'light'`;`toggleTheme` 在 light↔dark 翻转;`partialize` 包含 `theme`。
- **useTheme**(`src/client/useTheme.test.ts`):theme 变化时 `documentElement.dataset.theme` 正确更新。
- **切换按钮**(`ChatPanel.test.tsx` 扩展):渲染按钮、点击触发 `toggleTheme`、图标与 `aria-label` 随状态切换。
- 全量回归:`pnpm test` 149+ 全过。

## 视觉验收

实现后用 dev server + Playwright 截图,与 Figma `164-4350` 截图逐区对比(Chat / Canvas / Preview / Composer / 弹层 / raised 按钮),确认无露馅的浅色残留。

## 交付顺序

1. token 覆盖 + 硬编码清理(纯 CSS/class,可先肉眼验证暗色)。
2. store + useTheme + FOUC 脚本 + 切换按钮(TDD)。
3. Playwright 视觉对比与微调。
