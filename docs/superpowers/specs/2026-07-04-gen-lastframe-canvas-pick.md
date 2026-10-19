# 尾帧改画布点选 + 滑杆/状态点回退绿色

Nick 反馈两点:

1. **滑杆 accent 与高级按钮「已设参数」状态点回退 `--color-live` 绿**(上一轮统一成 teal 属过度对齐;toggle 开关保持 teal 不动,那是设计稿 1743:31561 明确标注的)。
2. **video 派生的 Last frame 不再在高级浮窗里内嵌资产网格**(浮窗套浮窗、缩略图过小,体验差),改为复用「画布点选」:点 `Pick last frame` 虚线按钮 → 弹窗隐藏进入点选模式 → 在画布上点一张图片即设为尾帧(仅收 image、排除首帧源资产,覆盖式单选)。

## 实现

- `GenerateForm.picking` 从 boolean 扩为 `false | 'refs' | 'lastFrame'`,点选命中后按目标分流:`refs` 沿用多选资格规则 toggle;`lastFrame` 仅图片、`setLastFrameId` 覆盖。
- 高级面板尾帧行的 `RefPicker`(single/label 网格模式)替换为虚线按钮(样式沿用设计稿 1743:31582),点击 `setPicking('lastFrame')`。
- `RefPicker` 删除 `single`/`label` 死代码分支,只保留引用行「+」网格多选。
