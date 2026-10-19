# 两侧边栏的常驻开关入口 — 设计稿

日期：2026-08-18
关联：`docs/superpowers/specs/2026-08-17-sidebar-collapse-handles.md`（把手本体）、`2026-08-18-edge-handle-liquid-follow.md`（把手的液体粘连）

## 目的

两个折叠把手默认隐藏、hover 才浮现，定位是**快捷方式**。它们各自控制的动作目前**没有常驻的可直达入口** —— 不知道把手存在的用户找不到「收起对话栏」和「预览全宽」。给这两个动作各补一个常驻按钮。

## 盘问结论

| 分叉 | 结论 | 否掉的选项与理由 |
|---|---|---|
| 预览按钮的语义 | **与右把手等价：全宽 / 恢复**。不新增预览隐藏态 | 「新增隐藏/显示预览栏」要给预览加收起态 + 持久化 + 与全宽态互斥，是另一个需求；「按钮管显隐 + 把手管全宽」会让预览有三种宽度态，状态机与持久化都要多一层 |
| 对话栏按钮的位置 | **ChatPanel 自己的顶部右侧**（项目名那一排，`justify-between` 右位天然空着） | 「页面右上角的账户条」虽然恒可见，但那是预览面板的一部分，用最右边的控件管最左边的栏，方位是反的 |
| 预览按钮的位置 | **预览面板 tab 行、Fullscreen 紧邻左侧**（Preview/Files pill 的对侧那一组）。渲染条件与右把手、与 Fullscreen 完全一致：`!compareOn && !filesTab` | 先放过画布工具列（已实现后撤回）：那条工具条属于画布，塞进控制**预览列**的开关是越界；挪进预览面板后，控件与它所控制的东西同处一栏，且与 Fullscreen 成组 |
| 图标 | **新画 3 个**：`panel-left`（对话栏）· `expand-corners` / `collapse-corners`（预览两态） | 库里没有 sidebar/panel 类图标；`fullscreen` 是对角双箭头且已被预览面板顶部的「新页签全屏」占用，同屏两个 fullscreen 做不同事必然混淆；`frame` 已被画布占用 |

**已接受的代价**：对话栏按钮随 ChatPanel 一起收起后消失，回来的路仍只有那个常显把手 —— Nick 明确接受。

## 图标

按 Nick 给的参考图新画，严格对齐现有规格：`viewBox 0 0 20 20` · `fill="none"` · `stroke-width="1.5"` · `stroke-linecap/linejoin="round"`。stroke 颜色随意（primary/secondary 走 CSS mask 以 currentColor 重着色，SVG 里的颜色不参与渲染）。三者都不登记 `ICON_TONE` —— 未登记默认 `primary`，随按钮的 currentColor 翻转，正是所需。

| 文件 | 形状 | 用途 |
|---|---|---|
| `panel-left.svg` | 圆角方框 + 偏左竖线（左 5 : 右 9） | 对话栏开关 |
| `expand-corners.svg` | 四个 L 形角标，拐角贴四个外角 | 预览按钮在**常态**（点击 → 全宽） |
| `collapse-corners.svg` | 四个 L 形角标，拐角朝中心 | 预览按钮在**全宽态**（点击 → 恢复） |

## 状态怎么给到按钮（两处取不同做法，各自最合适）

两个按钮都在 Workspace 的子组件里，而 `chatCollapsed` / `previewFull` 都是 Workspace 的局部 state。

- **`previewFull` → 进 store**。`Workspace` 要用它派生渲染宽与把手方向，`PreviewPanel` 要用它出图标与文案 —— 两个组件共读，正是 store 的用途（「跨组件协调也走 store 字段」）。
  - **持久化口径不变**：仍是独立 key `workspace.previewFull`，**不**进 persist 白名单。store 里那个字段只是共享读取通道，写盘仍归 Workspace：唯一翻转入口是 store action，Workspace 用 effect 订阅它 → 写 localStorage + 重算布局。单向，不是双写。
  - 这样避免把用户已有的设置迁进 `rezonalab-v4` blob（要么丢设置、要么写一次性迁移读），也不用动 CLAUDE.md 里那两个 key 的口径。
- **`chatCollapsed` → 传 prop**。`ChatPanel` 是 Workspace 的直接子组件，一层直传比进 store 更轻，也不必为一个按钮多一个全局字段。

## 约束

1. 两个按钮**复用把手已有的 i18n key**（`workspace.chatCollapse` / `workspace.previewFullWidth` / `workspace.previewRestore`）—— 同一动作同一文案，零新增文案。同名按钮在同一页出现两次是正确的无障碍做法（两个入口做同一件事）。
2. 复用 `IconButton` + `Tooltip`，不新建按钮种类、不自写按钮样式。
3. 预览那个按钮的样式与 tab 行的邻居完全一致（`ghost` + `rounded-[10px] bg-[var(--color-surface)] p-2`，图标 16）；**不套 `raised-active`** —— 这一排邻居都没有选中态，状态已由「撑满 ↔ 收拢」的图标切换表达，但 `aria-pressed` 保留。
4. 对话栏按钮尺寸与项目名那排协调，不撑高顶栏。
5. 不改把手的任何行为（含液体粘连）。

## 成功标准

1. 对话栏顶部右侧有常驻按钮，点击收起对话栏（走已有的宽度过渡），与把手效果完全一致。
2. 预览面板 tab 行、Fullscreen 左侧有常驻按钮，点击在「全宽 ↔ 恢复」间切换，与右把手完全一致；全宽态显示 `collapse-corners` 图标。compare / Files 覆盖态下与把手一同不渲染。
3. 两个按钮与各自把手**共享同一份状态**：任一入口翻转后，另一入口的图标 / 选中态 / 箭头方向同步。
4. `workspace.previewFull` 的持久化行为不变（跨刷新存活，仍是那个独立 key）。
5. 三个新图标随主题翻转（走 mask，深浅稿都可见）。
6. `pnpm lint` / `tsc` / `pnpm test` / `pnpm build` 全绿。
