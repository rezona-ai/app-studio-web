# Create animated character 弹窗重实现——实现计划

对应 spec：`docs/superpowers/specs/2026-07-21-rig-dialog-redesign.md`。

## 任务拆分

1. **缩略图资产 + 映射纯函数**
   - `public/figma/rig/anim-<clip>.png` × 11（已就位）。
   - `src/lib/rig-animation.ts` 新增 `rigAnimationThumb(name): string | null`——`normalizeClipName` 后查 11 名映射，未知返回 null；返回值为**相对路径**，组件侧再包 `assetPath()`。
   - 测试：`rig-animation.test.ts` 补映射/前缀归一/未知名用例。
   - 验证：`pnpm exec vitest run src/lib/rig-animation.test.ts`
2. **i18n**：`derived3d.animations` 11 语改单数语义（en: `Animation`）。验证：`pnpm exec vitest run`（i18n 完整性测试）。
3. **Derived3DForm rig 分支重构**
   - 弹窗容器 rig 模式改 464 宽 / p-8 / gap-6；头部标题+副标题（副标题=precheck 文案），移除状态横幅。
   - 动作卡：3 列 grid，128×56 卡 = 48 白底缩略图 + 名字，选中/禁用态按 spec。
   - Asset name 区块与底部 Cancel/Generate 胶囊按 spec 令牌实现。
   - retexture 分支与提交逻辑不动。
   - 验证：`pnpm exec vitest run src/components/canvas`（如有相关测试）+ `pnpm exec tsc --noEmit` + `pnpm lint`。
4. **渲染比对**：Playwright 注入 store 打开弹窗截图，与设计稿截图逐项核对（尺寸/间距/字号/配色），列对照表。

## 提交

`docs:` 与 `feat:` 成对；完成后回合 dev（--no-ff）。
