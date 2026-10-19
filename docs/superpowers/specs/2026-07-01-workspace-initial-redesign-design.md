# 工作台初始界面对齐 Figma 设计稿

> Figma：`TALUNA-DEVELOPER-SITE` node `1105-26050`（工作台初始/空态）

## 背景

按 Figma 设计稿重做工作台「初始界面」。多数结构（聊天栏、顶部搜索框、画布空态文案、预览空态、版本区）已存在，本次是 **6 个相互隔离的改动单元 + 一层用户信息数据**，而非推倒重建。

设计的色板（grey-900 / teal primary 等）**不照搬字面色值**：一律映射到既有语义令牌（`globals.css` 的 `--color-*`）。设计是布局/结构参考，配色系统沿用项目自身（深/浅主题靠令牌自动适配）。

## 范围内 / 范围外

**范围内**：以下 6 单元 + 用户信息接口接入 + i18n + 测试。
**范围外**：顶部搜索框宽度调整；koubou/画布数据流；ZoomBar 按钮集重构；设计稿 tab 行那个用途不明的 cursor/Tap 按钮（不加）；除已下载 3 个外的任何新图标。

## 图标

3 个新图标已按设计稿名称下载到 `public/figma/icons/`：`asset-library.svg`、`filter.svg`、`credit.svg`。仅需登记进 `figAsset` 注册表（`src/components/ui/figma.tsx`）。其余复用既有：账户条「分享」用既有 `share`；tidy/minimap/zoom/fit 等工具条图标均已有。

## 单元设计

### 1. 画布左上 · 资产库占位按钮（note 2）

- 新增 `AssetLibraryButton`（`AssetCanvas` 内）：`absolute left-4 top-4 z-10` 方形按钮（`IconButton` `bordered`，`size-10`，圆角对齐搜索框 12px，底 `--color-surface-2`），图标 `asset-library`。
- 占位：点击 no-op；`Tooltip` 文案「资产库（即将推出）」。`aria-label` 同。
- 与既有顶部搜索框同处 `top-4`，二者不重叠（搜索框居中、按钮贴左）。

### 2. 画布右下 · 过滤按钮触发类型过滤（note 3）

功能已实现（`KindLegend` + `visibleKinds`/`toggleKind`），改为「由右下按钮触发的 popover」。

- 新增 `FilterButton`：`absolute bottom-5 right-5 z-10` 方形 `IconButton`（`size-10`），图标 `filter`。
- `KindLegend` 改为受控 popover：由 `AssetCanvas` `Inner` 持本地态 `filterOpen`（瞬态，不入 store——同列内单点协调，无需跨组件）。点按钮 toggle。
- popover 浮层：`.anim-pop-in origin-bottom-right`，`bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]`，定位在按钮上方右对齐。遮罩 `onWheel` 即关闭以放行画布缩放（沿用 AddAssetMenu 既踩坑做法）。
- 按钮态：`isKindFilterActive(visibleKinds)` 为真（有类型被隐藏）时按钮显 `raised-active`，提示「正在过滤」。
- 移除 `KindLegend` 原「右侧 hover 热区显现」逻辑（单一入口=该按钮）。

### 3. 画布底部工具栏 · 保留 minimap 等（note 4）

设计稿底部工具栏只画了 tidy；现有 `ZoomBar` 已含 tidy / minimap / zoom± / fit / 百分比下拉，容器已是 `rounded-[20px]` + `shadow-toolbar`，**已满足「加上已实现的 minimap 等」**。本单元基本不改动，仅在新增 filter / asset-library 按钮后确保三者视觉一致（同 `size-10`、同圆角层级）。

### 4. 画布空态 · 补 5 个快捷 pill（确认：补上并接通）

- `CanvasEmptyState` 在「Double-click … freely」下方补一排胶囊 pill：Images / Videos / Audio & Music / 3D Model / Upload Resource。样式取设计稿 pill（半透明描边胶囊：`rounded-[24px]`、`bg`/`border` 用既有令牌，图标 20px + 文案）。
- 空态外层是 `pointer-events-none`（让双击穿透到 pane）；pill 行单独提为 `pointer-events-auto` 子层，使其可点。
- 接通（复用既有逻辑，不新造）：
  - image/video/audio/3d → `openGenForm({ kind, spawnAt })`，`spawnAt` = 画布视口中心（经 `registerViewportCenter` 注册的换算或 `screenToFlowPosition`）；`x/y` 给弹窗锚点（屏幕中心）。
  - Upload Resource → 触发隐藏 `<input type=file>` → 校验（`validateUpload`/`UPLOAD_POLICY.canvas`）→ `uploadAsset`（与 `AddAssetMenu` 同策略，拒绝走 `setError`）。

### 5. 预览区 · 账户条（note 5，完全照设计稿）

**数据层**

- `pgcApi.getCurrentUser()` → `GET /api/auth/me`，返回 `CurrentUser`。
- `pgcApi.getBalance()` → `GET /api/credits/balance`，返回 `BalanceData`。
- 类型进 `src/lib/pgc/types.ts`：
  - `CurrentUser { id: number; username: string; display_name?: string | null; email?: string | null; group?: string | null; role?: number | null; status?: number | null }`
  - `BalanceData { balance: number; held: number; spendable: number }`
- `ServerState` 增 `userInfo: CurrentUser | null`、`credit: BalanceData | null`（**瞬态，不持久化**——鉴权派生、廉价可重取）。
- `ServerActions.loadUserInfo()`：`Promise.allSettled` 并发拉两个接口，各自成功即写入；失败**静默**（非关键信息，不弹 Toast）。
- `useUserInfo`（`src/client/`）：挂载即 `loadUserInfo()`（鉴权就绪后）。由 `Workspace` 调用，与其它 bootstrap hooks 并列。

**纯逻辑**：`src/lib/user-display.ts`（同目录单测）
- `userInitial(user: CurrentUser | null): string`——`display_name` 优先、否则 `username`，取首个有效字符大写；空/缺回退 `'?'`。
- `formatCredit(n: number | null | undefined): string`——整数展示（`balance`），缺值显 `'0'`。

**UI**：`PreviewPanel`
- 顶部新增 **账户条**行（常驻）：
  - 左：forward/分享 `IconButton`（复用 `share` 图标，接现有 `SharePopover`；无 `shareUrl` 时禁用，与现状一致）。
  - 右：credit（`credit` 图标 + 数字，颜色 `--color-teal`：图标用 `FigIcon tone="primary"` 包在 `text-[var(--color-teal)]` 内，数字同色 + 灰 `credit` 文案）+ 头像（32px 圆、白描边、首字母回退，`userInitial`）。新增 `UserInfo` 子组件承载 credit+头像。
- 既有 **Draft 名 + Live 徽章 + Publish**：下移为「版本控制行」，**仅 `versions.length > 0` 时渲染**——空态（=设计稿范围）不显示，完全贴合设计稿；有版本时 Publish 入口不丢。
- tab 行（Preview|Files + download + refresh）保持不变。

### 6. 版本区 · 空态隐藏 Compare（note 6）

- `VersionTimeline`：`versions.length === 0` 时**不渲染** Compare 按钮（原为常驻 `disabled`）。`≥1` 仍按 `canCompare`（`≥2`）显示禁用/可用态。

## i18n

en 为唯一真相源，新增键补齐 6 语（en/zh/fr/ru/ja/vi）：
- `canvas.assetLibrary`（按钮/tooltip：资产库）、`canvas.assetLibrarySoon`（即将推出，作 tooltip 或合并进上一条）
- `canvas.filter`（过滤按钮 tooltip/aria）
- 空态 pill：四类生成复用既有 `canvas.assetKind.{image,video,audio,3d}`；Upload 复用 `canvas.addMenu.upload`
- `preview.credit`（"credit" 文案）、`preview.account`（账户条 aria，可选）
- 抽取时扫 `aria-label` 等易漏点（见 i18n 约定）。

## 测试（同目录 `*.test`）

- `lib/user-display.test.ts`：`userInitial`（display_name/username/空/特殊字符）、`formatCredit`（整数/0/null）。
- `client/useUserInfo.test.tsx`：挂载触发 `loadUserInfo`；接口失败时静默不抛、不弹 Toast。
- `lib/pgc/client`：`getCurrentUser`/`getBalance` 解析标准信封（可并入既有 client 测试或新增）。
- `components/preview/PreviewPanel.test.tsx`：账户条渲染 credit + 头像首字母；`versions=0` 不渲染 Publish 行、`>0` 渲染。
- `components/preview/VersionTimeline.test.tsx`：`versions=0` 不渲染 Compare；`=1` 渲染但禁用；`≥2` 可用。
- `components/canvas`：空态 pill 点击触发 `openGenForm`（image/video/audio/3d）与上传输入；filter 按钮 toggle popover、过滤激活时按钮 active 态。

## 不变式 / 约束

- 仅取后端文档约定字段（snake_case），不臆测兜底别名。
- 坐标归前端所有；本单元不触碰画布落位/轮询。
- 新增 UI 全部复用既有令牌 / 基础组件 / 动效类，无硬编码色值、无一次性 keyframes、无新按钮种类、无自造 toast。
- 自身绝对路径（fetch/img）经 `apiPath()`/`assetPath()`。
