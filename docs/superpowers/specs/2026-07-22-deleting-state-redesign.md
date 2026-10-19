# 卡片删除中态重设计：删除语义徽章 + 消除双圆

## 背景

上一轮（spec 2026-07-22-cancel-generating-on-delete）把删除中覆盖层的旧 spinner 换成了生成占位同款的「状态光环」。上线后确认两个问题：

1. **语义错位**：光环是"内容正在成形"的处理中语汇，套在删除上没有传达"正在移除"；用户看到的是又一个生成圈。
2. **双圆同现**：删除一张 generating 卡时，`GeneratingPlaceholder` 自带的居中光环与删除覆盖层的光环同时出现，两个圆环叠在卡片中央，视觉效果差。

## 目标与成功标准

- 删除中态一眼可辨"正在删除"：危险色（`--color-danger`）+ trash 字形，不再与生成态共用光环语汇。
- 删除一张 generating 卡时，占位图的光环与扫光被压制，画面中只有删除徽章一个焦点。
- 卡片内容呈现"退场感"（去饱和 + 压暗 + 轻微缩小），与"内容成形"的生成态方向相反。
- 保留既有语义与约束：`role="status"` + `aria-label`（canvas.deleting）、`aria-busy`、`pointer-events-none`、删除失败恢复原样（状态仍由 `deletingIds` 驱动，无新状态机）。
- 新增动效补进 `prefers-reduced-motion: reduce` 禁用列表。

## 现状约束

- `NodeCard` 已知 `deleting`（订阅 `deletingIds`），但媒体区由各节点组件作为 children 传入，`GeneratingPlaceholder` 拿不到 deleting——压制其光环需要祖先级手段（CSS 作用域类），不宜为此给四个节点组件穿针引线传 prop。
- `StatusHalo` 上一轮从 `GeneratingPlaceholder` 抽出仅为 `NodeCard` 复用；本轮 `NodeCard` 不再用它，单消费者抽象应回收（反模式：不留只有一个使用方的抽象）。
- trash 图标已在 FigIcon 注册（`tone: primary`，mask + currentColor 重着色），可直接以 danger 色渲染。
- 危险语义色已有令牌：`--color-danger` / `--color-danger-soft`（深浅稿各自定义），删除确认弹窗已在用。

## 方案比较

### 方案 A：光环改色（danger 红光环）

保留光环形态，仅把删除中的光环染成危险色。

- 优点：改动最小。
- 缺点：形态不变，"处理中圈"的误读仍在；双圆问题原封不动。

### 方案 B：危险色 trash 徽章 + 内容退场 + 祖先类压制占位光环（推荐）

覆盖层换成居中的 trash 徽章（danger 柔光底 + danger 描边 + trash 字形，轻脉冲表示请求在途）；卡片内容整体去饱和压暗微缩；卡根挂 `.node-deleting`，globals.css 据此隐藏占位图的光环与扫光。

- 优点：trash + 危险色直给删除语义；退场感与生成态方向相反，不混淆；双圆从根上消除；无 prop 穿透。
- 缺点：新增一个轻量 keyframes（脉冲）；jsdom 不加载样式表，压制规则只能以"卡根带类 + 样式表含规则"两段断言守护。

### 方案 C：删除时立刻本地移除卡片（乐观删除）

没有删除中态，自然没有视觉问题。

- 优点：最直接。
- 缺点：推翻既有悲观删除契约（失败恢复卡片），失败时卡片"闪现还魂"体验更差；影响面远超视觉需求。

## 推荐设计

采用方案 B。

### 视觉与动效

- **覆盖层**（`NodeCard` deleting 分支）：半透明表面色遮罩保留；居中徽章 `size-10` 圆形，`--color-danger-soft` 底 + danger 40% 描边 + backdrop-blur，内嵌 `FigIcon trash`（18px，currentColor=danger）。覆盖层 `anim-media-in` 淡入，徽章 `.anim-pulse-soft`（透明度 1→0.55 轻脉冲，1.6s循环）表达请求在途。
- **内容退场**：header + 媒体区包一层内容容器，deleting 时 `grayscale + opacity-60 + motion-safe:scale-[0.98]`，transition 200ms；卡根不再整体 `opacity-60`（避免把徽章一起压暗）。
- **压制占位光环**：卡根 deleting 时加 `.node-deleting`；globals.css 新增规则隐藏其内 `.asset-generating-focus` 与 `.asset-generating-sheen`（连带其 `role=status`，避免"生成中/删除中"双状态朗读）。占位图与暗部渐晕保留，作为退场内容的一部分。
- **新增 CSS**：`@keyframes pulse-soft` + `.anim-pulse-soft`、`.node-deleting` 压制规则；`.anim-pulse-soft` 补进 reduced-motion 禁用列表。

### 组件回收

- `GeneratingPlaceholder`：`StatusHalo` 导出回收，内联回组件内部（视觉零变化）。
- `NodeCard`：移除对 `StatusHalo` 的引用。

## 无障碍与降级

- 删除语义仍由覆盖层内 `role="status"` + `aria-label`（canvas.deleting）承载，容器 `aria-busy` 不变。
- reduced-motion：脉冲禁用，静态徽章 + 压暗保持信息完整；内容缩小已带 `motion-safe:`。

## 非目标

- 不改删除流程（悲观删除、`deletingIds` 驱动、失败恢复）。
- 不改生成占位视觉本体与上传进度层。
- 不为删除确认弹窗、右键菜单做任何调整。
