# 资产生成面板对齐设计稿 396:17849

对照 Figma「Prompt Input」(TALUNA DEVELOPER SITE, node 396:17849) 优化画布资产生成面板(`GenerateForm` 及其子控件)的视觉细节。仅视觉层对齐,不改生成参数 schema、请求组装与落卡逻辑。

## 设计稿关键规格

- 卡片:p-12 / rounded-24 / gap-24(现状已一致)。
- 引用行:组间 gap-12;引用资产为**纯缩略图 chip 50×40 rounded-10**(无文字标签);添加引用为 **40px 图标按钮**(plus 20px,rounded-12,填充底 + 描边);源 chip 与多选引用组之间有 20px 竖分隔线。
- prompt 输入区:四周 p-8,文字 15px/24 tracking -0.3(现状字体一致,补齐 padding)。
- 底部参数 pill:h-40 / **rounded-8(= --radius-control)** / bg fill + 描边 line-2 / **无阴影** / 内衬 p-8;「标签(muted 灰)+ 值(ink)」间距 4px,与 chevron 间距 8px;chevron 统一 16px。
- 模型 pill 同参数 pill 规格(rounded-8)。
- 高级设置:**40px 方形图标按钮**,rounded-10,填充底无描边,居中 16px adjustments 图标(新增设计图标)。
- 提交按钮:40px,**恒 rounded-12**(不再随激活态在 10/12 间切换)。

## 变更点

| 文件 | 变更 |
|---|---|
| `ui/figma.tsx` + `public/figma/icons/adjustments.svg` | 登记设计稿 adjustments 图标(primary,mask 重着色) |
| `ui/Select.tsx` | 圆角按 variant 派生:filled=8px(生成面板),plain 保持 12px(Composer);filled 去阴影 |
| `canvas/GenParamControls.tsx` | pill 圆角 12→8、去阴影;标签改 muted 色;chevron 14→16;AdvancedPill 改方形图标按钮 |
| `canvas/RefPicker.tsx` | 多选触发钮改 40px 图标按钮(plus);保留尾帧场景的虚线文字按钮;文案接入 i18n |
| `canvas/GenerateForm.tsx` | RefChip 有缩略图时改 50×40 纯图 chip(hover 浮层显移除);引用行 gap-12 + 源/引用间分隔线;textarea p-8;提交钮恒 rounded-12 |
| `i18n/locales/*.ts` | 新增 `canvas.gen.addRef` / `canvas.gen.noRefAssets`(六语) |
