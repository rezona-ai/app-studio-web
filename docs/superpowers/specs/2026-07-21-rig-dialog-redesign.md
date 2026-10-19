# Create animated character 弹窗按设计稿重实现

设计稿：Figma `TALUNA DEVELOPER SITE` node `5149:70061`（464×564，dev mode 取精确值）。

## 目的与范围

`Derived3DForm` 的 **rig3d 分支**当前是纯文字 Toggle 网格 + 状态横幅，与设计稿差距大。本次仅重做 rig3d 模式的视觉与结构；**retexture 模式不动**（设计稿未覆盖）。行为契约（precheck / 最多 5 个动作 / 提交登记异步任务 / PgcError 兜底）全部保留。

## 设计稿精确值 → 令牌映射

弹窗容器：宽 464、padding 32、纵向 gap 24。容器沿用项目模态外壳令牌（`rounded-[24px] border-line bg-surface shadow-prompt`），设计稿深色 `#222` 由 dark 主题的 `--color-surface` 承担，不硬编码。

| 区块 | 设计稿 | 实现 |
|---|---|---|
| 标题 | Inter 16 semibold lh24 tracking .24px 白 | `text-[16px] font-semibold leading-6 tracking-[0.24px] text-ink` |
| 副标题 | 13 regular lh1.5 `#a3a3a3` | `text-[13px] leading-[1.5] text-muted`；文案 = precheck 状态文案（riggable 态即 “Ready to rig. Choose the animations to embed.”），替代原状态横幅 |
| 关闭 | 16px 图标右上 | 现有 `IconButton` + `X size={16}` |
| Animation 行 | 左 “Animation” 14 semibold lh20；右计数 `3/5` 12 medium `#7b7b7b` tracking -0.12px | 左 `text-[14px] font-semibold leading-5 text-ink`；右 `text-[12px] font-medium leading-4 tracking-[-0.12px] text-muted`，格式 `n/5` |
| 动作卡网格 | 3 列、gap 8、卡 128×56 | `grid grid-cols-3 gap-2`，卡 `h-14 p-1 rounded-[8px]` |
| 卡默认态 | 边框 `#494949`（grey/400） | `border border-[var(--color-line-2)]` |
| 卡选中态 | 边框 `#1fd4cf` + 底 `#007867`（primary/dark） | `border-[var(--color-teal)] bg-[var(--color-teal-soft)]`——项目无 primary/dark 令牌，选中底统一走既有 `--color-teal-soft`（与全站选中态一致，不新增硬编码） |
| 缩略图 | 48×48 rounded 8 白底 + 角色贴图 | `size-12 rounded-[8px] bg-white` + `<img>`（object-cover） |
| 卡文字 | 14 regular 白 | `text-[14px] text-ink` |
| Asset name 标签 | 14 semibold lh20 | 同 Animation 标签 |
| 输入框 | h42 rounded 12 底 `#101112` 边框 `rgba(211,237,248,.11)` placeholder 12 `#737373` | `h-[42px] rounded-[12px] bg-[var(--color-fill)] border border-[var(--color-line-2)] px-[17px] text-[13px] placeholder:text-[12px]` |
| 按钮行 | 两枚等宽胶囊各占可用宽度一半、gap 21、h30 radius 360（Figma 里 318px 容器宽是画稿残留，不取）；Cancel 白底字 `#171717`；Generate 底 `#1fd4cf` 字 `#171717`；字 13 bold lh16 tracking .22px | `w-[318px] gap-[21px]`，`h-[30px] rounded-full flex-1 text-[13px] font-bold leading-4 tracking-[0.2223px]`；Cancel `bg-white text-[#171717]`→ 用恒浅色 CTA 语义：`bg-[var(--color-pill,white)]`? 无对应令牌，用 `bg-white text-[var(--color-on-teal)]`（`--color-on-teal`=#171717 恒定不翻）；Generate `bg-[var(--color-teal)] text-[var(--color-on-teal)]`（同 TopupModal 先例） |

## 缩略图资产

设计稿每卡可见缩略图即最顶层贴图，共 11 张，已压缩为 96px 存 `public/figma/rig/anim-<clip>.png`（walk/jump/run/idle/slash/grab/hurt/block/special/down/pose）。

动作预设来自后端 precheck（非人形拓扑动作名不同），前端以 `normalizeClipName` 后的名字查缩略图映射；**未知动作名退化为白底空缩略图**，卡片布局不变。图片路径必须经 `assetPath()`（basePath 约束）。

## 加载态（设计稿未覆盖，补充约定）

动作全集依赖后端 precheck 返回；`checking` 且尚无 presets 时，网格渲染 6 张骨架卡（同尺寸 128×56，缩略图与文字条用全局 `.skeleton-shimmer`），避免空网格塌陷；数据到达后原位替换。

## 交互与行为（不变式）

- precheck 五态沿用；非 riggable 态副标题显示对应文案，网格保留但 Generate 禁用（原逻辑 `rigBlocked`）。
- 勾选上限 5：达上限时未选卡禁用（`disabled` + opacity）。
- Esc / 遮罩 / Cancel 关闭走 `useRequestClose` 退场动画；提交成功关闭，PgcError 保留表单。
- 无障碍：卡片为 `button[aria-pressed]`，计数 `aria-live="polite"`。

## i18n

- `derived3d.animations` 文案改为单数 “Animation”（11 语同步），仅 rig 弹窗使用该 key（grep 确认）。
- 副标题复用 `derived3d.precheck.*`，无新增 key。

## 取舍

- 不新建通用“缩略图选择卡”组件（目前仅此一处用，YAGNI）；样式内联于 `Derived3DForm`。
- 选中底色不引入 `#007867` 新令牌，走 `--color-teal-soft`——保持全站选中态一致；若设计组坚持 primary/dark 再补令牌。
- Cancel/Generate 胶囊不改造 `Button`（`.btn-raised` 是另一种 CTA 形态），按 TopupModal 先例内联 token 化样式。
