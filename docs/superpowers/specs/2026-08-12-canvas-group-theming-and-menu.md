# 分组框:统一主题色 + 右键菜单

日期:2026-08-12
状态:已批准(两条决策由 Nick 逐条确认)
前置:`2026-08-05-canvas-groups`(分组功能本体)、`2026-08-12-canvas-ux-refinements`(决策 3 右键分流 / 决策 5 框体吃指针)

## 目的

实机反馈两条:

1. 分组的边框和 label 颜色不对 —— 现在按 `GROUP_COLORS` 五色轮换(image/video/audio/3d/text 的类型色),与全站「强调色只有品牌青」的令牌纪律冲突,画布上五颜六色的框读起来像是在表达资产类型。
2. 标题条上那个 14px 的删除(trash)图标按钮太小,不好点 —— 删除入口改由**分组右键菜单**承担。

## 约束

- 只动分组框自身的视觉与入口,不碰几何 / 归属判定 / 落库链路(`canvas-group.ts` 的包围盒与命中判定、`moveGroup` / `deleteGroup` 的乐观与撤销语义全部原样)。
- 颜色一律走 CSS 变量,不引入硬编码色值、不新增令牌(CLAUDE.md UI/UX 范式)。
- 菜单复用既有右键菜单的浮层外观与交互坑位(遮罩 `onWheel` 即关、`.anim-pop-in` + `origin-top-left`、`--color-pop` + `--shadow-popover`),不造第二种菜单形态。
- 不留 dead code:调色板整套删掉,不保留「渲染层不读但仍落库」的 `color` 字段。

## 决策

### 决策 1:所有分组框统一用品牌青 `--color-teal`

边框、label 文字、柔光底一律 teal 系,**删除** `GROUP_COLORS` 与 `nextGroupColor`,并把 `Group.color` 字段从前端类型 / 映射 / 建框请求里一并摘掉(后端字段仍在、存量值原样躺着,前端不读不写)。

理由:全站「选中 / 进度 / 高亮」一律品牌青,框是「用户圈出来的强调区域」,与这条纪律同类;类型色留给卡片表达资产类型,框借用会造成语义串台。

**连带:三态视觉要重新拉开距离。** 原先 drop 高亮靠「框色 → 借品牌青」来区分,统一青色后这条区分失效,改为按**边型 + 底色浓度**区分:

| 态 | 边框 | 底 |
|---|---|---|
| ~~常态~~ | ~~1px 实线 teal~~ | ~~`color-mix(teal 6%, transparent)`~~ |
| drop(有卡要进来) | 2px 实线 teal | `--color-teal-soft` |
| leave(有成员要出去) | 2px 虚线 teal + `opacity-50` | 同常态 |

三态仍只改颜色 / 边型 / 透明度,**不动几何**(高亮不该让框跳一下)。1px ↔ 2px 的切换是安全的:框体是 `absolute inset-0` + `border-box`,边框加粗向**内**生长,外沿位置不变 —— 现有 leave 态已经在用 `border-2`,同一条依据。

> **口径两次收窄(勿按本节旧文修回来)**:① `2026-08-13-group-a11y-and-menu-debts` 决策 1 把 label 文字从强调色改成中性色(浅色稿 1.85:1 → ≥7:1);② `2026-08-19-group-card-selection-polish` 问题 4 **去掉常态描边**(上表「常态」行已划掉),常态改半透明灰底 `color-mix(--color-fill 55%, transparent)`,强调色只留给 drop / leave 与选中(选中态改用卡片那套 1.5px primary-24% 描边 + `.node-beam`)。本决策的**内核仍有效**:框色不由数据驱动、不按资产类型轮换,`GROUP_COLORS` / `nextGroupColor` / `Group.color` 不复活。(另:本节写的 `teal` 是品牌换名前的令牌名,现全站为品牌橙 `--color-primary`。)

### 决策 2:分组右键菜单 = 重命名 + 删除框

- 触发区:**标题条 + 框体空白处**右键(两者都是分组自己的表面)。框内卡片上右键仍走卡片那条链路(单选贴卡浮窗 / 多选批量菜单),不变。
- 菜单两项:`重命名`、`删除框`。删除语义沿用现有 `deleteGroup`(拆框留卡 + 5s 撤销 Toast),不新增「连卡一起删」。
- 标题条上的 trash `IconButton` **移除**;双击标题条进入 inline 改名作为快捷方式**保留**。
- 重命名是**跨组件协调**(菜单在 `Workspace` 层,inline 输入框在 `GroupNode` 里),按项目范式走 store 字段 `groupRenameId`,不用 ref / 事件总线。

**顺带修一个既有 bug**:`AssetCanvas.onNodeContextMenu` 当前不分流节点类型,右键分组会拿 group id 去走 `contextTargetFor` → `selectAsset(gid)` + `openAssetDetail({ id: gid })`;浮窗因查不到资产而不渲染(表现为「右键分组毫无反应」),但 group id 已经被塞进 `selectedIds`,污染后续 ⌘A / 批量动作的选区口径。分流后这条路彻底断掉。

## 成功标准

1. 任意数量的分组框,边框与 label 恒为品牌青;深浅色主题下都清晰(青色恒定不随主题翻)。
2. 拖卡进 / 出框时,drop 与 leave 两态与常态肉眼可辨,且框的位置尺寸不发生任何跳动。
3. 在标题条或框内空白处右键 → 光标处弹出两项菜单;点「重命名」标题条进入 inline 编辑并全选文字;点「删除框」框消失、成员留在原位、Toast 给 5s 撤销。
4. 右键分组不再把 group id 写进 `selectedIds`,也不再打开资产细节浮窗。
5. 框内卡片上右键的行为与本次改动前完全一致。
6. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 已知缺口（评审确认、本次不修，留档）

三条都来自任务 2 的评审，逐条对照代码验证过，判定「代价 < 修的复杂度」或「属既有机制的必然代价」：

1. **乐观建框窗口内，`groupMenu.gid` / `groupRenameId` 不随 temp→real 换 id 重映射**：「圈成一组」后到 POST 回执落地之间右键该框，回执一到菜单会凭空消失（已进改名态则输入框消失、草稿无提交）。双击改名那条入口**存量就有**同一窗口（RF 按 node.id 做 key，id 一换即 remount，本地编辑态一样丢），不是本次回归。修点不在 `actions.ts` —— 那层的 `StoreSlice` 只有 `KoubouState & ServerState`、看不到 UIState，写不了这两个字段；要修得把 `realGid` 暴露给 UI 层，代价与收益不成比例（窗口是一次 POST 往返）。
2. ~~**手型工具 / 按住 ⌥ 时「框体空白右键」失效**~~：**已在 `2026-08-13-group-a11y-and-menu-debts` 决策 5 清掉** —— 不动 `pointer-events`（all-or-nothing，改回去会把平移 / 框选又抢走），改在 pane 上用既有 `groupHitFor` 按几何补判一次，右键与点选都兜住。
3. **滚轮平移把正在改名的框滑出视口会丢草稿，并留下悬空 `groupRenameId`**：`onlyRenderVisibleElements` 卸载节点，而 React 卸载不派发 blur ⟹ `onCommit` 不跑（拖拽平移会先 mousedown 让输入框失焦，正常提交；只有滚轮/触控板两指平移绕过失焦）。丢草稿是编辑态上提前就有的行为；新增的是滑回来时框自动重回编辑态（框名为原值、全选），无数据分歧。若要收：`GroupNameInput` 卸载时用 ref 读最新草稿兜底 commit，但得同时区分「取消导致的卸载」，否则 Esc 会被兜底成提交。

终审又补了两条留档（不阻塞合并）：

4. ~~**删框失去了唯一的键盘可达入口**~~：**已在 `2026-08-13-group-a11y-and-menu-debts` 决策 3 清掉**（Tab 聚焦给焦点环 + Enter/Space 选中 + Backspace 删）。附一条当时的事实更正：框节点其实**本来就在 Tab 序里**（RF 的 `nodesFocusable` 默认 true ⟹ wrapper 带 `tabIndex=0`），这里记的「不可聚焦」不准确；真正缺的只是「聚焦之后怎么成为操作目标」。
5. **本回合三个 fix/feat commit 的正文超出 CLAUDE.md 的「至多 3–5 行」**（8 / 10 / 7 行）：内容本身合规（只讲为什么与验证结论、无会话日志），超出的部分是真机复验清单与「哪几条不修」的指路。已提交不重写历史，记在这里；下回把复验清单压成一行。
6. ~~**光标菜单壳沿用了三处既有债**~~：三条（夹取进视口 / z 阶梯 / Esc 关闭）**已在 `2026-08-13-group-a11y-and-menu-debts` 决策 6 一次收掉**，两个菜单组件一行未改 —— 正是抽壳换来的那份收益。

## 明确不做

- 「改框色」能力(调色板 UI):删掉轮换后前端不再有色彩概念,要做是下一个需求。
- 菜单里的「选中框内全部卡」「连卡一起删」「折叠框」(`collapsed` 字段照旧不渲染)。
- 键盘快捷键(F2 改名 / Delete 删框):键盘层有独立的手势分派规则(`2026-08-11-keyboard-layer-guards`),不在本次顺手塞。
