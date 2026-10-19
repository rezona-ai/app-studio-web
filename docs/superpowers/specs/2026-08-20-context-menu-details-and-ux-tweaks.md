# 卡片详情二级面板 + 三处 UI 收敛 — 设计稿

日期：2026-08-20
关联：`2026-08-12-canvas-ux-refinements.md`（本回合要**部分回退**它的决策 3）、`2026-08-09-lightbox-action-bar.md`（本回合要拆掉它依赖的翻页）、`2026-08-18-sidebar-toggle-entries.md`（预览常驻按钮，本回合据此撤把手）

## 目的

四件互相独立的 UI 收敛，共同的动机是**同一个动作只留一个入口、浮层之间不再互相争位**：

1. 「Download ZIP」从预览工具条迁进分享菜单，改名 **Export as ZIP** —— 「把游戏交出去」的动作已在分享菜单里聚齐（Share Game / Workbench / Rezona / Export as APK），工具条上再留一个是同类动作的第二个落点。
2. 撤掉**预览侧**的折叠把手 —— `2026-08-18-sidebar-toggle-entries` 给这个动作补了常驻按钮后，hover 才浮现的把手成了同一动作的第二个入口。（**对话栏那侧的把手保留**：它收起后没有栏可 hover，常显把手是唯一回路。）
3. 单选右键从「细节 + 动作合成一个贴卡浮窗」改回**菜单形态**，细节降级为菜单内的 **Details 二级面板**（hover 即展开）。
4. 资产预览（lightbox）**去掉翻页**，底部动作条改**不透明底**。

## 盘问结论

| 分叉 | 结论 | 否掉的选项与理由 |
|---|---|---|
| Details 二级面板的开合模型 | **hover 即开，且指针可移进面板操作**（复制提示词 / 血缘跳转 / Edit and retry）。离开「菜单项 ∪ 面板」后延迟 200ms 收起 | 「hover 只做只读预览、点击才钉住」要用户点两次才用得上 retry，且「hover 出来的东西点不了」本身反直觉；「面板纯只读、retry 上移进菜单」与演示图不符（图里 retry 在面板内） |
| 旧贴卡浮窗（`store.assetDetail`）的去向 | **整体退役**。`AssetDetailPopover` + `assetDetail` 字段一并删除；单选右键与资产列表行右键**统一**开新菜单 | 「两套并存」是 CLAUDE.md 明列的反模式（堆叠废弃机制），且两处动作清单会双轨；「面板仍贴卡、跟画布平移」要维持两套锚点（菜单在光标、面板在卡），两者会互相重叠，也与演示图的「紧贴菜单右侧」不符 |
| 已接受的代价 | 失去「浮窗跟着卡片平移 / 缩放走」这个特性 | 菜单是光标锚点，滚轮即关（既有遮罩行为），跟手需求随之消失 |
| Export as ZIP 的在飞反馈 | **菜单项就地转圈**：点击不关菜单，该项禁用 + spinner + `aria-busy`，拉完自动关菜单；失败仍由既有 `guard` → Toast | 「点即关 + 成功 Toast」在拉包那几秒完全无反馈，用户会重开菜单再点一次（要另加在飞守卫）；「点即关且无提示」直接丢掉现有的在飞反馈 |
| 去掉翻页后「窗内删除」停在哪 | **关窗**。没有序列就没有「下一张」 | 这不是选择题：`nextAfterDelete` 的整个语义（下一张 → 上一张 → 关窗）建立在可翻页序列上，序列去掉后只剩关窗一种结果 |
| 动作条不透明底怎么做 | **整条收进一个 pill 容器**：`bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]`，圆角 `rounded-[16px]`；容器内按钮转为透明底 + `hover:bg-[var(--color-fill)]`，图标 `tone="primary"`（随 `--color-ink` 翻转） | 「每个按钮各自不透明圆底」仍是三块孤立的浮片，与画布菜单同屏时照样读不出层级；沿用现在的 `white/10 + 白图标`（为黑遮罩手调的一次性色值）与「颜色一律走 CSS 变量」相悖 |
| Details 的图标 | **新画 `info.svg`**（圆 + 竖条 + 点），登记进 `figAsset`，不登记 `ICON_TONE`（默认 primary，随容器翻转） | 库里没有 info；`question` 是「帮助」语义；`adjustments` 已被生成面板高级设置占用；演示图里 Details 与 Use as reference 共用 `@` 显然是画稿时的占位重复 |
| 二级面板的展开箭头 | 复用 `chevronRight`（已登记 `secondary`，恒灰） | 不新画箭头；灰度正对应演示图里那个不抢眼的 `>` |

## 单选菜单的形状

顺序即演示图顺序。**Details 恒在首位**，其余四项复用既有纯函数 `singleAssetActions(asset)` —— 判据（能否 @引用 / 能否下载）不在此处重写。

```
┌──────────────────┐┌────────────────────┐
│ ⓘ Details      > ││ bg_forest.png  Image
│ @ Use as reference││ PROMPT        [copy]
│ ✎ Rename         ││ MODEL & PARAMETERS  
│ ↓ Download       ││ SOURCE              
│ 🗑 Delete         ││ [ ⟳ Edit and retry ]
└──────────────────┘└────────────────────┘
```

- **多选菜单不变**：Details 是单张卡的属性，多选没有「这张卡是怎么来的」。
- 分流判据：`ids.length === 1 && gids.length === 0` → 单选分支，否则维持现有选区分支。「恰好选中一张时右键」于是也走单选分支 —— 与今天等价（今天这种情形开的正是贴卡浮窗），不是回归。
- 面板正文继续用 `AssetDetailBody` 的 `SingleAsset`，**外壳换了、正文不动**（这正是它当初被抽出来的理由）。`SingleAsset` 内部原先直接调 `openAssetDetail(null)` 收浮窗，改为接 `onClose` prop —— 正文不该知道自己被谁装着。

## 二级面板的落位与收起

- 几何复用 `placeBesideRect(anchor, size, bounds)`：锚点矩形 = **菜单盒自身的 client rect**，故优先贴右、右侧不够则翻到左侧、两侧都不够则夹进视口。不新写几何。
- 垂直方向与菜单顶边对齐（`placeBesideRect` 既有语义），不与 Details 那一行对齐 —— 面板高度远大于行高，对齐行会在视口下半屏频繁触发夹取。
- 面板高度实测（`ResizeObserver`）后参与夹取，沿用 `AssetDetailPopover` / `ContextMenuShell` 已有的量法；`max-h` + 内滚兜住超长内容。
- **面板渲染在菜单盒之外，悬停意图显式接线**（实现期修正了本设计稿的原方案）。原打算把面板作为 Details 行的 DOM 子节点，靠「子树内不触发 `pointerleave`」省掉桥接；实际不可行 —— 菜单盒是 `overflow-hidden` 且 `anim-pop-in` 期带 `transform`，而 `transform` 会让 `fixed` 子节点以菜单盒为包含块，于是被它的 overflow 裁掉。故面板挂在盒外、自己 `fixed` 定位，壳把 `onPointerEnter` / `onPointerLeave` 显式交给它。跨越 8px 间隙那一瞬由 200ms 延迟吸收，不需要桥接元素。
- **延迟收起用 state + effect，不用定时器 ref**：面板不是 DOM 子节点 ⟹ 那两个回调要在**渲染期**交给面板，而渲染期传一个读 `ref.current` 的函数会被 `reactCompiler` 的 lint 判成「渲染期访问 ref」。换成 `leaving` state 之后，取消与卸载清理都由 effect 的 cleanup 统一承担。
- 行按钮的宽度靠 `w-full` 自己撑，**不靠父级 `align-items: stretch`** —— 带面板的行外面包了一层 div 接 `pointerLeave`，按钮不再是列的直接 flex 子项，`self-stretch` 失效，而 `<button>` 的 `width:auto` 是内蕴收缩（那一行会比别人窄一截）。
- 关闭路径：指针离开容器 200ms 后收；菜单关闭时随之消失；Esc / 点遮罩 / 滚轮由 `ContextMenuShell` 既有逻辑一次关掉整个菜单。

## 约束

1. **不新造浮层范式**：二级面板与菜单同一套外观令牌（`--color-pop` + `shadow-popover` + `backdrop-blur`），进场用 `.anim-pop-in`，`origin-*` 从菜单侧缩放。
2. **`ContextMenuShell` 保持被两个菜单共用**：子面板能力以 `MenuItem` 上的**可选**字段引入（`submenu?: ReactNode`），分组框菜单不传即完全无感。几何/夹取仍归壳（它已经持有菜单盒的 rect 与视口夹取逻辑）。
3. **删净不留残**：`AssetDetailPopover.tsx`（含其测试）、`store` 的 `assetDetail` / `openAssetDetail` / `AssetDetailTarget`、`canvas-keys` 的 `assetDetail` 字段、`lib/lightbox-nav.ts`（含其测试）、i18n 的 `canvas.lightboxPrev/Next/Position`、`MediaLightbox` 的 `navList` prop 一并移除。
4. **`canvas-keys` 的键盘归属不变弱**：`assetDetail` 字段去掉后，「有浮层开着」仍由 `contextMenu != null` 覆盖单选右键这条路径（今天单选开的是 assetDetail，明天开的是 contextMenu，判定不留空档）。
5. `Export as ZIP` 放在分享菜单**分隔线之下、`Export as APK` 之上**（两者同为导出，ZIP 是默认形态故居前）。文案复用既有 `preview.downloadZip`？**否** —— 新增 `preview.fileMenu.exportZip`（"Export as ZIP"）覆盖 11 语；`preview.downloadZip` / `preview.downloading` 随工具条按钮一并退役。
6. 撤把手只删预览侧那一处 `<EdgeHandle>` 调用，`EdgeHandle` 组件与 `lib/edge-handle.ts`（含镜像单测）**原样保留**给对话栏侧。
7. lightbox 去翻页后 `←/→` 键不再被消费（Esc / Delete 保留）；`previewableAssets` 随 `lightbox-nav.ts` 一起删 —— 它今天只服务翻页。

## 成功标准

1. 分享菜单里有 Export as ZIP，点击就地转圈、拉完自动关菜单；预览工具条上不再有下载按钮。
2. 预览面板左缘不再浮现把手；tab 行那个全宽 / 恢复按钮功能不变。
3. 单选右键出现菜单（Details + 4 项），hover Details 即在右侧展开细节面板；指针可移入面板点复制 / 血缘 / Edit and retry；移开 200ms 后面板收起，菜单仍在。
4. 资产列表行右键开同一个菜单。
5. lightbox 无左右翻页箭头、无「2 / 3」指示，`←/→` 不再翻页；窗内删除后直接关窗。
6. lightbox 底部动作条是一条不透明 pill，浅/深主题各自读得清，与画布菜单同屏时层级分明。
7. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` 全绿。
8. 上述遗留项均已在下表登记，不靠记忆传递。

## 已知遗留（评审记录，本回合不修）

| 编号 | 事实 | 为什么不在本回合修 |
|---|---|---|
| M-2 | 视口窄于 **876px** 且菜单落在 `300 < menuLeft < W-576` 区间时，`placeBesideRect` 两侧都装不下 → 夹取后二级面板近乎完全覆盖菜单本体（面板 280 宽 / 菜单 276 宽，夹取后最多只差 4px）。此时指针落在被覆盖的 Details 行上，面板的 `pointerEnter` 会 `cancelClose`，面板赖住 | 要修得加一条「两侧都不行就改放下方」的落位分支 —— 新几何 + 新单测，不属本回合范围。用户仍可 Esc / 滚轮关掉整个菜单，不是死路；且本项目是固定桌面布局（无移动端断点），876px 以下三栏本已很挤 |
| M-5 | lightbox 的**关闭钮**仍是 `bg-white/10 text-white`（为黑遮罩手调的一次性色值）。动作条改成令牌 pill 后，同一浮层里出现「一条不透明浅色 pill + 一枚半透明白圆」 | 违反「颜色一律走 CSS 变量」在本回合**之前**就存在；一并收口会扩大到需求没点到的元素。待 Nick 确认后单独处理 |
| M-8 尾 | `LineageLink` 跳转后 `setSelection` 换成源卡，而菜单的 `ids` 仍指向原卡（Delete / Rename 作用于原卡）；菜单 + 面板浮在原光标处，可能压住刚居中的目标 | 语义分歧在旧贴卡浮窗时代就存在，非本回合引入；菜单形态只是让它更显眼 |
| M-9 尾 | `groupMenu` / `groupRenameId` 在**回放期**切项目同样不清（本回合只给 `selectProject` 补了 `contextMenu`） | 早于本回合的既有缺口。这次只补回「旧贴卡浮窗曾覆盖、被本次重构丢掉」的那一条 |
