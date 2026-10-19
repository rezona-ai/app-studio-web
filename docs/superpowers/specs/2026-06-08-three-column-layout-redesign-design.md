# 三栏布局重实现设计方案

- 日期:2026-06-08
- 设计稿:Figma `Taluna_game` 节点 `8:1373`(1440×900)
- 范围:按 Figma 重排现有三栏外壳,英文照搬设计稿文案,保留底层功能

## 1. 目标与范围

**做**

- 逐栏贴合 Figma:去掉全宽 `Toolbar`,把其功能拆进各栏头部。
- 全新中性 / Inter 设计系统(token + 三套阴影)。
- 界面文案全部**英文**,照搬 Figma。
- 中栏新增可用的 "Add notes" 资产菜单,由**双击空白画布**触发。

**不做(YAGNI)**

- 画布力导向布局算法 —— 保留现有实现。
- 真实 Publish / 分享 / ZIP 打包 / 版本对比后端 —— 保留现有占位与逻辑,仅换皮。
- 左栏折叠功能 —— **不实现**(无相关 UI 与逻辑)。

## 2. 设计 Token 改造

### 2.1 字体

用 `next/font/google` 引入 **Inter**,在 `layout.tsx` 暴露为 `--font-inter`,`globals.css` 的 `body` 用它。

### 2.2 颜色与圆角(`globals.css` 的 `@theme`)

| 用途 | 新 token | 值 |
|---|---|---|
| 主文字 | `--color-ink` | `#121212` |
| 次文字 | `--color-muted` | `#7b7b7b` |
| 表面(白) | `--color-surface` | `#fcfcfc` |
| 表面(浅) | `--color-surface-2` | `#f8f7f7` |
| 填充(浅灰) | `--color-fill` | `#f1f1f1` |
| 画布底 | `--color-canvas` | `#f8f7f7` |
| 点阵点色 | (Background dot) | `#e2e2e2` |
| 描边 1 | `--color-line` | `#ececec` |
| 描边 2 | `--color-line-2` | `#e2e2e2` |
| Live 强调 | `--color-live` | `#49ba61` |
| 卡片圆角 | `--radius-card` | `12px` |
| 控件圆角 | `--radius-control` | `8px` |

- **移除蓝色品牌色 `--color-brand`**;原引用它的地方改用 `--color-ink`(深色按钮)或去掉。
- **保留**资产类型色 `--color-image/-video/-audio/-3d/-doc`(画布节点仍用)。

### 2.3 三套阴影(做成 CSS 变量 / 工具类)

- `--shadow-toolbar`:`0 8px 16px -12px #00000020, 0 1px 4px -4px #00000013`
- `--shadow-button`:`0 0 0 1px #d4d4d4, inset 0 1px 0 #ffffff54, 0 3px 4px -1px #00000026`
- `--shadow-prompt`:`0 8px 16px -12px #00000013, inset 0 2px 0 #ffffff, 0 18px 24px -20px #00000020`(配 `backdrop-filter: blur(12px)`)

## 3. 组件架构

```
Workspace (去掉 <Toolbar/>,保留 react-resizable-panels: Group / Panel / Separator)
├─ Panel 左 (默认 22%, min 18%, 不可折叠)  ChatPanel
├─ Separator (1px, --color-line)
├─ Panel 中 (默认 56%, min 30%)            AssetCanvas
├─ Separator
└─ Panel 右 (默认 22%, min 18%)            PreviewPanel
```

### 3.1 新增原子件 `src/components/ui/`

- `Button.tsx`:变体 `light`(默认,`--shadow-button`)/ `dark`(深色实心)/ `ghost`;支持禁用态。
- `IconButton.tsx`:变体 `ghost`(透明,头部图标用)/ `filled`(深色圆形,发送 / 播放用);尺寸 sm/md。
- `Badge.tsx`:变体 `green`(Live 绿色 pill)。

### 3.2 新增 `src/components/canvas/AddAssetMenu.tsx`

- 由 AssetCanvas 的**双击空白画布**触发(见 4.2),在光标处弹出白色圆角卡(`--shadow-toolbar`)。
- 分组(**已去掉 Utilities/Playlist**):
  - `Add notes`:Text → `doc`、Image → `image`、Video → `video`、Audio → `audio`、3D World → `3d`(每项带类型图标)。
  - `Add source`:`Upload`(副标题 `Image/ Video/ Audio`)。
- 点击 Text/Image/Video/Audio/3D World → 调 `addAsset(kind)`;点击 Upload → 触发隐藏 `<input type=file>`,读文件按 mime 推断 kind 后 `addAsset(kind, {uploaded})`。
- 菜单开闭状态由 AssetCanvas **本地 state** 维护(不进 store),点击遮罩 / 选完即关。

### 3.3 store 新增 `addAsset` 动作

```ts
addAsset: (kind: AssetKind, opts?: {
  label?: string;
  source?: AssetSource;          // 默认 'generated';Upload 传 'uploaded'
  preview?: AssetPreviewData;    // Upload 传 { dataUrl, src }
  position?: { x: number; y: number }; // 默认画布可视中心 / 双击点
}) => void
```

- 用 `newId` 生成 id/key,`status: 'ready'`,`pinned: true`(避免力导向重排已手动添加的节点)。
- 这是本次**唯一新增的行为**;其余沿用现有 store。

### 3.4 删除 / 迁移

- **删除** `src/components/workspace/Toolbar.tsx`,功能迁移:
  - 品牌 logo + 项目名 → 左栏头部。
  - 搜索 → 左栏 SearchField,仍调 `setSearchOpen(true)` 复用现有 `SearchPalette`(⌘K 不变)。
  - 分享 / 试玩 → 右栏头部 share / Publish。
- 节点右键 `ContextMenu`(派生菜单)**保留**,仅对齐新 token 配色。

## 4. 逐栏规格(英文文案照搬 Figma)

### 4.1 左栏 Chat(白底 `--color-surface`,右侧 1px 描边)

- **头部**(高约 56):星形 logo + 文本 `Project name` + `⌄`(chevron);**无右侧折叠键**。
- **SearchField**:整行浅灰填充(`--color-fill`)圆角;左放大镜图标 + 占位 `Search ...` + 右侧 `⌘K` 提示;点击 → `setSearchOpen(true)`。
- **消息区**:`flex-1` 可滚动,沿用 `MessageItem`;**空态**居中淡灰单行 `Hi there, what game are we making today`。
- **Composer**:换皮成 Prompt Input 卡片(`--shadow-prompt` + blur)。
  - 占位 `Great to see you, what game do you want to make today…`。
  - 底部左:`+` IconButton(= 现"附件"逻辑)、`@` IconButton(= 现"提及"逻辑)。
  - 底部右:圆形深色发送 IconButton(↑);运行中切"停止"。
  - **保留全部逻辑**:mention 弹层、附件 FileReader、发送 / abort。

### 4.2 中栏 Canvas(浅灰点阵 `--color-canvas`)

- React Flow `Background` 改 `variant="dots"`、color `#e2e2e2`、gap 20。
- **移除**现有左上类型 chips、底部提示条。
- **空态**(画布无资产时,居中两行淡灰):
  - 行1:`AI-generated assets will appear here.`
  - 行2:内联灰色 pill `▷ Double-click`(光标图标 + 加粗文字)+ ` on a blank space can also generate them directly.`
- **AddAssetMenu 触发**:`zoomOnDoubleClick={false}`;在画布 pane 上 `onDoubleClick` → 取光标坐标,打开 AddAssetMenu(见 3.2)。
- **底部居中浮动条**:圆角 pill,含 `100% ⌄`(缩放,接 React Flow `zoomTo` / `useReactFlow`)+ undo IconButton + redo IconButton。
- 现有节点拖拽 / 选中 / 右键派生 / 力导向**保留不动**。

### 4.3 右栏 Preview(白底,左侧 1px 描边)

- **头部**:`Draft_1`(取 active version label,无则字面 `Draft_1`)+ 绿色 `Live` Badge;右侧 share IconButton(ghost)+ `Publish` Button(light)。
- **Live preview 子栏**:文本 `Live preview` + 右侧 download IconButton(= 现 ZIP 占位)+ play IconButton(filled,深色,接现 GameFrame 试玩)。`DeviceToggle`:Figma 此处无设备切换,本轮**隐藏其 UI**,保留 `device` state(默认 `mobile`)与 `GameFrame` 接线,后续需要再补。
- **预览区**:`--color-fill` 大圆角块;沿用 `GameFrame` / `CompareView`;**空态**居中淡灰 `Live preview, save as version, export as ZIP here.`。
- **底部**:分隔线 + 文本 `Versions` + `Compare` Button(light;无可对比版本时禁用,接现 `toggleCompare`);下方 `VersionTimeline` 换皮成新 token 样式。

## 5. 改动文件清单

**改**

- `src/app/globals.css`(token + 阴影 + 字体)
- `src/app/layout.tsx`(Inter 字体注入)
- `src/components/workspace/Workspace.tsx`(去 Toolbar、调列宽、Separator 样式)
- `src/components/chat/ChatPanel.tsx`(新头部 + SearchField + 空态)
- `src/components/chat/Composer.tsx`(Prompt Input 换皮,逻辑保留)
- `src/components/canvas/AssetCanvas.tsx`(点阵背景、空态、双击触发、浮动缩放条、移除旧 chips/提示条)
- `src/components/preview/PreviewPanel.tsx`(新头部 + Live preview 子栏 + 预览区空态)
- `src/components/preview/VersionTimeline.tsx`(换皮)
- `src/components/preview/DeviceToggle.tsx`(本轮隐藏 UI,保留状态接线)
- `src/components/canvas/ContextMenu.tsx`(仅配色对齐)
- `src/store/index.ts`(+ `addAsset`)
- `src/store/types.ts`(如 action 类型需声明)

**增**

- `src/components/ui/Button.tsx`
- `src/components/ui/IconButton.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/canvas/AddAssetMenu.tsx`

**删**

- `src/components/workspace/Toolbar.tsx`

## 6. 验证方式

- `pnpm dev` 启动,用 Playwright 在 1440×900 截图,逐栏与 Figma 截图比对:头部、间距、空态文案、AddAssetMenu、底部浮动条、右栏预览/版本区。
- 交互回归确认:搜索打开 SearchPalette(⌘K)、Composer 发送 / @ / 附件 / 停止、双击空白画布弹 AddAssetMenu 并能新增各类型资产、Upload 选文件落 uploaded 资产、节点右键派生、试玩 / 设备切换、保存版本 / 对比。
- `pnpm test` 通过(store 新增 addAsset 补单测)。

## 7. 待校准项(实现时确认)

- 画布空态第二行 pill 的光标图标样式,以 Figma 文本/图标节点为准。
- 右栏列宽、各头部精确高度与内边距,以 Figma 测量微调。
