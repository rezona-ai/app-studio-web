# Retexture 弹窗重实现——实现计划

对应 spec：`docs/superpowers/specs/2026-07-21-retexture-dialog-redesign.md`。

1. **i18n**：en `textPrompt` → `Texture Description`。验证：i18n 完整性测试。
2. **Derived3DForm 收敛**：容器/关闭钮/名称字段/底部胶囊按钮去掉 `isRig` 条件（统一 464/p-8/gap-6 与 rig 版样式）；retexture 头部副标题改 source.label（12px）；重排 retexture 分支为双列布局；`Toggle` 重样式（h-11、选中 teal 描边+soft 底+semibold）；质量/对齐选项显示 label 首字母大写。
   验证：`pnpm exec vitest run src/components/canvas/Derived3DForm.test.tsx` + `tsc --noEmit` + `lint`。
3. **渲染比对**：Playwright + mock PGC 打开 retexture 弹窗截图，对照设计稿逐项核对。

提交 `docs:` + `feat:` 成对；完成后 `--no-ff` 回合 dev。
