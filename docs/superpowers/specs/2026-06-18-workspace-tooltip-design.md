# Workspace 图标按钮气泡提示（Tooltip）设计稿

> 日期：2026-06-18 · 状态：已确认设计，待实现计划

## 背景与目标

Workspace 三栏（Chat | Canvas | Preview）里存在大量**纯图标 / 纯符号、无可见文字标签**的按钮与控件。这些元素大多已挂了 `aria-label`，对屏幕阅读器友好，但 `aria-label` **hover 时不显示任何可视气泡**——视力用户把鼠标悬到一个图标上得不到任何文字提示，影响易用性。

目标：给 Workspace 三栏内所有「不含可见文字标签」的交互元素，增加 hover / focus 触发的**可视气泡提示**。

**范围**：仅 Workspace 三栏（`src/components/workspace|chat|canvas|preview/`）。landing 落地页不在本次范围。

**文案策略**：以现有 `aria-label` 为单一真相源，组件默认读取它作为气泡文案；个别过简或需要语境化的（如 disabled 态）再用显式 `label` 覆盖。不维护两套文本。

## 方案选型

| 方案 | 取舍 | 结论 |
|---|---|---|
| **A. 自建依赖无关的 `<Tooltip>` portal 组件** | `createPortal` 渲到 `body` + `getBoundingClientRect` 定位：不被 overflow 裁剪、可视口翻转、可解决 disabled 按钮 hover 不触发；零新增依赖，契合「精简依赖 + 自建 UI 原语」约定 | **采用** |
| B. 纯 CSS `data-tooltip` + `::after` | 会被 `overflow:hidden` 裁剪（节点卡、Lightbox 等大量存在）、难做边缘翻转、disabled 仍需外包一层 | 否决（裁剪问题致命） |
| C. 引入 Floating UI / Radix | 功能最全，但与项目精简依赖约定相悖 | 否决 |

## 组件设计：`src/components/ui/Tooltip.tsx`

定位为 `components/ui/` 下的通用 UI 原语，泛化覆盖 `IconButton` / `span[role="button"]` / 普通 `<button>` 等所有触发形态。

### API

```tsx
type TooltipProps = {
  label?: string;                 // 气泡文案;缺省时回退读 children 的 aria-label
  side?: 'top' | 'bottom';        // 默认 'top';贴近视口边缘时自动翻转
  children: ReactElement;         // 唯一触发子元素
};

// 用法一:复用 aria-label,零重复
<Tooltip><IconButton aria-label="Send" .../></Tooltip>

// 用法二:语境化 / 覆盖文案
<Tooltip label={canMention ? 'Mention an asset' : 'Generate assets on the canvas first to @mention them'}>
  <IconButton aria-label="Mention" disabled={!canMention} .../>
</Tooltip>
```

### 关键行为

1. **文案单一真相源**：`label` 缺省时回退到 `isValidElement(children) && children.props['aria-label']`；无任何来源时不渲染气泡（开发期可 warn）。
2. **解决 disabled 痛点**：hover / focus 监听挂在**外包 `<span class="inline-flex">`** 上，而非 disabled 的子按钮上（disabled 元素不派发指针事件）。这是把 `Composer.tsx` 现有的手写 span+title hack 泛化为统一组件——实现后移除该 hack。
3. **触发**：`mouseenter` / `focusin` 打开（延时 ~350ms 防闪烁），`mouseleave` / `focusout` 立即关闭；`scroll`（捕获阶段）/ `pointerdown` 时关闭（避免画布平移、滚动时气泡滞留）。
4. **定位**：`createPortal` 到 `document.body`，`position: fixed`；打开瞬间按触发元素 rect 计算；默认置于上方，若上方空间不足（顶部 < 8px）翻转到下方；水平方向 clamp 进视口。
5. **无障碍**：保持子元素 `aria-label` 为唯一可读标签；气泡本身 `aria-hidden="true"`（纯视觉，避免与 aria-label 重复播报）。
6. **样式**：复用设计 token（`--color-ink` / `--color-surface` / `--color-line` / 阴影），小圆角、轻阴影、`text-xs`、`pointer-events-none`、`whitespace-nowrap`、高 `z-index`；v1 不画箭头，保持简洁。

### 边界与约束

- portal 到 body → 不受 `@xyflow` 画布 transform、`react-resizable-panels`、各滚动/裁剪容器影响。
- 定位仅在打开瞬间计算一次（不随滚动持续跟随）；滚动即关闭，避免位置漂移与性能开销。
- 仅接受单个 `ReactElement` 子元素；外包 span 用 `inline-flex` 以尽量不破坏 flex 行内布局（集成时逐一目视核对间距）。
- `setTimeout` / rect 计算等副作用在组件卸载与关闭时清理。

## 需加气泡的元素清单（约 18 处）

### Chat 面板
| 元素 | 位置 | 文案来源 |
|---|---|---|
| Jump to latest（下箭头） | `ChatPanel.tsx` | aria-label |
| Attach（＋） | `Composer.tsx` | aria-label |
| Mention（@，含 disabled 语境化文案） | `Composer.tsx` | 显式 label 覆盖 |
| Send / Stop | `Composer.tsx` | aria-label |
| 改名 ✏ / 删除 🗑（hover 浮现） | `ProjectMenu.tsx` | aria-label |
| 移除 ×（hover 浮现） | `AssetChip.tsx` / `AttachmentBar.tsx` | aria-label |

### Canvas 面板
| 元素 | 位置 | 文案来源 |
|---|---|---|
| Generate from this asset（＋，选中浮现） | `nodes/NodeCard.tsx` | aria-label |
| Generate ↑ / Remove ×（ref chip） | `GenerateForm.tsx` | aria-label |
| Advanced settings ⚙ | `GenParamControls.tsx` | aria-label |
| Close × | `MediaLightbox.tsx` | aria-label |
| Play / Expand | `nodes/VideoNode.tsx` | aria-label |
| Play / Pause | `nodes/AudioNode.tsx` | aria-label |
| Expand | `nodes/ThreeDNode.tsx` | aria-label |

### Preview 面板
| 元素 | 位置 | 文案来源 |
|---|---|---|
| Download ZIP（disabled 态需气泡） | `PreviewPanel.tsx` | aria-label |
| Refresh preview（disabled 态需气泡） | `PreviewPanel.tsx` | aria-label |

### 有意跳过（不在本次范围）
- 有可见文字：`ModelSelector`、`DeviceToggle`（原生 select）、`VersionTimeline` 的 Compare、`RefPicker` 的 Add reference、`CreateGameModal` / `RenameAssetModal` 的 Create / Rename 提交按钮（渲染文字）。
- 文字菜单项：`ContextMenu` / `AddAssetMenu` / `ProjectMenu` 的文字项。
- 非按钮：状态 spinner、Workspace 拖拽分隔条、画布搜索框图标、⌘K 提示、`KindLegend` 文字图例。
- **GenParamControls 的 − / ＋ 步进按钮**：符号按钮但下方有可见字段标签，加气泡偏噪音，默认跳过，需要再补。

## 测试（同目录 `Tooltip.test.tsx`，TDD）

jsdom + fake timers（jsdom 下 `getBoundingClientRect` 返回 0，仅测存在性 / 文本 / 显隐，不测像素位置；portal 渲到 body）：

1. 渲染子元素。
2. hover 后（推进延时）气泡出现并显示文案。
3. 无 `label` 时回退读子元素 `aria-label`。
4. 显式 `label` 覆盖 aria-label。
5. `mouseleave` / blur 后气泡隐藏。
6. **包裹 disabled 按钮时 hover 仍触发气泡**（核心回归点）。
7. 气泡带 `aria-hidden="true"`。

## 实施顺序

1. TDD 实现 `Tooltip.tsx` + `Tooltip.test.tsx`。
2. 按清单逐栏接入（Chat → Canvas → Preview），并移除 `Composer.tsx` 的手写 span+title hack。
3. `pnpm exec tsc --noEmit` + `pnpm test` + 目视核对各栏布局与气泡显隐。
