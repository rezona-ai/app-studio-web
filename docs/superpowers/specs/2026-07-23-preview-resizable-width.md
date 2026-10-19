# 右边栏可拖拽调宽 + 游戏预览完全自适应

日期：2026-07-23

## 目的

右边栏（Preview 面板）当前宽度由「游戏竖屏比例 282:519 × 舞台可用高」反推（`computePreviewWidth`），用户不可调。改为：

1. 右边栏宽度由用户拖拽自由调整（同 Chat 列的分隔条交互），宽度持久化。
2. 游戏预览在舞台内 **contain 自适应**：宽高不匹配比例时留边，不再反过来驱动面板宽。
3. 保留当前最小宽度 `330px`（`PREVIEW_WIDTH_MIN`），既是拖拽下限也是账户条不截断的硬底。

## 现状（将被替换的机制）

- `GameFrame` 用 ResizeObserver 测舞台高 → `computePreviewWidth` → store `previewWidth` → `Workspace` 据此定 spacer / overlay 宽。
- `PreviewPanel` 测可用高 → `computePreviewBlockHeight` 给预览块显式高，短屏「借」版本区高度以填满 MIN 宽消黑边。
- 这两条链的存在理由都是「面板宽必须精确等于游戏渲染宽」。改为用户自由调宽后整链失效，按仓库反模式约定（不堆叠废弃机制）整体删除。

## 方案

- **Workspace**：仿 Chat 列，在画布与预览 spacer 之间加一条可拖拽分隔条；`previewW` 为组件本地 state，落 `localStorage('workspace.previewWidth')`。向左拖增宽。夹取范围 `[330, 800]`。compare / Files tab 仍覆盖为 `calc(100% - chatW)` 全宽，不受影响。
- **GameFrame**：现有 `FRAME_SIZE = min(100%, 100cqh×282/519) + aspectRatio` 本身就是 contain 适配，保留；删除测高上报逻辑。
- **PreviewPanel**：删除可用高测量与 `computePreviewBlockHeight` 分支，回到固定 `flex-[7]`（预览块）: `flex-[3]`（版本区）。
- **store**：删除 `previewWidth` / `setPreviewWidth`（瞬态，无持久化迁移问题）。
- **lib/preview-width.ts**：精简为拖拽常量 + `clampPreviewW` 纯函数（单测）；删除 `computePreviewWidth` / `computePreviewBlockHeight` 及相关常量。

## 取舍

- 上限取 800（与 Chat 列一致）而非旧 `PREVIEW_WIDTH_MAX=520`：自由调宽的语义下 520 过紧；画布列 `flex-1 min-w-0` 自然吸收。
- 不做「双栏联动夹取」（chat + preview 超过视口）：两栏上限合计 1600，小于常见工作区视口才会出问题，YAGNI，出现时再夹。

## 成功标准

- 分隔条可拖动右栏宽度，刷新后保持；最小 330、最大 800。
- 游戏预览在任意面板宽下 contain 居中显示，无溢出。
- `previewWidth` 机制在 src 内无残留引用；lint / tsc / test / build 全绿。

## 迭代(同日)

1. **拖拽上限动态化**:固定 800 改为「视口宽 − Chat 列(含分隔条)− 画布保底宽 `CANVAS_WIDTH_MIN=320`」,预览可扩到几乎盖满画布;`clampPreviewW(w, max)` 双参化,极窄视口下 MIN 优先。
2. **预览不再区分移动/桌面**:默认生成的游戏即桌面端,GameFrame / CompareView 删除 282:519 竖屏定比例,iframe 铺满舞台(对比视图各占半宽、全高)。

## 迭代二(2026-07-24):完全覆盖 + 画布滚动兜底

- 画布最小可用宽定为 `CANVAS_WIDTH_MIN=520`(顶部搜索栏 484 + 两侧 16 边距,底部工具条约 350 更窄),保证全部覆盖组件完整展示。
- 预览拖拽上限放开为「视口宽 − Chat 列」:可完全盖住画布(同 Files tab 的全宽覆盖形态)。
- 画布列改为 `overflow-x-auto` 容器 + 内层 `min-width:520px`:被挤压到最小宽以下时横向滚动展示,组件不再被压坏。
- 迭代三:画布顶部搜索栏 `w-[484px]` 改百分比 `w-[70%]`,484px(设计稿宽)转为 `max-w` 上限——画布被挤窄时搜索栏跟随收窄。
- 迭代四:Chat 列拖拽加对称动态上限「视口 − 预览列 − 2px 分隔条」——右栏拖满后左栏不可再越过右栏(此前两栏合计可超视口)。
- 迭代五:单预览框去掉 py-2 边距与 10px 圆角,满幅方角严格贴合容器(圆角 FRAME 仅对比视图保留)。
- 迭代六:预览面板左边缘加一键全宽/恢复把手——紧贴边缘的圆角梯形长条(clip-path,无边框),默认隐藏、鼠标进入边缘热区淡入(显现无延迟,隐藏延迟 300ms 淡出),全宽前记忆当前宽,箭头指示方向,compare/Files 下不渲染。
- 迭代七:全宽会让满幅 iframe 里的 16:9 游戏横向拉伸失真——上限改按比例反推 `maxPreviewWidth = min(舞台高×16/9, 视口−Chat−2)`,舞台高 = (视口高−账户条52)×0.7−tab行48;把手语义从「全宽」改为「最大宽度」。
- 迭代八:下限也按比例反推——`minPreviewWidth = max(330, 舞台高×282/519)`(282:519 为改版前移动预览框比例),拖到最窄时舞台呈手机竖屏形状,模拟移动端显示效果;330 仍为账户条硬底。
- 迭代九:spacer 补上与 overlay 相同的 300ms 宽度过渡——把手一键展开/恢复时二者同步动画,修掉过渡期 spacer 瞬跳露出页面底色的灰块。
