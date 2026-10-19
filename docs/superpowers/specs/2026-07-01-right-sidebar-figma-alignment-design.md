# 右边栏（Preview 栏）空态完全对齐 Figma 设计稿

- 日期：2026-07-01
- 设计来源：Figma `TALUNA DEVELOPER SITE` 节点 **1527-40709**（"Right Sidebar"，299×900，**dark 模式**）
- 涉及组件：`src/components/preview/PreviewPanel.tsx`、`UserInfo.tsx`、`PreviewTabs`（PreviewPanel 内）、`VersionTimeline.tsx`；全局令牌 `src/app/globals.css`
- 关联图标资产：`public/figma/icons/`

## 1. 背景与目标

右栏（Chat | Canvas | **Preview**）的空态/初始界面与最新 Figma 设计稿存在偏差，主要集中在**暗色灰阶**与**空态结构细节**两类。本次目标：让右栏**空态**逐项对齐设计稿 1527-40709，并把**暗色主题令牌**校准到设计稿的中性灰阶（全局生效）。

设计稿用了 **Figma 变量模式（light/dark）**，右栏在 dark 模式下解析到一套干净的中性灰阶（`grey/900 #171717` → `grey/400 #494949`）——这就是全局暗色调色板，因此令牌映射可精确对位。

## 2. 范围

**在范围（本次做）：**

- 全局暗色令牌（`[data-theme="dark"]`）的「面 / 填充」灰阶校准（影响全站，属令牌级一致性变更）。
- 右栏**空态**（`hasGame === false`）的结构 / 间距 / 描边 / 图标对齐。

**不在范围（本次不做）：**

- 右栏**有版本态**的结构（版本列表 / Draft·Live·Publish 行 / 游戏预览 / Compare 视图）——仅其颜色随全局令牌自然变化，结构不动。
- 中栏 Canvas、左栏 Chat 的结构——仅颜色随全局令牌变化，改完目视核对。
- 头像真图：后端 `/auth/me` 不返回头像 URL，沿用首字母占位（见 §6 偏差说明）。

## 3. 决策记录（已与用户确认）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 对齐状态范围 | **仅空态 / 初始界面** |
| D2 | 颜色对齐程度 | **全局暗色令牌对齐设计稿** |
| D3 | 面板宽度 | **保持现网响应式**（`w-[28%] min-w-[360px] max-w-[460px]`，不收窄到稿面 299px） |
| D4 | 分段 tab 样式 | **改为仅图标（eye / folder）+ Tooltip + aria-label**（去掉 Preview/Files 文字标签） |
| D5 | 新增「Tap」手势图标 | **暂不加**（功能未定义，避免常禁用、无 handler 的 dead button），右侧保持「下载 + 刷新」两个 |

## 4. 全局暗色令牌映射（`globals.css` 的 `[data-theme="dark"]`）

设计稿 dark 灰阶（经节点精确用法证实）：
`grey/900 #171717`（根底） · `grey/800 #202020`（面板/舞台/tab 容器/图标按钮） · `grey/700 #262626`（分享按钮底） · `grey/500 #404040`（icon/disable） · `grey/400 #494949`（line/default + 激活 tab 底）。

| 令牌 | 现值 | → 新值 | 依据 |
|---|---|---|---|
| `--color-canvas` | `#141718` | **`#171717`** | grey/900（右栏根底 `background/grey`） |
| `--color-surface` | `#232627` | **`#202020`** | grey/800（`background/grey-800`：面板/舞台/tab 容器/图标按钮底） |
| `--color-surface-2` | `#2c2c2e` | **`#262626`** | grey/700（分享按钮底 `text/caption`） |
| `--color-fill` | `#313335` | **`#2e2e2e`** ⚠️ | 插值（右栏未用到；维持「hover 比 surface-2 略浅」的灰阶连续性） |
| `--color-pop` | `#1c1e1f` | **`#1a1a1a`** ⚠️ | 插值（右栏未用到；维持「浮层略深于 surface + 模糊」语义） |
| `--color-ink` | `#fcfcfc` | 不变 | Text/Primary(dark) |
| `--color-muted` | `#7b7b7b` | 不变 | Text/Secondary |
| `--color-line` / `-2` / `-strong` | `#222222`/`#323232`/`#494949` | **不变** | 三者已是设计稿灰值（`Shade8`/`RZN-750`/`grey-400`） |

⚠️ `fill`/`pop` 为插值项（设计稿未在右栏给 dark 直值），低风险，落地后逐栏目视核对，可随时回退。
同步检查 `globals.css` 内其它引用上述变量处（如 `--color-skeleton-hi #45484b` 与新 `fill #2e2e2e` 的明度差需仍可见微光，必要时微调）。

## 5. 右栏空态结构规格（逐项，括号内为设计稿 px）

> 描边一律用 `--color-line-strong`（`#494949` = `line/default`），替换现用的 `--color-line`。

### 5.1 根容器（`PreviewPanel` 最外层）

- `bg-[var(--color-surface)]` → **`bg-[var(--color-canvas)]`**（根底 grey/900 #171717）
- `border-l border-[var(--color-line)]` → **`border-l border-[var(--color-line-strong)]`**

### 5.2 账户条（Header，节点 1527:33324）

- 容器：`px-3 py-2`（12 / 8）**已对**；**移除 `border-b`**（该分隔线由 tab 行的 `border-t` 承担，见 5.3）。
- 分享按钮（"Tab-Overview" forward）：
  - 图标：现用 `figAsset.share`（发送箭头）→ **新增并改用 `figAsset.forward`**（设计稿 `forward` 转发曲线箭头，**水平镜像** `flipX`），`size 18 → 16`，`tone primary`。
  - 容器：`IconButton variant="bordered"`（带边框）→ **`variant="ghost"`（无边框）**；底色 `bg-[var(--color-surface-2)]`（#262626）；`rounded-[10px] → rounded-[8px]`；`p-1.5 → px-4 py-2`（16 / 8）。
- `UserInfo`（节点 1527:33329 / 33334）：
  - credit 闪电：teal，`size 14`（稿面 ≈10×13，沿用 14 可）；`"0"` Inter Bold 14 / leading-24 / teal **已对**；`"credit"` 12 / leading-18 / 文字色沿用 `--color-ink`，补 `tracking-[0.18px]`。
  - 头像：`size-8`（32）/ `rounded-full`；边框沿用 `--color-line-2`（主题安全，见 §6），首字母占位不变。

### 5.3 tab 行（Camera Header，节点 1527:33338）

- 容器：`h-12`（48）**已对**；`px-4 py-2 → px-3 py-3`（12 / 12）；`border-b border-[var(--color-line)]` → **`border-t border-[var(--color-line-strong)]`**（分隔线置于 tab 行**上方**，即账户条与 tab 行之间）。
- `PreviewTabs` 分段容器（节点 1527:33339）：
  - 底色 `bg-[var(--color-canvas)]` → **`bg-[var(--color-surface)]`**（#202020）；`p-1`（4）/ `rounded-[12px]` **已对**。
  - **去掉文字标签**（D4），tab 仅渲染图标 `eye-show` / `folder`（`size 16`），外包 `Tooltip` + `aria-label`（复用 `preview.tabPreview` / `preview.tabFiles`）。
  - 激活态：底色 `bg-[var(--color-surface-2)]` → **`bg-[var(--color-line-strong)]`**（#494949，设计稿激活 pill 底；注释说明「描边令牌复用为激活底」）；`px-4`（16）**已对**；`py-2 → py-1`（4）；`rounded-[8px]` **已对**；图标 `tone primary`。
  - 未激活态：透明 **已对**；`px-4 py-1`；图标 `tone secondary`。
- 右侧图标组（节点 1527:33346）：`gap-2`（8）**已对**。
  - **保持「下载 + 刷新」两个**（D5：不加 Tap）。
  - 每个按钮：`IconButton variant="bordered" → "ghost"`（无边框）；底色 `bg-[var(--color-surface-2)]` → **`bg-[var(--color-surface)]`**（#202020）；`rounded-[12px] → rounded-[10px]`（稿面 9.6，取 10 贴齐圆角档）；`p-2`（h≈32）**已对**；图标 `size 20 → 16`。
  - 禁用态（空态下 `disabled`）：`IconButton` 现为 `opacity-30`，目视近似设计稿 `icon/disable #404040`，**作为已知微差保留**（不改全局 `IconButton`，见 §6）。

### 5.4 舞台 / 空预览区（节点 1527:33356）

- 舞台容器（包裹 empty / GameFrame 的 `flex-1` 区）：底色 → **`bg-[var(--color-surface)]`**（#202020）；加 **`border-t border-b border-[var(--color-line-strong)]`**（#494949，舞台上下各一条分隔线）。
  - 现网两条分隔线分别表达为：tab 行 `border-b`（→ 改为舞台 `border-t`）与 `VersionTimeline` 根 `border-t`（→ 舞台/版本区之间，改色 line-strong）。实现以「视觉位置一致 + 颜色 line-strong」为准。
- 空态提示语（节点 1527:33357）：
  - 颜色 `text-[var(--color-ink)]` → **`text-[var(--color-muted)]`**（#7b7b7b）。
  - 加 **`max-w-[206px]`** 居中；`text-[15px] leading-6 tracking-[-0.3px]` Regular / center **已对**。

### 5.5 Versions 头（节点 1559:55952 / 55953）

- 头部行：`px-4 py-3 → px-3 py-3`（12 / 12）；**加 `border-b border-[var(--color-line-strong)]`**（#494949，"Versions" 标题下方分隔线）。
- "Versions" 文字：`text-[12px] font-semibold leading-4 tracking-[-0.12px]` **已对**。
- Compare 按钮：空态下设计稿为 `opacity-0` 占位；现网为条件不渲染（`versions.length > 0`），**视觉等价，保留现状**。

## 6. 已知偏差与理由

- **头像边框**：设计稿用 `0.8px white`；现网沿用 `--color-line-2`（主题安全，浅色稿下白边不可见）。头像本就是无后端图的首字母占位，保留主题感知边框。
- **禁用图标色**：设计稿 `#404040`；现网 `IconButton` 用 `disabled:opacity-30`（白图标 30% ≈ 偏亮）。改全局 `IconButton` 超出范围，作为微差保留。
- **面板宽度**：设计稿 299px；保留响应式（D3）。
- **fill / pop 令牌**：插值，非设计稿右栏直值（§4 ⚠️）。

## 7. 新增图标资产

- `public/figma/icons/forward.svg`：取自设计稿节点 `1527:33327`（forward / 转发曲线箭头，`viewBox 14.6667×12`）。在 `figma.tsx` 注册 `figAsset.forward`，`ICON_TONE` 归类 `primary`（随 currentColor 翻转）。渲染时 `flipX`（设计稿 `-scale-x-100`）。

## 8. 验收标准

1. dark 主题下右栏空态与节点 1527-40709 截图逐项一致：根底 #171717、舞台 #202020、分隔线 #494949 清晰可见、空提示语 #7b7b7b、tab 仅图标且激活 pill #494949、右侧 2 个无边框图标按钮 #202020。
2. 全局 dark 令牌改动后，Chat / Canvas / 有版本态目视无破绽（面更扁平更深，符合设计稿语汇）。
3. light 主题不受影响（仅改 `[data-theme="dark"]` 块）。
4. 防白闪内联脚本（`layout.tsx`，硬编码 `taluna-v4`/`theme`）无需改动（仅改令牌值，未动 persist 配置）。
5. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` 通过；相关组件测试（`PreviewPanel.test.tsx` 等）按新结构更新且通过。
