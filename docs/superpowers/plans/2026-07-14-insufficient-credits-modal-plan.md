# 积分不足弹窗实现计划

对应设计稿：`docs/superpowers/specs/2026-07-14-insufficient-credits-modal.md`

## 步骤

1. **资产**：落 `insufficient-chest.webp` / `insufficient-swirl.jpg` / `icons/arrow-right.svg`；`figma.tsx` 登记 `arrowRight`（secondary）。
2. **抽共享 hook `src/client/useTopupFlow.ts`**：从 `TopupModal` 平移配置拉取 / 券倒计时 / 建单轮询取消 / 埋点逻辑，行为零变化；`TopupModal` 改为消费 hook，原单测全部保持绿。
3. **新组件 `src/components/ui/InsufficientCreditsModal.tsx`**：按设计稿实现 hero / 描述行 / 券横幅 / 三卡 / view-all / 全宽 CTA；默认选中第二档；waiting 态与取消。
4. **分流**：`Workspace.tsx` 按 `creditModalOpen` 来源渲染两个弹窗之一（均 dynamic import）。
5. **i18n**：六语新增 `insufficient.*`。
6. **测试**：`InsufficientCreditsModal.test.tsx`（渲染档位 / 默认第二档 / CTA 建单带 package_id / enabled=false 回落 / view-all 切 manual / 关闭）；跑全量 lint + tsc + test。
7. **运行态核验**：Playwright + mock `/api/*`（既有套路）截图比对设计稿。

## 验收

- insufficient 触发弹新弹窗，manual 仍弹 TopupModal，支付全链路行为与现网一致。
- CI 四件套（lint / tsc / test / build）全绿。
