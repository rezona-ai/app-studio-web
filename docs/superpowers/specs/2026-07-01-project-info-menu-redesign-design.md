# Project Info（项目切换器菜单）对齐 Figma 设计稿

- 日期：2026-07-01
- Figma：`TALUNA-DEVELOPER-SITE` node `1527-28576`（Sidebar / 项目名下拉菜单展开态）
- 分支：`feat/project-info-redesign`

## 背景

左栏 Chat 顶部的「项目名称下拉按钮」点开后是项目切换菜单（组件 `ProjectMenu`）。
设计稿把菜单重新组织，与当前实现存在结构与视觉差异。本次仅重构该菜单，**顶部触发按钮不动**（logo + 项目名 + chevron 已与设计稿一致）。

### 设计稿 vs 现状差异

| 维度 | 现状 | 设计稿 |
|---|---|---|
| 分组顺序 | 项目列表在上、Create 在下 | 操作组在**上**、项目列表在**下** |
| 操作项 | 仅 Create new game | Create new game ⌘N、Duplicate ⌘D、Back to Studio |
| 当前项指示点 | 绿色 `--color-live` | 青色 `#1fd4cf`（Figma `primary/main`） |

## 决策（已与 Nick 确认）

1. **Duplicate**：本次**不加**。PGC 无「复制项目」接口，等后端就绪再补。
2. **Back to Studio**：跳**父级根路径**——`window.location.href = '/'`，刻意不经 `apiPath()` 以跳出 `/game` basePath 回到父级 Taluna Studio。
3. **指示点颜色**：改为青色 `#1fd4cf`，严格对齐设计稿。**复用 `globals.css` 已有的 `--color-teal: #1fd4cf`**（注释即「Figma text/primary，Live/Current 徽章」，语义完全契合「当前项目」指示，且主题恒定），无需新增 token。

## 目标与非目标

**目标**
- `ProjectMenu` 结构改为「操作组（上）／分隔线／项目列表（下）」。
- 操作组含：`Create new game... ⌘N`、`Back to Studio`。
- 当前项目指示点改为设计稿青色，经新 token。
- 全程复用既有令牌 / 基础组件 / 动效，无硬编码。

**非目标**
- 不加 Duplicate。
- 不动顶部触发按钮、不动行内改名 / 删除确认交互逻辑。
- 不接入全局 `⌘N` 键盘监听（`⌘N` 仅为设计稿一致的视觉标签，与现状一致）。

## 菜单结构（重构后）

```
┌──────────────────────────────┐  rounded-[20px] · border --color-line
│ [操作组 p-8 gap-1]            │  bg --color-pop · shadow-popover · backdrop-blur
│   Create new game...     ⌘N  │  h-36 · rounded-12 · hover bg-fill
│   Back to Studio             │  h-36 · rounded-12 · hover bg-fill
│ ──────────分隔线────────────  │  项目列表容器 border-t --color-line
│ [项目列表 p-8 · max-h-188 滚动]│  scrollbar-none
│   Project name            ●  │  当前项:bg-fill + 青点(hover 让位操作按钮)
│   Project 2           ✎  🗑  │  hover 显现 改名/删除
│   Project 3                  │
└──────────────────────────────┘
```

- 外层容器仍 `overflow-hidden` 裁切圆角；操作组在前、项目列表在后。
- 分隔线由「border-t 挂在项目列表容器顶部」实现（原本挂在 Create 容器）。
- 项目列表为空（理论上不会发生，平台保证至少一个项目）时，仍渲染操作组；分隔线随项目列表容器一并省略。

## Back to Studio 行为

- `ProjectMenu` 新增 `onBackToStudio: () => void` 回调 prop（保持组件表现层纯净，与 `onCreate`/`onSelect` 同构）。
- `ChatPanel` 传入该回调：`() => { window.location.href = '/'; }`，附中文注释说明「刻意不经 basePath，跳出 /game 回到父级 Studio 根」。
- 点击后同时 `onClose()` 关闭菜单（导航前的收尾，与 Create 一致）。

## 设计令牌（复用既有 `--color-teal`）

`src/app/globals.css` 已在 `@theme`（`:root`）定义：

```css
--color-teal: #1fd4cf;   /* Figma text/primary #1FD4CF:Live/Current 徽章 */
```

- 该值与设计稿 `primary/main` 完全一致，语义即「当前/Live」，无 dark 覆盖 → 主题恒定。**直接复用，不新增 token。**
- 当前项指示点由 `bg-[var(--color-live)]` 改为 `bg-[var(--color-teal)]`。

## 复用的既有令牌 / 组件

- 颜色：`--color-ink` / `--color-muted` / `--color-pop` / `--color-fill` / `--color-surface-2` / `--color-line`
- 阴影：`--shadow-popover` / `--shadow-shortcut`
- 字号：菜单项 `12px`（`body.medium`）、快捷键 `11px`（`body.small`）
- 圆角：容器 `20px`、菜单项 `12px`、快捷键 `6px`；间距 `8px`
- 组件：`Shortcut`（本文件内）、`FigIcon`（pencil / trash）、`Tooltip`
- 动效：`.anim-pop-in` + `origin-top-left`（不变）

## 国际化

`chat.project` 段新增 `backToStudio`，六语（en/zh/fr/ru/ja/vi）补齐，en 为真相源：

| locale | 文案 |
|---|---|
| en | Back to Studio |
| zh | 返回工作室 |
| fr | Retour au Studio |
| ru | Назад в Студию |
| ja | スタジオに戻る |
| vi | Quay lại Studio |

`ProjectMenu` 内 `Back to Studio` 文案走 `t('chat.project.backToStudio')`。
（`Create new game...` 维持现状硬编码，本次不迁移以收敛 diff。）

## 测试（`ProjectMenu.test.tsx`）

保留现有 8 例，新增 / 调整：
1. **分组顺序**：断言操作组（Create / Back to Studio）在 DOM 中位于项目列表之**前**（用 `compareDocumentPosition` 或 query 顺序）。
2. **Back to Studio**：存在该项；点击调用 `onBackToStudio` 且 `onClose`。
3. **无 Duplicate**：断言查不到「Duplicate」。
4. 新增 `onBackToStudio: vi.fn()` 到 `setup()` 默认 props。

i18n：测试环境 `t()` 回落 key 或 en 文案——沿用现有测试对文案的匹配方式（现有用例直接匹配 en 文案，如 `/Create new game/i`、`Rename Alpha`），故 `Back to Studio` 用例按 en 文案匹配。

## 涉及文件

- `src/components/chat/ProjectMenu.tsx`（重排结构 + 新增 Back to Studio 项 + 青点改 `--color-teal`）
- `src/components/chat/ChatPanel.tsx`（新增 `onBackToStudio` 回调并传入）
- `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（新增 `chat.project.backToStudio`）
- `src/components/chat/ProjectMenu.test.tsx`（更新测试）

> `globals.css` 不改动——复用既有 `--color-teal`。

## 验收

- `pnpm exec vitest run src/components/chat/ProjectMenu.test.tsx` 全绿。
- `pnpm exec tsc --noEmit`、`pnpm lint` 通过。
- 视觉与设计稿一致：操作组在上、青点、分隔线、间距 / 圆角 / 字号对齐。
