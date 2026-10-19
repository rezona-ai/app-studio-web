# 工具多媒体输出折叠设计

资产生成类工具（如 `mcp__media__check_generation_tasks`）一次可返回**多张媒体**。当前 `ToolCard` 把 `part.media` 全部**全尺寸竖排、始终可见**，一长条占满对话。本设计：当一个工具的可渲染媒体 **≥2 张**时，折叠成「首图 + `+N` 角标」，点击展开全尺寸竖排。

## 现状

`src/components/chat/ToolCard.tsx`：
- `{part.media?.map((item, i) => <MediaItemView key={i} item={item} />)}` —— 全部媒体全尺寸常驻（不随 pill 折叠）。
- `MediaItemView`：单项渲染 img/video/audio（`max-h-48`，各带 `mt-2`）；无 previewUrl 或 3d/model3d 类型渲染 `null`。

## 设计

把那一行 `part.media?.map` 换成一个 co-located 子组件 `MediaGroup`：

```tsx
function MediaGroup({ items }: { items: MediaItem[] }) { ... }
```

- **可渲染项** = `items.filter(it => it.previewUrl && it.kind !== '3d' && it.kind !== 'model3d')`（与 `MediaItemView` 的渲染条件一致，保证「+N」计数与展开数吻合）。
- `renderable.length === 0` → 返回 `null`。
- `renderable.length === 1` → `<div className="mt-2"><MediaItemView item={r[0]} /></div>`（**保持现状**：单图全尺寸常驻，不折）。
- `renderable.length >= 2`：本地 `useState` 折叠态 `open`（默认 `false`），**与 pill 头部控制 diff/参数的 chevron 相互独立**。
  - **收起（默认）**：整块首图为一个按钮，点击展开；右下角叠 `+{renderable.length - 1}` 角标。
    ```tsx
    <button type="button" onClick={() => setOpen(true)} className="relative mt-2 block w-fit">
      <MediaItemView item={r[0]} />
      <span className="absolute bottom-2 right-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-pop)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-ink)] shadow-[var(--shadow-pill)]">+{extra}</span>
    </button>
    ```
  - **展开**：全部可渲染媒体全尺寸竖排 + 末尾一个收起按钮（上箭头）。
    ```tsx
    <div className="mt-2 space-y-2">
      {r.map((it, i) => <MediaItemView key={i} item={it} />)}
      <button type="button" aria-label={t('common.close')} onClick={() => setOpen(false)}
        className="flex items-center text-[var(--color-muted)] transition hover:text-[var(--color-ink)]">
        <FigIcon src={figAsset.arrowDown} size={12} className="rotate-180" />
      </button>
    </div>
    ```

**配套改动：**
- `MediaItemView` 去掉各元素上的 `mt-2`（间距改由 `MediaGroup` 的 wrapper / `space-y-2` 统一控制），因为它现在只被 `MediaGroup` 复用。
- `ToolCard` 顶部 import 补 `FigIcon, figAsset`（`@/components/ui/figma`）。

**约束遵循：**
- **零新增 i18n 文案**：角标是纯数字 `+N`；收起按钮 `aria-label` 复用现有 `common.close`；展开按钮的可访问名来自内容（首图 alt + `+N`）。（[[i18n-conventions]]）
- 颜色全走 token（`--color-pop`/`--color-line`/`--color-ink`/`--color-muted`，`--shadow-pill`），无硬编码。
- 折叠图标复用 `figAsset.arrowDown`（`secondary` 灰）+ `rotate-180`，与 pill 折叠语汇一致。
- **已知小局限**：多媒体集若首项是 video，收起态整块封面是按钮、点击展开——video 原生控件与按钮点击可能轻微冲突。多资产生成场景几乎恒为图片，v1 接受此边缘。

## 单元边界

- `MediaGroup`（co-located 于 `ToolCard.tsx`）：只负责「≥2 折叠 / 单图常驻」的展示与本地折叠态。
- `MediaItemView`：仍只负责单项媒体渲染（去掉自带 margin）。
- `ToolCard` 主体、pill 头部折叠、diff/参数正文逻辑**不变**。

## 测试（`ToolCard.test.tsx` 增改）

- **新增**：
  - `≥2 图 → 默认折叠`：首图 `getByAltText('a.png')` 可见；`queryByAltText('b.png')` 不在 DOM；`getByText('+2')`（3 图时）在。
  - `点击展开 → 全部可见`：`fireEvent.click(getByText('+2'))` 后 `b.png`/`c.png` 均可见。
  - `单图 → 常驻无角标`：`getByAltText('a.png')` 在；`queryByText(/^\+\d/)` 不在。
- **更新**：现有「多条就绪 media 项各自渲染预览」（2 图断言两者都可见，line ~68-76）在新折叠下 `b.png` 默认隐藏——改为断言折叠态（首图可见 + `+1` 角标），或先点击展开再断言两者可见。
- **保留**：「折叠态下生成的媒体仍然可见」（单图）、「无预览直链不渲染」等单图/空态用例不回归。

## 验收

- tsc / lint / 全量 test 绿。
- 运行态核对（scratch 页，参照既有做法）：一个工具挂 5 张图 → 默认首图 + `+4` 角标；点击展开 5 张竖排 + 收起箭头；单图工具仍全尺寸常驻。明暗双主题角标可读。验证后删 scratch。
