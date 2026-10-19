# Retexture 3D model 弹窗按设计稿重实现

设计稿：Figma `TALUNA DEVELOPER SITE` node `5474:56443`（464×618）。承接 `2026-07-21-rig-dialog-redesign.md`：rig 弹窗已切到该设计语言，本次把 retexture 分支收敛到同一形态，`Derived3DForm` 内 rig/retexture 的容器、头部、Asset name、底部按钮全部共享，删除 `isRig` 条件样式。

## 布局（464 宽 / p-32 / 纵向 gap-24）

| 区块 | 设计稿 | 实现 |
|---|---|---|
| 标题 | 16 semibold lh24 tracking .24 | 同 rig（共享头部结构） |
| 副标题 | 12 lh16 tracking .18 muted。稿内文案是 rig 引导语的复制残留，不取 | 显示源资产名 `source.label`（12px，truncate）；rig 模式仍显示 precheck 文案（13px 是 rig 稿的值，两稿字号不同，各自保留） |
| Texture Description | 标签 14 semibold lh20 tracking .22；输入区 h94 rounded12 底 `#101112` 边框 `rgba(211,237,248,.11)` placeholder 12 `#737373` | 标签同 Animation/Asset name 共享样式；textarea `h-[94px] rounded-[12px] bg-fill border-line-2 px-[17px] py-[13px]`，placeholder 12px |
| 双列参数区 | 两列 flex gap-16，每列 gap-12：小标签(12 muted tracking .18 gap-4)+Select(h40 随内容收窄)、全宽开关(h44 py12 选中=teal 描边+primary/dark 底+14 semibold)、小标签+Select | 每列 `flex-1 flex flex-col gap-3`；Select 复用现组件 `variant="filled"`（h-10 与稿一致；稿内浅灰是未适配深色的组件实例，走令牌）；开关复用本文件 `Toggle` 并重样式为 `h-11 rounded-[8px]` 选中 `border-teal bg-teal-soft font-semibold text-ink`（primary/dark 处理同 rig 稿取舍） |
| 左列 | Image prompt → Texture → Texture quality | 保持互斥逻辑：填文字清 image prompt、选 image 清文字 |
| 右列 | Style image → PBR → Texture align | — |
| Asset name / 按钮 | 与 rig 稿一致（按钮各占可用宽一半） | 与 rig 共享同一份 JSX |

## Select 显示值

设计稿显示 `None / Detailed / Geometry`（首字母大写）。质量/对齐选项的显示 label 由原样 `detailed`/`original_image` 改为 `Standard`/`Detailed`、`Original image`/`Geometry`（值不变，仍传后端契约枚举）。

## i18n

- en `textPrompt` 按稿改 `Texture Description`（其余 10 语翻译不受大小写影响，不动）。
- 其余标签（Texture quality / Texture align / Texture / PBR / Image prompt / Style image / None / Asset name）现有 key 已与稿一致，零新增。

## 行为不变式

提交逻辑、互斥清空、Esc/遮罩关闭、submitting 防重、PgcError 保留表单全部不动；`rigBlocked` 仅作用于 rig 模式，retexture 的 Generate 不因 precheck 禁用。
