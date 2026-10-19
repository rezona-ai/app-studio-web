# 问答卡片重构（QuestionCard）设计稿

日期：2026-07-03
Figma：`TALUNA DEVELOPER SITE` node `1099-25192`（默认态）· `647-26220`（选中态）· `647-26356`（hover 态）

## 背景

现有 `src/components/chat/QuestionCard.tsx`（AskUserQuestion 交互卡）是「单选圆圈/复选框 + 上一步/下一步/提交按钮」形态。设计稿改为「进度条 + 圆形箭头导航 + 序号选项行 + Custom answer 自由输入」形态，且没有提交按钮。

## 交互语义（已与 Nick 确认）

- **点选项即答**：单选题点中选项立刻记录答案；非末题自动前进到下一题，**末题点选即整体提交**。
- **多选题**：点选项只切换选中态；选中至少一项后右箭头点亮，点右箭头前进/（末题）提交。
- **右箭头**：当前题已答才可点；末题时充当提交。左箭头回上一题，首题禁用。
- **Custom answer**：每题底部固定一行（铅笔图标 + muted 占位文字）。点击原地展开内联输入框（自动聚焦），回车确认为该题答案（末题回车即提交），Esc 收起。单选题下与选项互斥；多选题下作为额外一项并入 `string[]`。
- **单问题**：隐藏整个顶部导航行（进度条/箭头/计数）。
- **单问题且多选**：仍渲染导航行以承载确认动作，但隐藏左箭头与「n of N」计数，只留进度条 + 右箭头（= 提交）。

## 视觉（对齐设计稿 + 仓库令牌）

- **容器**：`rounded-[20px]` · `bg-[var(--color-surface-2)]` · `border border-[var(--color-line)]` · `px-2 py-3` · 纵向 `gap-3`。主题变量自动适配明暗，组件不写主题分支。
- **顶部导航行**（多问题时）：
  - 进度条：高 4px、圆角、轨道 `--color-line`、填充 `--color-teal`（品牌青 #1FD4CF，忠实设计稿 primary），宽度 = 已答题数/总题数，150ms 过渡；
  - 32px 圆形箭头按钮 ×2（chevron 用 `FigIcon`，同一资源 `flipX` 镜像；禁用态半透明）；
  - 计数「n of N」：14px semibold。
- **问题行**：16px 问号图标（`FigIcon` 新登记）+ 15px bold `--color-ink` 问题文字；`header` 字段仍以 12px muted 小字展示在问题上方。
- **选项行**：高 40px · `rounded-[12px]` · `pl-1 pr-3`；左侧 32px `rounded-[8px]` 序号方块（`--color-fill` 底、12px medium 数字）+ 12px medium 标签；`description` 有则放标签下方小字、行高自适应。
- **选中态**（Figma node `647-26220`）：整行加一圈 `--color-teal` 描边（圆角随行），无外晕、序号方块与背景不变（忠实设计稿 primary 青色 #1FD4CF，经 Nick 裁定不映射为项目 accent 蓝）。
- **Hover 态**（Figma node `647-26356`）：整行 `hover:bg-[var(--color-fill)]`，无描边变化。
- **Custom answer 行**：与选项行同构，方块内放铅笔图标（`tone: original`），文字 muted；展开态原地变输入框。
- 动效沿用既有类（`anim-media-in` 换题淡入等），新动画进 `prefers-reduced-motion` 禁用列表。

## 不变的部分

- 协议与提交流程不动：`onSubmit(interactionId, answers)`，`answers: Record<string, string | string[]>`（自由输入天然是 string）。
- ChatPanel 挂载方式、i18n 六语文案体系不变（新增文案补六套：custom answer 占位、进度 aria 等）。

## 测试（`QuestionCard.test.tsx` 更新）

- 单选点选自动前进；末题点选即提交且 answers 正确。
- 多选：点选只切换，右箭头门控（未答禁用），末题右箭头提交。
- Custom answer：展开、回车确认/提交、Esc 收起、多选并入数组。
- 单问题隐藏导航行；进度条宽度随已答题数变化。
- 左箭头回退保留已选状态。
