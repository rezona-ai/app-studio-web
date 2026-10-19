# 对话输入框高度可调设计（auto-grow + 手动拖拽）

日期：2026-07-10

## 背景与目标

当前 Composer 的 textarea 固定 `rows={2}`，内容多时只能内部滚动，可视区域太小。目标：

1. **随内容自动增高**：从 2 行起，随输入自动长高，最多展示 6 行；超过 6 行内部滚动（沿用现有镜像层同步滚动机制）。
2. **手动拖拽调整**：文本区上缘提供拖拽把手，用户可在 2–6 行之间拖出「基准高度」，作为高度下限并持久化。

## 交互规则（方案 A：基准高度作下限，auto-grow 仍生效）

- 实际显示行数 = `clamp(基准行数, 内容所需行数, 6)`。
  - 拖高后内容少也保持基准高度；内容多仍自动长到 6 行封顶。
- 基准行数取值 2–6 的整数（拖拽像素量化到行）；默认 2。
- 拖拽方向：输入框在面板底部，向上拖增高、向下拖降低（与 Workspace 分隔条同范式：pointer capture + 拖拽期间遮罩语义）。
- 无「固定高度模式」等隐藏状态；把手无需双击重置。

## 实现要点

### 状态

- `UIState.composer` 切片新增 `baseLines: number`（默认 2），经 `composerSet` 更新。
- persist：composer 草稿已持久化，`baseLines` 一并落 `taluna-v4`（partialize 已含 composer，无需改 layout 内联脚本）。

### 高度计算（Composer.tsx）

- 行高常量：`leading-6` = 24px；`pt-1` = 4px 上内边距。容器高度 = `lines * 24 + 4`。
- auto-grow：draft 变化时读 `taRef.current.scrollHeight` 推算内容所需行数（scrollHeight 含 pt-1，需减去后除以 24 向上取整）；与 `baseLines` 取 max、与 6 取 min，得出目标行数，设置到外层 `relative` 容器的 height（textarea/镜像层均 `absolute inset-0` 或 `h-full` 跟随）。
- **镜像层约束不破坏**：高度只作用于共同父容器，textarea 与镜像层的字体/内边距/换行度量保持完全一致；滚动同步逻辑不变。
- 需把 textarea 改为 `h-full`（当前靠 rows 撑高），镜像层已 `absolute inset-0`。

### 拖拽把手

- 位于文本区上缘（AttachmentBar 之下），高度约 8px 的命中区，`cursor-row-resize`，hover 显示细条（复用 `--color-line` / hover 转 `--color-teal` 的分隔条范式，不新造组件种类）。
- pointerdown 记录起始 Y 与起始行数；move 时 `delta = startY - clientY`，`baseLines = clamp(round(start + delta / 24), 2, 6)`；up 结束。拖拽期间 `setPointerCapture` 避免丢事件。
- `aria-label` + 键盘可达可暂不做（分隔条现状同级），但保留 role="separator" aria-orientation="horizontal"。
- `prefers-reduced-motion` 不涉及（无动画）。

## 测试

- 纯逻辑下沉 `src/lib/composer-height.ts`：`contentLines(scrollHeight)` 与 `displayLines(baseLines, contentLines)`（clamp 逻辑）单测。
- Composer 组件测试补充：拖拽把手存在、baseLines 经 composerSet 落 store。

## 错误与边界

- scrollHeight 读取在 ref 为空时跳过（保持当前行数）。
- 行数恒被 clamp 到 [2, 6]，持久化脏数据（旧版本无字段 / 越界）由 clamp 兜底。
