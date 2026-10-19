# 对话内多资产预览：缩略图带设计

一次工具调用同时产出多种资产（图 / 视频 / 音频 / 3D）时，`ToolCard` 现在的「首项当封面 + `+N` 角标」折叠（设计稿 `2026-07-02-tool-media-fold-design`）暴露出三个问题。本设计把折叠换成**横向缩略图带 + 常驻展开位**。

## 现状与问题

`src/components/chat/ToolCard.tsx` 的 `MediaGroup`：

```ts
const renderable = items.filter((it) => it.previewUrl && it.kind !== '3d' && it.kind !== 'model3d');
```

1. **类型不可见**：≥2 项时只显示第一项，其余压成 `+N` 数字。用户看不出这一轮到底生成了几类资产、有没有音频。
2. **音频打头时布局塌陷**（实测 `getBoundingClientRect()` 为 `w:0,h:54`）：折叠按钮是 `w-fit block`，`<audio class="w-full">` 在其中算出 0 宽，音频控件完全不可见，`absolute bottom-2 right-2` 的 `+N` 角标随之漂到卡片左外侧。
3. **3D 被静默吞掉**：`renderable` 过滤掉 `3d/model3d`，既不渲染也不计入 `+N`——生成 3 个资产界面只体现 2 个，用户无从知道模型已产出。

## 目的

- 一眼看清这一轮产出了**几件、哪几类**资产；
- 保留「不点也能看到内容」的信息量（沿用现在首项直出的好处）；
- 修掉音频塌陷；3D 不再静默消失。

## 约束

- 只改对话呈现层，**不动协议层**（`MediaItem` 不加字段）、不动自动导入 / 画布链路。
- 零新增 i18n 文案（缩略图 `aria-label` 用文件名，类型名复用 `canvas.assetKind.*`）。
- 颜色 / 圆角 / 阴影 / 动效全走既有令牌与 `.anim-*` 类；不引入新按钮种类。
- 不在消息流里挂 `model-viewer`（3D 运行时成本高，模型细节以画布为准）。

## 成功标准

- 三类问题各有一条回归测试守住；
- 混合资产（图+视+音+3D）在一张卡里类型与数量都可见；
- 音频无论排第几都能正常播放；
- `pnpm lint` / `tsc --noEmit` / `vitest run` 全绿。

## 方案

### 展示分层

| 可展示项数 | 形态 |
|---|---|
| 0 | 不渲染（同现状，pill 保持胶囊） |
| 1 | 全尺寸内联常驻（**保持现状**） |
| ≥2 | 横向缩略图带（`flex-wrap`）+ 带下方常驻展开位，**默认选中首项** |

**可展示项** = 能拿到缩略图或可内联播放的项：`previewUrl` 存在（image/video/audio），或能反查到画布 poster（3D）。两者皆无的项不进带——不留点不开的死格。

### 缩略图来源（纯函数 `src/lib/chat/media-thumb.ts`）

```ts
export function mediaThumb(item: MediaItem, assets: readonly Asset[]): { kind: AssetKind; src?: string }
```

- `kind` = `mediaKindToAssetKind(item.kind)`（已有纯函数）。
- image → 直接用 `previewUrl`（图片本身即缩略图）。
- video / audio / 3D → `previewUrl` 是媒体流 / `.glb`，不能当图，按**文件名反查画布资产的 poster**（视频封面 / 模型快照）：
  `assets.find(a => basename(a.preview?.src ?? '') === basename(item.path))?.preview?.poster`。
- 反查不到 → `src` 缺省，由调用方回退**类型占位图** `generatingPlaceholderPath(kind)`（`public/assets/generating/{image,video,audio,3d}.jpg`，与画布生成卡同一套视觉）。该 helper 从 `GeneratingPlaceholder.tsx` 上移到 `lib/asset-kind.ts`（原处再导出，画布侧引用不变），避免对话层反向依赖画布组件。

> **为什么要反查画布**：工具结果契约（Apifox 8405123「Agent Task Status」）只有 `asset_path` / `asset_filename` / `status`，**没有缩略图字段**；koubou 的 `preview_url` 由 `preview_base` + `asset_path` 拼出，3D 指向的就是 `.glb` 本身。模型那张预览图是 PGC 在落画布时产出的 sidecar（`CanvasItemData.thumbnail_url`，实测 `xxx.preview.webp`），只在画布资产上有。故只能在前端按文件名 join。这是**值级启发式 join**（不是臆造后端字段）：命中不了就回退类型图标，永不报错；同名不同源的极端情况下命中的也是同名资产，可接受。
> 更干净的做法是后端在 `media.tasks.status` 的 item 上补 `thumbnail_url`，届时本函数可退化为直读字段。

### 缩略图带

- 每格 `size-16`（64px）方形，`rounded-[10px]`，`overflow-hidden`，底 `--color-fill`，描边 `--color-line-2`；选中格描边转 `--color-teal` + 柔光环（沿用画布选中语汇）。
- 格内恒是一张 `<img object-cover>`：真实缩略图优先，否则类型占位图。
- **右下角类型徽章**：`FigIcon` + 类型色 `KIND_META[kind].colorVar` 描边的小圆角贴片，图 / 视 / 音 / 3D 一眼可分。
- 每格是 `button`，`aria-label` = 文件名（`basename(item.path)`），`aria-pressed` 标选中；`motion-safe:active:scale-[0.92]` 沿用 `IconButton` 反馈。

### 展开位

- 常驻在带下方，渲染当前选中项：image → `<img max-h-48>`；video → `<video controls max-h-48>`；audio → **自绘迷你播放器**（独占整行，不再被 `w-fit` 挤成 0 宽）；3D → 模型快照大图（`max-h-48`），未就绪回退类型占位图。
- **音频控件不用原生 `<audio controls>`**（各浏览器样式不一、与设计语汇冲突）：把画布 `AudioNode` 里那套「播放/暂停 + 可 seek 波形 + 当前/总时长」抽成共享 `src/components/ui/AudioPlayer.tsx`，画布与对话共用（含「同一时刻只有一个播放器出声」的模块级锁）。外观差异由调用方经 `className`/`style` 决定：画布是类型色底，对话是 `--color-fill` 凹槽底 + `--color-line-2` 描边。
- 切换选中用 `.anim-media-in` 淡入（已有类，已在 `prefers-reduced-motion` 禁用列表内）。

### 不做

- 不做 lightbox / 全屏放大（画布已有 `MediaLightbox`，对话里的资产最终都落画布）。
- 不做横向滚动条：`flex-wrap` 换行即可，一轮产出通常 ≤6 件。
- 不改 `groupToolRuns`：带 media 的 pill 仍不参与同名合并。

## 单元边界

- `src/components/ui/AudioPlayer.tsx`:共享迷你播放器(画布 / 对话共用)。
- `src/lib/chat/media-thumb.ts`：纯函数，`(item, assets) → {kind, src?}`，单测覆盖四类来源与回退。
- `MediaGroup` / `MediaThumbCell` / `MediaItemView`：co-located 于 `ToolCard.tsx`，只管展示与本地选中态。
- `ToolCard` 主体、pill 头部折叠、diff / 参数逻辑不变。

## 测试（`ToolCard.test.tsx` 增改）

- 单项 → 全尺寸内联，无缩略图带（沿用现有用例，断言改为无 `+N`、无带）。
- 图+视+音 → 带里 3 格，默认展开首项。
- **音频排首位** → 音频控件出现在展开位且宽度非 0（回归 #2）。
- **含 3D 且画布有同名资产** → 带里出现 4 格、3D 格用 poster 图（回归 #3）。
- 含 3D 但画布查不到 → 3D 格回退 `3d.jpg` 类型占位图，仍在带里。
- 视频 / 音频格用各自的 `video.jpg` / `audio.jpg` 占位图。
- `AudioPlayer` 独立单测：隐藏 `<audio>` 无原生 `controls`、点播放调 `play()` 且按钮转 Pause、`m:ss` 时长、新播放器抢占时暂停旧的。
- 点击第 3 格 → 展开位切到该项。
- 无 `previewUrl` 且无 poster 的项 → 不进带。
