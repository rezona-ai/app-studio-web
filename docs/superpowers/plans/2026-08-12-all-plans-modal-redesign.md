# 实现计划：all-plans 弹窗改版为 `9433:70184`

- spec：[2026-08-12 完整订阅弹窗改版](../specs/2026-08-12-all-plans-modal-redesign.md)
- 分支：`feat/all-plans-modal-redesign`（worktree `.orca/worktrees/all-plans-modal-redesign`）
- 推进方式：**并存加新 → 原子切换 → 删旧**；每个任务一个提交，可独立测试、独立评审
- ⚠️ 本回合按会话约束**不派子代理做逐提交评审**（会话内明确禁用 Agent 工具）；改为每个任务自带测试 + 合并前完整验证 + Nick 目测。若要恢复子代理评审，说一声即可。

## 任务 0：定位 Creator 档 CTA 填充失效的根因

- 现象：截图里 Creator 卡 CTA「Upgrade to Creator」无底色，Starter（白）/ Max（橙）正常。`TIER_CTA.creator = bg-[var(--color-cta-highlight)]`。
- 先写失败测试（`PlanCard.test.tsx`）断言 creator 卡 CTA 携带该填充类；再查 `--color-cta-highlight` 是否只定义在 `:root` 而在 `[data-theme="dark"]` 下被覆盖 / 是否被 Tailwind v4 任意值扫描漏掉。
- **定位到根因再改**；若根因属旧实现且新卡不复现，仍要在 commit message 写清结论（铁律 2）。
- 验证：`pnpm exec vitest run src/components/ui/PlanCard.test.tsx`

## 任务 1：`globals.css` 落 `--upsell-*` 令牌与四个样式类

- 令牌集中一处（spec §令牌），`.upsell-badge` / `.upsell-key` / `.upsell-strike` / `.upsell-card-sheen` 四个类；无新动效、无新 keyframes。
- 此时无人引用，纯增量，UI 零变化。
- 验证：`pnpm exec tsc --noEmit` + `pnpm build`（确认 Tailwind v4 能产出这些自定义属性）。

## 任务 2：hero 素材落库 + `UpsellHero` 新增 `upgradeForMore` 变体

- 素材：吉祥物实验室透明底 PNG（1.6MB）→ webp 压缩落 `public/figma/upgrade-lab.webp`；台面底纹 → `public/figma/upgrade-podium.webp`；清掉 `public/figma/tmp-9433-70184/`。
- `UpsellHero` 新增变体 `upgradeForMore`（橙渐变底 + color-dodge 底纹 + 位图右侧出血 + 字标 `Upgrade` / `for more` + inset 光晕），**保留** `welcomeBack` 变体不动（并存）。
- 图片路径必经 `assetPath()`（basePath 铁律）。
- 验证：`pnpm exec vitest run src/components/ui/`（现有用例不回归）+ dev 截图确认 hero。

## 任务 3：新建 `PlanCardDark` + 单测（TDD，先红后绿）

- 新组件，恒暗纵向排版，只引用任务 1 的令牌；数据映射复用 `plan-display.ts` 不改。
- 测试（spec §测试要求第 1 条）先写，跑红，再实现到绿。
- 此时 `AllPlansModal` 仍用旧 `PlanCard column`，线上行为不变。
- 验证：`pnpm exec vitest run src/components/ui/PlanCardDark.test.tsx`

## 任务 4：原子切换 + 删旧

- `AllPlansModal`：hero 换 `upgradeForMore`；说明行改为恒定新 key（新增 `upsell.descAllPlans`，四语言 `en/zh-TW/es/de` 同步；`descLowBalance` 若无其他引用则删）；三卡换 `PlanCardDark`；壳按稿调（backdrop 0.8 + blur、恒暗面、gap 16）。
- 删旧：`PlanCard` 去掉 `column` 分支与 `TIER_SURFACE`/`TIER_CTA`/`PlanCta` 中只服务 column 的部分；`UpsellHero` 删 `welcomeBack` 变体（无引用后）；同步删对应测试用例。
- 更新 `AllPlansModal.test.tsx`（两种 source 文案一致 + hero 变体 + 失败态 + 关闭）。
- 验证：`pnpm lint && pnpm exec tsc --noEmit && pnpm test`

## 执行记录（2026-08-12）

| 任务 | 提交 | 结论 |
|---|---|---|
| 0 根因 | 并入任务 1 的 commit message | 非源码缺陷,是浏览器旧 CSS chunk;新实现改真类从结构上规避 |
| 1 令牌 | `111e172` | `--upsell-*` + 四组样式类;顺带确认 @theme 里**未被引用**的令牌会被 Tailwind v4 摇掉 |
| 2 hero | `6c0cf67` | 素材转 jpg(226KB / 7KB);本机 sips 不能写 webp |
| 3 新卡 | `ab4d4cc` | 先红后绿,9 条用例 |
| 4 切换+删旧 | `ca5882a` | 11 份 locale 补 `descAllPlans`;删 column 分支 / welcomeBack / `.hero-wordart-outlined` |
| 5 走查 | `5babf4e` | 实截发现 hero 图层顺序与价格行折行两处,已修 |

## 任务 5：视觉走查与终审

- `pnpm dev` 起本地，四种档位分别触发（free 走 all-plans），Chrome DevTools 截图与 `9433:70184` 逐块比对：hero、说明行、三卡面/徽标/价格行/CTA/权益色。
- 浅色主题下复查弹窗仍恒暗、对比度达标。
- 全量验证：`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 四条命令的完整输出与退出码贴回。
- Nick 目测确认后 `--no-ff` 合并回 `dev`，合并结果上重跑全量验证，再跑 `/walkthrough` 更新功能地图。

## 回滚

改动集中在 `AllPlansModal` / `PlanCardDark` / `UpsellHero` / `globals.css` 四处，任务 4 的切换提交单独回滚即可退回旧视觉（旧组件在任务 4 内删除，回滚该提交同时恢复）。
