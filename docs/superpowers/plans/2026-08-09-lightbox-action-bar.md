# 实现计划：Lightbox 底部动作条

对应 spec：`docs/superpowers/specs/2026-08-09-lightbox-action-bar.md` · 分支 `feat/lightbox-action-bar`（基于 `dev` @ `fce05439`）

## 任务拆分原则

按「**纯逻辑 → store → UI**」推进，每个任务一个提交、可独立测试、可独立评审。
纯逻辑先行不是形式：删除后的焦点推进与位置指示都是能被表驱动穷举的函数，
放进组件就只能靠渲染断言间接验证。

**键盘让位那条（任务 3）单独成一个提交**，因为它改的是**既有**行为，
风险与「新加一个按钮」完全不同 —— 它写反了就是无声删错卡。

## 任务

### 1. `lightbox-nav.ts`：删除后的焦点 + 位置指示（纯函数）

`src/lib/lightbox-nav.ts` 加两个导出，同目录单测：

- `nextAfterDelete(list, currentId): string | null` —— 下一张 → 上一张 → `null`（关窗）。
  **在删除前调用**：删完当前 id 已不在 list 里，`stepAsset` 的 `findIndex < 0` 会返回 `null`，
  三种情况会退化成同一个答案。
- `positionOf(list, currentId): { index: number; total: number } | null` —— 1-based，不在列表里返回 `null`。

表驱动覆盖：首张 / 中间 / 末张 / 仅一张 / 空列表 / id 不在列表。

**验收**：变异 `nextAfterDelete` 的末张分支（改成恒取下一张）必须变红。

### 2. `openGenForm` / `openDerived3dForm` 顺带清 `lightbox`

`src/store/index.ts` 两个 action 各加 `lightbox: null`，`src/store/index.test.ts`（或就近的 store 测试）补两条。

注释要写清**为什么在 action 而不是组件**：生成先落 `pending_` 占位卡，而 lightbox 只渲染
`status === 'ready'` ⟹「表单打开 ⟹ 已离开浏览态」是语义不变式，不是某个按钮的局部行为。

**验收**：去掉任一处的 `lightbox: null`，对应用例变红。

### 3. 画布 Delete 监听给 lightbox 让位（**改既有行为，单独提交**）

`shouldTriggerCanvasDelete(key, hasSelection, activeEl)` 加第四个参数 `lightboxOpen: boolean`，
开着时返回 `false`；`AssetCanvas` 里那个 keydown effect 传入 `useStore.getState().lightbox != null`。

`src/lib/canvas-keys.test.ts` 补**两条方向相反**的用例：
- lightbox 开着 → 不触发画布删除；
- **lightbox 关着 → 既有行为一字不变**（单选直删 / 多选弹窗）。

第二条是防守卫写反的反向用例。只有第一条时，把守卫写成恒 `false` 也能全绿。

**验收**：守卫取反 → 两条同时变红（一条不够，说明反向用例没起作用）。

### 4. Lightbox 内的 Delete 键 + 删除后推进

`MediaLightbox.tsx` 既有的 keydown effect 里加 `Delete` / `Backspace` 分支：
先 `nextAfterDelete` 算好去处 → `requestDeleteAssets([currentId])` → `setLightbox(去处)`。

**顺序不能反**：先删会让 list 变化，算出来的去处就错了。

组件测试：删中间一张翻下一张 / 删末张退上一张 / 删光关窗 / 焦点在输入框时不触发。

### 5. 动作条 UI（三键 + 位置指示）

`MediaLightbox.tsx` 媒体下方加一行。三键用 `IconButton` + `FigIcon`
（`figAsset.trash` / `figAsset.plus` / `figAsset.download`），外观沿用 lightbox 内既有的
`bg-white/10` + `hover:bg-white/20` + `rounded-full` 深色浮层语汇。

- 删除 → 走任务 4 同一条路径（**抽成一个函数复用**，键盘与点击不能各写一遍）
- 派生 → `openAddMenu({ x, y, sourceId })`，锚在按钮上方；`canDeriveFrom` 为假时 `disabled`
- 下载 → `downloadAsset`，失败走既有 `DOWNLOAD_FAILED` Toast；`canDownloadAsset` 为假时 `disabled`
- 位置指示 `3 / 14`，`--font-mono`，`positionOf` 供数

**每个按钮 `onClick` 都要 `e.stopPropagation()`** —— 遮罩的 `onClick` 是关窗，
冒泡上去会点一下就关（既有翻页按钮已经踩过，照抄它们的写法）。

### 6. i18n（11 语）

三个按钮的 `aria-label` + 位置指示的读屏文案。键放 `canvas.lightbox*` 下，与既有
`lightboxPrev` / `lightboxNext` 同族。**11 个 locale 一次配齐**，不留 TODO。

### 7. 真机验收（零 credit）

在真实项目上走一遍：打开 → 翻 → 删两张（确认自动推进 + Toast 可撤销）→ 派生（确认关窗 + 表单打开）
→ 下载一张 → 检查 `3 / 14` 跟随筛选变化。
**重点验 jsdom 测不到的那些**：video 原生 controls 与动作条不打架、AddMenu 真的盖在 lightbox 之上、
按钮点击不误触关窗。

## 闸门

每个任务提交前：`pnpm lint && pnpm exec tsc --noEmit && pnpm exec vitest run <相关文件>`。
分支收尾与合并后各跑一次五道全闸门（`lint` / `tsc` / `test` / `test:tz` / `build`）——
**用 `&&` 串联**，上一轮用 `;` 串导致 tsc 非零退出被淹没、把类型错误提交了进去。

`test:tz` 与本项无关但仍要跑：它是 CI 的一步，分支不能让它红。

## 评审

每个任务提交后，派**干净上下文**的子代理基于 commit 范围独立评审（只给 spec 与 diff，不给会话历史）。
每个评审员一份**隔离的 scratchpad 副本**（`cp -R src` + 软链 `node_modules`），
**不得在共享 worktree 里就地变异** —— 上一轮六个评审员共用一份 worktree，两个跑就地变异互相污染过。

Critical / Important 修完才继续，Minor 记给终审。合并前终审全分支。
评审期间若必须往共享 worktree 落提交，**先发消息通知评审员**（上一轮违反过一次）。

## 风险

1. **任务 3 是唯一改既有行为的**。反向用例是它的主要防线。
2. **AddMenu 的定位**：锚点从卡片右缘改成动作条按钮，`x/y` 夹取进视口的逻辑是否仍成立要真机看
   （jsdom 里 `getBoundingClientRect` 全零，测不出来）。
3. **`openGenForm` 清 lightbox 会影响所有调用方**。已核实其余调用方触发时 lightbox 本就是关的，
   但这是跨功能改动，评审时要单独看一眼。

## 真机验收记录（2026-08-09，项目 1633，dev server :3016）

| 项 | 结果 |
|---|---|
| 三键 + 位置指示渲染 | ✅ `Previous/Next/Close/Delete/Generate from this asset/Download`，指示 `1 / 16`，读屏 `Item 1 of 16` |
| 动作条不覆盖媒体 | ✅ 遮罩 padding `32px 32px 96px`；媒体底边 589 < 动作条顶边 684（见下「几何复量」的重测说明） |
| 点动作不顺带关窗 | ✅ 点 Download 后窗仍在（`stopPropagation` 真机生效） |
| 派生 → AddMenu → 关窗 | ✅ 菜单夹在视口内（top 515 / left 825），选 Image 后**窗自动关**、生成表单出现 |
| 窗内删除 → 原位换下一张 | ✅ 位置 `2 / 16` → `2 / 15`，标题从「a tiny red dot…」换成「orphan regen 验收」 |
| 撤销 Toast | ✅ `Deleted / Undo`，`z-100`，可见 |
| **⌘A 全选 11 张 + 窗开着 + 真实 Delete** | ✅ **只删 1 张（净减 1，不是 11）、不弹确认弹窗**、窗口原位换下一张 —— 任务 3 的守卫真机成立 |

最后一项是本项最危险的那条，也是 jsdom 证明不了的那条（window 级监听与浮层的相互作用）。
用的是 CDP 真实键盘输入，不是合成事件。

### 途中的两个发现

1. **spec 决策 5 里「AddMenu 是 z-[56]」是错的**：实测是菜单 `z-50` + 自身遮罩 `z-40`
   （`z-[56]` 是画布浮动菜单那一档）。结论不变（50 > lightbox 的 30，盖得住），但数字已在 spec 里改正。
2. **合成 `MouseEvent` 做 ⌘ 多选会把 react-flow 打进更新风暴**
   （`Maximum update depth exceeded` → 页面白屏）。**与本分支无关** —— 我在 `dev`（`fce05439`，
   不含本分支任何改动）上跑同一段脚本，一模一样地复现。改用真实键盘 ⌘A 后一切正常。
   记下来是为了让后人别再把这个测试手法当成产品 bug 追。

### ⚠️ 验收造成的数据损失（如实记录）

**项目 1633 里 3 张测试资产被永久删除**：`acc-base.png`、`orphan regen 验收`、
`a tiny red dot on white background`（服务端资产数 16 → 13）。

原因是我的操作失误，不是产品缺陷：删除有 6 秒撤销窗口（`DELETE_GRACE_MS = 6000`），
而我把「删除」与「点撤销」放在了两次工具调用里，两次都超了窗口。
第三次改成同一次调用内完成时，探针又在 Toast 渲染出来之前就去找按钮 —— 也没点上。
这三张都是前几轮验收自己生成的测试图，不是实际工作产物；项目 1633 本身是验收专用项目。

### 采纳评审后的真机复看（2026-08-09，同一项目，零 credit，零删除）

终审把这一条从「未验到」抬成了合并前建议，理由成立：**I-1 改的是指针命中几何**
（全宽 40px 横带上哪些像素算遮罩），而 jsdom 没有布局 —— 单测只能证明「事件冒到了遮罩」，
证明不了「用户看到的那片黑真的可点」。用带坐标的真实指针事件序列复看：

| 项 | 结果 |
|---|---|
| 图片下方**偏左的黑处**（x=579，按钮簇左缘是 729） | ✅ 命中 `lightbox-actions` 横带，`data-closing` 翻 true，窗关掉 —— I-1 真机成立 |
| 点「以此派生」按钮 | ✅ 窗不关（`data-closing` 仍 false）、AddMenu 开出来 |
| AddMenu 开着按 `→` | ✅ 图片不动 —— I-2 真机成立 |
| Esc | ✅ 先关菜单、窗留着 |
| 菜单关掉后再按 `→` | ✅ 立刻恢复翻页（守卫确实是实时读） |
| M-4 修完后箭头与媒体中心 | ✅ 两者中心 Y 都是 342，偏差 0 |

动作条几何复量（H=748，content box 底边 652，图 1024×1024）：
媒体 `[95, 589]`、中心 342；横带 `[684, 724]`；**净空 95px**，不重叠；箭头中心 342、与媒体偏差 0。
位置指示 `role="img"`、`aria-label="Item 3 of 13"`。

> 这组数字是**重测过的**。第一版写的「媒体底边 343、净空 342px」自相矛盾（底边不可能与中心重合）——
> 增量评审一眼看出这三个数不能同时成立。重测才发现成因：我当时打开的那张 `acc-spawn.png`
> 是前几轮验收自己造的 **1×1 测试图**（`naturalWidth = 1`），`object-contain` 不放大 ⟹ 媒体真的只有 1px 高，
> 底边与中心确实重合。**测量没错，选的样本没有代表性** —— 拿它验「动作条不覆盖媒体」等于什么都没验。
> 换成 1024×1024 的图重量，才有上面这组。记一笔：几何验收要挑**撑满版面**的样本，
> 空/极小的样本会让「不重叠」这类结论平凡成立。

## 已知取舍（评审提出，本项明确不做）

- **`role="img"` 的碰撞只是搬了家，没消失**（终审 ①）。改掉 `role="status"` 解决的是
  「两个 live region 争播报 + 既有 `getByRole('status')` 多匹配」这个真问题；但 image 资产的
  媒体 `<img>` 隐式 role 就是 `img`，rig3d 的 `RiggedModelViewer` 也显式挂了 `role="img"` ——
  a11y 树里仍有两个。**语义上无害**（各有不同 accessible name，AT 不会打架），且全仓没有任何
  `getByRole('img')` 查询。彻底无碰撞只有一种写法：visually-hidden 文本
  （`<span className="sr-only">整句</span>` + 可见的 `2 / 3` 挂 `aria-hidden`），
  顺带能把下面「`role="img"` 读屏实际播报未验」那条未知数一并消掉。本项不改。

- **M-3 disabled 按钮上的 Tooltip 在真实浏览器里不会出现**（浏览器对 disabled 控件不派发鼠标事件）。
  于是绑骨产物那个灰掉的「派生」按钮没有任何解释。这是 `Tooltip` + `disabled` 的**通用坑**、
  不是本项引入；改法要动基础组件（wrapper 加 padding，或改 `aria-disabled` + handler 早返回）。
- ~~**M-4 `←/→` 箭头比媒体中心低 32px**~~ ✅ **已修**（终审说它「是这几条里最便宜也最该顺手做的」，
  且是本项引入的，故没有留给 Nick）。改成 `top-[calc(50%-32px)]`；真机复量：媒体中心 Y=342、
  箭头中心 Y=342、**偏差 0**。
- **M-5 下载按钮的 disabled 分支不可达**：渲染守卫已要求 `status === 'ready'` 且 `src` 非空，
  而 `canDownloadAsset` 判的就是这两件事。保留是为与 `canDeriveFrom` 对称、且将来判据收紧不用改这里。
- **N-3 「键盘归最上面那层」还剩一处不对称**：lightbox↔AddMenu 让位了，**画布↔AddMenu 没有** ——
  窗关着、在画布上点卡片「+」开了菜单、此时按 Delete，画布照删选中的卡，菜单还指着可能已被删的源。
  与 I-2 是同一条原则的另一半，属既有行为，本项没碰。要不要另起一项由 Nick 定。
- **既有的更新环**：往 store 放 assets 再渲染 `AssetCanvas`，`setRfNodes` → xyflow `setState`
  → `onSelectionChange` → `setSelection` 会打进 `Maximum update depth exceeded`。
  在 `dev`（`fce05439`）上同样复现；评审也用 diff 独立核过本分支对 `AssetCanvas.tsx` 生产代码
  只改了 2 行守卫。集成测试绕开它（守卫只看 `selectedIds.length`，不需要真节点）。

## ⚠️ 一次未能归因的偶发红（Node 22）

收尾那轮 Node 22 全量出现过 **一次 `1 failed | 3143 passed`**，随后**连跑四次全绿**（3144 passed）。
我**没有截到是哪条用例**（当时只 grep 了汇总行），因此**无法归因** —— 既不能说它属于交接文档记的
`CreativeLibraryModal.test.tsx` 那族已知偶发红，也不能排除是本分支引入的。

如实记在这里而不是含糊带过。若后续再遇到，抓失败用例名的做法是别只 grep 汇总行、
把 `^ *× ` 那几行一起留下。

## 未验到

- **翻页过程中 `selectedIds` 保持不变**（spec 成功标准 5）：只验到「开窗时画布 11 张仍选中」，
  翻了几页之后没有再查一次选中数。单测里有对应用例（约束 3），真机这一段是空的。
- **video / 3D 的动作条实际观感**：真机只在 image 上看过。padding 的推理对三种媒体都成立
  （`max-h` 是内容盒百分比），但 video 原生 controls 与动作条的视觉间距没有亲眼看过。
- **11 语的动作条渲染**：只在 en 下看过。
- **CI 真实环境**：分支未推，`--frozen-lockfile` / ubuntu 与本机的差异未验（Node 22 已在本地跑过全量）。
- **`role="img"` 的读屏实际播报**：改成 `img` 后 `aria-label` 在 jsdom 里可断言，但「虚拟光标停上去
  念的是整句、还是只念可见的 2 / 3」只有真机开读屏才听得出来。评审把握程度中等，我没验。
- ~~**评审采纳后的真机复验**~~ ✅ 已补，见上「采纳评审后的真机复看」。

