# 设计：全局滚动条优化 + 对话窗口项目菜单重构

日期：2026-06-10

## 背景与目标

对话窗口当前存在两类体验问题，需在一个 feature worktree 中一并优化：

- **A. 全局滚动条**：项目无任何自定义滚动条样式，多处 `overflow-auto`（对话消息区、ProjectMenu 列表、MentionPopover 等）沿用浏览器默认条；深色主题下滚动槽仍为白色，样式割裂、观感差。
- **B. 项目选择菜单**：触发按钮高亮被拉满整条工具栏；下拉项目列表与菜单其余项规格不统一、无数量上限；rename/delete 是底部独立按钮 + `window.prompt`/`window.confirm` 原生弹窗；"Create new game" 也走原生 `window.prompt`。

目标：滚动条 theme-aware、细、自动隐藏；项目菜单交互向设计稿与现代下拉菜单看齐（悬浮操作、原地改名、行内删除确认、独立创建弹窗）。

## 现状关键事实

- 技术栈：Next.js 16 + React 19 + Tailwind v4 + Zustand。
- `globals.css` 用 `@theme` 定义语义色变量，`[data-theme="dark"]` 覆盖；已有 `--color-line-2`、`--color-muted` 等可用于滚动条。
- 触发按钮在 `ChatPanel.tsx` 头部，类名含 `flex-1`，导致 hover 底色拉满工具栏；无菜单展开态高亮。
- `ProjectMenu.tsx`：列表项已是 36px、`rounded-[12px]`、`px-[8px] py-[6px]`、12px medium；`max-h-[200px]`≈5.5 项；底部 `SECTIONS` 含 create(⌘N)/rename/delete；导出 `ProjectMenuAction` 类型。
- rename/delete/create 现由 `ChatPanel.onMenuAction` 用 `window.prompt`/`window.confirm` 处理。
- store action 已就绪：`createProject(name)`、`renameProject(id, name)`、`deleteProject(id)`。
- 现成弹窗范式 `GenerateForm.tsx`：fixed 居中、backdrop(z-40)+圆角卡(z-50)、`Esc` 关闭、`backdrop-blur`、`shadow-prompt`。
- 可用图标：`figAsset.pencil`、`figAsset.trash`、`figAsset.chevronDown`、`figAsset.plus`。

## A. 全局滚动条样式

在 `src/app/globals.css` 末尾新增：

- **全局基线**（兜底，覆盖所有滚动区）：
  - Firefox：`* { scrollbar-width: thin; scrollbar-color: var(--color-line-2) transparent; }`
  - WebKit：`::-webkit-scrollbar { width: 6px; height: 6px; }`；`track` 透明（去掉深色白槽）；`thumb` 用 `var(--color-line-2)`、圆角胶囊（`border-radius: 999px`）；`thumb:hover` 加深到 `var(--color-muted)`。
- **自动隐藏工具类 `.scrollbar-auto`**（应用到重点容器）：
  - `thumb` 默认 `transparent`，仅在容器 hover 时显现为 `var(--color-line-2)`；Firefox 用 `scrollbar-color: transparent transparent` → hover 时 `var(--color-line-2) transparent`。
- **权衡说明**：纯 CSS 无法可靠地对任意滚动元素做「祖先 hover 才显条」的全局自动隐藏，因此基线层始终保留淡色细条兜底，重点容器叠加 `.scrollbar-auto` 获得 hover 才显现的效果。
- **应用 `.scrollbar-auto` 的容器**：ChatPanel 消息区（`flex-1 overflow-auto`）、ProjectMenu 列表、MentionPopover 列表。

## B1. 触发按钮（`ChatPanel.tsx`）

- 去掉触发按钮的 `flex-1`，改为内容自适应宽度 → hover/active 底色只覆盖按钮本身（logo + 名称 + chevron），不再拉满工具栏。
- 行容器改 `justify-between`：触发按钮居左、主题切换居右。项目名加 `max-w-[140px] truncate` 防止长名挤压。
- hover 底色保留 `bg-[var(--color-fill)]`；**菜单展开态(active)**：`menuOpen` 为真时固定加 `bg-[var(--color-fill)]`。

## B2. 下拉项目列表（`ProjectMenu.tsx`）

- 删掉底部操作区后，菜单主体即项目列表，列表项沿用统一规格（36px、`rounded-[12px]`、`px-[8px] py-[6px]`、12px medium）。
- **最多显示 5 个**：列表容器 `max-h-[188px]`（5×36 + 顶部内边距，第 6 项露头提示可滚），`overflow-auto` + `.scrollbar-auto`。

## B3. 每项悬浮操作 + 原地改名 + 行内删除确认（`ProjectMenu.tsx`）

- 移除底部 `SECTIONS` 的 rename/delete 按钮组；接口改为下述回调后，整个 `ProjectMenuAction` 类型不再被引用，一并删除。
- 每个项目行为 `group`：
  - 默认：右侧显示选中绿点（当前项目）。
  - **hover**：右侧显现两个小图标按钮——`figAsset.pencil`（改名）/ `figAsset.trash`（删除）；按钮 `onClick` 调 `stopPropagation` 避免触发项目切换。
- **改名（原地）**：点 pencil → 该行名称变为内联 `<input>`（预填当前名、autofocus、全选）。`Enter` 或失焦 → 保存调 `onRename(id, name)`（名称去空、非空且有变化才调）；`Esc` → 取消还原。编辑态下点击行不触发 `onSelect`。
- **删除（行内确认气泡）**：点 trash → 该行原地展开紧凑确认条「Delete this game? [取消] [删除]」。点删除 → `onDelete(id)`；点取消或 `Esc` → 还原。一次只允许一个行处于编辑/确认态。
- **接口调整**：
  - `ProjectMenu` props：`onAction` 移除，改为 `onCreate(): void` + `onRename(id: number, name: string): void` + `onDelete(id: number): void`（保留 `projects` / `currentId` / `onClose` / `onSelect`）。
  - `ChatPanel`：移除 `onMenuAction` 与全部 `window.prompt`/`window.confirm`；`onCreate` 打开创建弹窗，`onRename`/`onDelete` 直接透传 store 的 `renameProject`/`deleteProject`。

## B4. Create new game 独立弹窗（新建 `src/components/chat/CreateGameModal.tsx`）

- 复用 `GenerateForm` 范式：fixed 居中、`backdrop`(z-40, 点击关闭) + 圆角卡(z-50)、`Esc` 关闭、`backdrop-blur-[6px]`、`shadow-prompt`、`bg-[var(--color-surface)]`。
- 内容：标题「Create new game」+ 单行 `<input>`（autofocus、`Enter` 提交、占位 "Game name"）+ Create 按钮（有文字时 `raised-active`，否则 `raised` 禁用）。可含取消（或仅靠 backdrop/Esc 关闭）。
- 提交：`createProject(name.trim())` → 关闭。
- 挂载：`ChatPanel` 本地 `useState` 控制开关（`createOpen`），由菜单 create 项触发；不进 store（YAGNI）。
- 菜单 create 项保留 `⌘N` 快捷键提示文案。

## 涉及文件

| 文件 | 变更 |
|---|---|
| `src/app/globals.css` | 新增全局滚动条样式 + `.scrollbar-auto` 工具类（A） |
| `src/components/chat/ChatPanel.tsx` | 触发按钮宽度/高亮(B1)、接线创建弹窗 + rename/delete 回调(B3/B4)、消息区加 `.scrollbar-auto` |
| `src/components/chat/ProjectMenu.tsx` | 列表规格统一 + max5 滚动(B2)、悬浮操作 + 原地改名 + 行内删除确认(B3)、create 项触发 `onCreate` |
| `src/components/chat/CreateGameModal.tsx` | **新建**：创建游戏弹窗(B4) |
| `src/components/chat/MentionPopover.tsx` | 列表加 `.scrollbar-auto`（A，应用） |

## 测试策略

vitest + @testing-library/react 已就绪，组件测试为主：

- **ProjectMenu**：
  - 渲染项目列表；点击项目调 `onSelect`。
  - hover 显示 pencil/trash（DOM 中存在操作按钮）。
  - 点 pencil 进入输入态；输入 + `Enter` 调 `onRename(id, newName)`；`Esc` 不调用。
  - 点 trash 显示确认条；点删除调 `onDelete(id)`；点取消不调用。
  - 操作按钮点击不触发 `onSelect`（stopPropagation）。
- **CreateGameModal**：
  - 输入名称 + `Enter`/点击 Create 调 `createProject`，随后 `onClose`；空名称时 Create 禁用。
- 滚动条样式（A）为纯 CSS，不写单测，靠运行时人工核验（亮/暗主题各看一次）。

## 实现流程

- 在 feature worktree 中实现（满足 Nick「新建 feature worktree」的要求）。
- 验收：`pnpm test`、`pnpm lint` 通过；运行 app 人工核验滚动条（亮/暗）、触发按钮高亮宽度、列表 max5 滚动、原地改名、行内删除确认、创建弹窗。

## 非目标 / YAGNI

- 不引入第三方 modal/scrollbar 库。
- 创建弹窗不进 Zustand store（仅 ChatPanel 本地状态）。
- 不改动 store action 行为与后端接口。
- 不处理 ProjectMenu 之外的 rename/delete 入口（当前仅此一处）。
