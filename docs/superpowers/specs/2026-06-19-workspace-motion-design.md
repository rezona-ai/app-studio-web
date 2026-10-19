# Workspace 交互动效优化设计稿

> 日期:2026-06-19
> 范围:workspace 三栏(Chat / Canvas / Preview)及共享 UI 的微交互动效补全
> 状态:待 Nick 评审

## 一、背景与目标

当前 workspace 页面的交互元素大多是「瞬现 / 瞬变 / 无反馈」:对话输入框聚焦无视觉变化、Tooltip 气泡直接出现、画布双击/右键菜单瞬现、Toast 瞬现瞬消、各类下拉弹层无进场……页面整体偏静态,缺乏「生动」的质感。

项目**已有一套不错的动效基础设施**(纯 CSS,无任何动画库):画布选中流光 `node-beam`、连线流光 `edge-beam`、生成骨架微光 `skeleton-shimmer`、搜索框聚焦旋转渐变 `.canvas-search-bar`、入口页 `game-modal` / `prompt-box`。本设计**沿用同一套技术路线**,把缺失的微交互补齐。

**目标**:在不引入任何动画库的前提下,用一套**统一、克制、可降级**的动效语汇,补全 workspace 上「瞬现/瞬变」的交互反馈。

**调性(已与 Nick 确认)**:克制利落。150–200ms 为主,以淡入 / 微位移(2–8px) / 微缩放(0.96–1) / 焦点光晕为手段,几乎无感但更顺滑;**不**上旋转流光那类强表现力效果(那是画布选中/搜索框的既有专属语汇,不外扩)。

## 二、设计原则与约束

1. **纯 CSS,零新依赖**。keyframes / transition + 状态类切换;复杂卸载时机用极小的自写 hook,不引入 framer-motion。
2. **合成属性优先**。只动 `transform`(translate/scale)与 `opacity`;避免 `width/height/top/left/padding` 触发重排(展开折叠的高度过渡用 `max-height` + `overflow:hidden` 例外处理)。
3. **必带 `prefers-reduced-motion: reduce` 降级**。每条新动画都要有降级分支:退化为「无位移无缩放」的纯淡入,或直接瞬现。沿用 globals.css 既有写法。
4. **复用既有样板**。模态进出场复用 `game-modal-*` 那套(上浮缩放 + `data-closing` 延时卸载);按压/hover 复用 `motion-safe:` + `active:` 模式(参考 landing `GameCard`)。
5. **不破坏既有不变式**。画布节点坐标归前端所有 —— 动效**不得**干扰 xyflow 的最终 position(只用 transform 叠加,不动真实坐标);Workspace overlay 既有 `transition-[width]` 在拖拽期间关闭的逻辑保留。
6. **尊重后端契约**。本次纯前端视觉,不触碰任何协议 / store 数据流。

## 三、统一动效语汇

### 3.1 时长 / 缓动 token(口径统一,不必落成 CSS 变量)

| 用途 | 时长 | 缓动 |
|---|---|---|
| hover / press 微反馈 | 150ms | `ease-out` |
| 弹层/菜单/Tooltip 进场(pop-in) | 150ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| 输入框聚焦光晕 | 180ms | `ease` |
| 交叉淡入(占位卡→资产、预览切换) | 200ms | `ease` |
| Toast 进场 / 退场 | 200ms / 160ms | `ease-out` / `ease-in` |
| 模态进场 / 退场 | 复用 game-modal(320ms / 170ms) | 复用 game-modal |

### 3.2 共享 keyframe / 工具类(新增到 `globals.css`)

```css
/* 统一弹层进场:微缩放 + 上浮 + 淡入。transform-origin 由使用处按触发点指定 */
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}
.anim-pop-in { animation: pop-in 150ms cubic-bezier(0.22, 1, 0.36, 1) both; }

/* Toast:顶部下滑淡入 / 对称退场 */
@keyframes toast-in  { from { opacity: 0; transform: translateY(-8px); } to   { opacity: 1; transform: translateY(0); } }
@keyframes toast-out { from { opacity: 1; transform: translateY(0); }    to   { opacity: 0; transform: translateY(-8px); } }

@media (prefers-reduced-motion: reduce) {
  .anim-pop-in { animation: none; }
  /* Toast 等退化为纯淡入/瞬现,见各分项 */
}
```

> `transform-origin` 的处理:对 **left/top 定位、自身无 transform** 的弹层(双击/右键菜单、ProjectMenu、Select 下拉、RefPicker、参数 pill 弹层、ZoomBar),直接对元素本体加 `.anim-pop-in`,并按触发位置设 `transform-origin`(如菜单锚定左上 → `origin-top-left`)。

### 3.3 「定位 transform」与「动画 transform」的冲突处理

部分元素已用 `transform` 做定位(Tooltip 的 `translateY(-100% - 8px)` placement、Toast 的 `-translate-x-1/2` 水平居中),直接对其加动画 transform 会互相覆盖。统一解法:**外层负责定位(含定位 transform),内层负责进出场动画**。

- **Tooltip**:外层 `span` 维持 `position:fixed; top; left; transform:<placement>`;新增内层 `span` 承载进场(opacity + 轻微 translateY + 可选 scale)。clamp 宽度的 `useLayoutEffect` 仍作用于外层。
- **Toast**:外层容器维持 `fixed top-4 left-1/2 -translate-x-1/2`(定位);内层卡片承载 `toast-in` / `toast-out`(translateY + opacity)。

### 3.4 退场卸载 hook(新增 `src/client/useExitTransition.ts`)

Toast 与新增模态需要「退场动画播完再卸载」。抽一个极小 hook 统一(语义同 `GamePreviewModal` 现有的 `data-closing` + `CLOSE_MS` 内联逻辑):

```ts
// open 变 false 时,先置 closing,延时 ms 后才真正卸载
function useExitTransition(open: boolean, ms: number): { mounted: boolean; closing: boolean };
```

返回 `{ mounted, closing }`:`mounted` 控制是否渲染,`closing` 透传到 `data-closing` 触发退场动画。降级偏好下 `ms` 视为 0(瞬卸)。`GamePreviewModal` 可选后续收敛到此 hook(非本次必须)。

## 四、分项规格

> 现状均指「无进/出/聚焦动画」,除非另注。所有项默认带 reduced-motion 降级,不再逐条赘述。

### Tier 1 — 高频微交互

**1. Composer 输入框聚焦**(`chat/Composer.tsx`)
- 现状:`textarea` `outline:none`,外层卡片仅静态 `--shadow-prompt`,聚焦零反馈。
- 方案:外层卡片 `focus-within` 时,边框 `--color-line` → `--color-accent`,叠加 `0 0 0 3px var(--color-accent-soft)` 聚焦环(与既有 `--shadow-prompt` 多层并存);`transition: border-color, box-shadow 180ms ease`。**不上浮、不旋转**。失焦平滑还原。
- 实现:新增 `.composer-focus` 类(或等价 Tailwind `focus-within:` + transition),挂在卡片容器。
- 降级:仅切换边框色 + 静态光晕,无 transition。

**2. Tooltip 进场**(`ui/Tooltip.tsx`)
- 现状:`createPortal` 瞬现。
- 方案:按 3.3 拆内外层。内层挂 `pop-in` 变体 —— `opacity 0→1` + 朝触发元素方向 `translateY(±2px)→0`(top 气泡从下往上、bottom 气泡从上往下)+ 可选 `scale(0.98)→1`,~140ms ease-out。**仅进场**;滚动/滚轮/按下时维持现有瞬隐(无退场)。
- 降级:纯 opacity 淡入或瞬现。

**3. 双击菜单 + 右键菜单 进场**(`canvas/AddAssetMenu.tsx`、`canvas/ContextMenu.tsx`)
- 现状:两者均 `fixed` 瞬现。
- 方案:菜单本体加 `.anim-pop-in`,`transform-origin` 取左上(贴近触发点 = 用户双击/右键位置)。**仅进场**(关闭跟随卸载,瞬闭可接受,符合系统菜单惯例)。
- 降级:`animation:none`,瞬现。

**4. Toast 进出场**(`ui/Toast.tsx`)
- 现状:条件渲染瞬现;4s 后 `setError(null)` 瞬消。
- 方案:用 `useExitTransition` 拆 `mounted/closing`;按 3.3 外层定位、内层动画。进场 `toast-in`(200ms ease-out),退场 `toast-out`(160ms ease-in,`data-closing` 触发)。自动消失也走退场。
- 降级:进场纯淡入、退场瞬卸。

**5. 下拉 / 弹层统一进场**(共用 `.anim-pop-in`,仅进场)
- 适用:`ui/Select.tsx` 下拉(`ModelSelector` 若基于 Select 则一并受益)、`chat/ProjectMenu.tsx` 菜单、`chat/MentionPopover.tsx`、`canvas/RefPicker.tsx`、`canvas/GenParamControls.tsx` 的 ParamPill / AdvancedPill 弹层、`canvas/AssetCanvas.tsx` 的 ZoomBar。
- 方案:各弹层挂 `.anim-pop-in`,按其展开方向设 `transform-origin`(向下展开→顶部,向上展开→底部)。
- 附带:`Select` 触发器 chevron 已有 `rotate-180`,补 `transition-transform 150ms`(归入 Tier 3 #15,但与此项同文件,可一并改)。

### Tier 2 — 弹窗 & 内容切换

**6. 模态进出场**(`canvas/GenerateForm.tsx`、`canvas/RenameAssetModal.tsx`、`chat/CreateGameModal.tsx`、`canvas/MediaLightbox.tsx`)
- 现状:遮罩 + 面板瞬现/瞬消。
- 方案:复用 `game-modal-backdrop` / `game-modal-panel` 的进出场 keyframe 思路(背景淡入、面板上浮微缩放,`data-closing` 退场),用 `useExitTransition` 管卸载。`GenerateForm` 有「按触发点锚定」的非居中场景 —— 该情形 `transform-origin` 取锚点,居中场景保持中心。
- 降级:遮罩瞬现、面板无位移无缩放(辉光/阴影保留)。

**7. 占位卡 → 真实资产 交叉淡入**(`canvas/nodes/ImageNode.tsx`、`VideoNode.tsx`、`AudioNode.tsx`、`ThreeDNode.tsx`)
- 现状:生成完成后占位体直接被真实内容替换,视觉跳跃。
- 方案:占位体与真实内容**并行渲染、绝对叠放**;以 `ready` 标志(图片/视频 `onLoad`、3D `model-viewer` load、音频可播)驱动 `opacity` 交叉过渡(占位 1→0,真实 0→1,200ms)。真实内容**加载完成**才淡入,避免「占位先消失、真图还没到」的空窗。
- 要点:不改 xyflow 节点尺寸/坐标;仅节点内部 body 层做叠放淡入。
- 降级:直接切换(无淡入)。

**8. 预览内容切换 / overlay 淡入 / LoadingScreen 淡出**(`preview/PreviewPanel.tsx`、`workspace/Workspace.tsx`、`ui/LoadingScreen.tsx`)
- 现状:`GameFrame` ↔ `CompareView`(key 重建)硬切换;overlay 仅宽度过渡;LoadingScreen 显隐无过渡。
- 方案:
  - GameFrame↔CompareView:外层容器加 `transition-opacity 200ms`,切换时旧淡出→新淡入(或仅新内容淡入)。
  - overlay 打开:在既有 `transition-[width]` 基础上补 `opacity` 淡入(拖拽期间仍关闭过渡,保留既有逻辑)。
  - LoadingScreen:Workspace 控制其显隐时加淡出(`data-closing` / opacity 200ms)。
- 注意:`GameFrame` 既有 iframe 加载完成淡入(`transition-opacity 300ms`)保留,不冲突。
- 降级:瞬切。

**9. 节点 / 连线 出现·消失淡入淡出**(`canvas/nodes/NodeCard.tsx`、`canvas/FlowEdge.tsx`)
- 现状:节点新增 / 删除、连线新增 / 删除均瞬现瞬消。
- 方案:节点卡片首次挂载 `opacity 0→1`(+ 极轻 `scale 0.98→1`)150ms;连线 `edge-beam` 路径首帧 `opacity 0→1` 渐显。删除淡出**视成本决定**(xyflow 删除即卸载,做退场需拦截,**本项删除淡出列为可选**,优先只做出现淡入)。
- 注意:不与 `node-beam` 选中流光冲突;不动坐标。
- 降级:瞬现。

### Tier 3 — 质感细节

**10. 按钮按压微反馈**(`ui/Button.tsx`、`ui/IconButton.tsx`)
- 方案:补 `transition-[transform,filter,background-color] 150ms ease-out` + `motion-safe:active:scale-[0.96]`(IconButton 可 `0.92`)。`disabled` 透明度切换补 `transition-opacity`。
- 降级:`motion-safe:` 前缀天然不触发缩放。

**11. Segmented 选中滑块平移**(`ui/Segmented.tsx`)
- 现状:选中态直接背景反转。
- 方案:绝对定位滑块(thumb,宽 = 100%/N),`transition-[transform] 200ms`,选中时 `translateX` 到对应档位;文字 `transition-colors`。
- 降级:取消滑块平移,直接背景切换。

**12. NodeCard 选中时「+」按钮浮出 + hover 微抬升**(`canvas/nodes/NodeCard.tsx`)
- 方案:选中时右侧「+」按钮 `opacity 0→1` + `translateX(8px→0)`(或 `scale 0→1` origin-right)150ms;未选中节点 hover 时 `shadow` 微增强或 `translateY(-1px)` 微抬,150ms。
- 降级:瞬现 / 无抬升。

**13. ToolCard 展开 / 折叠高度过渡**(`chat/ToolCard.tsx`、`chat/DiffView.tsx`)
- 现状:`open` 切换后内容直接显隐。
- 方案:内容容器 `max-height 0 ↔ 足量` + `overflow:hidden` + `opacity`,200ms ease-out。
- 注意:`max-height` 取够大的上界;流式期间避免频繁触发。
- 降级:瞬显隐。

**14. 版本卡片选中 glow + hover、Compare 按钮启用反馈**(`preview/VersionTimeline.tsx`)
- 方案:卡片 `transition-[border-color,box-shadow] 200ms`,选中/对比选中时加轻微蓝色 glow(`0 0 12px rgba(53,130,255,0.2)`);卡片 hover `bg` 过渡;Compare 按钮 disabled→enabled 补 `transition`。
- 降级:静态选中态,无 glow/过渡。

**15. chevron 旋转过渡 + KindLegend 切换节点显隐**(`ui/Select.tsx`、`canvas/KindLegend.tsx`、`canvas/AssetCanvas.tsx`)
- 方案:Select chevron 补 `transition-transform 150ms`(同 #5 文件);KindLegend 切换 `visibleKinds` 时,被隐/显的画布节点做 `opacity` + 极轻 `scale` 过渡(150ms),复用 AssetCanvas 既有搜索高亮的过渡通道,注意与拖拽防护(`isDraggingRef`)不冲突。
- 降级:瞬切。

## 五、明确不做(out of scope)

- **对话消息「到达淡入上移」、附件 / @mention chip「逐个 stagger 入场」、审批 / 问卷卡「stagger 入场」**:流式期间频繁重渲易抖动、列表 key 复用风险高。若将来要做,只做最克制的纯 opacity 淡入,且需单独评估。
- **画布节点拖拽「回弹」动画**:与「坐标归前端所有」的不变式冲突,放弃。
- **DeviceToggle 原生 `<select>` 动效、Badge 显隐动画**:边际过低,跳过。
- **节点 / 连线删除退场**(#9 的删除分支):成本高,默认不做,仅保留「出现淡入」。

## 六、测试策略

- 动效主体是 CSS,**不写视觉断言**(无意义且脆)。
- **有逻辑改动的部分写单测**(同目录 `*.test.ts(x)`,Vitest + jsdom):
  - `useExitTransition`:`open` 切换时 `mounted/closing` 的时序(用假定时器)、reduced-motion 下 `ms→0`。
  - `Toast`:退场期间仍 `mounted`、`closing` 为真;延时后卸载。
  - 节点 `ready` 交叉淡入:`onLoad` 前后 `opacity` 类切换(断言 class,不断言动画)。
- 全量 `pnpm exec tsc --noEmit` + `pnpm lint` + `pnpm test` 通过。
- **人工核验**:逐项在浏览器看进/出/聚焦是否顺滑;开 `prefers-reduced-motion` 验证降级。

## 七、实施顺序(按 Tier 分批,每批可独立提交)

1. **基建**:globals.css 加 `pop-in` / `toast-in/out` + reduced-motion 分支;新增 `useExitTransition` hook(含测试)。
2. **Tier 1**:Composer 聚焦 → Tooltip → 双击/右键菜单 → Toast → 下拉/弹层统一进场。
3. **Tier 2**:模态进出场 → 占位卡交叉淡入 → 预览切换/overlay/LoadingScreen → 节点/连线出现淡入。
4. **Tier 3**:按钮按压 → Segmented 滑块 → NodeCard「+」/hover → ToolCard 展开 → 版本卡片 → chevron/KindLegend。

每批遵循「先看现状 → 改 → tsc/lint/test → 人工核验 → 中文 commit(`feat:` / 必要时 `docs:`)」。
