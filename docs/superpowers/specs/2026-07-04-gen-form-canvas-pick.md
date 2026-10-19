# 生成面板「画布点选引用」按钮(设计稿 396:17853)

上一轮对齐(见 `2026-07-04-gen-form-figma-align.md`)漏实现了设计稿引用行最左侧的 cursor-box 按钮。本轮补齐:该按钮进入**画布点选模式**,点击画布上的资产卡直接收编为生成引用。

## 设计稿规格(396:17851 引用行,展开 3 层核对)

| 子节点 | 内容 | 处理 |
|---|---|---|
| 396:17853 Component 4 | cursor-box 图标按钮,40px / rounded-12 / fill 底 + line-2 描边 / 图标 20px | 本轮实现(画布点选入口) |
| 396:17854 Inspiration Dropdown | hidden=true | 设计稿隐藏,跳过 |
| 396:17855 Line 1 | 20px 竖分隔线 | 移到点选按钮之后(上轮在源 chip 后) |
| 396:17856 Frame 137 | 50×40 引用缩略图 chip | 上轮已实现 |
| 396:17857/17858 Component 4(plus) | 40px 添加引用按钮 | 上轮已实现(RefPicker 触发钮) |

## 交互设计

- 按钮与 RefPicker 同 gating(`canMultiRef`:image 恒有;video 仅 omni 模式),置于引用行最左,后跟竖分隔线。
- 点击进入**点选模式**:隐藏弹窗与遮罩(组件保持挂载,已填 prompt/参数/引用不丢),顶部居中显示提示条(`canvas.gen.pickHint`)。
- capture 阶段拦截全局点击:命中 `.react-flow__node` 且资产合格(ready、类型在 `refAccept`、非源资产、未超该类型上限)→ toggle 进引用;已选资产再点视为移除;命中空白或不合格资产→仅退出点选。
- Esc 在点选期只退出点选(capture + stopPropagation,先于弹窗的关闭监听),不关弹窗。
- 新图标 `figAsset.cursorBox`(`public/figma/icons/cursor-box.svg`,primary mask 重着色)。
- 新 i18n:`canvas.gen.pickFromCanvas`(按钮 aria/tooltip)、`canvas.gen.pickHint`(提示条),六语。
